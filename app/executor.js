'use strict';

const path   = require('path');
const fs     = require('fs');
const fse    = require('fs-extra');
const os     = require('os');
const dns    = require('dns');
const crypto = require('crypto');
const Sftp   = require('ssh2-sftp-client');
const { ContainerClient } = require('@azure/storage-blob');

const { decrypt } = require('./crypto');
const data        = require('./data');
const logger      = require('./logger');
const pgp         = require('./pgp');
const { renameWithRetry } = require('./fs-utils');

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

// ── Path containment ──────────────────────────────────────────────────────────

const ILLEGAL_NAME_CHARS  = /[\\/:*?"<>|\0]/;
const RESERVED_DEVICE_STEM = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

/**
 * Validates a filename reported by a remote (SFTP) directory listing.
 * Rejects rather than rewrites: basename() would silently truncate a
 * traversal payload like "../../evil" down to "evil", masking the attempt
 * instead of refusing it.
 */
function sanitizeRemoteName(rawName) {
  if (typeof rawName !== 'string' || rawName.length === 0) {
    throw new Error(`Rejected unsafe remote filename: ${JSON.stringify(rawName)}`);
  }
  const normalized = rawName.replace(/\\/g, '/');
  const base       = path.posix.basename(normalized);
  if (base !== normalized || base === '' || base === '.' || base === '..' ||
      ILLEGAL_NAME_CHARS.test(base)) {
    throw new Error(`Rejected unsafe remote filename: ${JSON.stringify(rawName)}`);
  }
  // Windows strips trailing dots/spaces during path normalization, so
  // "evil.txt " would silently become "evil.txt" and could overwrite it.
  if (/[. ]$/.test(base)) {
    throw new Error(`Rejected unsafe remote filename: ${JSON.stringify(rawName)}`);
  }
  // Reserved device names resolve to devices in every directory on Windows —
  // writing to NUL silently discards data, COM1/LPT1 can block on the handle.
  const dotIdx = base.indexOf('.');
  const stem   = dotIdx === -1 ? base : base.slice(0, dotIdx);
  if (RESERVED_DEVICE_STEM.test(stem)) {
    throw new Error(`Rejected unsafe remote filename: ${JSON.stringify(rawName)}`);
  }
  return base;
}

/**
 * Asserts that candidatePath resolves to baseDir or a descendant of it.
 * Case folding happens after resolve(), not before — resolving first
 * normalizes ".." segments and separators, so folding the raw inputs could
 * mask a traversal that only becomes case-identical once normalized.
 */
function assertWithin(baseDir, candidatePath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(candidatePath);
  let cmpBase = resolvedBase;
  let cmpPath = resolvedPath;
  if (process.platform === 'win32') {
    cmpBase = cmpBase.toLowerCase();
    cmpPath = cmpPath.toLowerCase();
  }
  if (cmpPath !== cmpBase && !cmpPath.startsWith(cmpBase + path.sep)) {
    throw new Error(`Path escapes base directory: "${candidatePath}" is not within "${baseDir}"`);
  }
  return resolvedPath;
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
  renameWithRetry(tmp, destPath);
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

async function sftpListFiles(client, remotePath, filter, onReject) {
  let entries;
  try { entries = await client.list(remotePath); }
  catch { return []; }
  const base = remotePath.replace(/\/$/, '');
  const results = [];
  for (const e of entries) {
    if (e.type !== '-') continue;
    let safeName;
    try {
      safeName = sanitizeRemoteName(e.name);
    } catch (err) {
      logger.warn(`[executor] Rejected unsafe filename from remote "${remotePath}": ${err.message}`);
      if (onReject) onReject(e.name, remotePath, err);
      continue;
    }
    if (filter && !matchesGlob(safeName, filter)) continue;
    results.push({ name: safeName, path: `${base}/${safeName}`, relPath: safeName, size: e.size, mtime: e.modifyTime });
  }
  return results;
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
  renameWithRetry(tmp, localDest);
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

// ── Azure Blob — pure helpers ──────────────────────────────────────────────────

/**
 * Masks the `sig` query parameter value wherever it appears in a string.
 * @azure/storage-blob RestError messages embed the full request URL
 * including sig= (the SAS signature) — every catch block around a blob
 * operation must route the message through this before it reaches a
 * logger, an API response, or a history file.
 */
function redactSas(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/(\bsig=)[^&\s"')\]]*/gi, '$1***');
}

/**
 * Wraps an SDK error for safe propagation: redacts the SAS signature from
 * the message, and carries forward statusCode/code/errorCode/details so
 * Phase 3 alerting can distinguish a 403/expired-SAS from a network/proxy
 * failure — a bare `new Error(redactSas(err.message))` silently discards
 * that information at the point where it's cheapest to keep it. Safe
 * against a non-Error argument.
 */
function wrapBlobError(err) {
  if (!(err instanceof Error)) {
    return new Error(redactSas(String(err)));
  }
  const wrapped = new Error(redactSas(err.message));
  if (err.statusCode !== undefined) wrapped.statusCode = err.statusCode;
  if (err.code       !== undefined) wrapped.code       = err.code;
  if (err.errorCode  !== undefined) wrapped.errorCode  = err.errorCode;
  if (err.details    !== undefined) {
    try {
      wrapped.details = typeof err.details === 'string'
        ? redactSas(err.details)
        : JSON.parse(redactSas(JSON.stringify(err.details)));
    } catch {
      // details wasn't JSON-safe — drop it rather than risk leaking an
      // unredacted copy of it.
    }
  }
  return wrapped;
}

function parseSasDate(value, paramName) {
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid SAS token: could not parse "${paramName}" as a date: "${value}"`);
  }
  return d.toISOString();
}

/**
 * Strips a SAS token down to its bare query string. The Portal's Generate
 * SAS blade offers both a bare "Blob SAS token" and a full "Blob SAS URL"
 * (the same query string with the container URL prepended); tolerate the
 * URL by mistake rather than failing with an unhelpful "missing se/si" — but
 * a URL with no query string at all can't be salvaged, so name the actual
 * problem instead of falling through. Also used defense-in-depth wherever a
 * stored credential is read back, in case it predates splitSasUri() or was
 * written directly via the API's blobEndpoint/container/sasToken fields.
 */
function normalizeSasToken(input) {
  let s = String(input ?? '').trim();
  if (/^https?:\/\//i.test(s)) {
    const qIdx = s.indexOf('?');
    if (qIdx === -1) {
      throw new Error(
        'Invalid SAS token: looks like a full URL with no query string — copy the Blob SAS token, not the Blob SAS URL'
      );
    }
    s = s.slice(qIdx + 1);
  }
  return s.replace(/^\?/, '');
}

/**
 * Splits a full container-scoped Blob SAS URL, exactly as copied from the
 * Portal's Generate SAS blade, into DataMover's three profile components.
 *   https://account.blob.core.windows.net/container?sp=...&sig=...
 *     -> { blobEndpoint: "https://account.blob.core.windows.net",
 *          container: "container", sasToken: "sp=...&sig=..." }
 * This is now the primary intake path for azure-blob profiles (§7.2a).
 */
function splitSasUri(input) {
  const raw = String(input ?? '').trim();
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'Invalid SAS URI: expected a full URL like ' +
      '"https://account.blob.core.windows.net/container?sp=...&sig=..." ' +
      '— paste the Blob SAS URL from the Portal, not just the token.'
    );
  }
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('Invalid SAS URI: no container name found in the URL path.');
  }
  if (segments.length > 1) {
    throw new Error(
      `Invalid SAS URI: path has ${segments.length} segments ("${url.pathname}") — ` +
      `DataMover requires a container-level SAS URL, not a blob-level one.`
    );
  }
  if (!url.search) {
    throw new Error(
      'Invalid SAS URI: no query string found — this looks like a plain container URL, ' +
      'not a SAS URL. Paste the Blob SAS URL from the Portal, which includes the SAS ' +
      'query string.'
    );
  }
  return {
    blobEndpoint: url.origin,
    container:    segments[0],
    sasToken:     url.search.slice(1),
  };
}

/**
 * Parses a container-scoped SAS token's query parameters into the sasMeta
 * shape persisted on an azure-blob profile. Pure — no network. Tolerates a
 * leading "?". signingKey is always null: it is operator-entered (which
 * account key signed the token), not derivable from the token itself.
 */
function parseSasToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('Invalid SAS token: token is empty');
  }
  const normalized = normalizeSasToken(token);
  const params = new URLSearchParams(normalized);

  const sr = params.get('sr');
  if (sr && sr !== 'c') {
    throw new Error(`Invalid SAS token: signed resource "sr=${sr}" is not container-scoped (DataMover requires "sr=c")`);
  }

  const se = params.get('se');
  const si = params.get('si');
  let source, expiresAt;
  if (se) {
    source    = 'parsed';
    expiresAt = parseSasDate(se, 'se');
  } else if (si) {
    source    = 'manual';
    expiresAt = null;
  } else {
    throw new Error('Invalid SAS token: missing both "se" (expiry) and "si" (stored access policy) — cannot determine expiry');
  }

  const st = params.get('st');

  // User-delegation SAS awareness. Inert for a key-signed service SAS (no
  // skoid), but a user-delegation SAS dies when its delegation key expires
  // (ske) regardless of what se says — Azure caps that key at 7 days. Report
  // the EFFECTIVE expiry as min(se, ske) so DataMover never over-reports
  // remaining validity.
  const skoid = params.get('skoid');
  const sktid = params.get('sktid');
  const skt   = params.get('skt');
  const ske   = params.get('ske');
  const sks   = params.get('sks');
  const skv   = params.get('skv');

  const kind = skoid ? 'user-delegation' : 'service';
  const delegationKeyExpiresAt = ske ? parseSasDate(ske, 'ske') : null;
  if (delegationKeyExpiresAt && (!expiresAt || new Date(delegationKeyExpiresAt) < new Date(expiresAt))) {
    expiresAt = delegationKeyExpiresAt;
  }

  return {
    source,
    kind,
    expiresAt,
    startsAt:      st ? parseSasDate(st, 'st') : null,
    permissions:   params.get('sp')  || null,
    resource:      sr || null,
    policyId:      si || null,
    protocol:      params.get('spr') || null,
    signedVersion: params.get('sv')  || null,
    ipRange:       params.get('sip') || null,
    signingKey:    null,
    delegationKeyExpiresAt,
    delegationObjectId:    skoid || null,
    delegationTenantId:    sktid || null,
    delegationKeyStartsAt: skt ? parseSasDate(skt, 'skt') : null,
    delegationKeyService:  sks || null,
    delegationKeyVersion:  skv || null,
    parsedAt:      new Date().toISOString(),
  };
}

// ── Azure Blob — path resolution ───────────────────────────────────────────────

/**
 * Mirrors resolveSftpDir/resolveLocalDir for azure-blob profiles. Posix-style.
 * A leading "/" in rulePath overrides the profile prefix entirely (same as an
 * absolute path does for resolveLocalDir); otherwise rulePath is joined onto
 * profile.prefix and must not escape it — rejects rather than silently
 * normalizing, same as resolveLocalDir's traversal guard.
 */
function resolveBlobPrefix(profile, rulePath) {
  const base = (profile.prefix || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  if (!rulePath) return base;

  const normalizedRule = rulePath.replace(/\\/g, '/');
  if (normalizedRule.startsWith('/')) {
    return normalizedRule.replace(/^\/+/, '').replace(/\/+$/, '');
  }

  const resolved = path.posix.normalize(base ? `${base}/${normalizedRule}` : normalizedRule);
  const escapes = resolved === '..' || resolved.startsWith('../') ||
    (base && resolved !== base && !resolved.startsWith(`${base}/`));
  if (escapes) {
    throw new Error(`Path traversal rejected: "${rulePath}" escapes profile prefix "${profile.prefix || ''}"`);
  }
  return resolved;
}

// ── Azure Blob — primitives ─────────────────────────────────────────────────────

/**
 * Resolves a fresh ContainerClient for an azure-blob profile. ContainerClient
 * is a stateless HTTP client — no pooling, unlike getSftpClient. Construct
 * per call; do not thread this through transferRule's SFTP-specific `pool`.
 */
function getBlobContainerClient(profile) {
  const sas      = resolveCredential(profile.credentialRef);
  const sasQuery = normalizeSasToken(sas);
  const endpoint = (profile.blobEndpoint || '').replace(/\/+$/, '');
  const container = (profile.container || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return new ContainerClient(`${endpoint}/${container}?${sasQuery}`);
}

/**
 * Lists blobs under `prefix`. Honours `recursive` (default false) for
 * SFTP-listing parity: sftpListFiles is single-level, so a naive
 * listBlobsFlat() would silently widen the file set of any rule pointed at
 * this profile. false -> listBlobsByHierarchy, only blob items (BlobPrefix
 * "directory" entries ignored). true -> listBlobsFlat, subdirectory structure
 * preserved in relPath.
 *
 * HNS (ADLS Gen2) note: listBlobsFlat with no delimiter returns directories
 * as well as blobs on a hierarchical-namespace account (Microsoft-documented
 * behaviour, not inference). The recursive=true branch requests metadata and
 * skips any entry marked `hdi_isfolder=true`, plus defensively skips any
 * name ending in "/". The recursive=false branch is unaffected — it already
 * supplies the one supported delimiter and filters on `item.kind`.
 *
 * Blob names legitimately contain "/" as virtual directory separators, so
 * (unlike sftpListFiles, which sanitizes the whole name) each path segment is
 * sanitized independently via sanitizeRemoteName — any segment failing
 * rejects the whole blob. This matters because blobGetFile derives a local
 * staging path from relPath; an unsanitized ".." segment is a
 * write-anywhere primitive.
 *
 * FILTER SEMANTICS DIVERGE FROM SFTP: `filter` is matched against `relPath`
 * (matching listLocalFiles' convention), not the bare filename. With
 * recursive=false these are identical. With recursive=true, matchesGlob
 * compiles `*` to `[^/]*`, so a filter of `*.csv` will NOT match
 * `sub/dir/file.csv` — use `**\/*.csv` for that. This is intentional (it
 * matches how local recursive filters already work) but is the opposite of
 * sftpListFiles, which matches on the bare filename — a filter carried over
 * from an SFTP profile can silently return zero files against a recursive
 * blob profile.
 *
 * `limit` (default 0 = unlimited): once this many results have been
 * accepted, iteration stops immediately — the underlying async iterator is
 * abandoned via early `return`, not exhausted and sliced afterward. Used by
 * the profile test-connection endpoint to avoid enumerating an entire
 * production container just to prove connectivity.
 *
 * Returns the same shape as sftpListFiles: [{ name, path, relPath, size, mtime }]
 */
async function blobListFiles(containerClient, prefix, filter, onReject, recursive = false, limit = 0) {
  const rawPrefix = prefix || '';
  const prefixArg = rawPrefix ? (rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`) : '';
  const listOptions = prefixArg ? { prefix: prefixArg } : {};
  const results = [];

  function accept(rawName, size, lastModified) {
    const relRaw   = prefixArg && rawName.startsWith(prefixArg) ? rawName.slice(prefixArg.length) : rawName;
    const segments = relRaw.split('/').filter(s => s.length > 0);
    if (segments.length === 0) return;
    let safeSegments;
    try {
      safeSegments = segments.map(seg => sanitizeRemoteName(seg));
    } catch (err) {
      logger.warn(`[executor] Rejected unsafe blob name from container: "${rawName}" | ${err.message}`);
      if (onReject) onReject(rawName, prefix, err);
      return;
    }
    const relPath = safeSegments.join('/');
    const name    = safeSegments[safeSegments.length - 1];
    if (filter && !matchesGlob(relPath, filter)) return;
    results.push({ name, path: rawName, relPath, size, mtime: lastModified });
  }

  try {
    if (recursive) {
      const flatOptions = { ...listOptions, includeMetadata: true };
      for await (const blob of containerClient.listBlobsFlat(flatOptions)) {
        if (blob.name.endsWith('/')) continue; // defensive: HNS directory entry
        const meta = {};
        for (const [k, v] of Object.entries(blob.metadata || {})) meta[k.toLowerCase()] = v;
        if (String(meta.hdi_isfolder).toLowerCase() === 'true') continue; // HNS directory marker
        accept(blob.name, blob.properties.contentLength, blob.properties.lastModified);
        if (limit > 0 && results.length >= limit) return results;
      }
    } else {
      for await (const item of containerClient.listBlobsByHierarchy('/', listOptions)) {
        if (item.kind !== 'blob') continue; // ignore BlobPrefix (virtual directory) entries
        accept(item.name, item.properties.contentLength, item.properties.lastModified);
        if (limit > 0 && results.length >= limit) return results;
      }
    }
  } catch (err) {
    throw wrapBlobError(err);
  }

  return results;
}

/**
 * Downloads blobName to localDest (staged as `${localDest}.tmp`, verified,
 * then renamed). `stagingRoot` is required and is asserted against BEFORE
 * any write happens. Per-segment sanitizeRemoteName in blobListFiles is the
 * primary traversal defence and does reject "..", so this is defence in
 * depth — but it must actually run rather than merely appear to (a prior
 * version called assertWithin(path.dirname(localDest), localDest), which
 * asks whether a path sits inside its own parent — always true, so it could
 * never fire).
 */
async function blobGetFile(containerClient, blobName, localDest, expectedSize, stagingRoot) {
  if (!stagingRoot) {
    throw new Error('blobGetFile: stagingRoot is required (second-layer traversal defence)');
  }
  assertWithin(stagingRoot, localDest);

  await fse.ensureDir(path.dirname(localDest));
  const tmp = `${localDest}.tmp`;
  const blobClient = containerClient.getBlockBlobClient(blobName);
  try {
    await blobClient.downloadToFile(tmp);
  } catch (err) {
    throw wrapBlobError(err);
  }
  const actual = fs.statSync(tmp).size;
  if (actual !== expectedSize) {
    logger.error(`[executor] Blob get verify failed: expected=${expectedSize}B got=${actual}B "${blobName}"`);
    try { fs.unlinkSync(tmp); } catch {}
    throw new Error(
      `Blob get size mismatch: expected=${expectedSize} got=${actual} path="${blobName}"`
    );
  }
  renameWithRetry(tmp, localDest);
}

/**
 * Uploads directly to the final blob name via uploadFile() — no .tmp +
 * rename. Blob uploads commit via PutBlockList and are already atomic
 * (nothing is visible to a consumer until the upload completes); blob has no
 * atomic rename (rename = server-side copy + delete), so the tmp dance would
 * add a failure mode while removing nothing. Verifies remote size via
 * getProperties(); deletes the blob and throws on mismatch.
 */
async function blobPutFile(containerClient, localSrc, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  try {
    await blobClient.uploadFile(localSrc);
  } catch (err) {
    throw wrapBlobError(err);
  }

  const localSize = fs.statSync(localSrc).size;
  let remoteSize;
  try {
    remoteSize = (await blobClient.getProperties()).contentLength;
  } catch (err) {
    throw wrapBlobError(err);
  }

  if (remoteSize !== localSize) {
    logger.error(`[executor] Blob put verify failed: local=${localSize}B remote=${remoteSize}B "${blobName}"`);
    try { await blobClient.deleteIfExists(); } catch {}
    throw new Error(
      `Blob put size mismatch: local=${localSize} remote=${remoteSize} path="${blobName}"`
    );
  }
}

/** Deletes a blob. Silently succeeds if already gone, matching deleteFile(). */
async function blobDeleteFile(containerClient, blobName) {
  const blobClient = containerClient.getBlockBlobClient(blobName);
  try {
    await blobClient.deleteIfExists();
  } catch (err) {
    throw wrapBlobError(err);
  }
}

// ── Azure Blob — config helpers ──────────────────────────────────────────────────
// Mirrors app/scheduler.js's _getScheduleTimezone() pattern exactly: a local,
// read-only, defaulted config.json reader. Not routed through app/data.js —
// config.json isn't in its MANAGED set. No test seam, same as scheduler.js —
// a missing file is the common case and reads as "use the default".

const CONFIG_FILE = path.join(__dirname, '../data/config.json');

function _readAzureBlobConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return {}; }
}

function _getAzureBlobCapabilityTtlHours() {
  return _readAzureBlobConfig().AZURE_BLOB_CAPABILITY_TTL_HOURS ?? 24;
}

function _getAzureBlobDfsProbeTimeoutMs() {
  return _readAzureBlobConfig().AZURE_BLOB_DFS_PROBE_TIMEOUT_MS ?? 10000;
}

function _getAzureBlobSasWarnDays() {
  const raw = _readAzureBlobConfig().AZURE_BLOB_SAS_WARN_DAYS;
  return (Array.isArray(raw) && raw.every(Number.isFinite)) ? raw : [30, 14, 7, 1];
}

/**
 * Pure, no I/O. Single source of truth for SAS severity classification —
 * shared by transferRule's pre-flight, the scheduler's daily check, and the
 * profiles API, so they can't drift. warnDaysThresholds may be given in any
 * order — sorted internally. The smallest configured threshold and below is
 * 'critical' (matches the default array's "≤1 → error" row being the
 * tightest one); everything else that matches a threshold is 'warn';
 * negative days is always 'expired' regardless of thresholds; no expiresAt
 * at all (policy-backed SAS with no recorded expiry, §6.1) is 'unknown' —
 * not one of §6.2's four listed statuses, added because a null expiry is a
 * real, reachable state (§6.1's "manual" source) that the classifier must
 * not crash on or silently misreport as 'ok'.
 */
function classifySasExpiry(expiresAt, warnDaysThresholds) {
  if (!expiresAt) return { status: 'unknown', daysRemaining: null };
  const daysRemaining = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86400000);
  if (daysRemaining < 0) return { status: 'expired', daysRemaining };
  const sorted = [...warnDaysThresholds].sort((a, b) => a - b);
  for (const threshold of sorted) {
    if (daysRemaining <= threshold) {
      return { status: threshold === sorted[0] ? 'critical' : 'warn', daysRemaining };
    }
  }
  return { status: 'ok', daysRemaining };
}

// ── Azure Blob — DFS (ADLS Gen2) archive ─────────────────────────────────────────
// §16: archive strategy resolved at runtime via capability detection, not at
// design time. Blob API has no rename; ADLS Gen2 does, but only over the
// `dfs` sub-resource endpoint, which may or may not have a private endpoint
// provisioned. Detect once (cached), prefer atomic rename, fall back to
// copy+delete on environment/transport problems, fail loudly on data/state
// problems.

function withTimeout(promise, ms, makeError) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(makeError()), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// RFC1918 + CGN (100.64.0.0/10) — plain octet arithmetic, no new dependency.
const PRIVATE_IPV4_RANGES = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
];

function ipv4ToInt(address) {
  const parts = String(address).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    n = ((n << 8) | octet) >>> 0;
  }
  return n >>> 0;
}

function isPrivateIPv4(address) {
  const addrInt = ipv4ToInt(address);
  if (addrInt === null) return false;
  return PRIVATE_IPV4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xFFFFFFFF << (32 - bits)) >>> 0;
    return (addrInt & mask) === (ipv4ToInt(base) & mask);
  });
}

// Same account, same private-link pattern already proven for the blob
// sub-resource. profile.dfsEndpoint is an escape hatch for topologies that
// don't fit the substitution.
function deriveDfsEndpoint(profile) {
  if (profile.dfsEndpoint) return profile.dfsEndpoint.replace(/\/+$/, '');
  return (profile.blobEndpoint || '').replace(/\.blob\./, '.dfs.').replace(/\/+$/, '');
}

/**
 * Resolves a fresh DataLakeFileSystemClient for an azure-blob profile's `dfs`
 * sub-resource. Same "no pooling, construct fresh" contract as
 * getBlobContainerClient. @azure/storage-file-datalake is required() lazily
 * (not at module load) so a deployment missing it fails only when DFS is
 * actually attempted, not on require('./executor').
 */
function getDataLakeFileSystemClient(profile) {
  const { DataLakeFileSystemClient } = require('@azure/storage-file-datalake');
  const sas         = resolveCredential(profile.credentialRef);
  const sasQuery    = String(sas).trim().replace(/^\?/, '');
  const dfsEndpoint = deriveDfsEndpoint(profile);
  const container   = (profile.container || '').replace(/^\/+/, '').replace(/\/+$/, '');
  return new DataLakeFileSystemClient(`${dfsEndpoint}/${container}?${sasQuery}`);
}

function classifyProbeFailureReason(err) {
  const code = err && err.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns-unresolved';
  return 'live-check-failed';
}

/**
 * Three layers, cheapest first, stop at first negative (§16.2). The
 * dangerous failure mode isn't "DFS is absent" — it's "DFS is absent and a
 * live attempt hangs" (public network access is fully disabled on this
 * account, so a connection to a publicly-resolved dfs.core.windows.net IP
 * stalls or is rejected). DNS resolution to a private-range address is what
 * actually distinguishes "no dfs private endpoint" from "momentarily
 * unreachable" — a public resolution means the privatelink zone doesn't
 * exist, full stop, and no live attempt should be made.
 */
async function probeDfsCapability(profile) {
  try {
    require('@azure/storage-file-datalake');
  } catch {
    return { dfsReachable: false, reason: 'module-missing' };
  }

  let hostname;
  try {
    hostname = new URL(deriveDfsEndpoint(profile)).hostname;
    if (!hostname) throw new Error('empty hostname');
  } catch {
    return { dfsReachable: false, reason: 'dns-unresolved' };
  }

  let lookup;
  try {
    lookup = await withTimeout(
      dns.promises.lookup(hostname),
      2000,
      () => Object.assign(new Error('DNS lookup timed out'), { code: 'ETIMEDOUT' })
    );
  } catch {
    return { dfsReachable: false, reason: 'dns-unresolved' };
  }

  if (lookup.family !== 4 || !isPrivateIPv4(lookup.address)) {
    return { dfsReachable: false, reason: 'dns-public' };
  }

  try {
    const fsClient = getDataLakeFileSystemClient(profile);
    await withTimeout(
      fsClient.getProperties(),
      _getAzureBlobDfsProbeTimeoutMs(),
      () => Object.assign(new Error('DFS probe timed out'), { code: 'ETIMEDOUT' })
    );
    return { dfsReachable: true, reason: null };
  } catch (err) {
    return { dfsReachable: false, reason: classifyProbeFailureReason(err) };
  }
}

/**
 * Cached wrapper around probeDfsCapability. Re-reads profiles.json fresh
 * (not transferRule's possibly-stale in-memory copy) before persisting, so a
 * concurrent profile edit or another job's probe landing at the same time is
 * safe — data.write() takes a file lock via app/data.js's withLock().
 */
async function resolveDfsCapability(profile) {
  if (profile.archiveMode === 'copy-delete') {
    return { dfsReachable: false, reason: 'archive-mode-forced-copy-delete' };
  }

  const ttlMs  = _getAzureBlobCapabilityTtlHours() * 60 * 60 * 1000;
  const cached = profile.capabilities;
  if (cached?.probedAt && (Date.now() - new Date(cached.probedAt).getTime()) < ttlMs) {
    return { dfsReachable: cached.dfsReachable, reason: cached.reason ?? null };
  }

  const result = await probeDfsCapability(profile);

  try {
    const profiles = data.read('profiles.json');
    const idx = profiles.findIndex(p => p.id === profile.id);
    if (idx !== -1) {
      profiles[idx] = {
        ...profiles[idx],
        capabilities: { dfsReachable: result.dfsReachable, reason: result.reason, probedAt: new Date().toISOString() },
      };
      await data.write('profiles.json', profiles);
    }
  } catch (err) {
    logger.warn(`[executor] Failed to persist DFS capability probe result for profile "${profile.name}": ${err.message}`);
  }

  return result;
}

// A transport failure after a previously-successful probe means the cache is
// now suspect — force a re-probe next time rather than trusting a stale
// "reachable" verdict.
async function invalidateDfsCapabilityCache(profileId) {
  try {
    const profiles = data.read('profiles.json');
    const idx = profiles.findIndex(p => p.id === profileId);
    if (idx !== -1 && profiles[idx].capabilities) {
      profiles[idx] = { ...profiles[idx], capabilities: null };
      await data.write('profiles.json', profiles);
    }
  } catch (err) {
    logger.warn(`[executor] Failed to invalidate DFS capability cache for profile ${profileId}: ${err.message}`);
  }
}

/**
 * Atomic rename over the DFS endpoint. destinationPath (targetBlobPath) is
 * relative to the filesystem root, not including the container name.
 * NOTE: the installed @azure/storage-file-datalake API surface exposes this
 * as DataLakePathClient#move(destinationPath), not `.rename()` — verified
 * against the installed package (12.31.0); the SDK has no `.rename()` method.
 * Ensures the target directory exists first (DFS directories are real
 * objects); createIfNotExists is idempotent so this is safe to call every
 * time even though `_archive` is only ever one level deep. SDK errors
 * propagate untouched for the caller to classify.
 */
async function renameViaDataLake(profile, sourceBlobPath, targetBlobPath, targetDirPath) {
  const fsClient = getDataLakeFileSystemClient(profile);
  await fsClient.getDirectoryClient(targetDirPath).createIfNotExists();
  await fsClient.getFileClient(sourceBlobPath).move(targetBlobPath);
}

/**
 * Rename is atomic server-side, but the response can be lost to a network
 * blip after the operation committed (§16.4). Reuses the already-tested Blob
 * API (not DFS) for both checks — same underlying data, and these primitives
 * are already verified. source-absent AND target-present-with-expected-size
 * means the rename committed but its response was lost; anything else is
 * either a real error or an incomplete/failed rename.
 */
async function checkRenameAlreadySucceeded(containerClient, sourceBlobPath, targetBlobPath, expectedSize) {
  try {
    await containerClient.getBlockBlobClient(sourceBlobPath).getProperties();
    return false; // source still exists — rename did not commit
  } catch (err) {
    if (err.statusCode !== 404) return false; // an unrelated error — don't guess
  }

  try {
    const targetProps = await containerClient.getBlockBlobClient(targetBlobPath).getProperties();
    return targetProps.contentLength === expectedSize;
  } catch {
    return false;
  }
}

const DFS_TRANSPORT_ERROR_CODES = new Set([
  'MODULE_NOT_FOUND', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET',
]);

/**
 * Maps a DFS rename failure to 'fallback' | 'already-done' | 'real-error'
 * per §16.3. Principle: fall back on environment and transport problems,
 * fail on data and state problems — copy+delete is a correct (if
 * non-atomic) archive, so degrading to it is safe when the reason is "the
 * fast path isn't reachable," but would convert a diagnosable error into a
 * confusing one if the reason is "the source file isn't where we think it
 * is."
 */
async function classifyArchiveError(err, srcProfile, file, archiveTargetBlob) {
  const code       = err && err.code;
  const statusCode = err && err.statusCode;

  if (code && DFS_TRANSPORT_ERROR_CODES.has(code)) {
    logger.info(`[executor] Blob archive: DFS rename hit a transport/environment error (${code}) ` +
      `for "${file.name}" — falling back to copy+delete`);
    await invalidateDfsCapabilityCache(srcProfile.id);
    return 'fallback';
  }

  if (statusCode === 403) {
    logger.warn(`[executor] Blob archive: DFS rename got 403 for "${file.name}" on profile ` +
      `"${srcProfile.name}" — likely cause: SAS lacks 'm' (move) permission in sp. Falling back to copy+delete.`);
    return 'fallback';
  }

  if (statusCode === 404) {
    const containerClient = getBlobContainerClient(srcProfile);
    const alreadyDone = await checkRenameAlreadySucceeded(containerClient, file.path, archiveTargetBlob, file.size);
    return alreadyDone ? 'already-done' : 'real-error';
  }

  return 'real-error'; // 409 and anything else
}

/**
 * Copy+delete fallback (§16.5) — also used directly when archiveMode is
 * pinned to 'copy-delete'. syncCopyFromURL completes synchronously because
 * source and target are always in the same container/account (Microsoft's
 * documented condition for that). sourceClient.url already carries the
 * container's SAS (inherited from the ContainerClient it was constructed
 * from) — no separate token needed. Never deletes the source before the
 * copy is verified.
 */
function isCopySourceTooLargeError(err) {
  if (!err) return false;
  if (err.statusCode === 413) return true;
  // The exact error shape for "source too large for a sync copy" isn't
  // pinned to one code across API versions — match permissively rather than
  // hardcode a byte threshold that may drift.
  const haystack = `${err.code || ''} ${err.errorCode || ''} ${err.message || ''}`.toLowerCase();
  return haystack.includes('too large') || haystack.includes('requestbodytoolarge') ||
    haystack.includes('cannotverifycopysource');
}

async function archiveBlobViaCopyDelete(profile, file, archiveDirBlob, archiveTargetBlob) {
  const containerClient = getBlobContainerClient(profile);
  const sourceClient    = containerClient.getBlockBlobClient(file.path);
  const targetClient    = containerClient.getBlockBlobClient(archiveTargetBlob);

  try {
    try {
      await targetClient.syncCopyFromURL(sourceClient.url);
    } catch (err) {
      if (!isCopySourceTooLargeError(err)) throw err;
      const poller = await targetClient.beginCopyFromURL(sourceClient.url);
      await poller.pollUntilDone();
    }

    const targetProps = await targetClient.getProperties();
    if (targetProps.contentLength !== file.size) {
      logger.error(`[executor] Blob archive copy verify failed: expected=${file.size}B got=${targetProps.contentLength}B "${file.name}"`);
      try { await targetClient.deleteIfExists(); } catch {}
      throw new Error(
        `Blob archive copy size mismatch: expected=${file.size} got=${targetProps.contentLength} path="${archiveTargetBlob}"`
      );
    }

    await sourceClient.deleteIfExists();
  } catch (err) {
    throw wrapBlobError(err);
  }
}

/**
 * Entry point from archiveSourceFile for azure-blob sources (§16.1-16.3).
 * archiveMode: 'copy-delete' skips probing entirely (no wasted probe).
 * 'rename' fails loudly rather than silently degrading. 'auto' (default)
 * prefers rename, falls back on environment/transport problems, fails on
 * data/state problems.
 */
async function archiveBlobFile(srcProfile, file) {
  const mode              = srcProfile.archiveMode || 'auto';
  const archiveDirBlob    = path.posix.normalize(`${path.posix.dirname(file.path)}/_archive`);
  const archiveTargetBlob = `${archiveDirBlob}/${file.name}`;

  if (mode !== 'copy-delete') {
    const { dfsReachable, reason } = await resolveDfsCapability(srcProfile);
    if (dfsReachable) {
      try {
        return await renameViaDataLake(srcProfile, file.path, archiveTargetBlob, archiveDirBlob);
      } catch (err) {
        const classification = await classifyArchiveError(err, srcProfile, file, archiveTargetBlob);
        if (classification === 'already-done') return;
        if (mode === 'rename' || classification === 'real-error') {
          throw wrapBlobError(err);
        }
        logger.warn(`[executor] Blob archive: DFS rename failed for "${file.name}" ` +
          `(${classification}), falling back to copy+delete: ${redactSas(err.message)}`);
        // fall through to copy+delete below
      }
    } else if (mode === 'rename') {
      throw new Error(`Archive mode 'rename' is pinned for profile "${srcProfile.name}" ` +
        `but DFS is not reachable (${reason}) — no fallback attempted`);
    }
    // mode === 'auto' and !dfsReachable falls through to copy+delete silently
    // (expected, not exceptional — this is the documented degrade path)
  }

  return archiveBlobViaCopyDelete(srcProfile, file, archiveDirBlob, archiveTargetBlob);
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
  } else if (srcProfile.type === 'azure-blob') {
    // getBlobContainerClient is cheap and stateless — no pool entry (that
    // Map's cleanup loop calls client.end(), which ContainerClient lacks).
    const containerClient = getBlobContainerClient(srcProfile);
    await blobDeleteFile(containerClient, file.path);
  } else {
    await deleteFile(file.path);
  }
}

async function archiveSourceFile(srcProfile, file, pool) {
  if (srcProfile.type === 'azure-blob') {
    return archiveBlobFile(srcProfile, file);
  }
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
  let   workDir  = null;

  try {
    const srcProfile = profiles.find(p => p.id === rule.source.profileId);
    if (!srcProfile) throw new Error(`Source profile not found: ${rule.source.profileId}`);

    // A blob source always needs a local staging file — there is no direct
    // blob-to-destination streaming path in this design (§11: fast paths
    // excluded initially, correctness first).
    workDir = (rule.pgp?.enabled || rule.zip?.enabled || srcProfile.type === 'azure-blob')
      ? path.join(os.tmpdir(), `dm_work_${jobResult.id}`)
      : null;
    if (workDir) fse.ensureDirSync(workDir);

    // ── SAS expiry pre-flight (§6.4) — hard fail on expired, advisory on
    // warn/critical. Uses the already-persisted sasMeta — does NOT re-parse
    // the token.
    const blobProfilesInvolved = profiles.filter(p =>
      p.type === 'azure-blob' &&
      (p.id === srcProfile.id || (rule.destinations || []).some(d => d.profileId === p.id))
    );
    for (const p of blobProfilesInvolved) {
      const { status, daysRemaining } = classifySasExpiry(p.sasMeta?.expiresAt, _getAzureBlobSasWarnDays());
      if (status === 'expired') {
        throw new Error(`SAS token for profile "${p.name}" expired on ${p.sasMeta.expiresAt}`);
      }
      if (status === 'warn' || status === 'critical') {
        jobResult.errors.push(
          `Advisory: SAS token for profile "${p.name}" has ${daysRemaining}d remaining ` +
          `(expires ${p.sasMeta.expiresAt}) — renew soon`
        );
      }
      // 'ok': no action. 'unknown' (policy-backed profile with no recorded
      // expiry) is deliberately NOT advised here — it would repeat on every
      // single job run forever, which is noisy rather than useful; it's
      // surfaced instead in the daily scheduler check (appropriate cadence
      // for a standing reminder) and in the UI/test endpoint (visible on
      // demand). Do not "fix" this back to advising on 'unknown'.
    }

    let sourceFiles;
    if (srcProfile.type === 'sftp') {
      const client = await getSftpClient(srcProfile, pool);
      const sourceDir = resolveSftpDir(srcProfile, rule.source.path);
      sourceFiles  = await sftpListFiles(
        client,
        sourceDir,
        rule.source.filter,
        (rawName, remotePath, err) => {
          jobResult.errors.push(
            `Rejected unsafe filename "${rawName}" from remote "${remotePath}": ${err.message}`
          );
        }
      );
    } else if (srcProfile.type === 'azure-blob') {
      const containerClient = getBlobContainerClient(srcProfile);
      const prefix = resolveBlobPrefix(srcProfile, rule.source.path);
      sourceFiles  = await blobListFiles(
        containerClient,
        prefix,
        rule.source.filter,
        (rawName, blobPrefix, err) => {
          jobResult.errors.push(
            `Rejected unsafe blob name "${rawName}" under prefix "${blobPrefix}": ${err.message}`
          );
        },
        Boolean(srcProfile.recursive)
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
        const total    = sourceFiles.length;
        // file.path for an azure-blob entry is a blob name, not a local
        // path — fs.statSync would throw. Blob and SFTP both report mtime
        // directly on the listing entry, so both use that branch.
        const isRemote = srcProfile.type === 'sftp' || srcProfile.type === 'azure-blob';
        sourceFiles    = sourceFiles.filter(file => {
          try {
            let fileTime;
            if (isRemote) {
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
        } else if (destProfile.type === 'azure-blob') {
          const destPrefix = resolveBlobPrefix(destProfile, dest.path);
          const blobName   = destPrefix ? `${destPrefix}/${fileName}` : fileName;
          destEntry.path   = blobName;

          logger.info(`[transfer] "${rule.name}" | ${fileName} (${fileSize}B) → ${destProfile.name}`);
          try {
            const containerClient = getBlobContainerClient(destProfile);
            await withRetry(() => blobPutFile(containerClient, localFilePath, blobName), retryAttempts);
            logger.info(`[transfer] "${rule.name}" | ${fileName} → ${destProfile.name} OK`);
          } catch (err) {
            logger.error(`[transfer] "${rule.name}" | ${fileName} → ${destProfile.name} FAILED: ${err.message}`);
            destEntry.status = 'error';
            destEntry.error  = err.message;
            allOk = false;
          }
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
        let isLocal = !(srcProfile.type === 'sftp' || srcProfile.type === 'azure-blob');

        if (!isLocal) {
          try {
            const stagePath = path.join(workDir, `_dl_${file.name}`);
            if (srcProfile.type === 'sftp') {
              const client = await getSftpClient(srcProfile, pool);
              assertWithin(workDir, stagePath);
              await sftpGetFile(client, file.path, stagePath, file.size);
            } else if (srcProfile.type === 'azure-blob') {
              const containerClient = getBlobContainerClient(srcProfile);
              await blobGetFile(containerClient, file.path, stagePath, file.size, workDir);
            }
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
        let   isLocal      = !(srcProfile.type === 'sftp' || srcProfile.type === 'azure-blob');

        // ── Eager blob staging ─────────────────────────────────────────────
        // Unlike sftp (which stages lazily inside each transform's own
        // `if (!isLocal)` block, or streams straight to the destination when
        // no transform applies), blob has no direct-to-destination path —
        // stage once, up front, so every downstream `if (!isLocal)` block
        // below simply no-ops for blob, unmodified. Deliberately not wrapped
        // in its own try/catch: the equivalent sftp lazy-staging call (in
        // the PGP block below) isn't either — a staging failure aborts the
        // whole rule, not just this file. Pre-existing sftp behavior,
        // mirrored here rather than fixed.
        if (srcProfile.type === 'azure-blob' && !isLocal) {
          const containerClient = getBlobContainerClient(srcProfile);
          const stagePath = path.join(workDir, `_dl_${file.name}`);
          await blobGetFile(containerClient, file.path, stagePath, file.size, workDir);
          transferFile = { ...file, path: stagePath };
          isLocal = true;
        }

        // ── PGP transform ────────────────────────────────────────────────
        if (rule.pgp?.enabled) {
          let pgpInput = transferFile;
          if (!isLocal) {
            const client    = await getSftpClient(srcProfile, pool);
            const stagePath = path.join(workDir, `_dl_${file.name}`);
            assertWithin(workDir, stagePath);
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
            assertWithin(workDir, stagePath);
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
            assertWithin(workDir, stagePath);
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
            let destPath;
            if (destProfile.type === 'azure-blob') {
              const destPrefix = resolveBlobPrefix(destProfile, dest.path);
              destPath = destPrefix ? `${destPrefix}/${transferFile.name}` : transferFile.name;
            } else if ((srcProfile.type === 'local' || srcProfile.type === 'smb') && destProfile.type === 'sftp') {
              destPath = `${resolveSftpDir(destProfile, dest.path)}/${transferFile.name}`;
            } else {
              const localDestDir = resolveLocalDir(destProfile, dest.path);
              destPath = path.join(localDestDir, transferFile.name);
              assertWithin(localDestDir, destPath);
            }
            destEntry.path = destPath;

            logger.info(`[transfer] "${rule.name}" | ${transferFile.name} (${transferFile.size}B) → ${destProfile.name}`);
            try {
              await withRetry(async () => {
                if (destProfile.type === 'azure-blob') {
                  // transferFile.path is always a local file here — guaranteed
                  // by eager blob-source staging (blob src) or already true
                  // for local/smb src; sftp src's own lazy staging/streaming
                  // below never applies once this branch is taken.
                  const containerClient = getBlobContainerClient(destProfile);
                  await blobPutFile(containerClient, transferFile.path, destPath);
                } else if (srcProfile.type === 'sftp' &&
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

module.exports = {
  copyFile, moveFile, deleteFile, listFiles, transferRule, _setDataDir,
  sanitizeRemoteName, assertWithin,
  redactSas, wrapBlobError, parseSasToken, normalizeSasToken, splitSasUri,
  resolveBlobPrefix, getBlobContainerClient,
  blobListFiles, blobGetFile, blobPutFile, blobDeleteFile,
  isPrivateIPv4, probeDfsCapability, resolveDfsCapability, getDataLakeFileSystemClient,
  _getAzureBlobCapabilityTtlHours, _getAzureBlobDfsProbeTimeoutMs,
  classifySasExpiry, _getAzureBlobSasWarnDays,
};
