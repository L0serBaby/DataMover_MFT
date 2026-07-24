'use strict';

const path   = require('path');
const fs     = require('fs');
const fse    = require('fs-extra');
const crypto = require('crypto');
const openpgp = require('openpgp');

// Allow legacy PGP keys encrypted with older S2K/MD5 format
openpgp.config.allowInsecureDecryptionWithSigningKeys = true;
openpgp.config.allowInsecureVerificationWithReformattedKeys = true;

// openpgp.js hardcodes the critical bit on several hashed signature
// subpackets, including Key Expiration Time (type 9) — unlike GnuPG,
// which leaves it non-critical. Some strict vendor PGP validators reject
// a critical flag on a subpacket they otherwise understand fine, causing
// spurious "invalid key" rejections on our generated keys. This patches
// the subpacket bytes *before* they're hashed/signed (writeHashedSubPackets
// runs pre-signing), so the resulting signature stays fully valid — we're
// only changing what gets signed, not tampering with an already-signed key.
(function patchCriticalBit() {
  const proto = openpgp.SignaturePacket.prototype;
  const origWrite = proto.writeHashedSubPackets;
  proto.writeHashedSubPackets = function () {
    return clearCriticalBit(origWrite.call(this), 9); // 9 = keyExpirationTime
  };
})();

function clearCriticalBit(bytes, subpacketType) {
  const out = Uint8Array.from(bytes);
  // First 2 octets = big-endian total length of the subpacket area (RFC 4880 §5.2.3)
  let i = 2;
  const end = 2 + ((out[0] << 8) | out[1]);
  while (i < end) {
    let len, lenBytes;
    const first = out[i];
    if (first < 192) { len = first; lenBytes = 1; }
    else if (first < 255) { len = ((first - 192) << 8) + out[i + 1] + 192; lenBytes = 2; }
    else { len = (out[i + 1] << 24) | (out[i + 2] << 16) | (out[i + 3] << 8) | out[i + 4]; lenBytes = 5; }
    const typeOffset = i + lenBytes;
    const rawType = out[typeOffset];
    if ((rawType & 0x7f) === subpacketType) {
      out[typeOffset] = rawType & 0x7f; // clear the 0x80 critical bit
    }
    i = typeOffset + len; // len includes the type byte
  }
  return out;
}

const { encrypt: encryptCred, decrypt: decryptCred } = require('./crypto');
const logger = require('./logger');

// ── Data-dir overrides (test helper) ─────────────────────────────────────────

let _credFile = path.join(__dirname, '../data/credentials.enc');
let _keysFile = path.join(__dirname, '../data/pgp-keys.json');

function _setDataDir(dir) {
  _credFile = path.join(dir, 'credentials.enc');
  _keysFile = path.join(dir, 'pgp-keys.json');
}

// ── Key store ─────────────────────────────────────────────────────────────────

function readKeys() {
  try { return JSON.parse(fs.readFileSync(_keysFile, 'utf8')); }
  catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeKeys(keys) {
  // Safety guard: never persist private key armored material in the JSON store
  const safe = keys.map(k => {
    if (k.type !== 'private') return k;
    const { armoredKey: _stripped, ...rest } = k;
    return rest;
  });
  const tmp = _keysFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(safe, null, 2), 'utf8');
  fs.renameSync(tmp, _keysFile);
}

// ── Credential store ──────────────────────────────────────────────────────────

function readCredStore() {
  try {
    const raw = fs.readFileSync(_credFile, 'utf8').trim();
    return JSON.parse(decryptCred(raw));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeCredStore(store) {
  const tmp = _credFile + '.tmp';
  fs.writeFileSync(tmp, encryptCred(JSON.stringify(store)), 'utf8');
  fs.renameSync(tmp, _credFile);
}

function storePassphrase(ref, passphrase) {
  const store = readCredStore();
  store[ref] = passphrase;
  writeCredStore(store);
}

function resolvePassphrase(ref) {
  if (!ref) return undefined;
  try {
    const store = readCredStore();
    return store[ref] ?? undefined;
  } catch { return undefined; }
}

function deletePassphrase(ref) {
  try {
    const store = readCredStore();
    delete store[ref];
    writeCredStore(store);
  } catch { /* cred file may not exist */ }
}

function storePrivateArmored(id, armoredKey) {
  const store = readCredStore();
  store[`pgp_armored_${id}`] = armoredKey;
  writeCredStore(store);
}

function resolvePrivateArmored(id) {
  const store = readCredStore();
  const val   = store[`pgp_armored_${id}`];
  if (!val) throw new Error(`Private key armored material not found in credential store for id=${id}`);
  return val;
}

function deletePrivateArmored(id) {
  try {
    const store = readCredStore();
    delete store[`pgp_armored_${id}`];
    writeCredStore(store);
  } catch { /* cred file may not exist */ }
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function getKey(id) {
  const keys = readKeys();
  const key  = keys.find(k => k.id === id);
  if (!key) throw new Error(`PGP key not found: ${id}`);
  return key;
}

async function _loadPrivateKey(record) {
  const armoredKey = resolvePrivateArmored(record.id);
  const passphrase = resolvePassphrase(record.credentialRef);
  const rawKey = await openpgp.readKey({ armoredKey });
  if (passphrase) {
    return openpgp.decryptKey({ privateKey: rawKey, passphrase });
  }
  return rawKey;
}

// ── File operations ───────────────────────────────────────────────────────────

/**
 * Decrypts a PGP-encrypted file using the identified private key.
 * options.deleteSource — remove inputPath after successful decrypt
 */
async function decryptFile(inputPath, outputPath, privateKeyId, options = {}) {
  logger.info(`[pgp] Decrypt start — keyId=${privateKeyId} file="${path.basename(inputPath)}"`);

  const record = getKey(privateKeyId);
  if (record.type !== 'private') {
    throw new Error(`Key "${record.name}" is not a private key`);
  }

  const privateKey = await _loadPrivateKey(record);
  const encryptedBuf = fs.readFileSync(inputPath);

  let message;
  // Accept both binary and armored messages
  try {
    message = await openpgp.readMessage({ binaryMessage: encryptedBuf });
  } catch {
    message = await openpgp.readMessage({ armoredMessage: encryptedBuf.toString('utf8') });
  }

  const { data: decrypted } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    format: 'binary',
  });

  await fse.ensureDir(path.dirname(outputPath));
  const tmp = outputPath + '.pgptmp';
  fs.writeFileSync(tmp, Buffer.from(decrypted));
  fs.renameSync(tmp, outputPath);

  const bytes = fs.statSync(outputPath).size;
  if (bytes === 0) throw new Error(`Decrypted output is empty: "${path.basename(outputPath)}"`);

  if (options.deleteSource) {
    try { fs.unlinkSync(inputPath); } catch {}
  }

  logger.info(`[pgp] Decrypt OK — fingerprint=${record.fingerprint} output="${path.basename(outputPath)}" bytes=${bytes}`);
  return { ok: true, inputPath, outputPath, bytes };
}

/**
 * Encrypts a file for one or more recipient public keys.
 * options.sign       — also sign with options.signKeyId
 * options.signKeyId  — private key id used for signing
 * options.deleteSource — remove inputPath after successful encrypt
 */
async function encryptFile(inputPath, outputPath, publicKeyIds, options = {}) {
  if (!publicKeyIds || publicKeyIds.length === 0) {
    throw new Error('At least one recipient public key is required for encryption');
  }
  logger.info(`[pgp] Encrypt start — recipients=[${publicKeyIds.join(',')}] file="${path.basename(inputPath)}"`);

  const encryptionKeys = await Promise.all(
    publicKeyIds.map(async id => {
      const rec = getKey(id);
      return openpgp.readKey({ armoredKey: rec.armoredKey });
    })
  );

  let signingKeys;
  if (options.sign && options.signKeyId) {
    const signRec = getKey(options.signKeyId);
    if (signRec.type !== 'private') {
      throw new Error(`Sign key "${signRec.name}" is not a private key`);
    }
    signingKeys = await _loadPrivateKey(signRec);
  }

  const plaintext = fs.readFileSync(inputPath);
  const message = await openpgp.createMessage({ binary: plaintext });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys,
    signingKeys,
    format: 'binary',
  });

  await fse.ensureDir(path.dirname(outputPath));
  const tmp = outputPath + '.pgptmp';
  fs.writeFileSync(tmp, Buffer.from(encrypted));
  fs.renameSync(tmp, outputPath);

  const bytes = fs.statSync(outputPath).size;

  if (options.deleteSource) {
    try { fs.unlinkSync(inputPath); } catch {}
  }

  logger.info(`[pgp] Encrypt OK — output="${path.basename(outputPath)}" bytes=${bytes}`);
  return { ok: true, inputPath, outputPath, bytes };
}

// ── Filename helpers ──────────────────────────────────────────────────────────

function outputFilename(inputName, operation) {
  if (operation === 'encrypt') {
    return inputName.endsWith('.pgp') ? inputName : `${inputName}.pgp`;
  }
  // decrypt: strip .pgp extension if present
  return inputName.endsWith('.pgp') ? inputName.slice(0, -4) : inputName;
}

// ── In-rule transform ─────────────────────────────────────────────────────────

/**
 * Apply the rule's PGP transform to a single source file, writing to tmpDir.
 * Returns a file descriptor { name, path, size, relPath } for the transformed file.
 * Throws on failure — caller decides stop vs continue based on rule.pgp.onFailure.
 */
async function transformFile(file, pgpConfig, tmpDir) {
  const { operation, decryptKeyId, encryptKeyIds, sign, signKeyId } = pgpConfig;

  let currentPath = file.path;
  let currentName = file.name;

  if (operation === 'decrypt' || operation === 'decrypt-then-encrypt') {
    const outName = outputFilename(currentName, 'decrypt');
    const outPath = path.join(tmpDir, outName);
    await decryptFile(currentPath, outPath, decryptKeyId);
    currentPath = outPath;
    currentName = outName;
  }

  if (operation === 'encrypt' || operation === 'decrypt-then-encrypt') {
    const outName = outputFilename(currentName, 'encrypt');
    const outPath = path.join(tmpDir, outName);
    await encryptFile(currentPath, outPath, encryptKeyIds || [], { sign, signKeyId });
    // Clean up the intermediate plaintext from the decrypt step
    if (operation === 'decrypt-then-encrypt' && currentPath !== file.path) {
      try { fs.unlinkSync(currentPath); } catch {}
    }
    currentPath = outPath;
    currentName = outName;
  }

  const size = fs.statSync(currentPath).size;
  return { name: currentName, path: currentPath, size, relPath: currentName };
}

// ── Key management ────────────────────────────────────────────────────────────

/**
 * Generates a new RSA keypair.
 * Stores both public and private key records in pgp-keys.json.
 * Passphrase (if provided) is encrypted into credentials.enc.
 * Returns { publicKeyId, privateKeyId, fingerprint }.
 */
async function generateKeypair(name, email, passphrase, bits = 4096, expiresInDays) {
  logger.info(`[pgp] Generating ${bits}-bit keypair for "${name}" <${email}>`);

  const { privateKey: armoredPriv, publicKey: armoredPub } = await openpgp.generateKey({
    type:       'rsa',
    rsaBits:    bits,
    userIDs:    [{ name, email }],
    passphrase: passphrase || undefined,
    keyExpirationTime: expiresInDays ? expiresInDays * 86400 : 0,
  });

  const privObj = await openpgp.readPrivateKey({ armoredKey: armoredPriv });
  const pubObj  = await openpgp.readKey({ armoredKey: armoredPub });

  const fingerprint = privObj.getFingerprint().toUpperCase();
  const keyId       = privObj.getKeyID().toHex().toUpperCase();
  const expiresRaw  = await pubObj.getExpirationTime();
  const expiresAt   = (expiresRaw && expiresRaw !== Infinity)
    ? expiresRaw.toISOString() : null;

  const privId  = crypto.randomUUID();
  const pubId   = crypto.randomUUID();
  const credRef = passphrase ? `pgp_pass_${privId}` : null;
  const now     = new Date().toISOString();

  const privRecord = {
    id: privId, name: `${name} (private)`, type: 'private',
    fingerprint, keyId, owner: email,
    credentialRef: credRef,
    createdAt: now, expiresAt,
  };
  const pubRecord = {
    id: pubId, name: `${name} (public)`, type: 'public',
    fingerprint, keyId, owner: email,
    credentialRef: null, armoredKey: armoredPub,
    createdAt: now, expiresAt,
  };

  const keys = readKeys();
  keys.push(privRecord, pubRecord);
  writeKeys(keys);

  storePrivateArmored(privId, armoredPriv);
  if (credRef) storePassphrase(credRef, passphrase);

  logger.info(`[pgp] Keypair generated — fingerprint=${fingerprint} privId=${privId} pubId=${pubId}`);
  return { publicKeyId: pubId, privateKeyId: privId, fingerprint };
}

/**
 * Imports an armored public or private key.
 * Automatically detects key type. Validates passphrase for protected private keys.
 * Handles legacy two-byte-checksum S2K keys (s2k_usage === 255) via reformatKey conversion.
 * Returns the stored key record with armoredKey redacted, or { requiresPassphrase: true }
 * when a legacy key is detected but no passphrase was supplied to perform conversion.
 */
async function importKey(armoredKey, passphrase) {
  // Try as private first, then fall back to public
  let keyObj;
  let type;
  try {
    keyObj = await openpgp.readPrivateKey({ armoredKey });
    type   = 'private';
  } catch {
    keyObj = await openpgp.readKey({ armoredKey });
    type   = 'public';
  }

  let finalArmoredKey = armoredKey;
  let legacyConverted  = false;

  if (type === 'private') {
    // Detect legacy two-byte-checksum S2K (s2k_usage === 255) from the packet structure,
    // before any decryption is attempted.
    const isLegacyChecksum = !keyObj.isDecrypted() && keyObj.keyPacket?.s2k_usage === 255;

    if (isLegacyChecksum && !passphrase) {
      // Conversion requires decrypting the key first — signal the caller to prompt for one.
      return { requiresPassphrase: true };
    }

    if (passphrase) {
      try {
        await openpgp.decryptKey({ privateKey: keyObj, passphrase });
      } catch (err) {
        if (!err.message.includes('insecure two-byte hash')) throw err;

        // Legacy S2K two-byte hash confirmed — attempt in-memory conversion via reformatKey.
        // decryptKey (openpgp v5) works on an internal clone so keyObj is still in its original
        // parsed-but-encrypted state and safe to retry.
        logger.info(`[pgp] Legacy two-byte hash S2K detected — attempting reformatKey conversion`);
        try {
          // With the module-level insecure flags set, a second decrypt attempt may succeed on
          // some openpgp builds. If it still throws, decryptedKey stays as the locked keyObj and
          // reformatKey will throw "Key is not decrypted", which we surface as the GPG re-export
          // instruction below.
          let decryptedKey;
          try {
            decryptedKey = await openpgp.decryptKey({ privateKey: keyObj, passphrase });
          } catch (decryptErr) {
            // Key cannot be decrypted even with insecure flags — wrong passphrase or
            // format too old for openpgp v5 to handle at all
            if (decryptErr.message.toLowerCase().includes('passphrase')) {
              throw new Error('Incorrect passphrase for this key');
            }
            throw new Error('Key format is too old to convert automatically — please re-export using GPG');
          }

          const userIDs = keyObj.getUserIDs().map(uid => {
            const m = uid.match(/^(.*?)\s*<([^>]+)>$/);
            return m ? { name: m[1].trim(), email: m[2] } : { name: uid };
          });

          const { privateKey: reformattedArmored } = await openpgp.reformatKey({
            privateKey: decryptedKey,
            userIDs,
            passphrase,
            format: 'armored',
          });

          finalArmoredKey = reformattedArmored;
          legacyConverted  = true;
          logger.info(`[pgp] Legacy key conversion succeeded`);
        } catch (reformatErr) {
          logger.info(`[pgp] Legacy key conversion failed: ${reformatErr.message}`);
          throw new Error('Key format is too old to convert automatically — please re-export using GPG');
        }
      }
    }
  }

  // Fingerprint and key metadata are stable across reformatKey (key material is unchanged).
  const fingerprint = keyObj.getFingerprint().toUpperCase();
  const keyId       = keyObj.getKeyID().toHex().toUpperCase();
  const uids        = keyObj.getUserIDs();
  const uid         = uids[0] || keyId;
  const expiresRaw  = await keyObj.getExpirationTime();
  const expiresAt   = (expiresRaw && expiresRaw !== Infinity)
    ? expiresRaw.toISOString() : null;

  const id      = crypto.randomUUID();
  const credRef = (type === 'private' && passphrase) ? `pgp_pass_${id}` : null;

  const record = {
    id, name: uid, type, fingerprint, keyId,
    owner: uid, credentialRef: credRef,
    // armoredKey omitted for private keys — stored in credentials.enc below
    ...(type === 'public' ? { armoredKey: finalArmoredKey } : {}),
    createdAt: new Date().toISOString(),
    expiresAt,
    ...(legacyConverted ? { legacyConverted: true } : {}),
  };

  const keys = readKeys();
  keys.push(record);
  writeKeys(keys);

  if (type === 'private') storePrivateArmored(id, finalArmoredKey);
  if (credRef) storePassphrase(credRef, passphrase);

  logger.info(`[pgp] Key imported — type=${type} fingerprint=${fingerprint} id=${id}${legacyConverted ? ' (legacy converted)' : ''}`);
  return record;
}

/**
 * Deletes a key record and its stored passphrase.
 * Throws if the key is referenced by any rule.
 */
function deleteKey(id) {
  // Check rule references
  let rules = [];
  try {
    const dataModule = require('./data');
    rules = dataModule.read('rules.json');
  } catch { /* ignore if data unavailable */ }

  for (const rule of rules) {
    const pgp = rule.pgp || {};
    if (pgp.decryptKeyId === id ||
        (pgp.encryptKeyIds || []).includes(id) ||
        pgp.signKeyId === id) {
      throw new Error(`Key is referenced by rule "${rule.name}" — remove the PGP config from that rule first`);
    }
    // Check chain nodes
    for (const node of [...(rule.chainOnSuccess || []), ...(rule.chainOnFailure || [])]) {
      if (typeof node === 'object' && node !== null) {
        if (node.privateKeyId === id ||
            (node.publicKeyIds || []).includes(id) ||
            node.signKeyId === id) {
          throw new Error(`Key is referenced by a chain node in rule "${rule.name}"`);
        }
      }
    }
  }

  const keys   = readKeys();
  const record = keys.find(k => k.id === id);
  if (!record) throw new Error(`PGP key not found: ${id}`);

  writeKeys(keys.filter(k => k.id !== id));
  if (record.credentialRef) deletePassphrase(record.credentialRef);
  if (record.type === 'private') deletePrivateArmored(id);

  logger.info(`[pgp] Key deleted — type=${record.type} fingerprint=${record.fingerprint} id=${id}`);
}

/**
 * Returns the armored public key text for a given key id.
 * For private key records, extracts and returns only the public portion.
 * Never returns a private key via this function.
 */
async function exportPublicKey(id) {
  const record = getKey(id);
  if (record.type === 'public') return record.armoredKey;

  // Extract public portion from the private key stored in credentials.enc
  const armoredKey = resolvePrivateArmored(record.id);
  const privObj    = await openpgp.readPrivateKey({ armoredKey });
  return privObj.toPublic().armor();
}

module.exports = {
  decryptFile,
  encryptFile,
  transformFile,
  generateKeypair,
  importKey,
  deleteKey,
  exportPublicKey,
  outputFilename,
  readKeys,
  getKey,
  _setDataDir,
};
