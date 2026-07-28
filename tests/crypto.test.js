'use strict';

// Run with: node tests/crypto.test.js
// Runs on any platform now — the legacy (v1) coverage below uses
// _setMachineGuidOverride() instead of a real Windows registry read.

const assert  = require('assert');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const nodeCrypto = require('crypto');

// ── Temp directory setup ─────────────────────────────────────────────────────

const TMP_DIR = path.join(os.tmpdir(), `dm_crypto_test_${nodeCrypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(TMP_DIR, { recursive: true });

const {
  encrypt, decrypt, deriveSessionSecret,
  _setMasterKeyPath, _setConfigFile, _setCredentialsFilePath, _setMachineGuidOverride,
  _resetKeysForTest, _getMachineGuidCallCountForTest, _getDerivedKeysForTest,
  _legacyEncryptV1ForTest,
} = require('../app/crypto');

const MASTER_KEY_PATH = path.join(TMP_DIR, 'master.key');
// Never-written-by-default path — without this override, the missing-key
// guard added below would fall back to resolving the REAL project's
// data/credentials.enc, which every test that generates a fresh master key
// would then read as a side effect.
const DEFAULT_CREDENTIALS_PATH = path.join(TMP_DIR, 'credentials.enc');
_setMasterKeyPath(MASTER_KEY_PATH);
_setCredentialsFilePath(DEFAULT_CREDENTIALS_PATH);
_setMachineGuidOverride('TEST-FAKE-MACHINE-GUID-0000'); // never touch the real registry

function cleanup() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

function restoreSharedState() {
  _setMasterKeyPath(MASTER_KEY_PATH);
  _setCredentialsFilePath(DEFAULT_CREDENTIALS_PATH);
  _setMachineGuidOverride('TEST-FAKE-MACHINE-GUID-0000');
}

let passed = 0;
let failed = 0;

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

console.log('\ncrypto.js tests\n');

// ── v2 (current) format ────────────────────────────────────────────────────────

test('encrypt returns a string', () => {
  const result = encrypt('hello');
  assert.strictEqual(typeof result, 'string');
});

test('encrypted value has v2:salt:iv:data:tag format', () => {
  const result = encrypt('hello');
  const parts = result.split(':');
  assert.strictEqual(parts.length, 5, `Expected 5 parts, got ${parts.length}`);
  assert.strictEqual(parts[0], 'v2');
  parts.slice(1).forEach((p, i) => {
    assert.ok(p.length > 0, `Part ${i + 1} is empty`);
    assert.ok(Buffer.from(p, 'base64').length > 0, `Part ${i + 1} is not valid base64`);
  });
});

test('decrypt recovers original plaintext (v2 round-trip)', () => {
  const plaintext = 'super-secret-password-123!';
  const ciphertext = encrypt(plaintext);
  assert.strictEqual(decrypt(ciphertext), plaintext);
});

test('encrypt produces unique ciphertexts for same input (random salt + IV)', () => {
  const a = encrypt('same');
  const b = encrypt('same');
  assert.notStrictEqual(a, b, 'Two encryptions of same value should differ');
});

test('both unique ciphertexts decrypt to same plaintext', () => {
  const a = encrypt('same');
  const b = encrypt('same');
  assert.strictEqual(decrypt(a), 'same');
  assert.strictEqual(decrypt(b), 'same');
});

test('decrypt throws on tampered v2 ciphertext (auth tag still enforced)', () => {
  const ct = encrypt('tamper-test');
  const parts = ct.split(':');
  const dataBuf = Buffer.from(parts[3], 'base64'); // data segment
  dataBuf[0] ^= 0xff;
  parts[3] = dataBuf.toString('base64');
  const tampered = parts.join(':');
  assert.throws(() => decrypt(tampered), /Unsupported state|bad decrypt|auth/i);
});

test('decrypt throws on wrong number of segments', () => {
  assert.throws(() => decrypt('onlyone'), /Invalid ciphertext format/);
  assert.throws(() => decrypt('a:b'), /Invalid ciphertext format/);
  assert.throws(() => decrypt('a:b:c:d'), /Invalid ciphertext format/);
});

test('roundtrip preserves unicode and special characters', () => {
  const payload = '¡Héllo Wörld! 🔑 \n\t<xml>&amp;</xml>';
  assert.strictEqual(decrypt(encrypt(payload)), payload);
});

test('roundtrip preserves empty string', () => {
  assert.strictEqual(decrypt(encrypt('')), '');
});

test('roundtrip preserves long credential blob (JSON)', () => {
  const cred = JSON.stringify({ username: 'svc_test', password: 'P@$$w0rd!x100', host: 'sftp.example.com', port: 22 });
  assert.strictEqual(decrypt(encrypt(cred)), cred);
});

// ── Legacy v1 format ────────────────────────────────────────────────────────────

test('v1 ciphertext still decrypts after the v2 change', () => {
  const plaintext = 'legacy-credential-value';
  const v1Ciphertext = _legacyEncryptV1ForTest(plaintext);
  assert.strictEqual(v1Ciphertext.split(':').length, 3);
  assert.strictEqual(decrypt(v1Ciphertext), plaintext);
});

test('a store containing both v1 and v2 records reads correctly', () => {
  const v1 = _legacyEncryptV1ForTest('old-value');
  const v2 = encrypt('new-value');
  const store = { legacyKey: v1, currentKey: v2 };
  assert.strictEqual(decrypt(store.legacyKey), 'old-value');
  assert.strictEqual(decrypt(store.currentKey), 'new-value');
});

test('decrypting a v2 record never touches the registry', () => {
  _resetKeysForTest();
  _setMachineGuidOverride('TEST-FAKE-MACHINE-GUID-0000');
  const ct = encrypt('no-registry-needed');
  decrypt(ct);
  assert.strictEqual(_getMachineGuidCallCountForTest(), 0, 'getMachineGuid should never be called for v2-only work');
});

// ── Master key ──────────────────────────────────────────────────────────────────

test('master.key is generated once and reused on subsequent boots', () => {
  const keyPath = path.join(TMP_DIR, `master_reuse_${nodeCrypto.randomBytes(4).toString('hex')}.key`);
  _setMasterKeyPath(keyPath);

  encrypt('trigger-generation'); // first "boot" — creates the key
  assert.ok(fs.existsSync(keyPath), 'master key file should now exist');
  const bytesAfterFirstBoot = fs.readFileSync(keyPath);
  assert.strictEqual(bytesAfterFirstBoot.length, 32);

  _resetKeysForTest();        // simulate a fresh process — clears the in-memory cache only
  _setMasterKeyPath(keyPath); // same path; file is still on disk

  encrypt('trigger-reuse'); // second "boot" — must reuse, not regenerate
  const bytesAfterSecondBoot = fs.readFileSync(keyPath);
  assert.ok(bytesAfterFirstBoot.equals(bytesAfterSecondBoot), 'master key bytes must not change across boots');

  restoreSharedState();
});

test('records encrypted before and after a simulated reboot both decrypt', () => {
  const keyPath = path.join(TMP_DIR, `master_reboot_${nodeCrypto.randomBytes(4).toString('hex')}.key`);
  _setMasterKeyPath(keyPath);

  const before = encrypt('before-reboot');
  _resetKeysForTest();
  _setMasterKeyPath(keyPath);
  const after = encrypt('after-reboot');

  assert.strictEqual(decrypt(before), 'before-reboot');
  assert.strictEqual(decrypt(after), 'after-reboot');

  restoreSharedState();
});

test('config.MASTER_KEY_PATH is honoured when no direct override is set', () => {
  const configPath = path.join(TMP_DIR, `config_${nodeCrypto.randomBytes(4).toString('hex')}.json`);
  const relocatedKeyPath = path.join(TMP_DIR, 'relocated', 'master.key');
  fs.writeFileSync(configPath, JSON.stringify({ MASTER_KEY_PATH: relocatedKeyPath }), 'utf8');

  _setConfigFile(configPath);
  _setMasterKeyPath(null); // clear the direct override so config resolution applies
  _resetKeysForTest();

  encrypt('via-config-path');
  assert.ok(fs.existsSync(relocatedKeyPath), 'master key should have been created at the config-specified path');

  restoreSharedState();
});

// ── Missing-key guard ────────────────────────────────────────────────────────────
// loadOrCreateMasterKey() must not silently regenerate a key when the store
// it would be protecting already has v2 records depending on the (now
// missing) original — that would strand every one of those values behind an
// opaque GCM auth-tag error instead of a clear, actionable message.

test('missing key with a v2 store throws and does not write a new key file', () => {
  const keyPath = path.join(TMP_DIR, `guard_v2_${nodeCrypto.randomBytes(4).toString('hex')}.key`);
  const credFile = path.join(TMP_DIR, `guard_v2_${nodeCrypto.randomBytes(4).toString('hex')}.enc`);

  // Produce a real v2 record using a DIFFERENT (throwaway) key, then point
  // the guard at credFile while keyPath itself has never existed — exactly
  // "key lost/replaced while v2 data remains" rather than "never had a key".
  _setMasterKeyPath(path.join(TMP_DIR, `throwaway_${nodeCrypto.randomBytes(4).toString('hex')}.key`));
  _resetKeysForTest();
  fs.writeFileSync(credFile, encrypt('some-v2-secret'), 'utf8');

  _setMasterKeyPath(keyPath);
  _setCredentialsFilePath(credFile);
  _resetKeysForTest();

  assert.throws(
    () => encrypt('anything'),
    /Master key missing.*v2-format records|refusing to generate/i
  );
  assert.ok(!fs.existsSync(keyPath), 'a new master key must not have been written');

  restoreSharedState();
});

test('missing key with no credential store generates normally', () => {
  const keyPath = path.join(TMP_DIR, `guard_none_${nodeCrypto.randomBytes(4).toString('hex')}.key`);
  const credFile = path.join(TMP_DIR, `guard_none_${nodeCrypto.randomBytes(4).toString('hex')}.enc`); // never written

  _setMasterKeyPath(keyPath);
  _setCredentialsFilePath(credFile);
  _resetKeysForTest();

  const ct = encrypt('first-run-value');
  assert.ok(fs.existsSync(keyPath), 'master key should have been generated');
  assert.strictEqual(decrypt(ct), 'first-run-value');

  restoreSharedState();
});

test('missing key with a v1-only store generates normally (v1 does not depend on master.key)', () => {
  const keyPath = path.join(TMP_DIR, `guard_v1_${nodeCrypto.randomBytes(4).toString('hex')}.key`);
  const credFile = path.join(TMP_DIR, `guard_v1_${nodeCrypto.randomBytes(4).toString('hex')}.enc`);

  fs.writeFileSync(credFile, _legacyEncryptV1ForTest('legacy-only-value'), 'utf8');

  _setMasterKeyPath(keyPath);
  _setCredentialsFilePath(credFile);
  _resetKeysForTest();

  const ct = encrypt('post-upgrade-value'); // exercises the same missing-key path as the guard
  assert.ok(fs.existsSync(keyPath), 'master key should have been generated despite the existing v1 store');
  assert.strictEqual(decrypt(ct), 'post-upgrade-value');

  restoreSharedState();
});

// ── Derived keys ─────────────────────────────────────────────────────────────────

test('the credential key and session key are different', () => {
  _resetKeysForTest();
  const { credentialKey, sessionKey } = _getDerivedKeysForTest();
  assert.strictEqual(credentialKey.length, 32);
  assert.strictEqual(sessionKey.length, 32);
  assert.ok(!credentialKey.equals(sessionKey), 'credential key and session key must not be the same bytes');
});

test('deriveSessionSecret returns a stable 64-char hex string derived from the master key', () => {
  const a = deriveSessionSecret();
  const b = deriveSessionSecret();
  assert.strictEqual(a, b, 'same master key should derive the same session secret');
  assert.match(a, /^[0-9a-f]{64}$/);
});

// ── Results ────────────────────────────────────────────────────────────────────

cleanup();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
