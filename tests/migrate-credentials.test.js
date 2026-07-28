'use strict';

// Run with: node tests/migrate-credentials.test.js
// Runs on any platform — uses app/crypto.js's _setMachineGuidOverride() to
// produce genuine legacy (v1) fixtures without a real registry read.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ── Temp directory setup ─────────────────────────────────────────────────────

const TMP_DIR = path.join(os.tmpdir(), `dm_migrate_test_${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(TMP_DIR, { recursive: true });

const appCrypto = require('../app/crypto');
const MASTER_KEY_PATH = path.join(TMP_DIR, 'master.key');
appCrypto._setMasterKeyPath(MASTER_KEY_PATH);
// Without this, crypto.js's missing-key guard would fall back to checking
// the REAL project's data/credentials.enc the first time a test generates a
// master key — this keeps that check inside the sandbox too.
appCrypto._setCredentialsFilePath(path.join(TMP_DIR, 'unused-default-credentials.enc'));
appCrypto._setMachineGuidOverride('TEST-FAKE-MACHINE-GUID-0000'); // never touch the real registry

const { migrateCredentialStore } = require('../app/migrate-credentials');

function cleanup() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

function uniqueCredFile() {
  return path.join(TMP_DIR, `credentials_${crypto.randomBytes(4).toString('hex')}.enc`);
}

// ── Fixture helpers ────────────────────────────────────────────────────────────

// Genuine v1 ciphertext via the real legacy KDF path (machine-guid override,
// not the registry) — not a hand-rolled reimplementation of the old format.
function writeLegacyV1Store(credFile, store) {
  fs.writeFileSync(credFile, appCrypto._legacyEncryptV1ForTest(JSON.stringify(store)), 'utf8');
}

function writeV2Store(credFile, store) {
  fs.writeFileSync(credFile, appCrypto.encrypt(JSON.stringify(store)), 'utf8');
}

function readStoreRaw(credFile) {
  return fs.readFileSync(credFile, 'utf8').trim();
}

function decryptStore(credFile) {
  return JSON.parse(appCrypto.decrypt(readStoreRaw(credFile)));
}

// ── Minimal test runner ──────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
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

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\nmigrate-credentials.js tests\n');

test('migrates a v1 store to v2, preserving every value', () => {
  const credFile = uniqueCredFile();
  const original = {
    sftp_a:   'password-123',
    sshkey_b: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
    pgp_pass: 'p@ssphrase!',
  };
  writeLegacyV1Store(credFile, original);

  const result = migrateCredentialStore({ credFile });
  assert(result.migrated, 'expected migration to report success');

  assertEqual(readStoreRaw(credFile).split(':').length, 5, 'file should now be v2 format');
  assertEqual(JSON.stringify(decryptStore(credFile)), JSON.stringify(original));
});

test('creates a timestamped backup before migrating, preserving the original format', () => {
  const credFile = uniqueCredFile();
  writeLegacyV1Store(credFile, { key: 'value' });

  const prefix = path.basename(credFile) + '.bak-';
  assertEqual(fs.readdirSync(TMP_DIR).filter(f => f.startsWith(prefix)).length, 0);

  migrateCredentialStore({ credFile });

  const backups = fs.readdirSync(TMP_DIR).filter(f => f.startsWith(prefix));
  assertEqual(backups.length, 1, 'expected exactly one backup file');

  const backupContent = fs.readFileSync(path.join(TMP_DIR, backups[0]), 'utf8');
  assertEqual(backupContent.split(':').length, 3, 'backup should preserve the original v1 format untouched');
});

test('migration is idempotent — running twice produces the same readable result', () => {
  const credFile = uniqueCredFile();
  const original = { onlyKey: 'only-value' };
  writeLegacyV1Store(credFile, original);

  const first = migrateCredentialStore({ credFile });
  assert(first.migrated, 'first run should migrate');
  assertEqual(JSON.stringify(decryptStore(credFile)), JSON.stringify(original));

  const second = migrateCredentialStore({ credFile });
  assertEqual(second.migrated, false, 'second run should be a no-op (already v2)');
  assertEqual(second.reason, 'already v2');
  assertEqual(JSON.stringify(decryptStore(credFile)), JSON.stringify(original),
    'store must still be intact after the no-op second run');
});

test('with no v1 records present, no registry read occurs', () => {
  const credFile = uniqueCredFile();
  writeV2Store(credFile, { alreadyModern: 'value' });

  appCrypto._resetKeysForTest();
  appCrypto._setMachineGuidOverride('TEST-FAKE-MACHINE-GUID-0000');
  const before = appCrypto._getMachineGuidCallCountForTest();

  const result = migrateCredentialStore({ credFile });
  assertEqual(result.migrated, false);
  assertEqual(result.reason, 'already v2');
  assertEqual(appCrypto._getMachineGuidCallCountForTest(), before,
    'getMachineGuid must not be called when no v1 records exist');
});

test('migration leaves the original file untouched when the write step fails', () => {
  const credFile = uniqueCredFile();
  const original = { key: 'value-that-must-survive' };
  writeLegacyV1Store(credFile, original);
  const originalRaw = readStoreRaw(credFile);

  // Force the internal fs.writeFileSync(tmp, ...) to fail deterministically:
  // make the .tmp path a directory instead of a writable file location.
  fs.mkdirSync(credFile + '.tmp');

  const result = migrateCredentialStore({ credFile });
  assertEqual(result.migrated, false);
  assertEqual(readStoreRaw(credFile), originalRaw,
    'original file content must be byte-for-byte unchanged after a failed write');

  fs.rmSync(credFile + '.tmp', { recursive: true, force: true });
});

test('no credentials.enc present is a safe no-op', () => {
  const credFile = uniqueCredFile(); // never written
  const result = migrateCredentialStore({ credFile });
  assertEqual(result.migrated, false);
  assertEqual(result.reason, 'no credentials.enc present');
});

// ── Results ────────────────────────────────────────────────────────────────────

cleanup();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
