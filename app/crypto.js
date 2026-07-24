'use strict';

const crypto = require('crypto');
const { execSync } = require('child_process');

const APP_SALT = 'datamover-v1-ias-2024';
const KEY_LEN = 32; // 256-bit
const IV_LEN = 12;  // 96-bit — standard for GCM
const TAG_LEN = 16; // 128-bit auth tag

let _key = null;

function getMachineGuid() {
  try {
    const output = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }
    );
    const match = output.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
    if (!match) throw new Error('MachineGuid not found in registry output');
    return match[1].trim();
  } catch (err) {
    // Surface as a fatal startup error — we cannot safely derive a key without this
    throw new Error(`Failed to read MachineGuid from registry: ${err.message}`);
  }
}

function deriveKey() {
  if (_key) return _key;
  const guid = getMachineGuid();
  // PBKDF2 with the machine GUID as password and app salt — 100k iterations is
  // deliberately slow to resist brute-force if credentials.enc is extracted
  _key = crypto.pbkdf2Sync(guid, APP_SALT, 100_000, KEY_LEN, 'sha256');
  return _key;
}

/**
 * Encrypts a plaintext string.
 * Returns a base64 string in the format: iv:ciphertext:tag
 */
function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Encode each component separately so decryption can split on ':'
  return [
    iv.toString('base64'),
    encrypted.toString('base64'),
    tag.toString('base64'),
  ].join(':');
}

/**
 * Decrypts a value produced by encrypt().
 * Returns the original plaintext string.
 * Throws on any tampering or decryption failure.
 */
function decrypt(ciphertext) {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid ciphertext format');
  const [ivB64, dataB64, tagB64] = parts;
  const key = deriveKey();
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

// Derives a machine-specific 64-char hex secret for express-session signing.
// Uses a different salt than the encryption key so the two secrets are independent.
function deriveSessionSecret() {
  const guid = getMachineGuid();
  return crypto.createHmac('sha256', guid).update('datamover-session-v1-ias-2024').digest('hex');
}

module.exports = { encrypt, decrypt, deriveSessionSecret };
