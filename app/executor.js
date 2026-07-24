'use strict';

const path   = require('path');
const fs     = require('fs');
const fse    = require('fs-extra');
const os     = require('os');
const crypto = require('crypto');
const Sftp   = require('ssh2-sftp-client');

const { decrypt } = require('./crypto');
const data        = require('./data');
const logger      = require('./logger');
const pgp         = require('./pgp');

// Overridable via _setDataDir() for testing
let _credFile = path.join(__dirname, '../data/credentials.enc');

// ── Glob matching ─────────────────────────────────────────────────────────────

function matchesGlob(relPath, pattern) {
  if (!pattern) return true;
  const fp = relPath.replace(/\\/g, '/');
  // ? must be replaced BEFORE **/ so we don't corrupt the '?' in '(?:.+/)?'
  const re = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex metacharacters
    .replace(/\?/g,     '[^/]')              // ? → single non-separator char
    .replace(/\*\*\//g, '(?:.+/)?')          // **/ → zero or more path segments
    .replace(/\*\*/g,   '.*')                // ** alone → anything
    .replace(/\*/g,     '[^/]*');            // * → anything except /
  return new RegExp(`^${re}$`).test(fp);
}

// ── Local directory listing ───────────────────────────────────────────────────

async function listLocalFiles(dirPath, filter, ruleName) {
  await fs.promises.access(dirPath);

  const recursive = Boolean(filter && filter.includes('**'));
  const results = [];
  let totalEntries = 0;
  let fileLikeEntries = 0;
  let skippedNonFiles = 0;

  async function walk(dir, rel) {
    let dirHandle;
    try {
      dirHandle = await fs.promises.opendir(dir, { bufferSize: 512 });
    } catch (err) {
      logger.error(`[transfer] "${ruleName}" | opendir failed: ${dir} | ${err.stack || err.message}`);
      throw err;
    }

    const subdirs = [];

    try {
      for await (const entry of dirHandle) {
        totalEntries++;
        const relEntry = rel ? `${rel}/${entry.name}` : entry.name;
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (recursive) subdirs.push({ absPath: fullPath, rel: relEntry });
          continue;
        }

        let st;
        try {
          st = await fs.promises.stat(fullPath);
        } catch (err) {
          logger.warn(`[transfer] "${ruleName}" | stat failed: ${fullPath} | ${err.message}`);
          continue;
        }

        if (!st.isFile()) {
          skippedNonFiles++;
          logger.warn(`[transfer] "${ruleName}" | non-file skipped: ${fullPath}`);
          continue;
        }

        fileLikeEntries++;

        if (!filter || matchesGlob(relEntry, filter)) {
          results.push({
            name: entry.name,
            path: fullPath,
            relPath: relEntry,
            size: st.size
          });
        }
      }
    } catch (err) {
      logger.error(`[transfer] "${ruleName}" | iterator error at "${dir}": ${err.stack || err.message}`);
      throw err;
    }

    for (const sub of subdirs) {
      await walk(sub.absPath, sub.rel);
    }
  }

  await walk(dirPath, '');

  logger.info(`[DEBUG] [transfer] "${ruleName}" | total dir entries: ${totalEntries}`);
  logger.info(`[DEBUG] [transfer] "${ruleName}" | stat-confirmed files: ${fileLikeEntries}`);
  logger.info(`[DEBUG] [transfer] "${ruleName}" | skipped non-files: ${skippedNonFiles}`);
  logger.info(`[DEBUG] [transfer] "${ruleName}" | after name filter: ${results.length}`);

  return results;
}

// ── Path resolution ───────────────────────────────────────────────────────────

function resolveLocalDir(profile, rulePath) {
  const base = profile.path || '';
  if (!rulePath) return path.win32.normalize(base || '.');
  // Absolute Windows or UNC path in rulePath overrides the profile base entirely
  if (path.win32.isAbsolute(rulePath) || rulePath.startsWith('\\\\')) {
    return path.win32.normalize(rulePath);
  }
  // Relative path — must stay within the profile base
  const resolved     = path.win32.normalize(path.win32.join(base, rulePath));
  const normalBase   = path.win32.normalize(base || '.');
  if (base && !resolved.startsWith(normalBase + path.win32.sep) && resolved !== normalBase) {
    throw new Error(
      `Path traversal rejected: "${rulePath}" escapes profile base "${base}"`
    );
  }
  return resolved;
}

function resolveSftpDir(profile, rulePath) {
  return (rulePath || profile.remotePath || '/').replace(/\\/g, '/');
}

// ── Date part helper (shared by rename and zip bundle naming) ─────────────────

function buildDatePart(format) {
  const now = new Date();
  const Y   = now.getFullYear();
  const M   = String(now.getMonth() + 1).padStart(2, '0');
  const D   = String(now.getDate()).padStart(2, '0');
  const h   = String(now.getHours()).padStart(2, '0');
  const m   = String(now.getMinutes()).padStart(2, '0');
  const s   = String(now.getSeconds()).padStart(2, '0');
  switch (format) {
    case 'YYYYMMDD':            return `${Y}${M}${D}`;
    case 'YYYY-MM-DD':          return `${Y}-${M}-${D}`;
    case 'YYYY-MM-DDTHH-MM-SS': return `${Y}-${M}-${D}T${h}-${m}-${s}`;
    case 'YYYYMMDD_HHMMSS':     return `${Y}${M}${D}_${h}${m}${s}`;
    case 'MM-DD-YYYY':          return `${M}-${D}-${Y}`;
    case 'DD-MM-YYYY':          return `${D}-${M}-${Y}`;
    case 'UNIX':                return String(Math.floor(now.getTime() / 1000));
    case 'CYYMMDD': {
      const c = Math.floor(Y / 100) - 19;
      return `${c}${String(Y).slice(2)}${M}${D}`;
    }
    default: return `${Y}${M}${D}`;
  }
}

// ── Rename transform helper ───────────────────────────────────────────────────

function applyRename(fileName, renameConfig) {
  const {
    position = 'prefix', format = 'YYYYMMDD', separator = '_',
    customText = '', customPosition = 'prefix',
    includeDate = true, // false = skip the date prefix/suffix entirely, custom text only
  } = renameConfig;
  const sep  = separator ?? '_';
  const ext  = path.extname(fileName);
  let base = path.basename(fileName, ext);

  if (includeDate) {
    const datePart = buildDatePart(format);
    base = position === 'suffix'
      ? `${base}${sep}${datePart}`
      : `${datePart}${sep}${base}`;
  }

  const custom = (customText || '').trim();
  if (custom) {
    base = customPosition === 'suffix'
      ? `${base}${sep}${custom}`
      : `${custom}${sep}${base}`;
  }

  return `${base}${ext}`;
}

// ── Zip helpers ───────────────────────────────────────────────────────────────

function resolveZipBundleName(zipConfig, ruleName, firstFileName) {
  const template = zipConfig.bundleName || '{rulename}_{date}';
  const datePart = buildDatePart(zipConfig.dateFormat || 'YYYYMMDD');
  const safeName = (ruleName || 'rule').replace(/[^a-zA-Z0-9_\-.]/g, '-');
  const fileBase = firstFileName
    ? path.basename(firstFileName, path.extname(firstFileName))
    : 'bundle';
  return template
    .replace(/\{rulename\}/gi, safeName)
    .replace(/\{date\}/gi,     datePart)
    .replace(/\{filename\}/gi, fileBase);
}

async function createZip(files, outputPath, level) {
  const archiver = require('archiver');
  await fse.ensureDir(path.dirname(outputPath));
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: level ?? 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) archive.file(f.path, { name: f.name });
    archive.finalize();
  });
}

async function extractZip(zipPath, destDir) {
  const unzipper = require('unzipper');
  await fse.ensureDir(destDir);
  return new Promise((resolve, reject) => {
    fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: destDir }))
      .on('close', resolve)
      .on('error', reject);
  });
}

// ── Low-level local transfer primitives ──────────────────────────────────────

/**
 * Copies a single local/UNC file.  Writes to .tmp on the destination side
 * then renames — the destination directory is created if it does not exist.
 */
async function copyFile(srcPath, destPath) {
  await fse.ensureDir(path.dirname(destPath));
  const tmp = destPath + '.tmp';
  await fse.copy(srcPath, tmp, { overwrite: true });
  fs.renameSync(tmp, destPath);
}

/**
 * Moves a single local/UNC file: copy → verify byte counts → delete source.
 * Never deletes the source if copy or verification fails.
 */
async function moveFile(srcPath, destPath) {
  await copyFile(srcPath, destPath);
  const srcSize  = fs.statSync(srcPath).size;
  const destSize = fs.statSync(destPath).size;
  if (srcSize !== destSize) {
    logger.error(`[executor] Size verify failed: src=${srcSize}B dest=${destSize}B "${path.basename(destPath)}"`);
    try { fs.unlinkSync(destPath); } catch {}
    throw new Error(
      `Size mismatch after copy (src=${srcSize} dest=${destSize}) — source not deleted`
    );
  }
  fs.unlinkSync(srcPath);
}

/**
 * Deletes a file.  Silently succeeds when the file does not exist.
 */
async function deleteFile(filePath) {
  try { fs.unlinkSync(filePath); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
}

/**
 * Lists files at a local/UNC directory path (or .path / .remotePath of a
 * profile object).  Supports glob patterns including ** for recursion.
 * Returns [{ name, path, relPath, size }].  Returns [] for missing paths.
 */
async function listFiles(profileOrPath, filter) {
  const dirPath = typeof profileOrPath === 'string'
    ? profileOrPath
    : (profileOrPath.path || profileOrPath.remotePath || '');
  return listLocalFiles(dirPath, filter || null);
}

// ── Credential resolution ─────────────────────────────────────────────────────

function resolveCredential(credentialRef) {
  let raw;
  try { raw = fs.readFileSync(_credFile, 'utf8').trim(); }
  catch (err) {
    if (err.code === 'ENOENT')
      throw new Error(`Credentials file missing — cannot resolve ref "${credentialRef}"`);
    throw err;
  }
  const store = JSON.parse(decrypt(raw));
  const value = store[credentialRef];
  if (value == null)
    throw new Error(`Credential ref "${credentialRef}" not found in store`);
  return value;  // password string — never logged
}

// ── SFTP connection pool ──────────────────────────────────────────────────────

async function getSftpClient(profile, pool) {
  if (pool.has(profile.id)) return pool.get(profile.id);
  const credential = resolveCredential(profile.credentialRef);  // throws early if cred missing
  const client = new Sftp();
  const connOpts = { host: profile.host, port: profile.port || 22, username: profile.username };
  if (profile.authType === 'key') {
    connOpts.privateKey = credential;  // never echoed to logs
  } else {
    connOpts.password = credential;    // never echoed to logs
  }
  await client.connect(connOpts);
  pool.set(profile.id, client);
  return client;
}

async function sftpListFiles(client, remotePath, filter) {
  let entries;
  try { entries = await client.list(remotePath); }
  catch { return []; }
  const base = remotePath.replace(/\/$/, '');
  return entries
    .filter(e => e.type === '-')
    .filter(e => !filter || matchesGlob(e.name, filter))
    .map(e => ({ name: e.name, path: `${base}/${e.name}`, relPath: e.name, size: e.size, mtime: e.modifyTime }));
}

async function sftpGetFile(client, remotePath, localDest, expectedSize) {
  await fse.ensureDir(path.dirname(localDest));
  const tmp = localDest + '.tmp';
  await client.get(remotePath, tmp);
  const actual = fs.statSync(tmp).size;
  if (actual !== expectedSize) {
    logger.error(`[executor] SFTP get verify failed: expected=${expectedSize}B got=${actual}B "${remotePath}"`);
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error(
      `SFTP get size mismatch: expected=${expectedSize} got=${actual} path="${remotePath}"`
    );
  }
  fs.renameSync(tmp, localDest);
}

async function sftpPutFile(client, localSrc, remoteDest) {
  const tmp = `${remoteDest}.tmp`;
  await client.put(localSrc, tmp);
  const remoteSize = (await client.stat(tmp)).size;
  const localSize  = fs.statSync(localSrc).size;
  if (remoteSize !== localSize) {
    logger.error(`[executor] SFTP put verify failed: local=${localSize}B remote=${remoteSize}B "${remoteDest}"`);
    try { await client.delete(tmp); } catch {}
    throw new Error(
      `SFTP put size mismatch: local=${localSize} remote=${remoteSize} path="${remoteDest}"`
    );
  }
  await client.rename(tmp, remoteDest);
}

// ── Retry ─────────────────────────────────────────────────────────────────────

async function withRetry(fn, maxAttempts) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1) await new Promise(r => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr;
}

// ── Source disposition ────────────────────────────────────────────────────────

async function deleteSourceFile(srcProfile, file, pool) {
  if (srcProfile.type === 'sftp') {
    const client = pool.get(srcProfile.id);
    if (client) await client.delete(file.path);
  } else {
    await deleteFile(file.path);
  }
}

async function archiveSourceFile(srcProfile, file, pool) {
  if (srcProfile.type === 'sftp') {
    const client = pool.get(srcProfile.id);
    if (client) {
      const archivePath = `${path.posix.dirname(file.path)}/_archive/${file.name}`;
      try { await client.mkdir(path.posix.dirname(archivePath), true); } catch {}
      await client.rename(file.path, archivePath);
    }
  } else {
    const archiveDir = path.join(path.dirname(file.path), '_archive');
    await fse.ensureDir(archiveDir);
    // moveFile verifies byte count before deleting — safe for local archive
    await moveFile(file.path, path.join(archiveDir, file.name));
  }
}

// ── transferRule ─────────────────────────────────────────────────────────────

/**
 * Executes a full rule:
 *   1. Resolves source profile and lists matching files
 *   2. Applies PGP → rename → zip transforms in order
 *   3. Fans out each (transformed) file to all destination profiles
 *   4. Applies action (copy/move) and postTransfer source disposition
 *   5. Honours onError (stop / continue / retry) and retryCount
 *   6. Bundle-zip mode: two-pass — stage all files first, then zip → single delivery
 *
 * Returns a jobResult object; does NOT persist it to history.json — callers do that.
 */
async function transferRule(rule) {
  const startTime = new Date().toISOString();
  const jobResult = {
    id:               crypto.randomUUID(),
    ruleId:           rule.id,
    ruleName:         rule.name,
    startTime,
    endTime:          null,
    status:           'success',
    filesTransferred: 0,
    bytesTransferred: 0,
    files:            [],
    errors:           [],
  };

  const profiles = data.read('profiles.json');
  const pool     = new Map();
  const workDir  = (rule.pgp?.enabled || rule.zip?.enabled)
    ? path.join(os.tmpdir(), `dm_work_${jobResult.id}`)
    : null;
  if (workDir) fse.ensureDirSync(workDir);

  try {
    const srcProfile = profiles.find(p => p.id === rule.source.profileId);
    if (!srcProfile) throw new Error(`Source profile not found: ${rule.source.profileId}`);

    let sourceFiles;
    if (srcProfile.type === 'sftp') {
      const client = await getSftpClient(srcProfile, pool);
      sourceFiles  = await sftpListFiles(
        client,
        resolveSftpDir(srcProfile, rule.source.path),
        rule.source.filter
      );
    } else {
      sourceFiles = await listLocalFiles(
        resolveLocalDir(srcProfile, rule.source.path),
        rule.source.filter,
        rule.name
      );
    }

    // ── Date filter ──────────────────────────────────────────────────────
    if (rule.dateFilter) {
      const { field = 'modified', mode, withinDays, sinceDate } = rule.dateFilter;
      let cutoff = null;

      if (mode === 'withinDays' && withinDays != null) {
        cutoff = new Date();
        cutoff.setHours(0, 0, 0, 0);
        cutoff.setDate(cutoff.getDate() - withinDays);
      } else if (mode === 'olderThanDays' && withinDays != null) {
        cutoff = new Date();
        cutoff.setHours(0, 0, 0, 0);
        cutoff.setDate(cutoff.getDate() - withinDays);
      } else if (mode === 'sinceDate' && sinceDate) {
        const [y, m, d] = sinceDate.split('-').map(Number);
        cutoff = new Date(y, m - 1, d, 0, 0, 0, 0);
      }

      if (cutoff) {
        const total  = sourceFiles.length;
        const isSftp = srcProfile.type === 'sftp';
        sourceFiles  = sourceFiles.filter(file => {
          try {
            let fileTime;
            if (isSftp) {
              fileTime = file.mtime != null ? new Date(file.mtime) : null;
            } else {
              const stat = fs.statSync(file.path);
              fileTime   = field === 'created' ? stat.birthtime : stat.mtime;
            }
            if (!fileTime) return true;
            const keep = mode === 'olderThanDays' ? (fileTime < cutoff) : (fileTime >= cutoff);
            return keep;
          } catch { return true; }
        });
        logger.info(
          `[transfer] "${rule.name}" | date filter (${field}, ${mode}): ` +
          `${sourceFiles.length} passed, ${total - sourceFiles.length} excluded`
        );
      }
    }

    if (rule.action === 'delete') {
      // ── Delete-only rule — cleanup, no destinations ─────────────────────
      for (const file of sourceFiles) {
        const fileEntry = { name: file.name, size: file.size, status: 'ok', sourcePath: file.path, destinations: [] };
        try {
          await deleteSourceFile(srcProfile, file, pool);
          logger.info(`[transfer] "${rule.name}" | ${file.name} deleted`);
          jobResult.filesTransferred++;
          jobResult.bytesTransferred += file.size;
        } catch (err) {
          logger.error(`[transfer] "${rule.name}" | ${file.name} delete failed: ${err.message}`);
          fileEntry.status = 'error';
          fileEntry.error  = err.message;
          jobResult.errors.push(`Delete failed for "${file.name}": ${err.message}`);
        }
        fileEntry.timestamp = new Date().toISOString();
        jobResult.files.push(fileEntry);
        if (fileEntry.status === 'error' && rule.onError === 'stop') break;
      }

    } else {
    const retryAttempts = rule.onError === 'retry' ? (rule.retryCount || 1) + 1 : 1;
    const isBundle = rule.zip?.enabled && rule.zip.operation === 'zip' && rule.zip.mode === 'bundle';

    // ── Inner helper: deliver a local file to all destinations ────────────────
    async function deliverLocalFile(localFilePath, fileName, fileSize) {
      let allOk = true;
      const destEntries = [];
      for (const dest of rule.destinations) {
        const destProfile = profiles.find(p => p.id === dest.profileId);
        const destEntry   = { profileId: dest.profileId, status: 'ok' };
        if (!destProfile) {
          destEntry.status = 'error';
          destEntry.error  = `Destination profile not found: ${dest.profileId}`;
          allOk = false;
        } else {
          const destPath = destProfile.type === 'sftp'
            ? `${resolveSftpDir(destProfile, dest.path)}/${fileName}`
            : path.join(resolveLocalDir(destProfile, dest.path), fileName);
          destEntry.path = destPath;

          logger.info(`[transfer] "${rule.name}" | ${fileName} (${fileSize}B) → ${destProfile.name}`);
          try {
            await withRetry(async () => {
              if (destProfile.type === 'sftp') {
                const client = await getSftpClient(destProfile, pool);
                await sftpPutFile(client, localFilePath, destPath);
              } else {
                await copyFile(localFilePath, destPath);
              }
            }, retryAttempts);
            logger.info(`[transfer] "${rule.name}" | ${fileName} → ${destProfile.name} OK`);
          } catch (err) {
            logger.error(`[transfer] "${rule.name}" | ${fileName} → ${destProfile.name} FAILED: ${err.message}`);
            destEntry.status = 'error';
            destEntry.error  = err.message;
            allOk = false;
          }
        }
        destEntries.push(destEntry);
      }
      return { allOk, destEntries };
    }

    // ── Source disposition helper ─────────────────────────────────────────────
    async function disposeSource(file) {
      if (rule.action === 'move' || rule.postTransfer === 'delete') {
        await deleteSourceFile(srcProfile, file, pool);
        logger.info(`[transfer] "${rule.name}" | ${file.name} source deleted`);
      } else if (rule.postTransfer === 'archive') {
        await archiveSourceFile(srcProfile, file, pool);
        logger.info(`[transfer] "${rule.name}" | ${file.name} source archived`);
      }
    }

    if (isBundle) {
      // ── Bundle zip — two-pass ─────────────────────────────────────────────
      // Pass 1: stage all files locally, apply PGP + rename to each
      const staged = [];
      let   bundleBroken = false;

      for (const file of sourceFiles) {
        let stg     = file;
        let isLocal = (srcProfile.type !== 'sftp');

        if (!isLocal) {
          try {
            const client    = await getSftpClient(srcProfile, pool);
            const stagePath = path.join(workDir, `_dl_${file.name}`);
            await sftpGetFile(client, file.path, stagePath, file.size);
            stg     = { ...file, path: stagePath };
            isLocal = true;
          } catch (err) {
            logger.error(`[transfer] "${rule.name}" | bundle: stage failed "${file.name}": ${err.message}`);
            jobResult.errors.push(`Bundle stage failed for "${file.name}": ${err.message}`);
            if (rule.onError === 'stop') { bundleBroken = true; break; }
            continue;
          }
        }

        if (rule.pgp?.enabled) {
          try {
            stg = await pgp.transformFile(stg, rule.pgp, workDir);
          } catch (err) {
            logger.error(`[transfer] "${rule.name}" | bundle: PGP failed "${file.name}": ${err.message}`);
            if (rule.pgp.onFailure !== 'continue') {
              jobResult.errors.push(`PGP transform failed for "${file.name}": ${err.message}`);
              if (rule.onError === 'stop') { bundleBroken = true; break; }
              continue;
            }
            logger.warn(`[transfer] "${rule.name}" | ${file.name} forwarding un-transformed (onFailure=continue)`);
          }
        }

        if (rule.rename?.enabled) {
          stg = { ...stg, name: applyRename(stg.name, rule.rename) };
        }

        staged.push({ original: file, staged: stg });
      }

      if (!bundleBroken && staged.length > 0) {
        // Pass 2: zip all staged files
        const archiveName = resolveZipBundleName(rule.zip, rule.name, staged[0].staged.name) + '.zip';
        const archivePath = path.join(workDir, archiveName);
        try {
          await createZip(staged.map(x => x.staged), archivePath, rule.zip.level ?? 6);
          const archiveSize = fs.statSync(archivePath).size;
          logger.info(`[transfer] "${rule.name}" | bundle zip: ${staged.length} file(s) → ${archiveName} (${archiveSize}B)`);

          const { allOk, destEntries } = await deliverLocalFile(archivePath, archiveName, archiveSize);
          jobResult.files.push({
            name:         archiveName,
            size:         archiveSize,
            bundledCount: staged.length,
            sourceFiles:  staged.map(s => s.original.path),
            status:       allOk ? 'ok' : 'error',
            destinations: destEntries,
            timestamp:    new Date().toISOString(),
          });

          if (allOk) {
            jobResult.filesTransferred = 1;
            jobResult.bytesTransferred = archiveSize;
            for (const { original } of staged) {
              try   { await disposeSource(original); }
              catch (err) {
                logger.warn(`[transfer] "${rule.name}" | ${original.name} disposition error: ${err.message}`);
                jobResult.errors.push(`Disposition failed for "${original.name}": ${err.message}`);
              }
            }
          } else {
            jobResult.errors.push(`Bundle archive "${archiveName}" failed on one or more destinations`);
          }
        } catch (err) {
          logger.error(`[transfer] "${rule.name}" | bundle zip creation failed: ${err.message}`);
          jobResult.errors.push(`Bundle zip creation failed: ${err.message}`);
          jobResult.files.push({
            name:         archiveName,
            status:       'error',
            error:        err.message,
            sourceFiles:  staged.map(s => s.original.path),
            destinations: [],
            timestamp:    new Date().toISOString(),
          });
        }
      }

    } else {
      // ── Per-file loop ─────────────────────────────────────────────────────
      for (const file of sourceFiles) {
        const fileEntry    = { name: file.name, size: file.size, status: 'ok', sourcePath: file.path, destinations: [] };
        let   allDestsOk   = true;
        let   transferFile = file;
        let   isLocal      = (srcProfile.type !== 'sftp');

        // ── PGP transform ────────────────────────────────────────────────
        if (rule.pgp?.enabled) {
          let pgpInput = transferFile;
          if (!isLocal) {
            const client    = await getSftpClient(srcProfile, pool);
            const stagePath = path.join(workDir, `_dl_${file.name}`);
            await sftpGetFile(client, file.path, stagePath, file.size);
            pgpInput = { ...file, path: stagePath };
            isLocal  = true;
          }
          try {
            transferFile = await pgp.transformFile(pgpInput, rule.pgp, workDir);
            isLocal = true;
            fileEntry.pgpTransformed = transferFile.name;
          } catch (err) {
            logger.error(`[transfer] "${rule.name}" | ${file.name} PGP transform failed: ${err.message}`);
            if (rule.pgp.onFailure === 'continue') {
              logger.warn(`[transfer] "${rule.name}" | ${file.name} forwarding un-transformed (onFailure=continue)`);
              transferFile = pgpInput;
              isLocal      = true;
            } else {
              fileEntry.status = 'error';
              fileEntry.error  = `PGP transform failed: ${err.message}`;
              jobResult.errors.push(`PGP transform failed for "${file.name}": ${err.message}`);
              fileEntry.timestamp = new Date().toISOString();
              if (rule.onError === 'stop') { jobResult.files.push(fileEntry); break; }
              jobResult.files.push(fileEntry);
              continue;
            }
          }
        }

        // ── Rename transform ─────────────────────────────────────────────
        if (rule.rename?.enabled) {
          const newName = applyRename(transferFile.name, rule.rename);
          logger.info(`[transfer] "${rule.name}" | rename ${transferFile.name} → ${newName}`);
          transferFile        = { ...transferFile, name: newName };
          fileEntry.renamedTo = newName;
        }

        // ── Per-file zip ─────────────────────────────────────────────────
        if (rule.zip?.enabled && rule.zip.operation === 'zip') {
          if (!isLocal) {
            const client    = await getSftpClient(srcProfile, pool);
            const stagePath = path.join(workDir, `_dl_zip_${file.name}`);
            await sftpGetFile(client, transferFile.path, stagePath, transferFile.size);
            transferFile = { ...transferFile, path: stagePath };
            isLocal      = true;
          }
          const zipName = transferFile.name + '.zip';
          const zipPath = path.join(workDir, zipName);
          try {
            await createZip([transferFile], zipPath, rule.zip.level ?? 6);
            const zipSize = fs.statSync(zipPath).size;
            logger.info(`[transfer] "${rule.name}" | per-file zip: ${transferFile.name} → ${zipName} (${zipSize}B)`);
            transferFile      = { name: zipName, path: zipPath, size: zipSize };
            isLocal           = true;
            fileEntry.zippedAs = zipName;
          } catch (err) {
            logger.error(`[transfer] "${rule.name}" | ${file.name} zip failed: ${err.message}`);
            fileEntry.status = 'error';
            fileEntry.error  = `Zip failed: ${err.message}`;
            jobResult.errors.push(`Zip failed for "${file.name}": ${err.message}`);
            fileEntry.timestamp = new Date().toISOString();
            if (rule.onError === 'stop') { jobResult.files.push(fileEntry); break; }
            jobResult.files.push(fileEntry);
            continue;
          }
        }

        // ── Unzip ────────────────────────────────────────────────────────
        if (rule.zip?.enabled && rule.zip.operation === 'unzip') {
          if (!isLocal) {
            const client    = await getSftpClient(srcProfile, pool);
            const stagePath = path.join(workDir, `_dl_unzip_${file.name}`);
            await sftpGetFile(client, transferFile.path, stagePath, transferFile.size);
            transferFile = { ...transferFile, path: stagePath };
            isLocal      = true;
          }
          const extractDir = path.join(workDir, `_unzip_${crypto.randomUUID()}`);
          let   extracted  = [];
          try {
            await extractZip(transferFile.path, extractDir);
            extracted = await listLocalFiles(extractDir, null);
            logger.info(`[transfer] "${rule.name}" | unzip: ${transferFile.name} → ${extracted.length} file(s)`);
          } catch (err) {
            logger.error(`[transfer] "${rule.name}" | ${file.name} unzip failed: ${err.message}`);
            fileEntry.status = 'error';
            fileEntry.error  = `Unzip failed: ${err.message}`;
            jobResult.errors.push(`Unzip failed for "${file.name}": ${err.message}`);
            fileEntry.timestamp = new Date().toISOString();
            if (rule.onError === 'stop') { jobResult.files.push(fileEntry); break; }
            jobResult.files.push(fileEntry);
            continue;
          }

          let allExtOk = true;
          for (const ext_file of extracted) {
            const { allOk, destEntries } = await deliverLocalFile(ext_file.path, ext_file.name, ext_file.size);
            if (allOk) {
              jobResult.filesTransferred++;
              jobResult.bytesTransferred += ext_file.size;
            } else {
              allExtOk = false;
              jobResult.errors.push(`Extracted file "${ext_file.name}" failed on one or more destinations`);
            }
            jobResult.files.push({
              name:         ext_file.name,
              size:         ext_file.size,
              sourcePath:   file.path,
              status:       allOk ? 'ok' : 'error',
              destinations: destEntries,
              timestamp:    new Date().toISOString(),
            });
          }

          if (allExtOk) {
            try   { await disposeSource(file); }
            catch (err) {
              logger.warn(`[transfer] "${rule.name}" | ${file.name} disposition error: ${err.message}`);
              jobResult.errors.push(`Disposition failed for "${file.name}": ${err.message}`);
            }
          }
          if (!allExtOk && rule.onError === 'stop') break;
          continue;  // skip normal destination loop
        }

        // ── Destination loop ─────────────────────────────────────────────
        let attemptedDests = 0;
        for (const dest of rule.destinations) {
          // Per-destination filter: skip if pattern set and file doesn't match
          if (dest.filter) {
            const subject = file.relPath || file.name;
            if (!matchesGlob(subject, dest.filter)) continue;
          }
          attemptedDests++;

          const destProfile = profiles.find(p => p.id === dest.profileId);
          const destEntry   = { profileId: dest.profileId, status: 'ok' };

          if (!destProfile) {
            destEntry.status = 'error';
            destEntry.error  = `Destination profile not found: ${dest.profileId}`;
            allDestsOk = false;
          } else {
            const destPath = ((srcProfile.type === 'local' || srcProfile.type === 'smb') && destProfile.type === 'sftp')
              ? `${resolveSftpDir(destProfile, dest.path)}/${transferFile.name}`
              : path.join(resolveLocalDir(destProfile, dest.path), transferFile.name);
            destEntry.path = destPath;

            logger.info(`[transfer] "${rule.name}" | ${transferFile.name} (${transferFile.size}B) → ${destProfile.name}`);
            try {
              await withRetry(async () => {
                if (srcProfile.type === 'sftp' &&
                    (destProfile.type === 'local' || destProfile.type === 'smb')) {
                  if (isLocal) {
                    // Already staged/transformed — copy from local workDir
                    await copyFile(transferFile.path, destPath);
                  } else {
                    // Still on remote SFTP — stream down directly
                    const client = await getSftpClient(srcProfile, pool);
                    await sftpGetFile(client, transferFile.path, destPath, transferFile.size);
                  }
                } else if ((srcProfile.type === 'local' || srcProfile.type === 'smb') &&
                            destProfile.type === 'sftp') {
                  const client = await getSftpClient(destProfile, pool);
                  await sftpPutFile(client, transferFile.path, destPath);
                } else {
                  await copyFile(transferFile.path, destPath);
                }
              }, retryAttempts);
              logger.info(`[transfer] "${rule.name}" | ${transferFile.name} → ${destProfile.name} OK`);
            } catch (err) {
              logger.error(`[transfer] "${rule.name}" | ${transferFile.name} → ${destProfile.name} FAILED: ${err.message}`);
              destEntry.status = 'error';
              destEntry.error  = err.message;
              allDestsOk = false;
            }
          }

          fileEntry.destinations.push(destEntry);
        }

        if (attemptedDests === 0) {
          logger.warn(`[transfer] "${rule.name}" | ${file.name} — no destinations matched filter`);
        }

        fileEntry.timestamp = new Date().toISOString();

        if (allDestsOk) {
          jobResult.filesTransferred++;
          jobResult.bytesTransferred += transferFile.size;
          try   { await disposeSource(file); }
          catch (err) {
            logger.warn(`[transfer] "${rule.name}" | ${file.name} disposition error: ${err.message}`);
            fileEntry.dispositionError = err.message;
            jobResult.errors.push(`Disposition failed for "${file.name}": ${err.message}`);
          }
        } else {
          fileEntry.status = 'error';
          jobResult.errors.push(`File "${file.name}" failed on one or more destinations`);
          if (rule.onError === 'stop') { jobResult.files.push(fileEntry); break; }
        }

        jobResult.files.push(fileEntry);
      }
    }
    }

  } finally {
    for (const [, client] of pool) {
      try { await client.end(); } catch {}
    }
    if (workDir) {
      try { fse.removeSync(workDir); } catch {}
    }
  }

  jobResult.endTime = new Date().toISOString();
  jobResult.status  = jobResult.errors.length === 0
    ? 'success'
    : jobResult.filesTransferred > 0 ? 'partial' : 'failed';

  if (jobResult.status === 'success' && jobResult.filesTransferred === 0) {
    jobResult.subStatus = 'idle';
  }

  return jobResult;
}

// Test helper — redirects both data.js DATA_DIR and the credentials file path
function _setDataDir(dir) {
  data._setDataDir(dir);
  pgp._setDataDir(dir);
  _credFile = path.join(dir, 'credentials.enc');
}

module.exports = { copyFile, moveFile, deleteFile, listFiles, transferRule, _setDataDir };
