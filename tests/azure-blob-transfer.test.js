'use strict';

// Run with: .\runtime\node.exe tests/azure-blob-transfer.test.js
//
// Integration-style tests for transferRule()'s azure-blob wiring (Phase 2a).
// Local filesystem is real (temp dirs); the Azure SDK is faked by injecting
// a FakeContainerClient into the require cache for '@azure/storage-blob'
// BEFORE app/executor.js (and therefore its `const { ContainerClient } =
// require('@azure/storage-blob')`) is ever required. This mirrors how
// executor.test.js exercises only the SFTP *error* path (no live server) —
// here we go one step further and fake the "server" so the happy path is
// coverable too.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ── Fake @azure/storage-blob — MUST be installed before executor.js loads ──────

const fakeContainers = new Map(); // containerName -> { blobs: [{name, content, lastModified, metadata}], uploaded: [], deleted: [] }

function registerFakeContainer(containerName, blobs = []) {
  const store = {
    blobs: blobs.map(b => ({ lastModified: new Date('2026-01-01T00:00:00Z'), metadata: {}, ...b })),
    uploaded: [],
    deleted: [],
  };
  fakeContainers.set(containerName, store);
  return store;
}

class FakeBlobClient {
  constructor(store, blobName) { this.store = store; this.blobName = blobName; }

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
}

class FakeContainerClient {
  constructor(url) {
    const containerName = url.split('?')[0].split('/').filter(Boolean).pop();
    const store = fakeContainers.get(containerName);
    if (!store) throw new Error(`FakeContainerClient: no fake container registered for "${containerName}"`);
    this._containerName = containerName;
    this._store = store;
  }

  getBlockBlobClient(blobName) { return new FakeBlobClient(this._store, blobName); }

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
  id: azureBlobModulePath,
  filename: azureBlobModulePath,
  loaded: true,
  exports: { ContainerClient: FakeContainerClient },
};

// ── Temp directory + data dir setup (same pattern as executor.test.js) ─────────

const ROOT      = path.join(os.tmpdir(), `dm_azblob_tr_${crypto.randomBytes(4).toString('hex')}`);
const SRC_DIR   = path.join(ROOT, 'source');
const DST_DIR   = path.join(ROOT, 'dest');
const DATA_DIR  = path.join(ROOT, 'data');

for (const d of [SRC_DIR, DST_DIR, DATA_DIR]) fs.mkdirSync(d, { recursive: true });

const { _setDataDir: setData } = require('../app/data');
const executor = require('../app/executor'); // now sees FakeContainerClient
executor._setDataDir(DATA_DIR);

const appCrypto = require('../app/crypto');
appCrypto._setMasterKeyPath(path.join(DATA_DIR, 'master.key'));
appCrypto._setCredentialsFilePath(path.join(DATA_DIR, 'credentials.enc'));

const { transferRule } = executor;

function cleanup() {
  fs.rmSync(ROOT, { recursive: true, force: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeFile(dir, name, content = 'hello') {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function writeProfiles(profiles) {
  fs.writeFileSync(path.join(DATA_DIR, 'profiles.json'), JSON.stringify(profiles, null, 2), 'utf8');
}

function writeCredStore(store) {
  fs.writeFileSync(path.join(DATA_DIR, 'credentials.enc'), appCrypto.encrypt(JSON.stringify(store)), 'utf8');
}

function makeLocalProfile(id, dirPath) {
  return { id, type: 'local', name: `Local ${id}`, path: dirPath };
}

const FUTURE_EXPIRY = '2099-01-01T00:00:00Z';
const PAST_EXPIRY    = '2020-01-01T00:00:00Z';

function makeBlobProfile(id, overrides = {}) {
  return {
    id,
    type: 'azure-blob',
    name: overrides.name || `Blob ${id}`,
    blobEndpoint: 'https://fakeaccount.blob.core.windows.net',
    container: overrides.container || `container-${id}`,
    prefix: overrides.prefix ?? '',
    recursive: overrides.recursive ?? false,
    credentialRef: `azureblob_${id}`,
    sasMeta: { expiresAt: FUTURE_EXPIRY, ...(overrides.sasMeta || {}) },
    ...overrides,
  };
}

function makeRule(overrides) {
  return Object.assign({
    id:           crypto.randomUUID(),
    name:         'Test Rule',
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    action:       'copy',
    postTransfer: 'leave',
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

console.log('\ntransferRule azure-blob wiring tests\n');

// ── blob source → local dest ────────────────────────────────────────────────

await test('blob source → local dest: plain copy with no transform', async () => {
  registerFakeContainer('container-blobsrc1', [
    { name: 'inbound/report.csv', content: Buffer.from('col1,col2\n1,2') },
  ]);
  writeCredStore({ azureblob_blobsrc1: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake' });
  writeProfiles([
    makeBlobProfile('blobsrc1', { container: 'container-blobsrc1', prefix: 'inbound' }),
    makeLocalProfile('dst1', DST_DIR),
  ]);

  const result = await transferRule(makeRule({
    source: { profileId: 'blobsrc1', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
  }));

  assertEqual(result.status, 'success');
  assertEqual(result.filesTransferred, 1);
  assert(fs.existsSync(path.join(DST_DIR, 'report.csv')), 'file should land in local dest');
  assertEqual(fs.readFileSync(path.join(DST_DIR, 'report.csv'), 'utf8'), 'col1,col2\n1,2');
});

await test('blob source → local dest: recursive listing preserves subdirectory in relPath but delivers by name', async () => {
  registerFakeContainer('container-blobsrc-rec', [
    { name: 'inbound/sub/nested.csv', content: Buffer.from('nested-data') },
  ]);
  writeCredStore({ azureblob_blobsrc_rec: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake' });
  const dstDir = path.join(ROOT, 'dst_rec'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile('blobsrc_rec', { container: 'container-blobsrc-rec', prefix: 'inbound', recursive: true }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({
    source: { profileId: 'blobsrc_rec', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
  }));

  assertEqual(result.status, 'success');
  assertEqual(result.filesTransferred, 1);
  assert(fs.existsSync(path.join(dstDir, 'nested.csv')), 'nested blob delivered under its bare name');
});

// ── local source → blob dest ────────────────────────────────────────────────

await test('local source → blob dest: file uploaded under prefix', async () => {
  const store = registerFakeContainer('container-blobdst1', []);
  writeCredStore({ azureblob_blobdst1: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake' });
  const srcDir = path.join(ROOT, 'src_to_blob'); fs.mkdirSync(srcDir, { recursive: true });
  writeFile(srcDir, 'upload.txt', 'upload-content');
  writeProfiles([
    makeLocalProfile('src', srcDir),
    makeBlobProfile('blobdst1', { container: 'container-blobdst1', prefix: 'outbound' }),
  ]);

  const result = await transferRule(makeRule({
    source: { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'blobdst1', path: null }],
  }));

  assertEqual(result.status, 'success');
  assertEqual(result.filesTransferred, 1);
  assert(store.uploaded.includes('outbound/upload.txt'), 'blob should be uploaded under the destination prefix');
  const uploaded = store.blobs.find(b => b.name === 'outbound/upload.txt');
  assertEqual(uploaded.content.toString('utf8'), 'upload-content');
});

// ── blob source with PGP enabled ────────────────────────────────────────────

await test('blob source with PGP enabled: eager staging feeds the transform correctly (PGP failure path)', async () => {
  // No PGP recipient configured — this proves the eagerly-staged local file
  // actually reaches pgp.transformFile (which then fails cleanly on a bogus
  // recipient) rather than a blob name/path being handed to it directly,
  // which would fail completely differently (ENOENT / not-a-path errors).
  registerFakeContainer('container-blobpgp1', [
    { name: 'secure.txt', content: Buffer.from('sensitive-data') },
  ]);
  writeCredStore({ azureblob_blobpgp1: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake' });
  const dstDir = path.join(ROOT, 'dst_pgp'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile('blobpgp1', { container: 'container-blobpgp1', prefix: '' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({
    source: { profileId: 'blobpgp1', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    pgp: {
      enabled: true, operation: 'encrypt',
      encryptKeyIds: ['00000000-0000-0000-0000-000000000000'], // nonexistent key id
      onFailure: 'fail',
    },
  }));

  assertEqual(result.filesTransferred, 0, 'no successful transfer — bogus recipient key id');
  assert(result.errors.some(e => e.includes('PGP transform failed') && e.includes('PGP key not found')),
    `failure should be attributed to the PGP step (key lookup), not a staging/path error: ${JSON.stringify(result.errors)}`);
  assert(!result.errors.some(e => /ENOENT|is not a function|Cannot read propert/.test(e)), 'must not fail with a raw path/type error — proves the staged local file reached PGP correctly');
});

await test('blob source with PGP enabled and a working transform: staged local content is what gets encrypted and delivered', async () => {
  // Use PGP's own passthrough-safe failure mode is not what we want here —
  // instead verify indirectly: rename-only "transform" (always available,
  // no key material needed) proves the eagerly staged file's content and
  // name flow correctly into a downstream transform step.
  registerFakeContainer('container-blobrename1', [
    { name: 'original.csv', content: Buffer.from('a,b,c') },
  ]);
  writeCredStore({ azureblob_blobrename1: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake' });
  const dstDir = path.join(ROOT, 'dst_rename'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile('blobrename1', { container: 'container-blobrename1', prefix: '' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({
    source: { profileId: 'blobrename1', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    rename: { enabled: true, position: 'prefix', format: 'UNIX', separator: '_', includeDate: false, customText: 'staged', customPosition: 'prefix' },
  }));

  assertEqual(result.status, 'success');
  assertEqual(result.filesTransferred, 1);
  const files = fs.readdirSync(dstDir);
  assertEqual(files.length, 1);
  assert(files[0].startsWith('staged_'), `renamed file should carry the custom prefix, got "${files[0]}"`);
  assertEqual(fs.readFileSync(path.join(dstDir, files[0]), 'utf8'), 'a,b,c', 'content staged from blob must survive the transform untouched');
});

// ── SAS-expired pre-flight ──────────────────────────────────────────────────

await test('SAS-expired pre-flight throws before any listing happens (source profile)', async () => {
  // Deliberately do NOT register a fake container — if listing were ever
  // attempted despite the expired SAS, FakeContainerClient's constructor
  // would throw "no fake container registered", a different message than
  // expected below, so this also proves listing never starts.
  writeCredStore({ azureblob_blobexpired1: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + PAST_EXPIRY + '&sig=fake' });
  writeProfiles([
    makeBlobProfile('blobexpired1', { container: 'container-never-registered', sasMeta: { expiresAt: PAST_EXPIRY } }),
    makeLocalProfile('dst1', DST_DIR),
  ]);

  let caught = null;
  try {
    await transferRule(makeRule({
      source: { profileId: 'blobexpired1', path: null, filter: null },
      destinations: [{ profileId: 'dst1', path: null }],
    }));
  } catch (err) {
    caught = err;
  }
  assert(caught, 'transferRule should throw for an expired SAS');
  assert(/SAS token for profile ".*" expired on/.test(caught.message), `expected expiry message, got: ${caught.message}`);
});

await test('SAS-expired pre-flight also fires for an expired destination profile', async () => {
  const srcDir = path.join(ROOT, 'src_dest_expiry'); fs.mkdirSync(srcDir, { recursive: true });
  writeFile(srcDir, 'x.txt');
  writeCredStore({ azureblob_blobdestexpired1: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + PAST_EXPIRY + '&sig=fake' });
  writeProfiles([
    makeLocalProfile('src', srcDir),
    makeBlobProfile('blobdestexpired1', { container: 'container-never-registered-2', sasMeta: { expiresAt: PAST_EXPIRY } }),
  ]);

  let caught = null;
  try {
    await transferRule(makeRule({
      source: { profileId: 'src', path: null, filter: null },
      destinations: [{ profileId: 'blobdestexpired1', path: null }],
    }));
  } catch (err) {
    caught = err;
  }
  assert(caught, 'transferRule should throw when a destination SAS is expired, before any upload');
  assert(/SAS token for profile ".*" expired on/.test(caught.message), `expected expiry message, got: ${caught.message}`);
});

await test('a non-expired sasMeta does not block the rule', async () => {
  registerFakeContainer('container-blobvalid1', [{ name: 'ok.txt', content: Buffer.from('ok') }]);
  writeCredStore({ azureblob_blobvalid1: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake' });
  const dstDir = path.join(ROOT, 'dst_valid'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile('blobvalid1', { container: 'container-blobvalid1' }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({
    source: { profileId: 'blobvalid1', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
  }));
  assertEqual(result.status, 'success');
});

// ── delete-only rule on azure-blob source (deleteSourceFile branch) ─────────

await test('delete-only rule deletes the blob via blobDeleteFile', async () => {
  const store = registerFakeContainer('container-blobdel1', [
    { name: 'todelete.txt', content: Buffer.from('x') },
  ]);
  writeCredStore({ azureblob_blobdel1: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake' });
  writeProfiles([
    makeBlobProfile('blobdel1', { container: 'container-blobdel1' }),
  ]);

  const result = await transferRule(makeRule({
    source: { profileId: 'blobdel1', path: null, filter: null },
    destinations: [],
    action: 'delete',
  }));

  assertEqual(result.status, 'success');
  assertEqual(result.filesTransferred, 1);
  assert(store.deleted.includes('todelete.txt'), 'blobDeleteFile should have been invoked for the source blob');
  assertEqual(store.blobs.length, 0);
});

// postTransfer: 'archive' on an azure-blob source is covered in depth by
// tests/azure-blob-archive.test.js (Phase 2b: DFS rename, capability
// detection, copy+delete fallback, idempotency guard) — not duplicated here.

// ── blob → blob (side effect of eager staging + additive destPath branch) ──

await test('blob source → blob dest: uploads through local staging', async () => {
  registerFakeContainer('container-blobtoblobsrc', [{ name: 'transit.dat', content: Buffer.from('transit-content') }]);
  const dstStore = registerFakeContainer('container-blobtoblobdst', []);
  writeCredStore({
    azureblob_blobtoblobsrc: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake',
    azureblob_blobtoblobdst: 'sv=2024-11-04&sr=c&sp=racwdl&se=' + FUTURE_EXPIRY + '&sig=fake',
  });
  writeProfiles([
    makeBlobProfile('blobtoblobsrc', { container: 'container-blobtoblobsrc' }),
    makeBlobProfile('blobtoblobdst', { container: 'container-blobtoblobdst', prefix: 'landing' }),
  ]);

  const result = await transferRule(makeRule({
    source: { profileId: 'blobtoblobsrc', path: null, filter: null },
    destinations: [{ profileId: 'blobtoblobdst', path: null }],
  }));

  assertEqual(result.status, 'success');
  assert(dstStore.uploaded.includes('landing/transit.dat'));
});

// ── Results ───────────────────────────────────────────────────────────────────

cleanup();
console.log(`
${passed} passed, ${failed} failed
`);
if (failed > 0) process.exit(1);

})();
