'use strict';

// Run with: .\runtime\node.exe tests/azure-blob-archive.test.js
//
// Integration-style tests for the Phase 2b archive wiring: DFS rename with
// runtime capability detection, copy+delete fallback, idempotency guard.
// Follows the FakeContainerClient-injected-into-require.cache pattern from
// tests/azure-blob-transfer.test.js, extended with:
//   - a FakeDataLakeFileSystemClient / FakeDataLakeFileClient for
//     '@azure/storage-file-datalake' (DFS rename side)
//   - a syncCopyFromURL/beginCopyFromURL-capable FakeBlobClient (copy+delete
//     fallback side)
//   - a monkeypatched dns.promises.lookup (capability probe DNS layer)
//   - a monkeypatched logger.warn (asserting the SAS-permission-cause warn)

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const dns    = require('dns');

// ── Fake @azure/storage-blob ────────────────────────────────────────────────────

const fakeContainers = new Map(); // containerName -> store

function registerFakeContainer(containerName, blobs = []) {
  const store = {
    blobs: blobs.map(b => ({ lastModified: new Date('2026-01-01T00:00:00Z'), metadata: {}, ...b })),
    uploaded: [],
    deleted: [],
    syncCopyCalls: [],
    syncCopyShouldFail: null,
    propertyOverrides: new Map(), // blobName -> 'not-found' | { contentLength }
  };
  fakeContainers.set(containerName, store);
  return store;
}

function makeBlobUrl(containerName, blobName) {
  return `https://fakeaccount.blob.core.windows.net/${containerName}/${encodeURIComponent(blobName)}?sig=fakesas`;
}

function parseBlobUrl(url) {
  const [base] = url.split('?');
  const parts = base.replace(/^https?:\/\//, '').split('/');
  const containerName = parts[1];
  const blobName = decodeURIComponent(parts.slice(2).join('/'));
  return { containerName, blobName };
}

class FakeBlockBlobClient {
  constructor(containerName, store, blobName) {
    this.containerName = containerName;
    this.store = store;
    this.blobName = blobName;
    this.url = makeBlobUrl(containerName, blobName);
  }

  async downloadToFile(tmpPath) {
    const blob = this.store.blobs.find(b => b.name === this.blobName);
    if (!blob) { const e = new Error(`BlobNotFound: ${this.blobName}`); e.statusCode = 404; throw e; }
    fs.writeFileSync(tmpPath, blob.content);
  }

  async uploadFile(localPath) {
    const content = fs.readFileSync(localPath);
    const idx = this.store.blobs.findIndex(b => b.name === this.blobName);
    const entry = { name: this.blobName, content, lastModified: new Date(), metadata: {} };
    if (idx >= 0) this.store.blobs[idx] = entry; else this.store.blobs.push(entry);
    this.store.uploaded.push(this.blobName);
  }

  async getProperties() {
    if (this.store.propertyOverrides.has(this.blobName)) {
      const override = this.store.propertyOverrides.get(this.blobName);
      if (override === 'not-found') { const e = new Error(`BlobNotFound: ${this.blobName}`); e.statusCode = 404; throw e; }
      return override;
    }
    const blob = this.store.blobs.find(b => b.name === this.blobName);
    if (!blob) { const e = new Error(`BlobNotFound: ${this.blobName}`); e.statusCode = 404; throw e; }
    return { contentLength: blob.content.length };
  }

  async deleteIfExists() {
    const idx = this.store.blobs.findIndex(b => b.name === this.blobName);
    if (idx === -1) return { succeeded: false };
    this.store.blobs.splice(idx, 1);
    this.store.deleted.push(this.blobName);
    return { succeeded: true };
  }

  async syncCopyFromURL(sourceUrl) {
    if (this.store.syncCopyShouldFail) throw this.store.syncCopyShouldFail;
    const { containerName, blobName } = parseBlobUrl(sourceUrl);
    const srcStore = fakeContainers.get(containerName);
    const srcBlob = srcStore && srcStore.blobs.find(b => b.name === blobName);
    if (!srcBlob) { const e = new Error(`CopySource not found: ${blobName}`); e.statusCode = 404; throw e; }
    const idx = this.store.blobs.findIndex(b => b.name === this.blobName);
    const entry = { name: this.blobName, content: Buffer.from(srcBlob.content), lastModified: new Date(), metadata: {} };
    if (idx >= 0) this.store.blobs[idx] = entry; else this.store.blobs.push(entry);
    this.store.syncCopyCalls.push({ from: blobName, to: this.blobName });
  }

  async beginCopyFromURL(sourceUrl) {
    await this.syncCopyFromURL(sourceUrl);
    return { pollUntilDone: async () => ({}) };
  }
}

class FakeContainerClient {
  constructor(url) {
    const containerName = url.split('?')[0].split('/').filter(Boolean).pop();
    const store = fakeContainers.get(containerName);
    if (!store) throw new Error(`FakeContainerClient: no fake container registered for "${containerName}"`);
    this._containerName = containerName;
    this._store = store;
  }

  getBlockBlobClient(blobName) { return new FakeBlockBlobClient(this._containerName, this._store, blobName); }

  listBlobsByHierarchy(_delimiter, options) {
    const prefix = (options && options.prefix) || '';
    const store = this._store;
    return {
      [Symbol.asyncIterator]: async function* () {
        const seenPrefixes = new Set();
        for (const blob of store.blobs) {
          if (prefix && !blob.name.startsWith(prefix)) continue;
          const rest = blob.name.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash === -1) {
            yield { kind: 'blob', name: blob.name, properties: { contentLength: blob.content.length, lastModified: blob.lastModified } };
          } else {
            const dirName = prefix + rest.slice(0, slash + 1);
            if (!seenPrefixes.has(dirName)) { seenPrefixes.add(dirName); yield { kind: 'prefix', name: dirName }; }
          }
        }
      },
    };
  }

  listBlobsFlat(options) {
    const prefix = (options && options.prefix) || '';
    const store = this._store;
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const blob of store.blobs) {
          if (prefix && !blob.name.startsWith(prefix)) continue;
          yield { name: blob.name, properties: { contentLength: blob.content.length, lastModified: blob.lastModified }, metadata: blob.metadata };
        }
      },
    };
  }
}

const azureBlobModulePath = require.resolve('@azure/storage-blob');
require.cache[azureBlobModulePath] = {
  id: azureBlobModulePath, filename: azureBlobModulePath, loaded: true,
  exports: { ContainerClient: FakeContainerClient },
};

// ── Fake @azure/storage-file-datalake ───────────────────────────────────────────

const fakeDfsFilesystems = new Map(); // containerName -> store

function registerFakeDfsFilesystem(containerName, opts = {}) {
  const store = {
    directoriesEnsured: [],
    moveCalls: [],
    moveShouldFail: opts.moveShouldFail || null,
    getPropertiesShouldFail: opts.getPropertiesShouldFail || null,
  };
  fakeDfsFilesystems.set(containerName, store);
  return store;
}

class FakeDataLakeDirectoryClient {
  constructor(store, dirPath) { this.store = store; this.dirPath = dirPath; }
  async createIfNotExists() {
    this.store.directoriesEnsured.push(this.dirPath);
    return { succeeded: true };
  }
}

class FakeDataLakeFileClient {
  constructor(store, filePath) { this.store = store; this.filePath = filePath; }
  async move(destinationPath) {
    this.store.moveCalls.push({ from: this.filePath, to: destinationPath });
    if (this.store.moveShouldFail) throw this.store.moveShouldFail;
  }
}

class FakeDataLakeFileSystemClient {
  constructor(url) {
    const containerName = url.split('?')[0].split('/').filter(Boolean).pop();
    const store = fakeDfsFilesystems.get(containerName);
    if (!store) throw new Error(`FakeDataLakeFileSystemClient: no fake DFS filesystem registered for "${containerName}" — a live DFS attempt should not have been made here`);
    this._store = store;
  }
  getDirectoryClient(dirPath) { return new FakeDataLakeDirectoryClient(this._store, dirPath); }
  getFileClient(filePath) { return new FakeDataLakeFileClient(this._store, filePath); }
  async getProperties() {
    if (this._store.getPropertiesShouldFail) throw this._store.getPropertiesShouldFail;
    return {};
  }
}

const azureDatalakeModulePath = require.resolve('@azure/storage-file-datalake');
require.cache[azureDatalakeModulePath] = {
  id: azureDatalakeModulePath, filename: azureDatalakeModulePath, loaded: true,
  exports: { DataLakeFileSystemClient: FakeDataLakeFileSystemClient },
};

// ── Temp directory + data dir setup ─────────────────────────────────────────────

const ROOT     = path.join(os.tmpdir(), `dm_azblob_arch_${crypto.randomBytes(4).toString('hex')}`);
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const { _setDataDir: setData } = require('../app/data');
const executor = require('../app/executor');
executor._setDataDir(DATA_DIR);

const appCrypto = require('../app/crypto');
appCrypto._setMasterKeyPath(path.join(DATA_DIR, 'master.key'));
appCrypto._setCredentialsFilePath(path.join(DATA_DIR, 'credentials.enc'));

const { transferRule } = executor;

function cleanup() { fs.rmSync(ROOT, { recursive: true, force: true }); }

// ── DNS mock ─────────────────────────────────────────────────────────────────────

let dnsLookupImpl = async () => { throw Object.assign(new Error('no dns mock configured'), { code: 'ENOTFOUND' }); };
let dnsLookupCallCount = 0;
dns.promises.lookup = (...args) => { dnsLookupCallCount++; return dnsLookupImpl(...args); };

function setDnsPrivate(address = '10.1.2.3') { dnsLookupImpl = async () => ({ address, family: 4 }); }
function setDnsPublic(address = '20.150.10.5') { dnsLookupImpl = async () => ({ address, family: 4 }); }
function setDnsUnresolved() { dnsLookupImpl = async () => { const e = new Error('getaddrinfo ENOTFOUND'); e.code = 'ENOTFOUND'; throw e; }; }

// ── logger.warn spy ──────────────────────────────────────────────────────────────

const logger = require('../app/logger');
let warnMessages = [];
const originalWarn = logger.warn.bind(logger);
logger.warn = (msg, ...rest) => { warnMessages.push(msg); return originalWarn(msg, ...rest); };

// ── Helpers ──────────────────────────────────────────────────────────────────────

function writeProfiles(profiles) {
  fs.writeFileSync(path.join(DATA_DIR, 'profiles.json'), JSON.stringify(profiles, null, 2), 'utf8');
}

function writeCredStore(store) {
  fs.writeFileSync(path.join(DATA_DIR, 'credentials.enc'), appCrypto.encrypt(JSON.stringify(store)), 'utf8');
}

function addCredential(id, sasToken) {
  const credFile = path.join(DATA_DIR, 'credentials.enc');
  const store = fs.existsSync(credFile)
    ? JSON.parse(appCrypto.decrypt(fs.readFileSync(credFile, 'utf8').trim()))
    : {};
  store[`azureblob_${id}`] = sasToken;
  writeCredStore(store);
}

function readProfiles() {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'profiles.json'), 'utf8'));
}

const FUTURE_EXPIRY = '2099-01-01T00:00:00Z';

let profileCounter = 0;
function makeBlobProfile(overrides = {}) {
  profileCounter++;
  const id = overrides.id || `blobprof${profileCounter}`;
  const container = overrides.container || `container-${id}`;
  addCredential(id, `sv=2024-11-04&sr=c&sp=racwdlme&se=${FUTURE_EXPIRY}&sig=fake`);
  return {
    id,
    type: 'azure-blob',
    name: overrides.name || `Blob ${id}`,
    blobEndpoint: 'https://fakeaccount.blob.core.windows.net',
    container,
    prefix: overrides.prefix ?? '',
    recursive: overrides.recursive ?? false,
    credentialRef: `azureblob_${id}`,
    sasMeta: { expiresAt: FUTURE_EXPIRY, ...(overrides.sasMeta || {}) },
    archiveMode: overrides.archiveMode ?? 'auto',
    capabilities: overrides.capabilities,
    ...overrides,
  };
}

function makeLocalProfile(id, dirPath) {
  return { id, type: 'local', name: `Local ${id}`, path: dirPath };
}

function makeRule(overrides) {
  return Object.assign({
    id:           crypto.randomUUID(),
    name:         'Archive Test Rule',
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    action:       'copy',
    postTransfer: 'archive',
    onError:      'continue',
    retryCount:   0,
  }, overrides);
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.stack || err.message}`);
    failed++;
  }
}

function assert(cond, msg)    { if (!cond)   throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

(async () => {

console.log('\ntransferRule azure-blob archive (Phase 2b) tests\n');

// ── 1. dfs reachable, rename succeeds cleanly ───────────────────────────────

await test('dfs reachable, rename succeeds cleanly (directory needs creation)', async () => {
  setDnsPrivate();
  const blobStore = registerFakeContainer('container-rename-ok', [
    { name: 'inbound/report.csv', content: Buffer.from('col1,col2\n1,2') },
  ]);
  const dfsStore = registerFakeDfsFilesystem('container-rename-ok');
  const dstDir = path.join(ROOT, 'dst_rename_ok'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-rename-ok', prefix: 'inbound' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({}));

  assertEqual(result.status, 'success');
  assert(fs.existsSync(path.join(dstDir, 'report.csv')), 'delivery should still succeed');
  assertEqual(dfsStore.moveCalls.length, 1, 'exactly one DFS move() call');
  assertEqual(dfsStore.moveCalls[0].from, 'inbound/report.csv');
  assertEqual(dfsStore.moveCalls[0].to, 'inbound/_archive/report.csv');
  assertEqual(dfsStore.directoriesEnsured.length, 1);
  assertEqual(dfsStore.directoriesEnsured[0], 'inbound/_archive');
  assertEqual(blobStore.deleted.length, 0, 'blob-API delete should never be called on the rename path');
  const fileEntry = result.files.find(f => f.name === 'report.csv');
  assert(!fileEntry.dispositionError, 'no disposition error expected on a clean rename');
});

await test('dfs reachable, rename succeeds cleanly (directory already exists)', async () => {
  setDnsPrivate();
  registerFakeContainer('container-rename-ok2', [
    { name: 'x.txt', content: Buffer.from('hello') },
  ]);
  const dfsStore = registerFakeDfsFilesystem('container-rename-ok2');
  const dstDir = path.join(ROOT, 'dst_rename_ok2'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-rename-ok2', prefix: '' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({}));

  assertEqual(result.status, 'success');
  assertEqual(dfsStore.moveCalls.length, 1);
  assertEqual(dfsStore.moveCalls[0].to, '_archive/x.txt');
  // createIfNotExists is idempotent — called regardless of whether the
  // directory already existed; the fake always reports success either way.
  assertEqual(dfsStore.directoriesEnsured.length, 1);
});

// ── 2. dns-public → copy+delete fallback, no live DFS attempt ──────────────

await test('dns-public falls back to copy+delete and succeeds — no live DFS attempt made', async () => {
  setDnsPublic();
  const blobStore = registerFakeContainer('container-dns-public', [
    { name: 'archive-me.txt', content: Buffer.from('fallback-content') },
  ]);
  // Deliberately do NOT register a fake DFS filesystem — if a live DFS
  // attempt were ever made despite the public DNS result, the constructor
  // would throw a distinct "no fake DFS filesystem registered" error.
  const dstDir = path.join(ROOT, 'dst_dns_public'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-dns-public' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({}));

  assertEqual(result.status, 'success');
  const fileEntry = result.files.find(f => f.name === 'archive-me.txt');
  assert(!fileEntry.dispositionError, `expected no disposition error, got: ${fileEntry.dispositionError}`);
  assert(blobStore.deleted.includes('archive-me.txt'), 'source should be deleted after verified copy');
  const archived = blobStore.blobs.find(b => b.name === '_archive/archive-me.txt');
  assert(archived, 'archived copy should exist under _archive/');
  assertEqual(archived.content.toString('utf8'), 'fallback-content');
});

// ── 3. archiveMode: 'rename' pinned + dfs unreachable → fails, no fallback ──

await test("archiveMode 'rename' pinned + dns-public (dfs unreachable) fails the file with the classification named, no fallback attempted", async () => {
  setDnsPublic();
  const blobStore = registerFakeContainer('container-pinned-fail', [
    { name: 'pinned.txt', content: Buffer.from('must-not-move') },
  ]);
  const dstDir = path.join(ROOT, 'dst_pinned_fail'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-pinned-fail', archiveMode: 'rename' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({}));

  const fileEntry = result.files.find(f => f.name === 'pinned.txt');
  assert(fs.existsSync(path.join(dstDir, 'pinned.txt')), 'delivery to destination should still succeed');
  assert(fileEntry.dispositionError, 'dispositionError should be recorded');
  assert(/pinned/.test(fileEntry.dispositionError) && /dns-public/.test(fileEntry.dispositionError),
    `expected pinned-mode + dns-public in message, got: ${fileEntry.dispositionError}`);
  assertEqual(blobStore.deleted.length, 0, 'no fallback — source must not be touched');
  assertEqual(blobStore.blobs.filter(b => b.name.includes('_archive')).length, 0, 'no copy attempted');
});

// ── 4. rename fails with 403 → falls back, warns naming the SAS cause ──────

await test('rename fails with 403 falls back to copy+delete and logs a warn naming the SAS-permission cause', async () => {
  setDnsPrivate();
  const blobStore = registerFakeContainer('container-403', [
    { name: 'need-move-perm.txt', content: Buffer.from('data') },
  ]);
  registerFakeDfsFilesystem('container-403', {
    moveShouldFail: Object.assign(new Error('This request is not authorized to perform this operation.'), { statusCode: 403 }),
  });
  const dstDir = path.join(ROOT, 'dst_403'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-403' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  warnMessages = [];
  const result = await transferRule(makeRule({}));

  const fileEntry = result.files.find(f => f.name === 'need-move-perm.txt');
  assert(!fileEntry.dispositionError, `403 should fall back and succeed, got: ${fileEntry.dispositionError}`);
  assert(blobStore.deleted.includes('need-move-perm.txt'), 'copy+delete fallback should have completed');
  const sasWarn = warnMessages.find(m => /403/.test(m) && /sp/i.test(m) && /'m'/.test(m));
  assert(sasWarn, `expected a warn naming the SAS 'm' permission cause, got: ${JSON.stringify(warnMessages)}`);
});

// ── 5. rename fails with 404, idempotency guard confirms already-done ──────

await test('rename fails with 404, idempotency guard confirms source-absent/target-present-correct-size → treated as success', async () => {
  setDnsPrivate();
  const content = Buffer.from('col1,col2\n1,2');
  const blobStore = registerFakeContainer('container-404-already-done', [
    { name: 'lost-response.csv', content },
  ]);
  registerFakeDfsFilesystem('container-404-already-done', {
    moveShouldFail: Object.assign(new Error('The specified path does not exist.'), { statusCode: 404 }),
  });
  // Simulate the rename having actually committed server-side despite the
  // client seeing a 404: source getProperties -> not-found, target
  // getProperties -> present with the correct size. Listing still sees the
  // blob (unaffected — it reads store.blobs directly), so the file is
  // correctly picked up as a transfer candidate before this override kicks in.
  blobStore.propertyOverrides.set('lost-response.csv', 'not-found');
  blobStore.propertyOverrides.set('_archive/lost-response.csv', { contentLength: content.length });

  const dstDir = path.join(ROOT, 'dst_404_done'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-404-already-done' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({}));

  const fileEntry = result.files.find(f => f.name === 'lost-response.csv');
  assert(!fileEntry.dispositionError, `expected the idempotency guard to treat this as success, got: ${fileEntry.dispositionError}`);
  assertEqual(blobStore.syncCopyCalls.length, 0, 'copy+delete must never be attempted once already-done is confirmed');
});

// ── 6. rename fails with 404, idempotency guard finds neither present → real error ──

await test('rename fails with 404, idempotency guard finds source still present → real error, disposition fails', async () => {
  setDnsPrivate();
  const blobStore = registerFakeContainer('container-404-real-error', [
    { name: 'genuinely-broken.txt', content: Buffer.from('data') },
  ]);
  registerFakeDfsFilesystem('container-404-real-error', {
    moveShouldFail: Object.assign(new Error('The specified path does not exist.'), { statusCode: 404 }),
  });
  // No property overrides: source still resolves normally (still present),
  // so checkRenameAlreadySucceeded must return false immediately.

  const dstDir = path.join(ROOT, 'dst_404_real'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-404-real-error' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({}));

  const fileEntry = result.files.find(f => f.name === 'genuinely-broken.txt');
  assert(fs.existsSync(path.join(dstDir, 'genuinely-broken.txt')), 'delivery should still have succeeded');
  assert(fileEntry.dispositionError, 'a real error must fail the disposition step');
  assertEqual(blobStore.syncCopyCalls.length, 0, 'a real error must not fall back to copy+delete');
});

// ── 7. capability cache respected across calls within the TTL ──────────────

await test('capability cache respected: two archive calls within the TTL window only probe once', async () => {
  setDnsPrivate();
  registerFakeContainer('container-cache', [
    { name: 'cache-1.txt', content: Buffer.from('one') },
    { name: 'cache-2.txt', content: Buffer.from('two') },
  ]);
  registerFakeDfsFilesystem('container-cache');
  const dstDir = path.join(ROOT, 'dst_cache'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-cache' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  dnsLookupCallCount = 0;

  const result1 = await transferRule(makeRule({ source: { profileId: 'src', path: null, filter: 'cache-1.txt' } }));
  assertEqual(result1.status, 'success');
  assertEqual(dnsLookupCallCount, 1, 'first call should probe once');

  const cachedProfile = readProfiles().find(p => p.id === 'src');
  assert(cachedProfile.capabilities?.probedAt, 'capability should be persisted after the first probe');
  assertEqual(cachedProfile.capabilities.dfsReachable, true);

  const result2 = await transferRule(makeRule({ source: { profileId: 'src', path: null, filter: 'cache-2.txt' } }));
  assertEqual(result2.status, 'success');
  assertEqual(dnsLookupCallCount, 1, 'second call within the TTL window must not probe again');
});

// ── 8. copy+delete: verify-then-delete-source ordering ─────────────────────

await test('copy+delete: source is preserved when the post-copy size verification fails', async () => {
  setDnsPublic(); // force straight to copy+delete, simplest path to exercise
  const blobStore = registerFakeContainer('container-verify-fail', [
    { name: 'verify-me.txt', content: Buffer.from('twelve bytes') }, // 12 bytes... adjust below
  ]);
  // Force the target's reported size to mismatch after the copy, regardless
  // of what was actually copied.
  blobStore.propertyOverrides.set('_archive/verify-me.txt', { contentLength: 999999 });

  const dstDir = path.join(ROOT, 'dst_verify_fail'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-verify-fail' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({}));

  const fileEntry = result.files.find(f => f.name === 'verify-me.txt');
  assert(fileEntry.dispositionError, 'size mismatch should fail the disposition step');
  assert(/mismatch/i.test(fileEntry.dispositionError), `expected a size-mismatch message, got: ${fileEntry.dispositionError}`);
  assert(blobStore.blobs.some(b => b.name === 'verify-me.txt'), 'source must still exist — verification failed before delete');
  assert(!blobStore.deleted.includes('verify-me.txt'), 'source must never be deleted when verification fails');
  assert(!blobStore.blobs.some(b => b.name === '_archive/verify-me.txt'), 'the partial/mismatched copy should be cleaned up');
});

// ── Bonus: archiveMode 'copy-delete' pinned skips probing entirely ─────────

await test("archiveMode 'copy-delete' skips probing entirely — zero DNS lookups", async () => {
  const blobStore = registerFakeContainer('container-forced-cd', [
    { name: 'forced.txt', content: Buffer.from('forced-copy-delete') },
  ]);
  const dstDir = path.join(ROOT, 'dst_forced_cd'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile({ id: 'src', container: 'container-forced-cd', archiveMode: 'copy-delete' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  dnsLookupCallCount = 0;
  const result = await transferRule(makeRule({}));

  assertEqual(dnsLookupCallCount, 0, "archiveMode: 'copy-delete' must skip the probe entirely — no wasted probe");
  const fileEntry = result.files.find(f => f.name === 'forced.txt');
  assert(!fileEntry.dispositionError);
  assert(blobStore.deleted.includes('forced.txt'));
});

// ── Results ───────────────────────────────────────────────────────────────────

cleanup();
console.log(`
${passed} passed, ${failed} failed
`);
if (failed > 0) process.exit(1);

})();
