'use strict';

// Run with: .\runtime\node.exe tests/azure-blob-expiry.test.js
//
// Phase 3: SAS expiry tracking & alerting. Covers the shared classifier
// (app/executor.js's classifySasExpiry), the scheduler's daily check,
// GET /api/profiles + POST /:id/test's use of it, and transferRule's
// pre-flight (hard-fail on expired unchanged from Phase 2a, new advisory on
// warn/critical, nothing on ok/unknown).
//
// Fakes @azure/storage-blob via the require.cache-injection pattern
// established in tests/azure-blob-transfer.test.js (needed for the
// transferRule and POST /:id/test tests, which both list through a real
// ContainerClient shape once the pre-flight allows the call through).
//
// Also covers POST/PUT /api/profiles' sasUri intake path (the single-paste
// SAS URL redesign) — this is the only place these route handlers are
// exercised at all, which is why profilesRouter._setCredFilePath() had to be
// added: without it, POST/PUT's writeCredStore() would write to the real
// repo's data/credentials.enc.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ── Fake @azure/storage-blob — MUST be installed before executor.js loads ──────

const fakeContainers = new Map();

function registerFakeContainer(containerName, blobs = []) {
  const store = {
    blobs: blobs.map(b => ({ lastModified: new Date('2026-01-01T00:00:00Z'), metadata: {}, ...b })),
    uploaded: [],
    deleted: [],
  };
  fakeContainers.set(containerName, store);
  return store;
}

class FakeBlockBlobClient {
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
    this._store = store;
  }

  getBlockBlobClient(blobName) { return new FakeBlockBlobClient(this._store, blobName); }

  listBlobsByHierarchy(_delimiter, options) {
    const prefix = (options && options.prefix) || '';
    const store = this._store;
    return {
      [Symbol.asyncIterator]: async function* () {
        for (const blob of store.blobs) {
          if (prefix && !blob.name.startsWith(prefix)) continue;
          yield { kind: 'blob', name: blob.name, properties: { contentLength: blob.content.length, lastModified: blob.lastModified } };
        }
      },
    };
  }

  listBlobsFlat(options) {
    return this.listBlobsByHierarchy('/', options);
  }
}

const azureBlobModulePath = require.resolve('@azure/storage-blob');
require.cache[azureBlobModulePath] = {
  id: azureBlobModulePath, filename: azureBlobModulePath, loaded: true,
  exports: { ContainerClient: FakeContainerClient },
};

// ── Temp directory + data dir setup ─────────────────────────────────────────────

const ROOT     = path.join(os.tmpdir(), `dm_azblob_exp_${crypto.randomBytes(4).toString('hex')}`);
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const executor = require('../app/executor');
executor._setDataDir(DATA_DIR);

const appCrypto = require('../app/crypto');
appCrypto._setMasterKeyPath(path.join(DATA_DIR, 'master.key'));
appCrypto._setCredentialsFilePath(path.join(DATA_DIR, 'credentials.enc'));

const scheduler = require('../app/scheduler');
const profilesRouter = require('../app/api/profiles');
// profiles.js's credentials.enc path is hardcoded relative to __dirname by
// default (no _setDataDir seam existed for it before this test needed to
// exercise POST/PUT, which write credentials) — redirect it into DATA_DIR so
// these tests can never touch the real repo's data/credentials.enc.
profilesRouter._setCredFilePath(path.join(DATA_DIR, 'credentials.enc'));

const { transferRule, classifySasExpiry, _getAzureBlobSasWarnDays } = executor;

function cleanup() {
  scheduler._reset();
  fs.rmSync(ROOT, { recursive: true, force: true });
}

// ── Route-handler extraction (mirrors tests/api-auth.test.js) ──────────────────

function findRouteHandler(router, method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const getProfilesHandler  = findRouteHandler(profilesRouter, 'get', '/');
const postProfileHandler  = findRouteHandler(profilesRouter, 'post', '/');
const putProfileHandler   = findRouteHandler(profilesRouter, 'put', '/:id');
const testProfileHandler  = findRouteHandler(profilesRouter, 'post', '/:id/test');

function makeRes() {
  return {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body = body; return this; },
  };
}

function makeReq(overrides = {}) {
  return { params: {}, query: {}, body: {}, ...overrides };
}

// ── logger spy (mirrors tests/azure-blob-archive.test.js) ──────────────────────

const logger = require('../app/logger');
let warnMessages, errorMessages;
const originalWarn  = logger.warn.bind(logger);
const originalError = logger.error.bind(logger);
logger.warn  = (msg, ...rest) => { warnMessages.push(msg);  return originalWarn(msg, ...rest); };
logger.error = (msg, ...rest) => { errorMessages.push(msg); return originalError(msg, ...rest); };
function resetLogSpies() { warnMessages = []; errorMessages = []; }

// ── Helpers ──────────────────────────────────────────────────────────────────────

function writeProfiles(profiles) {
  fs.writeFileSync(path.join(DATA_DIR, 'profiles.json'), JSON.stringify(profiles, null, 2), 'utf8');
}

function addCredential(id, sasToken) {
  const credFile = path.join(DATA_DIR, 'credentials.enc');
  const store = fs.existsSync(credFile)
    ? JSON.parse(appCrypto.decrypt(fs.readFileSync(credFile, 'utf8').trim()))
    : {};
  store[`azureblob_${id}`] = sasToken;
  fs.writeFileSync(credFile, appCrypto.encrypt(JSON.stringify(store)), 'utf8');
}

function readStoredCredential(ref) {
  const credFile = path.join(DATA_DIR, 'credentials.enc');
  const store = JSON.parse(appCrypto.decrypt(fs.readFileSync(credFile, 'utf8').trim()));
  return store[ref];
}

// +0.5 day buffer absorbs wall-clock time elapsed between building a test
// fixture and classifySasExpiry() evaluating it later (real async gaps in
// the scheduler/API/transferRule paths — file I/O, route dispatch, etc.).
// Math.floor rounds toward -Infinity, so a value sitting exactly on an
// integer day boundary can drift down by one after even a few ms of delay
// without this margin; the buffer keeps daysFromNow(N) reliably floor to N.
function daysFromNow(days) {
  return new Date(Date.now() + (days + 0.5) * 86400000).toISOString();
}

function makeBlobProfile(id, overrides = {}) {
  const container = overrides.container || `container-${id}`;
  addCredential(id, 'sv=2024-11-04&sr=c&sp=racwdlme&se=2099-01-01T00:00:00Z&sig=fake');
  return {
    id,
    type: 'azure-blob',
    name: overrides.name || `Blob ${id}`,
    blobEndpoint: 'https://fakeaccount.blob.core.windows.net',
    container,
    prefix: overrides.prefix ?? '',
    credentialRef: `azureblob_${id}`,
    sasMeta: overrides.sasMeta, // deliberately no default — tests set this explicitly
    ...overrides,
  };
}

function makeLocalProfile(id, dirPath) {
  return { id, type: 'local', name: `Local ${id}`, path: dirPath };
}

function makeRule(overrides) {
  return Object.assign({
    id:           crypto.randomUUID(),
    name:         'Expiry Test Rule',
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

console.log('\nazure-blob SAS expiry tracking & alerting (Phase 3) tests\n');

// ── classifySasExpiry ────────────────────────────────────────────────────────

await test('classifySasExpiry: null expiresAt -> unknown, daysRemaining null', async () => {
  const r = classifySasExpiry(null, [30, 14, 7, 1]);
  assertEqual(r.status, 'unknown');
  assertEqual(r.daysRemaining, null);
});

await test('classifySasExpiry: negative days -> expired regardless of thresholds', async () => {
  const r = classifySasExpiry(daysFromNow(-1), [30, 14, 7, 1]);
  assertEqual(r.status, 'expired');
  assert(r.daysRemaining < 0);
});

await test('classifySasExpiry: exactly at the largest default threshold (30d) -> warn', async () => {
  const r = classifySasExpiry(daysFromNow(30), [30, 14, 7, 1]);
  assertEqual(r.status, 'warn');
  assertEqual(r.daysRemaining, 30);
});

await test('classifySasExpiry: one day above 30 -> ok', async () => {
  const r = classifySasExpiry(daysFromNow(31), [30, 14, 7, 1]);
  assertEqual(r.status, 'ok');
});

await test('classifySasExpiry: exactly at 14d -> warn', async () => {
  assertEqual(classifySasExpiry(daysFromNow(14), [30, 14, 7, 1]).status, 'warn');
});

await test('classifySasExpiry: exactly at 7d -> warn', async () => {
  assertEqual(classifySasExpiry(daysFromNow(7), [30, 14, 7, 1]).status, 'warn');
});

await test('classifySasExpiry: exactly at 1d (smallest threshold) -> critical', async () => {
  const r = classifySasExpiry(daysFromNow(1), [30, 14, 7, 1]);
  assertEqual(r.status, 'critical');
});

await test('classifySasExpiry: 0 days remaining -> critical', async () => {
  assertEqual(classifySasExpiry(daysFromNow(0), [30, 14, 7, 1]).status, 'critical');
});

await test('classifySasExpiry: sorts an unsorted, non-default thresholds array internally', async () => {
  // Smallest threshold (5) should be 'critical' regardless of input order.
  const unsorted = [20, 5, 60];
  assertEqual(classifySasExpiry(daysFromNow(5), unsorted).status, 'critical');
  assertEqual(classifySasExpiry(daysFromNow(6), unsorted).status, 'warn');   // matches 20, not the smallest
  assertEqual(classifySasExpiry(daysFromNow(20), unsorted).status, 'warn');
  assertEqual(classifySasExpiry(daysFromNow(21), unsorted).status, 'warn');  // matches 60
  assertEqual(classifySasExpiry(daysFromNow(61), unsorted).status, 'ok');
});

// _getAzureBlobSasWarnDays() reads data/config.json via a hardcoded path
// (mirrors app/scheduler.js's _getScheduleTimezone() — no test seam, same
// convention). It is therefore not redirectable to this test's temp DATA_DIR;
// writing a custom value would mean touching the real project's config.json,
// which the test-suite tripwire (tests/run-all.js) forbids. This only
// exercises the default-fallback branch, same limitation _getScheduleTimezone
// already has in the existing test suite.
await test('_getAzureBlobSasWarnDays: defaults to [30,14,7,1] when unset', async () => {
  assertEqual(JSON.stringify(_getAzureBlobSasWarnDays()), JSON.stringify([30, 14, 7, 1]));
});

// ── scheduler daily check ───────────────────────────────────────────────────

await test('_checkAzureBlobSasExpiry: expired profile logs error with days-ago and no other level', async () => {
  writeProfiles([makeBlobProfile('expired1', { sasMeta: { expiresAt: daysFromNow(-3) } })]);
  resetLogSpies();
  await scheduler._checkAzureBlobSasExpiry();
  assert(errorMessages.some(m => /EXPIRED/.test(m) && /"Blob expired1"/.test(m) && /3d ago/.test(m)),
    `expected an EXPIRED error line naming the profile and days-ago, got: ${JSON.stringify(errorMessages)}`);
  assertEqual(warnMessages.length, 0);
});

await test('_checkAzureBlobSasExpiry: critical profile logs at error level', async () => {
  writeProfiles([makeBlobProfile('crit1', { sasMeta: { expiresAt: daysFromNow(0) } })]);
  resetLogSpies();
  await scheduler._checkAzureBlobSasExpiry();
  assert(errorMessages.some(m => /expiring imminently/.test(m) && /"Blob crit1"/.test(m)),
    `expected a critical error line, got: ${JSON.stringify(errorMessages)}`);
  assertEqual(warnMessages.length, 0);
});

await test('_checkAzureBlobSasExpiry: warn profile logs at warn level with days remaining', async () => {
  writeProfiles([makeBlobProfile('warn1', { sasMeta: { expiresAt: daysFromNow(10) } })]);
  resetLogSpies();
  await scheduler._checkAzureBlobSasExpiry();
  assert(warnMessages.some(m => /renewal reminder/.test(m) && /"Blob warn1"/.test(m) && /10d remaining/.test(m)),
    `expected a warn renewal-reminder line, got: ${JSON.stringify(warnMessages)}`);
  assertEqual(errorMessages.length, 0);
});

await test('_checkAzureBlobSasExpiry: unknown (no expiresAt) profile logs at warn level', async () => {
  writeProfiles([makeBlobProfile('unk1', { sasMeta: { source: 'manual', expiresAt: null } })]);
  resetLogSpies();
  await scheduler._checkAzureBlobSasExpiry();
  assert(warnMessages.some(m => /no recorded/.test(m) && /"Blob unk1"/.test(m)),
    `expected a no-recorded-expiry warn line, got: ${JSON.stringify(warnMessages)}`);
  assertEqual(errorMessages.length, 0);
});

await test('_checkAzureBlobSasExpiry: ok profile emits no log line at all', async () => {
  writeProfiles([makeBlobProfile('ok1', { sasMeta: { expiresAt: daysFromNow(365) } })]);
  resetLogSpies();
  await scheduler._checkAzureBlobSasExpiry();
  assertEqual(warnMessages.length, 0);
  assertEqual(errorMessages.length, 0);
});

await test('_checkAzureBlobSasExpiry: non-azure-blob profiles are ignored', async () => {
  writeProfiles([makeLocalProfile('local1', ROOT)]);
  resetLogSpies();
  await scheduler._checkAzureBlobSasExpiry();
  assertEqual(warnMessages.length, 0);
  assertEqual(errorMessages.length, 0);
});

// ── GET /api/profiles ────────────────────────────────────────────────────────

await test('GET /api/profiles: azure-blob profile has sasStatus and sasDaysRemaining', async () => {
  writeProfiles([
    makeBlobProfile('list1', { sasMeta: { expiresAt: daysFromNow(5) } }),
    makeLocalProfile('locallist1', ROOT),
  ]);

  const req = makeReq();
  const res = makeRes();
  await getProfilesHandler(req, res);

  const blobEntry  = res._body.find(p => p.id === 'list1');
  const localEntry = res._body.find(p => p.id === 'locallist1');

  assertEqual(blobEntry.sasStatus, 'warn'); // 5d remaining matches the <=7 default threshold, not the <=1 critical one
  assertEqual(blobEntry.sasDaysRemaining, 5);
  assert(!('sasStatus' in localEntry), 'a non-blob profile must not gain sasStatus');
  assert(!('sasDaysRemaining' in localEntry), 'a non-blob profile must not gain sasDaysRemaining');
  assert(!('sasToken' in blobEntry) && !('password' in blobEntry), 'redact() must still strip credentials');
});

// ── POST /api/profiles/:id/test ─────────────────────────────────────────────

await test('POST /:id/test: azure-blob response sas object includes status alongside existing Phase 1 fields', async () => {
  registerFakeContainer('container-test1', [{ name: 'a.txt', content: Buffer.from('x') }]);
  writeProfiles([
    makeBlobProfile('test1', { container: 'container-test1', sasMeta: { expiresAt: daysFromNow(10), permissions: 'racwdlme', startsAt: null } }),
  ]);

  const req = makeReq({ params: { id: 'test1' } });
  const res = makeRes();
  await testProfileHandler(req, res);

  assertEqual(res._body.ok, true);
  assert(res._body.sas, 'sas object should be present');
  assertEqual(res._body.sas.status, 'warn');
  assertEqual(res._body.sas.daysRemaining, 10);
  assert('expiresAt' in res._body.sas, 'existing Phase 1 field expiresAt unchanged');
  assert('permissions' in res._body.sas, 'existing Phase 1 field permissions unchanged');
  assert('capabilities' in res._body.sas, 'existing Phase 1 field capabilities unchanged');
  assert('notYetValid' in res._body.sas, 'existing Phase 1 field notYetValid unchanged');
});

// ── POST/PUT /api/profiles — sasUri intake (single-paste redesign) ──────────

await test('POST /api/profiles: azure-blob profile created from sasUri derives blobEndpoint/container and stores the bare token', async () => {
  writeProfiles([]);
  const sasUri = 'https://acctxyz.blob.core.windows.net/mycontainer?sv=2024-11-04&sr=c&sp=racwdlme&se=2027-01-01T00:00:00Z&sig=abc123';
  const req = makeReq({ body: { name: 'From URI', type: 'azure-blob', sasUri } });
  const res = makeRes();
  await postProfileHandler(req, res);

  assertEqual(res._status, 201);
  assertEqual(res._body.blobEndpoint, 'https://acctxyz.blob.core.windows.net');
  assertEqual(res._body.container, 'mycontainer');
  assert(!('sasToken' in res._body), 'sasToken must never be returned');
  assert(res._body.credentialRef, 'credentialRef should be set');

  const stored = readStoredCredential(res._body.credentialRef);
  assertEqual(stored, 'sv=2024-11-04&sr=c&sp=racwdlme&se=2027-01-01T00:00:00Z&sig=abc123');
  assert(!stored.includes('https://'), 'stored credential must be the bare token, not the URL');
});

await test('POST /api/profiles: azure-blob profile rejects an invalid sasUri with 400', async () => {
  writeProfiles([]);
  const req = makeReq({ body: { name: 'Bad URI', type: 'azure-blob', sasUri: 'not-a-url' } });
  const res = makeRes();
  await postProfileHandler(req, res);
  assertEqual(res._status, 400);
  assert(/expected a full URL/i.test(res._body.error), `unexpected error message: ${res._body.error}`);
});

await test('POST /api/profiles: azure-blob profile still accepts direct blobEndpoint/container/sasToken fields (back-compat, no sasUri)', async () => {
  writeProfiles([]);
  const req = makeReq({ body: {
    name: 'Direct Fields', type: 'azure-blob',
    blobEndpoint: 'https://directacct.blob.core.windows.net',
    container:    'directcontainer',
    sasToken:     'sv=2024-11-04&sr=c&sp=racwdlme&se=2027-01-01T00:00:00Z&sig=direct123',
  } });
  const res = makeRes();
  await postProfileHandler(req, res);

  assertEqual(res._status, 201);
  assertEqual(res._body.blobEndpoint, 'https://directacct.blob.core.windows.net');
  assertEqual(res._body.container, 'directcontainer');
  const stored = readStoredCredential(res._body.credentialRef);
  assertEqual(stored, 'sv=2024-11-04&sr=c&sp=racwdlme&se=2027-01-01T00:00:00Z&sig=direct123');
});

await test('PUT /api/profiles/:id: azure-blob profile updates blobEndpoint/container/credential when a new sasUri is pasted', async () => {
  writeProfiles([
    makeBlobProfile('putme', {
      blobEndpoint: 'https://old.blob.core.windows.net',
      container:    'oldcontainer',
      sasMeta:      { expiresAt: daysFromNow(5) },
    }),
  ]);
  const newUri = 'https://newacct.blob.core.windows.net/newcontainer?sv=2024-11-04&sr=c&sp=racwdlme&se=2028-01-01T00:00:00Z&sig=newsig';
  const req = makeReq({ params: { id: 'putme' }, body: { sasUri: newUri } });
  const res = makeRes();
  await putProfileHandler(req, res);

  assertEqual(res._status, 200);
  assertEqual(res._body.blobEndpoint, 'https://newacct.blob.core.windows.net');
  assertEqual(res._body.container, 'newcontainer');
  const stored = readStoredCredential(res._body.credentialRef);
  assertEqual(stored, 'sv=2024-11-04&sr=c&sp=racwdlme&se=2028-01-01T00:00:00Z&sig=newsig');
});

// ── transferRule pre-flight ──────────────────────────────────────────────────

await test('transferRule pre-flight: still hard-fails identically for expired (Phase 2a regression check)', async () => {
  writeProfiles([
    makeBlobProfile('src', { sasMeta: { expiresAt: '2020-01-01T00:00:00Z' } }),
    makeLocalProfile('dst1', ROOT),
  ]);

  let caught = null;
  try {
    await transferRule(makeRule({}));
  } catch (err) {
    caught = err;
  }
  assert(caught, 'transferRule should throw for an expired SAS');
  assertEqual(caught.message, 'SAS token for profile "Blob src" expired on 2020-01-01T00:00:00Z');
});

// "The job still succeeds" per §6.4 means the advisory does not hard-abort
// the rule (contrast with the 'expired' throw above) — the file still
// transfers. It does NOT mean jobResult.status stays 'success': status
// computation is untouched by this phase and already treats any non-empty
// jobResult.errors as 'partial' (when files did transfer) — the advisory
// landing in that same array is what makes it visible in job history at all.
await test('transferRule pre-flight: warn pushes an advisory; the file still transfers (job not aborted)', async () => {
  registerFakeContainer('container-pf-warn', [{ name: 'w.txt', content: Buffer.from('data') }]);
  const dstDir = path.join(ROOT, 'dst_pf_warn'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile('src', { container: 'container-pf-warn', sasMeta: { expiresAt: daysFromNow(10) } }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({ destinations: [{ profileId: 'dst1', path: null }] }));

  assertEqual(result.filesTransferred, 1, 'the advisory must not block the actual transfer');
  assert(fs.existsSync(path.join(dstDir, 'w.txt')));
  assert(result.errors.some(e => e.startsWith('Advisory:') && /10d remaining/.test(e) && /"Blob src"/.test(e)),
    `expected an advisory error entry, got: ${JSON.stringify(result.errors)}`);
});

await test('transferRule pre-flight: critical pushes an advisory; the file still transfers (job not aborted)', async () => {
  registerFakeContainer('container-pf-crit', [{ name: 'c.txt', content: Buffer.from('data') }]);
  const dstDir = path.join(ROOT, 'dst_pf_crit'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile('src', { container: 'container-pf-crit', sasMeta: { expiresAt: daysFromNow(0) } }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({ destinations: [{ profileId: 'dst1', path: null }] }));

  assertEqual(result.filesTransferred, 1, 'the advisory must not block the actual transfer');
  assert(fs.existsSync(path.join(dstDir, 'c.txt')));
  assert(result.errors.some(e => e.startsWith('Advisory:')),
    `expected an advisory error entry, got: ${JSON.stringify(result.errors)}`);
});

await test('transferRule pre-flight: ok pushes nothing', async () => {
  registerFakeContainer('container-pf-ok', [{ name: 'o.txt', content: Buffer.from('data') }]);
  const dstDir = path.join(ROOT, 'dst_pf_ok'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile('src', { container: 'container-pf-ok', sasMeta: { expiresAt: daysFromNow(365) } }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({ destinations: [{ profileId: 'dst1', path: null }] }));

  assertEqual(result.status, 'success');
  assertEqual(result.errors.length, 0);
});

await test('transferRule pre-flight: unknown (no expiresAt) pushes nothing', async () => {
  registerFakeContainer('container-pf-unk', [{ name: 'u.txt', content: Buffer.from('data') }]);
  const dstDir = path.join(ROOT, 'dst_pf_unk'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([
    makeBlobProfile('src', { container: 'container-pf-unk', sasMeta: { source: 'manual', expiresAt: null } }),
    makeLocalProfile('dst1', dstDir),
  ]);

  const result = await transferRule(makeRule({ destinations: [{ profileId: 'dst1', path: null }] }));

  assertEqual(result.status, 'success');
  assertEqual(result.errors.length, 0, 'unknown must not repeat an advisory on every job run');
});

// ── Results ───────────────────────────────────────────────────────────────────

cleanup();
console.log(`
${passed} passed, ${failed} failed
`);
if (failed > 0) process.exit(1);

})();
