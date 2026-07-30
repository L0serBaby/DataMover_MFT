'use strict';

// Run with: .\runtime\node.exe tests/azure-blob.test.js
// Pure-function + fake-SDK-client tests — no live Azure container required.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  redactSas, parseSasToken, normalizeSasToken, splitSasUri, resolveBlobPrefix,
  wrapBlobError, blobListFiles, blobGetFile,
} = require('../app/executor');

// ── Temp directory (for blobGetFile staging-root tests) ────────────────────────

const ROOT = path.join(os.tmpdir(), `dm_azblob_${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(ROOT, { recursive: true });

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function assert(cond, msg)    { if (!cond)    throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b)  throw new Error(m  || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

async function assertThrows(fn, pattern) {
  try { fn(); }
  catch (err) {
    if (pattern && !pattern.test(err.message))
      throw new Error(`Rejection "${err.message}" did not match ${pattern}`);
    return;
  }
  throw new Error('Expected a throw but none occurred');
}

// Unlike assertThrows, this awaits fn() — required for async functions
// (blobGetFile, blobListFiles) whose rejection happens on the returned
// promise, not synchronously on the call.
async function assertRejects(fn, pattern) {
  try { await fn(); }
  catch (err) {
    if (pattern && !pattern.test(err.message))
      throw new Error(`Rejection "${err.message}" did not match ${pattern}`);
    return;
  }
  throw new Error('Expected a rejection but none occurred');
}

// ── Fake ContainerClient factories ──────────────────────────────────────────────

// onPull fires exactly when the generator is resumed to produce that item
// (i.e. when the consumer calls .next()) — NOT eagerly for the whole array —
// so tests can prove an early `return` inside the for-await loop actually
// stops the iterator instead of merely slicing a fully-drained result.
function asyncIterableOf(items, onPull) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const item of items) {
        if (onPull) onPull(item);
        yield item;
      }
    },
  };
}

// Fake for the recursive=false (listBlobsByHierarchy) path. `items` are
// already shaped as { kind: 'blob'|'prefix', name, properties }.
function makeHierarchyClient(items, onPull) {
  return {
    listBlobsByHierarchy: (_delimiter, _options) => asyncIterableOf(items, onPull),
  };
}

// Fake for the recursive=true (listBlobsFlat) path. `items` are shaped as
// { name, properties, metadata }.
function makeFlatClient(items, onPull) {
  return {
    listBlobsFlat: (_options) => asyncIterableOf(items, onPull),
  };
}

function blobItem(name, size = 10, metadata = undefined) {
  return { name, properties: { contentLength: size, lastModified: new Date('2026-01-01T00:00:00Z') }, metadata };
}

(async () => {

console.log('\nazure-blob pure helper tests\n');

// ── redactSas ────────────────────────────────────────────────────────────────

await test('redactSas masks sig= inside a realistic RestError message', async () => {
  const msg =
    'RestError: The specified signature did not match. Details: ' +
    'GET https://stanalyticsprod01.blob.core.windows.net/databricks-landing?' +
    'restype=container&comp=list&sv=2024-11-04&ss=b&srt=co&sp=rwdlacx&' +
    'se=2027-01-01T00%3A00%3A00Z&st=2026-01-01T00%3A00%3A00Z&spr=https&' +
    'sig=AbCdEf1234567890%2Bxyz%3D returned status code 403';
  const redacted = redactSas(msg);
  assert(!redacted.includes('AbCdEf1234567890'), 'signature value should be gone');
  assert(redacted.includes('sig=***'), 'sig=*** should be present');
  assert(redacted.includes('se=2027-01-01T00%3A00%3A00Z'), 'other params should survive untouched');
  assert(redacted.includes('returned status code 403'), 'trailing message text should survive');
});

await test('redactSas handles sig as the last query parameter with no trailing separator', async () => {
  const msg = 'https://acct.blob.core.windows.net/c?sv=2024-11-04&sig=SECRETVALUE';
  assertEqual(redactSas(msg), 'https://acct.blob.core.windows.net/c?sv=2024-11-04&sig=***');
});

await test('redactSas is a no-op when no sig= is present', async () => {
  const msg = 'Some unrelated error with no signature in it';
  assertEqual(redactSas(msg), msg);
});

await test('redactSas does not corrupt a substring that merely contains "sig"', async () => {
  const msg = 'design=foo&assign=bar';
  assertEqual(redactSas(msg), msg);
});

await test('redactSas passes through non-string input unchanged', async () => {
  assertEqual(redactSas(null), null);
  assertEqual(redactSas(undefined), undefined);
});

// ── parseSasToken ────────────────────────────────────────────────────────────

await test('parseSasToken parses an ad-hoc (se-bearing) SAS', async () => {
  const token = 'sv=2024-11-04&sr=c&sp=racwdl&se=2027-07-29T00:00:00Z&st=2026-07-29T00:00:00Z&spr=https&sig=abc123';
  const meta = parseSasToken(token);
  assertEqual(meta.source, 'parsed');
  assertEqual(meta.expiresAt, new Date('2027-07-29T00:00:00Z').toISOString());
  assertEqual(meta.startsAt, new Date('2026-07-29T00:00:00Z').toISOString());
  assertEqual(meta.permissions, 'racwdl');
  assertEqual(meta.resource, 'c');
  assertEqual(meta.policyId, null);
  assertEqual(meta.protocol, 'https');
  assertEqual(meta.signedVersion, '2024-11-04');
  assertEqual(meta.signingKey, null);
  assert(meta.parsedAt, 'parsedAt should be set');
});

await test('parseSasToken tolerates a leading "?"', async () => {
  const meta = parseSasToken('?sv=2024-11-04&sr=c&sp=rl&se=2027-01-01T00:00:00Z&sig=abc');
  assertEqual(meta.source, 'parsed');
  assertEqual(meta.permissions, 'rl');
});

await test('parseSasToken parses a policy-backed (si-only) SAS as manual/unset expiry', async () => {
  const token = 'sv=2024-11-04&sr=c&si=datamover-databricks-landing&sig=abc123';
  const meta = parseSasToken(token);
  assertEqual(meta.source, 'manual');
  assertEqual(meta.expiresAt, null);
  assertEqual(meta.policyId, 'datamover-databricks-landing');
});

await test('parseSasToken rejects sr=b (blob-scoped, not container-scoped)', async () => {
  const token = 'sv=2024-11-04&sr=b&sp=r&se=2027-01-01T00:00:00Z&sig=abc';
  await assertThrows(() => parseSasToken(token), /container-scoped/i);
});

await test('parseSasToken rejects a token missing both se and si', async () => {
  const token = 'sv=2024-11-04&sr=c&sp=racwdl&sig=abc123';
  await assertThrows(() => parseSasToken(token), /missing both/i);
});

await test('parseSasToken rejects an empty token', async () => {
  await assertThrows(() => parseSasToken(''), /empty/i);
  await assertThrows(() => parseSasToken('   '), /empty/i);
});

await test('parseSasToken parses a full Blob SAS URL identically to its bare query string', async () => {
  const query = 'sv=2024-11-04&sr=c&sp=racwdlme&se=2027-07-29T00:00:00Z&sig=abc123';
  const url   = `https://stanalyticsprod01.blob.core.windows.net/databricks-landing?${query}`;
  const fromUrl   = parseSasToken(url);
  const fromQuery = parseSasToken(query);
  assertEqual(fromUrl.source, fromQuery.source);
  assertEqual(fromUrl.expiresAt, fromQuery.expiresAt);
  assertEqual(fromUrl.permissions, fromQuery.permissions);
  assertEqual(fromUrl.resource, fromQuery.resource);
});

await test('parseSasToken tolerates a full URL case-insensitively (HTTPS://)', async () => {
  const meta = parseSasToken('HTTPS://acct.blob.core.windows.net/c?sr=c&se=2027-01-01T00:00:00Z&sig=abc');
  assertEqual(meta.source, 'parsed');
});

await test('parseSasToken rejects a full URL with no query string, naming the actual problem', async () => {
  await assertThrows(
    () => parseSasToken('https://stanalyticsprod01.blob.core.windows.net/databricks-landing'),
    /Blob SAS token, not the Blob SAS URL/
  );
});

await test('parseSasToken rejects a non-parseable se value', async () => {
  const token = 'sv=2024-11-04&sr=c&se=not-a-date&sig=abc';
  await assertThrows(() => parseSasToken(token), /could not parse/i);
});

await test('parseSasToken ipRange maps from sip', async () => {
  const token = 'sv=2024-11-04&sr=c&se=2027-01-01T00:00:00Z&sip=10.0.0.1-10.0.0.255&sig=abc';
  assertEqual(parseSasToken(token).ipRange, '10.0.0.1-10.0.0.255');
});

// ── normalizeSasToken ────────────────────────────────────────────────────────

await test('normalizeSasToken passes a bare query string through unchanged', async () => {
  assertEqual(normalizeSasToken('sv=2024-11-04&sr=c&sig=abc'), 'sv=2024-11-04&sr=c&sig=abc');
});

await test('normalizeSasToken strips a leading "?"', async () => {
  assertEqual(normalizeSasToken('?sv=2024-11-04&sig=abc'), 'sv=2024-11-04&sig=abc');
});

await test('normalizeSasToken strips a full URL down to its query string', async () => {
  assertEqual(
    normalizeSasToken('https://acct.blob.core.windows.net/c?sv=2024-11-04&sig=abc'),
    'sv=2024-11-04&sig=abc'
  );
});

await test('normalizeSasToken rejects a full URL with no query string', async () => {
  await assertThrows(
    () => normalizeSasToken('https://acct.blob.core.windows.net/c'),
    /Blob SAS token, not the Blob SAS URL/
  );
});

// ── splitSasUri ──────────────────────────────────────────────────────────────

await test('splitSasUri splits a realistic container-scoped Blob SAS URL', async () => {
  const uri =
    'https://staldlsedadeveus.blob.core.windows.net/eda-landing' +
    '?sp=racwdlme&st=2026-07-29T00:00:00Z&se=2027-07-29T00:00:00Z&spr=https&sv=2024-11-04&sr=c&sig=AbC123%2Fxyz%3D';
  const split = splitSasUri(uri);
  assertEqual(split.blobEndpoint, 'https://staldlsedadeveus.blob.core.windows.net');
  assertEqual(split.container, 'eda-landing');
  assertEqual(
    split.sasToken,
    'sp=racwdlme&st=2026-07-29T00:00:00Z&se=2027-07-29T00:00:00Z&spr=https&sv=2024-11-04&sr=c&sig=AbC123%2Fxyz%3D'
  );
  // Round-trips cleanly into parseSasToken.
  const meta = parseSasToken(split.sasToken);
  assertEqual(meta.source, 'parsed');
  assertEqual(meta.permissions, 'racwdlme');
});

await test('splitSasUri rejects a non-URL input', async () => {
  await assertThrows(() => splitSasUri('not a url at all'), /expected a full URL/i);
});

await test('splitSasUri rejects a URL with zero path segments', async () => {
  await assertThrows(() => splitSasUri('https://acct.blob.core.windows.net/?sp=r&sig=abc'), /no container name/i);
});

await test('splitSasUri rejects a URL with more than one path segment (blob-level SAS)', async () => {
  await assertThrows(
    () => splitSasUri('https://acct.blob.core.windows.net/container/blob.csv?sp=r&sig=abc'),
    /2 segments/i
  );
});

await test('splitSasUri rejects a URL with no query string', async () => {
  await assertThrows(
    () => splitSasUri('https://acct.blob.core.windows.net/container'),
    /no query string found/i
  );
});

// ── resolveBlobPrefix ────────────────────────────────────────────────────────

await test('resolveBlobPrefix returns the profile prefix when rulePath is absent', async () => {
  assertEqual(resolveBlobPrefix({ prefix: 'inbound/' }, null), 'inbound');
});

await test('resolveBlobPrefix joins a relative rulePath onto the profile prefix', async () => {
  assertEqual(resolveBlobPrefix({ prefix: 'inbound' }, 'sub/dir'), 'inbound/sub/dir');
});

await test('resolveBlobPrefix rejects a relative rulePath that escapes the prefix', async () => {
  await assertThrows(() => resolveBlobPrefix({ prefix: 'inbound' }, '../escape'), /Path traversal rejected/);
});

await test('resolveBlobPrefix rejects a deeply nested traversal attempt', async () => {
  await assertThrows(() => resolveBlobPrefix({ prefix: 'inbound' }, 'sub/../../escape'), /Path traversal rejected/);
});

await test('resolveBlobPrefix treats a leading "/" rulePath as an override of the prefix', async () => {
  assertEqual(resolveBlobPrefix({ prefix: 'inbound' }, '/other/root'), 'other/root');
});

// ── parseSasToken — user-delegation SAS (§14.2e) ────────────────────────────────

await test('parseSasToken: user-delegation SAS with ske < se resolves expiresAt to ske', async () => {
  const token = 'sv=2024-11-04&sr=c&sp=rl&se=2027-01-01T00:00:00Z&' +
    'skoid=11111111-1111-1111-1111-111111111111&sktid=22222222-2222-2222-2222-222222222222&' +
    'skt=2026-07-01T00:00:00Z&ske=2026-07-08T00:00:00Z&sks=b&skv=2024-11-04&sig=abc';
  const meta = parseSasToken(token);
  assertEqual(meta.kind, 'user-delegation');
  assertEqual(meta.expiresAt, new Date('2026-07-08T00:00:00Z').toISOString(), 'effective expiry should be the earlier ske, not se');
  assertEqual(meta.delegationKeyExpiresAt, new Date('2026-07-08T00:00:00Z').toISOString());
  assertEqual(meta.delegationObjectId, '11111111-1111-1111-1111-111111111111');
  assertEqual(meta.delegationTenantId, '22222222-2222-2222-2222-222222222222');
});

await test('parseSasToken: user-delegation SAS with ske > se keeps se as the effective expiry', async () => {
  const token = 'sv=2024-11-04&sr=c&sp=rl&se=2026-08-01T00:00:00Z&skoid=oid&ske=2026-08-10T00:00:00Z&sig=abc';
  const meta = parseSasToken(token);
  assertEqual(meta.kind, 'user-delegation');
  assertEqual(meta.expiresAt, new Date('2026-08-01T00:00:00Z').toISOString(), 'min(se, ske) should pick se here');
});

await test('parseSasToken: service SAS with no ske is unchanged and reports kind "service"', async () => {
  const token = 'sv=2024-11-04&sr=c&sp=racwdl&se=2027-07-29T00:00:00Z&sig=abc';
  const meta = parseSasToken(token);
  assertEqual(meta.kind, 'service');
  assertEqual(meta.expiresAt, new Date('2027-07-29T00:00:00Z').toISOString());
  assertEqual(meta.delegationKeyExpiresAt, null);
});

// ── wrapBlobError (§14.2c) ───────────────────────────────────────────────────────

await test('wrapBlobError preserves statusCode/code/errorCode and redacts the message', async () => {
  const err = new Error(
    'Server failed to authenticate the request. GET https://acct.blob.core.windows.net/c?sv=2024-11-04&sig=SuperSecretSig123 returned 403'
  );
  err.statusCode = 403;
  err.code       = 'AuthenticationFailed';
  err.errorCode  = 'AuthenticationFailed';

  const wrapped = wrapBlobError(err);
  assert(wrapped instanceof Error);
  assertEqual(wrapped.statusCode, 403);
  assertEqual(wrapped.code, 'AuthenticationFailed');
  assertEqual(wrapped.errorCode, 'AuthenticationFailed');
  assert(!wrapped.message.includes('SuperSecretSig123'), 'signature must not survive');
  assert(wrapped.message.includes('sig=***'), 'redaction marker should be present');
});

await test('wrapBlobError redacts the signature from copied details too', async () => {
  const err = new Error('request failed');
  err.details = { errorCode: 'AuthenticationFailed', requestUrl: 'https://acct.blob.core.windows.net/c?sig=AnotherSecret456&sv=2024-11-04' };

  const wrapped = wrapBlobError(err);
  const detailsStr = JSON.stringify(wrapped.details);
  assert(!detailsStr.includes('AnotherSecret456'), 'signature must not survive in details');
  assert(detailsStr.includes('sig=***'), 'redaction marker should be present in details');
  assertEqual(wrapped.details.errorCode, 'AuthenticationFailed', 'non-secret fields survive intact');
});

await test('wrapBlobError omits fields that were absent on the source error', async () => {
  const wrapped = wrapBlobError(new Error('plain failure, no sig here'));
  assertEqual(wrapped.statusCode, undefined);
  assertEqual(wrapped.code, undefined);
  assertEqual(wrapped.errorCode, undefined);
  assertEqual(wrapped.details, undefined);
});

await test('wrapBlobError is safe against a non-Error argument', async () => {
  const wrapped = wrapBlobError('a bare string with sig=ShouldBeGone in it');
  assert(wrapped instanceof Error);
  assert(!wrapped.message.includes('ShouldBeGone'));
});

// ── blobListFiles — HNS directory exclusion, recursive=true (§15.1) ─────────────

await test('blobListFiles recursive=true excludes hdi_isfolder markers and trailing-slash names', async () => {
  const client = makeFlatClient([
    blobItem('inbound/real1.csv', 10, { hdi_isfolder: 'false' }),
    blobItem('inbound/subdir', 0, { hdi_isfolder: 'true' }),        // HNS folder marker
    blobItem('inbound/subdir/', 0, {}),                              // defensive trailing-slash skip
    blobItem('inbound/subdir/real2.csv', 20, {}),
  ]);
  const results = await blobListFiles(client, 'inbound', null, null, true);
  assertEqual(results.length, 2, 'only the two real blobs should survive');
  assert(results.some(r => r.relPath === 'real1.csv'));
  assert(results.some(r => r.relPath === 'subdir/real2.csv'));
});

await test('blobListFiles recursive=true treats hdi_isfolder case-insensitively and normalises the metadata key', async () => {
  const client = makeFlatClient([
    blobItem('inbound/folder-marker', 0, { HDI_isFolder: 'TRUE' }),
    blobItem('inbound/real.csv', 5, {}),
  ]);
  const results = await blobListFiles(client, 'inbound', null, null, true);
  assertEqual(results.length, 1);
  assertEqual(results[0].relPath, 'real.csv');
});

await test('blobListFiles recursive=true requests includeMetadata (marker would otherwise be invisible)', async () => {
  let capturedOptions = null;
  const client = {
    listBlobsFlat: (options) => { capturedOptions = options; return asyncIterableOf([]); },
  };
  await blobListFiles(client, 'inbound', null, null, true);
  assertEqual(capturedOptions.includeMetadata, true);
});

await test('blobListFiles recursive=false is unaffected by HNS markers (already filters on item.kind)', async () => {
  const client = makeHierarchyClient([
    { kind: 'prefix', name: 'inbound/subdir/' },
    { kind: 'blob', ...blobItem('inbound/real1.csv', 10) },
  ]);
  const results = await blobListFiles(client, 'inbound', null, null, false);
  assertEqual(results.length, 1);
  assertEqual(results[0].relPath, 'real1.csv');
});

// ── blobListFiles — recursive-mode filter divergence from SFTP (§14.2b) ─────────

await test('blobListFiles recursive=true: a bare glob does not match a nested blob (matches relPath, not bare name)', async () => {
  const client = makeFlatClient([blobItem('inbound/sub/dir/file.csv', 10)]);
  const results = await blobListFiles(client, 'inbound', '*.csv', null, true);
  assertEqual(results.length, 0, 'diverges from sftpListFiles, which matches the bare filename');
});

await test('blobListFiles recursive=true: "**/*.csv" matches the nested blob', async () => {
  const client = makeFlatClient([blobItem('inbound/sub/dir/file.csv', 10)]);
  const results = await blobListFiles(client, 'inbound', '**/*.csv', null, true);
  assertEqual(results.length, 1);
});

await test('blobListFiles recursive=false: bare glob and relPath are identical, filter matches normally', async () => {
  const client = makeHierarchyClient([{ kind: 'blob', ...blobItem('inbound/file.csv', 10) }]);
  const results = await blobListFiles(client, 'inbound', '*.csv', null, false);
  assertEqual(results.length, 1);
});

// ── blobListFiles — limit (§14.2d) ───────────────────────────────────────────────

await test('blobListFiles limit stops iteration early instead of enumerating then slicing', async () => {
  let pulled = 0;
  const items = ['a', 'b', 'c', 'd', 'e'].map(n => ({ kind: 'blob', ...blobItem(`inbound/${n}.txt`, 1) }));
  const client = makeHierarchyClient(items, () => { pulled++; });

  const results = await blobListFiles(client, 'inbound', null, null, false, 2);
  assertEqual(results.length, 2, 'only 2 results returned');
  assertEqual(pulled, 2, 'the iterator must not be pulled past the limit');
});

await test('blobListFiles limit=0 (default) is unlimited — preserves prior behaviour', async () => {
  const items = ['a', 'b', 'c'].map(n => ({ kind: 'blob', ...blobItem(`inbound/${n}.txt`, 1) }));
  const client = makeHierarchyClient(items);
  const results = await blobListFiles(client, 'inbound', null, null, false);
  assertEqual(results.length, 3);
});

await test('blobListFiles limit applies to accepted results, not raw entries (rejects still count against the source, not the limit)', async () => {
  const items = [
    { kind: 'blob', ...blobItem('inbound/../evil.txt', 1) }, // rejected by sanitizeRemoteName
    { kind: 'blob', ...blobItem('inbound/ok1.txt', 1) },
    { kind: 'blob', ...blobItem('inbound/ok2.txt', 1) },
  ];
  const client = makeHierarchyClient(items);
  const results = await blobListFiles(client, 'inbound', null, null, false, 2);
  assertEqual(results.length, 2);
  assert(results.every(r => r.name.startsWith('ok')), 'the rejected entry must not occupy a limit slot');
});

// ── blobGetFile — stagingRoot enforcement (§14.2a) ──────────────────────────────

await test('blobGetFile throws when stagingRoot is not supplied', async () => {
  const client = { getBlockBlobClient: () => ({ downloadToFile: async () => { throw new Error('should not be called'); } }) };
  await assertRejects(
    () => blobGetFile(client, 'blob/name.txt', path.join(ROOT, 'no_staging_root.txt'), 5),
    /stagingRoot is required/
  );
});

await test('blobGetFile throws when localDest resolves outside stagingRoot, and writes nothing', async () => {
  const stagingRoot = path.join(ROOT, 'stage_root');
  fs.mkdirSync(stagingRoot, { recursive: true });
  const outsideDest = path.join(ROOT, 'outside_staging', 'evil.txt');

  const client = { getBlockBlobClient: () => ({ downloadToFile: async () => { throw new Error('should not be called — assertWithin must fire first'); } }) };

  await assertRejects(
    () => blobGetFile(client, 'blob/name.txt', outsideDest, 5, stagingRoot),
    /Path escapes base directory/
  );
  assert(!fs.existsSync(outsideDest), 'no file should be created outside the staging root');
  assert(!fs.existsSync(outsideDest + '.tmp'), 'no tmp file should be created outside the staging root');
});

await test('blobGetFile succeeds and downloads when localDest is within stagingRoot', async () => {
  const stagingRoot = path.join(ROOT, 'stage_ok');
  fs.mkdirSync(stagingRoot, { recursive: true });
  const dest = path.join(stagingRoot, 'file.txt');

  const client = {
    getBlockBlobClient: () => ({
      downloadToFile: async (tmpPath) => { fs.writeFileSync(tmpPath, 'abcde'); },
    }),
  };

  await blobGetFile(client, 'blob/file.txt', dest, 5, stagingRoot);
  assertEqual(fs.readFileSync(dest, 'utf8'), 'abcde');
  assert(!fs.existsSync(dest + '.tmp'), 'tmp file should be renamed away');
});

// ── Cleanup ──────────────────────────────────────────────────────────────────────

try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}

// ── Results ───────────────────────────────────────────────────────────────────

console.log(`
${passed} passed, ${failed} failed
`);
if (failed > 0) process.exit(1);

})();
