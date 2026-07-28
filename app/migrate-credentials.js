'use strict';

const fs     = require('fs');
const logger = require('./logger');
const { encrypt, decrypt } = require('./crypto');

/**
 * Re-encrypts a credentials.enc store to the current (v2) format.
 *
 * credentials.enc is always ONE encrypt()ed blob wrapping a JSON object of
 * named credential values (SFTP passwords, SSH private keys, PGP private
 * keys/passphrases) — so "migrating" means: decrypt the whole blob once
 * (decrypt() transparently handles both the legacy v1 format and v2),
 * re-encrypt it once with the current encrypt() (always v2), and verify
 * every individual credential value survived before committing.
 *
 * Idempotent and safe to call on every boot:
 *   - the format is detected from the raw string WITHOUT decrypting first —
 *     if it's already v2, this returns immediately with no decrypt() call
 *     and no registry touch at all (only a v1 store ever needs the legacy
 *     PBKDF2(MachineGuid) key)
 *   - backs up to <credFile>.bak-<ISO timestamp> before anything else
 *   - re-encrypts, writes to <credFile>.tmp, and verifies every value
 *     round-trips from the .tmp file BEFORE renaming it into place — a
 *     failed verification therefore never touches the live file
 *   - on ANY failure the original file is left completely untouched and the
 *     failure is logged at error level; a run interrupted at any point
 *     (process killed mid-write, disk full, etc.) leaves either the
 *     untouched original or a stray .tmp file — both safe to retry from
 */
function migrateCredentialStore({ credFile }) {
  let raw;
  try {
    raw = fs.readFileSync(credFile, 'utf8').trim();
  } catch (err) {
    if (err.code === 'ENOENT') return { migrated: false, reason: 'no credentials.enc present' };
    logger.error(`[cred-migrate] Could not read credentials.enc: ${err.message}`);
    return { migrated: false, reason: err.message };
  }

  // Format check ONLY — do not decrypt yet. A store that's already v2 must
  // never trigger a registry read, so this has to happen before any
  // decrypt() call.
  if (raw.split(':').length !== 3) {
    return { migrated: false, reason: 'already v2' };
  }

  let store;
  try {
    store = JSON.parse(decrypt(raw));
  } catch (err) {
    logger.error(`[cred-migrate] Failed to decrypt credentials.enc — leaving original untouched: ${err.message}`);
    return { migrated: false, reason: err.message };
  }

  const backupPath = `${credFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try {
    fs.copyFileSync(credFile, backupPath);
  } catch (err) {
    logger.error(`[cred-migrate] Failed to create backup — aborting, original untouched: ${err.message}`);
    return { migrated: false, reason: err.message };
  }

  const tmp = credFile + '.tmp';
  try {
    const reEncrypted = encrypt(JSON.stringify(store));
    fs.writeFileSync(tmp, reEncrypted, 'utf8');

    // Verify every value round-trips from the .tmp file BEFORE renaming —
    // the live file must never be overwritten by a migration we haven't
    // independently confirmed is correct.
    const verifyStore = JSON.parse(decrypt(fs.readFileSync(tmp, 'utf8').trim()));
    const originalKeys = Object.keys(store);
    if (Object.keys(verifyStore).length !== originalKeys.length) {
      throw new Error('key count mismatch after re-encryption');
    }
    for (const key of originalKeys) {
      if (verifyStore[key] !== store[key]) {
        throw new Error(`value for "${key}" does not match source after re-encryption`);
      }
    }

    fs.renameSync(tmp, credFile);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* best-effort cleanup */ }
    logger.error(`[cred-migrate] Migration failed — leaving original untouched: ${err.message}`);
    return { migrated: false, reason: err.message };
  }

  logger.info(`[cred-migrate] credentials.enc re-encrypted to v2 format — backup at ${backupPath}`);
  return { migrated: true, backupPath };
}

module.exports = { migrateCredentialStore };
