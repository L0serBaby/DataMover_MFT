'use strict';

// Run with: node tests/crypto.test.js
// Requires registry access (Windows only) — must run as a user with HKLM read rights.

const assert = require('assert');
const { encrypt, decrypt } = require('../app/crypto');

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

test('encrypt returns a string', () => {
  const result = encrypt('hello');
  assert.strictEqual(typeof result, 'string');
});

test('encrypted value has iv:data:tag format', () => {
  const result = encrypt('hello');
  const parts = result.split(':');
  assert.strictEqual(parts.length, 3, `Expected 3 parts, got ${parts.length}`);
  parts.forEach((p, i) => {
    assert.ok(p.length > 0, `Part ${i} is empty`);
    assert.ok(Buffer.from(p, 'base64').length > 0, `Part ${i} is not valid base64`);
  });
});

test('decrypt recovers original plaintext', () => {
  const plaintext = 'super-secret-password-123!';
  const ciphertext = encrypt(plaintext);
  assert.strictEqual(decrypt(ciphertext), plaintext);
});

test('encrypt produces unique ciphertexts for same input (random IV)', () => {
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

test('decrypt throws on tampered ciphertext', () => {
  const ct = encrypt('tamper-test');
  const parts = ct.split(':');
  // Flip one byte in the ciphertext component
  const dataBuf = Buffer.from(parts[1], 'base64');
  dataBuf[0] ^= 0xff;
  parts[1] = dataBuf.toString('base64');
  const tampered = parts.join(':');
  assert.throws(() => decrypt(tampered), /Unsupported state|bad decrypt|auth/i);
});

test('decrypt throws on wrong number of segments', () => {
  assert.throws(() => decrypt('onlyone'), /Invalid ciphertext format/);
  assert.throws(() => decrypt('a:b'), /Invalid ciphertext format/);
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

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
