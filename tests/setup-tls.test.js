'use strict';

// Run with: .\runtime\node.exe tests/setup-tls.test.js
// Uses a temp certs dir and real (loopback) TCP binds — no live server required.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const net    = require('net');
const forge  = require('node-forge');

// ── Temp dirs ─────────────────────────────────────────────────────────────────

const ROOT      = path.join(os.tmpdir(), `dm_tls_${crypto.randomBytes(4).toString('hex')}`);
const CERTS_DIR = path.join(ROOT, 'certs');
fs.mkdirSync(CERTS_DIR, { recursive: true });

const setupTls = require('../app/setup-tls');
setupTls._setCertsDir(CERTS_DIR);

function cleanup() {
  fs.rmSync(ROOT, { recursive: true, force: true });
}

function uniqueHostname() {
  return `test-${crypto.randomBytes(4).toString('hex')}.example`;
}

function uniqueConfigPath() {
  return path.join(ROOT, `config_${crypto.randomBytes(4).toString('hex')}.json`);
}

// Binds an ephemeral port, resolves the assigned port number, and closes it —
// gives us a port number that was free at the moment of the call.
function getFreePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });
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
    console.log(`        ${err.message}`);
    failed++;
  }
}

function assert(cond, msg)    { if (!cond)   throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m  || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

async function assertRejects(fn, pattern) {
  try { await fn(); }
  catch (err) {
    if (pattern && !pattern.test(err.message))
      throw new Error(`Rejection "${err.message}" did not match ${pattern}`);
    return;
  }
  throw new Error('Expected a rejection but none was thrown');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

console.log('\nsetup-tls.js tests\n');

await test('generated cert parses and SAN contains all expected entries', async () => {
  const hostname = uniqueHostname();
  const result = setupTls.generateSelfSignedCert({ hostname, overwrite: true });
  assert(result.fingerprint, 'fingerprint should be returned');
  assert(result.notAfter,    'notAfter should be returned');

  const certPem = fs.readFileSync(setupTls._certPath(), 'utf8');
  const cert = forge.pki.certificateFromPem(certPem);
  const san  = cert.getExtension('subjectAltName');
  assert(san, 'subjectAltName extension should be present');

  const dnsNames = san.altNames.filter(a => a.type === 2).map(a => a.value);
  const ips      = san.altNames.filter(a => a.type === 7).map(a => a.ip);

  assert(dnsNames.includes(hostname),    'SAN should include the entered hostname');
  assert(dnsNames.includes(os.hostname()), 'SAN should include os.hostname()');
  assert(dnsNames.includes('localhost'), 'SAN should include localhost');
  assertEqual(ips.length, 1, 'expected exactly one IP SAN entry');
  assert(ips.includes('127.0.0.1'), 'SAN should include 127.0.0.1');

  // Dedup check: total altNames should equal the number of *unique* DNS names
  // plus the one IP entry — catches a regression that stops deduping.
  const expectedDnsCount = new Set([hostname, os.hostname(), 'localhost']).size;
  assertEqual(dnsNames.length, expectedDnsCount, 'DNS SAN entries should be deduped');
  assertEqual(san.altNames.length, expectedDnsCount + 1);
});

await test('fingerprint is stable across a parse round-trip', async () => {
  const hostname = uniqueHostname();
  const result = setupTls.generateSelfSignedCert({ hostname, overwrite: true });

  const certPem       = fs.readFileSync(setupTls._certPath(), 'utf8');
  const reparsed      = forge.pki.certificateFromPem(certPem);
  const reserialized  = forge.pki.certificateToPem(reparsed);
  const roundTripFp   = setupTls._fingerprintOf(reserialized);

  assertEqual(roundTripFp, result.fingerprint);
});

await test('refuses to overwrite an existing cert without the explicit flag', async () => {
  setupTls.generateSelfSignedCert({ hostname: uniqueHostname(), overwrite: true }); // ensure one exists
  await assertRejects(
    () => setupTls.generateSelfSignedCert({ hostname: uniqueHostname() }),
    /already exists/
  );
});

await test('overwrite:true replaces an existing cert', async () => {
  const hostname2 = uniqueHostname();
  setupTls.generateSelfSignedCert({ hostname: uniqueHostname(), overwrite: true });
  setupTls.generateSelfSignedCert({ hostname: hostname2, overwrite: true }); // should not throw

  const certPem = fs.readFileSync(setupTls._certPath(), 'utf8');
  const cert = forge.pki.certificateFromPem(certPem);
  assertEqual(cert.subject.getField('CN').value, hostname2);
});

await test('checkPort returns false for a port the test itself holds open', async () => {
  const holder = net.createServer();
  await new Promise(resolve => holder.listen(0, resolve));
  const heldPort = holder.address().port;

  const result = await setupTls.checkPort(heldPort);
  assertEqual(result.available, false);

  await new Promise(resolve => holder.close(resolve));
});

await test('checkPort returns true for the port the service currently listens on', async () => {
  // No real bind is attempted for this case — the short-circuit trusts that
  // the running service (currentPort) already holds it.
  const result = await setupTls.checkPort(3000, 3000);
  assertEqual(result.available, true);
});

await test('checkPort returns true for a genuinely free port', async () => {
  const freePort = await getFreePort();
  const result = await setupTls.checkPort(freePort);
  assertEqual(result.available, true);
});

await test('completeSetup writes nothing when the port is unbindable', async () => {
  const configPath = uniqueConfigPath();
  fs.writeFileSync(configPath, JSON.stringify({ existing: true }), 'utf8');

  // A valid cert/key pair exists so the port check is the thing that fails.
  setupTls.generateSelfSignedCert({ hostname: uniqueHostname(), overwrite: true });

  const holder = net.createServer();
  await new Promise(resolve => holder.listen(0, resolve));
  const heldPort = holder.address().port;

  await assertRejects(() => setupTls.completeSetup({
    port: heldPort, currentPort: 1, behindTlsProxy: false, configPath,
  }));

  const after = fs.readFileSync(configPath, 'utf8');
  assertEqual(after, JSON.stringify({ existing: true }), 'config.json must be untouched on failure');
  assert(!fs.existsSync(configPath + '.tmp'), 'no leftover .tmp file');

  await new Promise(resolve => holder.close(resolve));
});

await test('completeSetup writes nothing when the cert is missing or unparseable', async () => {
  const configPath = uniqueConfigPath();
  fs.writeFileSync(configPath, JSON.stringify({ existing: true }), 'utf8');

  const emptyCertsDir = path.join(ROOT, `empty_certs_${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(emptyCertsDir, { recursive: true });
  setupTls._setCertsDir(emptyCertsDir);

  try {
    const freePort = await getFreePort();
    await assertRejects(() => setupTls.completeSetup({
      port: freePort, currentPort: 1, behindTlsProxy: false, configPath,
    }), /Certificate\/key check failed/);

    const after = fs.readFileSync(configPath, 'utf8');
    assertEqual(after, JSON.stringify({ existing: true }), 'config.json must be untouched on failure');
  } finally {
    setupTls._setCertsDir(CERTS_DIR); // restore for subsequent tests
  }
});

await test('completeSetup succeeds and writes config when cert and port are both fine', async () => {
  const configPath = uniqueConfigPath();
  fs.writeFileSync(configPath, JSON.stringify({}), 'utf8');

  setupTls.generateSelfSignedCert({ hostname: uniqueHostname(), overwrite: true });
  const freePort = await getFreePort();

  const result = await setupTls.completeSetup({
    port: freePort, currentPort: 1, behindTlsProxy: false, configPath,
  });
  assertEqual(result.port, freePort);

  const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assertEqual(after.PORT, freePort);
  assertEqual(after.SSL_CERT, 'certs/server.crt');
  assertEqual(after.SSL_KEY, 'certs/server.key');
  assert(after.SETUP_COMPLETED_AT, 'SETUP_COMPLETED_AT should be set');
});

await test('completeSetup skips cert verification and SSL_CERT/SSL_KEY when behindTlsProxy', async () => {
  const configPath = uniqueConfigPath();
  fs.writeFileSync(configPath, JSON.stringify({}), 'utf8');

  // Point at an empty certs dir — this must NOT be checked when behind a proxy.
  const emptyCertsDir = path.join(ROOT, `empty_certs_${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(emptyCertsDir, { recursive: true });
  setupTls._setCertsDir(emptyCertsDir);

  try {
    const freePort = await getFreePort();
    const result = await setupTls.completeSetup({
      port: freePort, currentPort: 1, behindTlsProxy: true, configPath,
    });
    assertEqual(result.port, freePort);

    const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assertEqual(after.PORT, freePort);
    assert(!('SSL_CERT' in after), 'SSL_CERT should not be written when behind a proxy');
    assert(!('SSL_KEY' in after),  'SSL_KEY should not be written when behind a proxy');
    assert(after.SETUP_COMPLETED_AT, 'SETUP_COMPLETED_AT should still be set');
  } finally {
    setupTls._setCertsDir(CERTS_DIR);
  }
});

// ── Results ───────────────────────────────────────────────────────────────────

cleanup();
console.log(`
${passed} passed, ${failed} failed
`);
if (failed > 0) process.exit(1);

})();
