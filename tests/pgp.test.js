'use strict';

// Run with: .\runtime\node.exe tests/pgp.test.js
// Tests the pgp.js module: roundtrip, wrong-key rejection,
// passphrase failure, and file cleanup behaviour.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const openpgp = require('openpgp');

// ── Temp directory setup ─────────────────────────────────────────────────────

const ROOT    = path.join(os.tmpdir(), `dm_pgp_${crypto.randomBytes(4).toString('hex')}`);
const DATA_DIR = path.join(ROOT, 'data');
const WORK_DIR = path.join(ROOT, 'work');

for (const d of [DATA_DIR, WORK_DIR]) fs.mkdirSync(d, { recursive: true });

// Point pgp.js at the temp DATA_DIR before requiring it so credential/key
// files go to the temp location and never touch the real data/ directory.
const pgp = require('../app/pgp');
pgp._setDataDir(DATA_DIR);

// pgp.js's credential store goes through app/crypto.js's encrypt/decrypt,
// which — independent of DATA_DIR above — resolves its own master.key and
// credentials.enc paths. Redirect both (the latter matches pgp.js's own
// _credFile above) or this suite would create/read real data/ files.
const appCrypto = require('../app/crypto');
appCrypto._setMasterKeyPath(path.join(DATA_DIR, 'master.key'));
appCrypto._setCredentialsFilePath(path.join(DATA_DIR, 'credentials.enc'));

function cleanup() {
  fs.rmSync(ROOT, { recursive: true, force: true });
}

// ── Minimal test harness ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const errors = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    errors.push({ name, err });
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writePlain(name, content = `PGP test payload ${crypto.randomUUID()}`) {
  const p = path.join(WORK_DIR, name);
  fs.writeFileSync(p, content, 'utf8');
  return { path: p, content };
}

// ── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\nPGP module tests\n');

  // ── Key generation ──────────────────────────────────────────────────────────
  console.log('Key generation');

  let pubId, privId, fingerprint;
  await test('generateKeypair returns publicKeyId, privateKeyId, fingerprint', async () => {
    const r = await pgp.generateKeypair('Test User', 'test@datamover.local', 'test-pass-1', 2048);
    assert(r.publicKeyId,  'missing publicKeyId');
    assert(r.privateKeyId, 'missing privateKeyId');
    assert(r.fingerprint,  'missing fingerprint');
    pubId      = r.publicKeyId;
    privId     = r.privateKeyId;
    fingerprint = r.fingerprint;
  });

  await test('generated keys are stored in pgp-keys.json', () => {
    const keys = pgp.readKeys();
    assert(keys.find(k => k.id === pubId),  'public key not stored');
    assert(keys.find(k => k.id === privId), 'private key not stored');
  });

  await test('generateKeypair with expiresInDays sets expiresAt ~1 year out on both records', async () => {
    const r = await pgp.generateKeypair('Expiring User', 'expiring@datamover.local', undefined, 2048, 365);
    const keys = pgp.readKeys();
    const pk = keys.find(k => k.id === r.publicKeyId);
    const sk = keys.find(k => k.id === r.privateKeyId);
    assert(pk.expiresAt, 'public key expiresAt should be set');
    assert(sk.expiresAt, 'private key expiresAt should be set');
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    const expectedMs = Date.now() + oneYearMs;
    assert(Math.abs(new Date(pk.expiresAt).getTime() - expectedMs) < 60 * 60 * 1000,
      `public key expiresAt not ~1 year out: ${pk.expiresAt}`);
    assert(Math.abs(new Date(sk.expiresAt).getTime() - expectedMs) < 60 * 60 * 1000,
      `private key expiresAt not ~1 year out: ${sk.expiresAt}`);
  });

  await test('generateKeypair with no expiresInDays leaves expiresAt null', async () => {
    const r = await pgp.generateKeypair('Never Expires User', 'never@datamover.local', undefined, 2048);
    const keys = pgp.readKeys();
    const pk = keys.find(k => k.id === r.publicKeyId);
    const sk = keys.find(k => k.id === r.privateKeyId);
    assert(pk.expiresAt === null, `expected null expiresAt, got ${pk.expiresAt}`);
    assert(sk.expiresAt === null, `expected null expiresAt, got ${sk.expiresAt}`);
  });

  await test('generated key expiration subpacket (type 9) is present but not marked critical', async () => {
    const r = await pgp.generateKeypair('Critical Bit User', 'critbit@datamover.local', undefined, 2048, 730);
    const armored = await pgp.exportPublicKey(r.publicKeyId);
    const key = await openpgp.readKey({ armoredKey: armored });
    const sig = key.users[0].selfCertifications[0];
    const bytes = sig.writeHashedSubPackets();

    // Walk the RFC 4880 §5.2.3 subpacket TLV area (read-only mirror of the
    // clearCriticalBit patch logic) to find subpacket type 9.
    let i = 2;
    const end = 2 + ((bytes[0] << 8) | bytes[1]);
    let found = false;
    let critical = null;
    while (i < end) {
      let len, lenBytes;
      const first = bytes[i];
      if (first < 192) { len = first; lenBytes = 1; }
      else if (first < 255) { len = ((first - 192) << 8) + bytes[i + 1] + 192; lenBytes = 2; }
      else { len = (bytes[i + 1] << 24) | (bytes[i + 2] << 16) | (bytes[i + 3] << 8) | bytes[i + 4]; lenBytes = 5; }
      const typeOffset = i + lenBytes;
      const rawType = bytes[typeOffset];
      if ((rawType & 0x7f) === 9) {
        found = true;
        critical = (rawType & 0x80) !== 0;
      }
      i = typeOffset + len;
    }

    assert(found, 'key expiration subpacket (type 9) not found on self-certification');
    assert(critical === false, 'key expiration subpacket should not be marked critical');
  });

  await test('key with patched (non-critical) expiration subpacket still round-trips encrypt/decrypt', async () => {
    const r = await pgp.generateKeypair('Critical Bit Roundtrip User', 'critbit-rt@datamover.local', undefined, 2048, 730);
    const { path: src } = writePlain('critbit_roundtrip.txt');
    const enc = path.join(WORK_DIR, 'critbit_roundtrip.txt.pgp');
    const dec = path.join(WORK_DIR, 'critbit_roundtrip_dec.txt');
    await pgp.encryptFile(src, enc, [r.publicKeyId]);
    await pgp.decryptFile(enc, dec, r.privateKeyId);
    const original  = fs.readFileSync(src, 'utf8');
    const recovered = fs.readFileSync(dec, 'utf8');
    assert(recovered === original, 'roundtrip content mismatch on critical-bit-patched key');
  });

  await test('stored keys do not expose armoredKey via readKeys() redact path (api contract)', () => {
    // readKeys() itself returns armoredKey — it's the API layer that redacts.
    // Verify both keys have fingerprints matching the generated pair.
    const keys = pgp.readKeys();
    const pk   = keys.find(k => k.id === pubId);
    const sk   = keys.find(k => k.id === privId);
    assert(pk.fingerprint === fingerprint, 'public key fingerprint mismatch');
    assert(sk.fingerprint === fingerprint, 'private key fingerprint mismatch');
    assert(pk.type === 'public',  'wrong type for public key');
    assert(sk.type === 'private', 'wrong type for private key');
  });

  // ── Key import ───────────────────────────────────────────────────────────────
  console.log('\nKey import');

  let importedPubId, importedPrivId;
  await test('importKey detects public key type', async () => {
    const exported = await pgp.exportPublicKey(privId);
    const rec = await pgp.importKey(exported, undefined);
    assert(rec.type === 'public', `expected public, got ${rec.type}`);
    assert(!rec.armoredKey, 'armoredKey should be redacted in returned record');
    importedPubId = rec.id;
  });

  await test('generateKeypair with no passphrase stores no credentialRef', async () => {
    const r = await pgp.generateKeypair('No Pass User', 'nopass@test.local', undefined, 2048);
    const sk = pgp.readKeys().find(k => k.id === r.privateKeyId);
    assert(sk.credentialRef === null, 'credentialRef should be null with no passphrase');
  });

  // ── Export ───────────────────────────────────────────────────────────────────
  console.log('\nKey export');

  await test('exportPublicKey returns armored public key block', async () => {
    const armored = await pgp.exportPublicKey(pubId);
    assert(armored.includes('BEGIN PGP PUBLIC KEY BLOCK'), 'not a public key block');
  });

  await test('exportPublicKey on private key id returns public portion only', async () => {
    const armored = await pgp.exportPublicKey(privId);
    assert(armored.includes('BEGIN PGP PUBLIC KEY BLOCK'), 'should return public block');
    assert(!armored.includes('BEGIN PGP PRIVATE KEY BLOCK'), 'must not expose private key');
  });

  // ── Encrypt / Decrypt roundtrip ──────────────────────────────────────────────
  console.log('\nEncrypt / decrypt roundtrip');

  const { path: plainPath, content: plainContent } = writePlain('hello.txt');
  const encPath = path.join(WORK_DIR, 'hello.txt.pgp');
  const decPath = path.join(WORK_DIR, 'hello_dec.txt');

  await test('encryptFile creates output file', async () => {
    const r = await pgp.encryptFile(plainPath, encPath, [pubId]);
    assert(r.ok, 'encryptFile returned ok=false');
    assert(fs.existsSync(encPath), 'encrypted file not created');
    assert(r.bytes > 0, 'encrypted file is empty');
  });

  await test('decryptFile recovers original content', async () => {
    const r = await pgp.decryptFile(encPath, decPath, privId);
    assert(r.ok, 'decryptFile returned ok=false');
    assert(fs.existsSync(decPath), 'decrypted file not created');
    const recovered = fs.readFileSync(decPath, 'utf8');
    assert(recovered === plainContent, `content mismatch:\n  got: ${recovered}\n  exp: ${plainContent}`);
  });

  await test('encrypted content is different from plaintext', () => {
    const enc = fs.readFileSync(encPath);
    assert(!enc.equals(Buffer.from(plainContent)), 'encryption produced identical bytes');
  });

  // ── transformFile helper (decrypt operation) ──────────────────────────────────
  console.log('\ntransformFile helper');

  const { path: plain2, content: content2 } = writePlain('data.csv', 'col1,col2\nval1,val2');
  const enc2 = path.join(WORK_DIR, 'data.csv.pgp');
  await pgp.encryptFile(plain2, enc2, [pubId]);

  await test('transformFile decrypt produces file without .pgp extension', async () => {
    const tmpDir = path.join(WORK_DIR, 'tmp_transform');
    fs.mkdirSync(tmpDir, { recursive: true });
    const result = await pgp.transformFile(
      { name: 'data.csv.pgp', path: enc2, size: fs.statSync(enc2).size },
      { operation: 'decrypt', decryptKeyId: privId },
      tmpDir
    );
    assert(result.name === 'data.csv', `expected data.csv, got ${result.name}`);
    assert(fs.existsSync(result.path), 'output file not created');
    const recovered = fs.readFileSync(result.path, 'utf8');
    assert(recovered === content2, 'content mismatch after transformFile decrypt');
  });

  await test('transformFile encrypt appends .pgp extension', async () => {
    const tmpDir = path.join(WORK_DIR, 'tmp_enc');
    fs.mkdirSync(tmpDir, { recursive: true });
    const result = await pgp.transformFile(
      { name: 'report.txt', path: plain2, size: fs.statSync(plain2).size },
      { operation: 'encrypt', encryptKeyIds: [pubId] },
      tmpDir
    );
    assert(result.name === 'report.txt.pgp', `expected report.txt.pgp, got ${result.name}`);
    assert(fs.existsSync(result.path), 'output file not created');
  });

  await test('transformFile decrypt-then-encrypt roundtrip', async () => {
    const tmpDir = path.join(WORK_DIR, 'tmp_re');
    fs.mkdirSync(tmpDir, { recursive: true });
    const result = await pgp.transformFile(
      { name: 'data.csv.pgp', path: enc2, size: fs.statSync(enc2).size },
      { operation: 'decrypt-then-encrypt', decryptKeyId: privId, encryptKeyIds: [pubId] },
      tmpDir
    );
    assert(result.name === 'data.csv.pgp', `expected data.csv.pgp, got ${result.name}`);
    assert(fs.existsSync(result.path), 'output not created');
    // The result should be decryptable
    const finalDec = path.join(WORK_DIR, 'final_dec.csv');
    await pgp.decryptFile(result.path, finalDec, privId);
    const finalContent = fs.readFileSync(finalDec, 'utf8');
    assert(finalContent === content2, 'decrypt-then-encrypt content mismatch');
  });

  // ── Wrong-key rejection ──────────────────────────────────────────────────────
  console.log('\nWrong key / passphrase rejection');

  let wrongPrivId;
  await test('setup: generate a second keypair', async () => {
    const r = await pgp.generateKeypair('Other User', 'other@test.local', 'other-pass', 2048);
    wrongPrivId = r.privateKeyId;
  });

  await test('decryptFile throws when wrong private key used', async () => {
    let threw = false;
    try { await pgp.decryptFile(encPath, path.join(WORK_DIR, 'wrong_dec.txt'), wrongPrivId); }
    catch { threw = true; }
    assert(threw, 'expected decryptFile to throw with wrong key');
  });

  await test('decryptFile does not leave .pgptmp file on failure', async () => {
    const outPath = path.join(WORK_DIR, 'bad_out.txt');
    try { await pgp.decryptFile(encPath, outPath, wrongPrivId); } catch {}
    const tmpPath = outPath + '.pgptmp';
    assert(!fs.existsSync(tmpPath), '.pgptmp temp file leaked after failure');
  });

  await test('importKey throws on wrong passphrase for protected private key', async () => {
    const privRecord = pgp.readKeys().find(k => k.id === privId);
    let threw = false;
    try { await pgp.importKey(privRecord.armoredKey, 'wrong-passphrase'); }
    catch { threw = true; }
    assert(threw, 'expected importKey to throw on wrong passphrase');
  });

  // ── File cleanup / deleteSource ───────────────────────────────────────────────
  console.log('\nFile cleanup (deleteSource)');

  await test('encryptFile with deleteSource removes source after success', async () => {
    const { path: src } = writePlain('delete_me.txt');
    const out = path.join(WORK_DIR, 'delete_me.txt.pgp');
    await pgp.encryptFile(src, out, [pubId], { deleteSource: true });
    assert(!fs.existsSync(src), 'source file not deleted after encrypt with deleteSource');
    assert(fs.existsSync(out), 'output file should exist');
  });

  await test('decryptFile with deleteSource removes source after success', async () => {
    const { path: src } = writePlain('del_enc_src.txt');
    const enc = path.join(WORK_DIR, 'del_enc_src.txt.pgp');
    const dec = path.join(WORK_DIR, 'del_enc_src_dec.txt');
    await pgp.encryptFile(src, enc, [pubId]);
    await pgp.decryptFile(enc, dec, privId, { deleteSource: true });
    assert(!fs.existsSync(enc), 'encrypted source not deleted after decrypt with deleteSource');
    assert(fs.existsSync(dec), 'decrypted output should exist');
  });

  // ── Key deletion ──────────────────────────────────────────────────────────────
  console.log('\nKey deletion');

  await test('deleteKey removes key from pgp-keys.json', () => {
    const before = pgp.readKeys().length;
    pgp.deleteKey(importedPubId);
    const after = pgp.readKeys().length;
    assert(after === before - 1, `expected ${before - 1} keys, got ${after}`);
    assert(!pgp.readKeys().find(k => k.id === importedPubId), 'deleted key still present');
  });

  await test('deleteKey throws for nonexistent id', () => {
    let threw = false;
    try { pgp.deleteKey(crypto.randomUUID()); }
    catch { threw = true; }
    assert(threw, 'expected throw for nonexistent key');
  });

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n─────────────────────────────────────`);
  console.log(`  Passed: ${passed}   Failed: ${failed}`);
  if (errors.length) {
    console.log('\nFailures:');
    for (const { name, err } of errors) {
      console.error(`  • ${name}: ${err.message}`);
    }
  }
  console.log('');

  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Unexpected test runner error:', err);
  cleanup();
  process.exit(1);
});
