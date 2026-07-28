'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { execSync } = require('child_process');
const logger = require('./logger');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const KEY_LEN  = 32; // 256-bit
const IV_LEN   = 12; // 96-bit — standard for GCM
const SALT_LEN = 16; // per-record HKDF salt

// HKDF info labels — distinct per derivation context so a compromise of one
// (e.g. the session secret leaking via a logging bug) does not also hand
// over the credential-encryption key. Both derive from the same master.key.
const CREDENTIAL_KEY_INFO = 'datamover-credential-key-v2';
const SESSION_KEY_INFO    = 'datamover-session-key-v2';
const RECORD_KEY_INFO     = 'datamover-record-key-v2';

// ── Legacy (v1) constants — decrypt-only, see getLegacyKeyV1() ────────────────
// This is finding C2: MachineGuid is readable by any local account via one
// registry query, and this salt is a literal in a public repo, so anything
// encrypted this way is decryptable by anyone with the source and a registry
// read. Kept solely so pre-existing v1 records keep decrypting; nothing may
// ever encrypt NEW data this way again.
const LEGACY_V1_APP_SALT = 'datamover-v1-ias-2024';

// ── Config / path resolution ──────────────────────────────────────────────────

// Overridable via _setConfigFile() for testing
let _configFile = path.join(DATA_DIR, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(_configFile, 'utf8'));
  } catch {
    return {};
  }
}

// Overridable via _setMasterKeyPath() for testing — never call in production
let _masterKeyPathOverride = null;

/**
 * Single source of truth for where the master key lives, so relocating it
 * later (config.MASTER_KEY_PATH) is a config change, not a refactor.
 */
function resolveMasterKeyPath() {
  if (_masterKeyPathOverride) return _masterKeyPathOverride;
  const config = loadConfig();
  if (config.MASTER_KEY_PATH) return path.resolve(ROOT_DIR, config.MASTER_KEY_PATH);
  return path.join(DATA_DIR, 'master.key');
}

// Overridable via _setCredentialsFilePath() for testing — never call in production
let _credentialsFilePathOverride = null;

function resolveCredentialsFilePath() {
  if (_credentialsFilePathOverride) return _credentialsFilePathOverride;
  return path.join(DATA_DIR, 'credentials.enc');
}

// Format-sniff ONLY — never decrypt here. This runs on the "master key is
// missing" path, precisely when we can least afford to assume anything about
// what key would even be needed to decrypt safely.
function credentialStoreHasV2Records() {
  let raw;
  try {
    raw = fs.readFileSync(resolveCredentialsFilePath(), 'utf8').trim();
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  const parts = raw.split(':');
  return parts.length === 5 && parts[0] === 'v2';
}

// ── Master key ────────────────────────────────────────────────────────────────

function restrictMasterKeyAcl(keyPath) {
  const account = process.env.USERDOMAIN
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME;
  try {
    // *S-1-5-32-544 = well-known SID for BUILTIN\Administrators — locale-independent
    execSync(
      `icacls "${keyPath}" /inheritance:r /grant:r "${account}:F" /grant:r "*S-1-5-32-544:F"`,
      { stdio: 'ignore' }
    );
  } catch (err) {
    logger.warn(`[crypto] Could not restrict ACL on ${keyPath}: ${err.message} — file permissions were left at their default`);
  }
}

let _masterKey = null;

function loadOrCreateMasterKey() {
  const keyPath = resolveMasterKeyPath();

  try {
    const existing = fs.readFileSync(keyPath);
    if (existing.length !== KEY_LEN) {
      throw new Error(`Master key at ${keyPath} is ${existing.length} bytes, expected ${KEY_LEN} — refusing to use it`);
    }
    return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // Master key is missing. Before assuming this is a genuine first run,
  // check whether credentials.enc already holds v2 records — if it does, a
  // new key here would be silently useless (every v2 value would fail to
  // decrypt with an opaque GCM auth-tag error) and would mask what is
  // actually a lost or replaced key. A v1-only or absent store is the real
  // first-run case (v1 records don't depend on master.key at all) and must
  // keep generating silently.
  if (credentialStoreHasV2Records()) {
    throw new Error(
      `Master key missing at ${keyPath}, but ${resolveCredentialsFilePath()} already contains ` +
      'v2-format records. Refusing to generate a new key — that would make those records ' +
      'permanently undecryptable. Restore the original data/master.key from backup, or, if ' +
      'starting fresh is genuinely intended, restore a credentials.enc.bak-* backup (or remove ' +
      'credentials.enc) before restarting.'
    );
  }

  // Genuinely a first run (or v1-only legacy data). Generate, persist, lock down.
  const key = crypto.randomBytes(KEY_LEN);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const tmp = keyPath + '.tmp';
  fs.writeFileSync(tmp, key);
  fs.renameSync(tmp, keyPath);
  restrictMasterKeyAcl(keyPath);
  logger.info(`[crypto] Master key generated at ${keyPath}`);
  return key;
}

function getMasterKey() {
  if (!_masterKey) _masterKey = loadOrCreateMasterKey();
  return _masterKey;
}

// ── Derived keys (HKDF) ───────────────────────────────────────────────────────

function hkdf(ikm, salt, info, length = KEY_LEN) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

let _credentialKey = null;
let _sessionKey = null;

function getCredentialKey() {
  if (!_credentialKey) _credentialKey = hkdf(getMasterKey(), Buffer.alloc(0), CREDENTIAL_KEY_INFO);
  return _credentialKey;
}

function getSessionKey() {
  if (!_sessionKey) _sessionKey = hkdf(getMasterKey(), Buffer.alloc(0), SESSION_KEY_INFO);
  return _sessionKey;
}

// ── Legacy (v1) key — decrypt-only ────────────────────────────────────────────

let _machineGuidOverride = null; // test seam — never set in production
let _machineGuidCallCount = 0;   // test instrumentation — proves the registry was (not) touched

function getMachineGuid() {
  _machineGuidCallCount++;
  if (_machineGuidOverride) return _machineGuidOverride;
  try {
    const output = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }
    );
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    if (!match) throw new Error('MachineGuid not found in registry output');
    return match[1].trim();
  } catch (err) {
    // Surface as a fatal, clear error — a v1 record exists and needs this;
    // there is no safe way to guess at a substitute.
    throw new Error(`Failed to read MachineGuid from registry: ${err.message}`);
  }
}

let _legacyKey = null;

// PBKDF2(MachineGuid, literal salt) — the original C2 finding, preserved only
// to decrypt records already on disk in the v1 format. Nothing may ever
// encrypt new data with this. Lazily evaluated so the registry is touched
// ONLY when a genuine v1 record is actually being decrypted — a store with
// no v1 records left must never trigger a registry read.
function getLegacyKeyV1() {
  if (!_legacyKey) {
    const guid = getMachineGuid();
    _legacyKey = crypto.pbkdf2Sync(guid, LEGACY_V1_APP_SALT, 100_000, KEY_LEN, 'sha256');
  }
  return _legacyKey;
}

// ── Encrypt / decrypt ──────────────────────────────────────────────────────────

/**
 * Encrypts a plaintext string.
 * Returns a versioned string: v2:salt:iv:ciphertext:tag (all base64 except
 * the literal "v2"). The random per-record salt derives a one-off record key
 * via HKDF from the credential key, so no two records share key material
 * even though they share the same master/credential key.
 */
function encrypt(plaintext) {
  const credKey = getCredentialKey();
  const salt = crypto.randomBytes(SALT_LEN);
  const recordKey = hkdf(credKey, salt, RECORD_KEY_INFO);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', recordKey, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    'v2',
    salt.toString('base64'),
    iv.toString('base64'),
    encrypted.toString('base64'),
    tag.toString('base64'),
  ].join(':');
}

function decryptV2(parts) {
  const [, saltB64, ivB64, dataB64, tagB64] = parts;
  const credKey = getCredentialKey();
  const salt = Buffer.from(saltB64, 'base64');
  const recordKey = hkdf(credKey, salt, RECORD_KEY_INFO);
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', recordKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function decryptLegacyV1(parts) {
  const [ivB64, dataB64, tagB64] = parts;
  const key = getLegacyKeyV1();
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Decrypts a value produced by encrypt() — either format:
 *   3 parts (iv:ciphertext:tag)         -> legacy v1, PBKDF2(MachineGuid)
 *   5 parts (v2:salt:iv:ciphertext:tag) -> v2, HKDF from master.key
 * Old and new records coexist; nothing has to be rewritten in one pass.
 * Throws on any tampering, decryption failure, or unrecognized format.
 */
function decrypt(ciphertext) {
  const parts = ciphertext.split(':');
  if (parts.length === 5 && parts[0] === 'v2') return decryptV2(parts);
  if (parts.length === 3) return decryptLegacyV1(parts);
  throw new Error('Invalid ciphertext format');
}

// Derives the express-session signing secret from the master key instead of
// PBKDF2(MachineGuid) — the other half of C2 (forgeable session cookies).
// Changing this invalidates every existing session cookie: everyone re-logs
// in once after upgrade. Expected, not a bug.
function deriveSessionSecret() {
  return getSessionKey().toString('hex');
}

// ── Test helpers — never call in production code ──────────────────────────────

function _setMasterKeyPath(p) {
  _masterKeyPathOverride = p;
  _masterKey = _credentialKey = _sessionKey = null;
}

function _setConfigFile(p) {
  _configFile = p;
}

function _setCredentialsFilePath(p) {
  _credentialsFilePathOverride = p;
}

function _setMachineGuidOverride(guid) {
  _machineGuidOverride = guid;
  _legacyKey = null;
}

function _resetKeysForTest() {
  _masterKey = _credentialKey = _sessionKey = _legacyKey = null;
  _machineGuidCallCount = 0;
}

function _getMachineGuidCallCountForTest() {
  return _machineGuidCallCount;
}

function _getDerivedKeysForTest() {
  return { credentialKey: getCredentialKey(), sessionKey: getSessionKey() };
}

// Produces a genuine v1-format ciphertext via the real legacy KDF path (so it
// respects _setMachineGuidOverride), letting tests verify decrypt()'s legacy
// branch without a real registry read or reimplementing the old algorithm by
// hand. NEVER used by production code — encrypt() always produces v2.
function _legacyEncryptV1ForTest(plaintext) {
  const key = getLegacyKeyV1();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), encrypted.toString('base64'), tag.toString('base64')].join(':');
}

module.exports = {
  encrypt, decrypt, deriveSessionSecret,
  _setMasterKeyPath, _setConfigFile, _setCredentialsFilePath, _setMachineGuidOverride,
  _resetKeysForTest, _getMachineGuidCallCountForTest, _getDerivedKeysForTest,
  _legacyEncryptV1ForTest,
};
