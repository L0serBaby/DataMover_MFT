'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const forge  = require('node-forge');

const { encrypt, decrypt } = require('./crypto');
const data                 = require('./data');

const CRED_FILE = path.join(__dirname, '../data/credentials.enc');

// ── Credential store helpers ──────────────────────────────────────────────────

function readCredStore() {
  try {
    return JSON.parse(decrypt(fs.readFileSync(CRED_FILE, 'utf8').trim()));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeCredStore(store) {
  const tmp = CRED_FILE + '.tmp';
  fs.writeFileSync(tmp, encrypt(JSON.stringify(store)), 'utf8');
  fs.renameSync(tmp, CRED_FILE);
}

// ── Fingerprint calculation ───────────────────────────────────────────────────

function fingerprintFromPublicKeyPem(publicKeyPem) {
  // Parse and re-serialize as SSH public key bytes to compute the standard fingerprint
  const pubKey  = forge.pki.publicKeyFromPem(publicKeyPem);
  const sshPub  = forge.ssh.publicKeyToOpenSSH(pubKey);
  // sshPub is "ssh-rsa <base64> " or "ssh-ed25519 <base64> "
  const b64Part = sshPub.trim().split(/\s+/)[1];
  const keyBytes = Buffer.from(b64Part, 'base64');
  const hash     = crypto.createHash('sha256').update(keyBytes).digest('base64');
  return `SHA256:${hash.replace(/=+$/, '')}`;
}

// ── Key generation ────────────────────────────────────────────────────────────

async function generateKeypair(name, algorithm) {
  if (!name || typeof name !== 'string') throw new Error('name is required');
  if (algorithm !== 'ed25519' && algorithm !== 'rsa') {
    throw new Error('algorithm must be "ed25519" or "rsa"');
  }

  let privateKeyPem, publicKeyOpenSsh, fingerprint;

  if (algorithm === 'rsa') {
    const keypair = await new Promise((resolve, reject) => {
      forge.pki.rsa.generateKeyPair({ bits: 4096, workers: -1 }, (err, kp) => {
        if (err) reject(err); else resolve(kp);
      });
    });
    privateKeyPem   = forge.pki.privateKeyToPem(keypair.privateKey);
    publicKeyOpenSsh = forge.ssh.publicKeyToOpenSSH(keypair.publicKey, name);
    const pubPem    = forge.pki.publicKeyToPem(keypair.publicKey);
    fingerprint     = fingerprintFromPublicKeyPem(pubPem);
  } else {
    // ed25519 via Node crypto (node-forge ed25519 support is limited)
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

    // Build OpenSSH public key manually
    const rawPub  = publicKey.export({ type: 'spki', format: 'der' });
    // Last 32 bytes of the SPKI DER are the raw ed25519 public key
    const keyBytes = rawPub.slice(rawPub.length - 32);
    const type     = 'ssh-ed25519';
    const typeBuf  = Buffer.from(type, 'utf8');
    const lenType  = Buffer.alloc(4); lenType.writeUInt32BE(typeBuf.length);
    const lenKey   = Buffer.alloc(4); lenKey.writeUInt32BE(keyBytes.length);
    const wireBytes = Buffer.concat([lenType, typeBuf, lenKey, keyBytes]);
    const b64       = wireBytes.toString('base64');
    publicKeyOpenSsh = `${type} ${b64} ${name}`;
    fingerprint = `SHA256:${crypto.createHash('sha256').update(wireBytes).digest('base64').replace(/=+$/, '')}`;
  }

  const id        = crypto.randomUUID();
  const record    = {
    id,
    name,
    algorithm,
    bits:        algorithm === 'rsa' ? 4096 : null,
    fingerprint,
    publicKey:   publicKeyOpenSsh,
    createdAt:   new Date().toISOString(),
  };

  const store = readCredStore();
  store[`sshkey_priv_${id}`] = privateKeyPem;
  writeCredStore(store);

  const keys = data.read('ssh-keys.json');
  keys.push(record);
  await data.write('ssh-keys.json', keys);

  return record;
}

// ── Key import ────────────────────────────────────────────────────────────────

async function importKey(name, privateKeyPem, passphrase) {
  if (!name || typeof name !== 'string') throw new Error('name is required');
  if (!privateKeyPem || typeof privateKeyPem !== 'string') throw new Error('privateKeyPem is required');

  let decryptedPem = privateKeyPem.trim();

  if (passphrase) {
    // Try Node crypto first — handles both RSA and Ed25519 encrypted PEM natively
    try {
      const nodeKey = crypto.createPrivateKey({ key: decryptedPem, passphrase });
      decryptedPem = nodeKey.export({ type: 'pkcs8', format: 'pem' });
    } catch {
      // Fall back to forge for legacy RSA keys Node crypto cannot handle
      const privKey = forge.pki.decryptRsaPrivateKey(decryptedPem, passphrase);
      if (!privKey) throw new Error('Failed to decrypt private key — wrong passphrase or unsupported format');
      decryptedPem = forge.pki.privateKeyToPem(privKey);
    }
  }

  // Derive public key and fingerprint
  let publicKeyOpenSsh, fingerprint, algorithm, bits;
  try {
    const privKey = forge.pki.privateKeyFromPem(decryptedPem);
    const pubKey  = forge.pki.setRsaPublicKey(privKey.n, privKey.e);
    algorithm = 'rsa';
    bits      = privKey.n.bitLength();
    publicKeyOpenSsh = forge.ssh.publicKeyToOpenSSH(pubKey, name);
    const pubPem = forge.pki.publicKeyToPem(pubKey);
    fingerprint  = fingerprintFromPublicKeyPem(pubPem);
  } catch {
    // Try ed25519 via Node crypto
    try {
      const nodeKey = crypto.createPrivateKey(decryptedPem);
      if (nodeKey.asymmetricKeyType !== 'ed25519') throw new Error('Unsupported key type');
      const pubDer  = crypto.createPublicKey(nodeKey).export({ type: 'spki', format: 'der' });
      const keyBytes = pubDer.slice(pubDer.length - 32);
      const type     = 'ssh-ed25519';
      const typeBuf  = Buffer.from(type, 'utf8');
      const lenType  = Buffer.alloc(4); lenType.writeUInt32BE(typeBuf.length);
      const lenKey   = Buffer.alloc(4); lenKey.writeUInt32BE(keyBytes.length);
      const wire     = Buffer.concat([lenType, typeBuf, lenKey, keyBytes]);
      publicKeyOpenSsh = `${type} ${wire.toString('base64')} ${name}`;
      fingerprint  = `SHA256:${crypto.createHash('sha256').update(wire).digest('base64').replace(/=+$/, '')}`;
      algorithm = 'ed25519';
      bits = null;
    } catch {
      throw new Error('Could not parse private key — only RSA and Ed25519 PEM keys are supported');
    }
  }

  const id     = crypto.randomUUID();
  const record = {
    id,
    name,
    algorithm,
    bits:      bits || null,
    fingerprint,
    publicKey: publicKeyOpenSsh,
    createdAt: new Date().toISOString(),
  };

  const store = readCredStore();
  store[`sshkey_priv_${id}`] = decryptedPem;
  writeCredStore(store);

  const keys = data.read('ssh-keys.json');
  keys.push(record);
  await data.write('ssh-keys.json', keys);

  return record;
}

// ── Key deletion ──────────────────────────────────────────────────────────────

async function deleteKey(id) {
  const profiles = data.read('profiles.json');
  const refs = profiles.filter(p => p.sshKeyId === id);
  if (refs.length > 0) {
    const names = refs.map(p => p.name).join(', ');
    const err = new Error(`SSH key is referenced by profile(s): ${names}`);
    err.referenced = refs.map(p => ({ id: p.id, name: p.name }));
    throw err;
  }

  const keys = data.read('ssh-keys.json');
  const idx  = keys.findIndex(k => k.id === id);
  if (idx === -1) throw new Error('SSH key not found');

  const store = readCredStore();
  delete store[`sshkey_priv_${id}`];
  writeCredStore(store);

  await data.write('ssh-keys.json', keys.filter(k => k.id !== id));
}

// ── Public key export ─────────────────────────────────────────────────────────

function exportPublicKey(id) {
  const keys = data.read('ssh-keys.json');
  const key  = keys.find(k => k.id === id);
  if (!key) throw new Error('SSH key not found');
  return key.publicKey;
}

// ── OpenSSH private key format (Ed25519 only) ─────────────────────────────────
// Node crypto has no built-in OpenSSH private key serialiser. We build the
// binary format manually per the openssh-key-v1 spec.

function convertToOpenSshPrivateKey(pkcs8Pem, comment = '') {
  const privKey = crypto.createPrivateKey(pkcs8Pem);
  const pubKey  = crypto.createPublicKey(privKey);

  // Raw key bytes from DER exports
  const privDer  = privKey.export({ type: 'pkcs8', format: 'der' });
  const pubDer   = pubKey.export({ type: 'spki',   format: 'der' });
  const privBytes = privDer.slice(privDer.length - 32); // ed25519 scalar
  const pubBytes  = pubDer.slice(pubDer.length  - 32);  // ed25519 public point

  // Helper: 4-byte big-endian length prefix followed by data
  function lpBytes(buf) {
    const len = Buffer.alloc(4); len.writeUInt32BE(buf.length); return Buffer.concat([len, buf]);
  }
  function lpStr(s) { return lpBytes(Buffer.from(s, 'utf8')); }

  const keyType = Buffer.from('ssh-ed25519', 'utf8');

  // Public key block: ssh-ed25519 || pubBytes (each length-prefixed)
  const pubBlock = Buffer.concat([lpBytes(keyType), lpBytes(pubBytes)]);

  // Private key block:
  //   check1 || check2 (same random uint32, detect decryption errors)
  //   || keytype || pubBytes || 64-byte secret (privScalar+pub) || comment
  const check = crypto.randomBytes(4);
  const secret = Buffer.concat([privBytes, pubBytes]); // 64 bytes total
  const privBody = Buffer.concat([
    check, check,
    lpBytes(keyType), lpBytes(pubBytes), lpBytes(secret), lpStr(comment),
  ]);

  // Pad to multiple of 8 with bytes 1,2,3,4,5,6,7,1,2,...
  const padLen = (8 - (privBody.length % 8)) % 8;
  const pad = Buffer.from(Array.from({ length: padLen }, (_, i) => (i + 1) & 0xff));
  const privBlock = Buffer.concat([privBody, pad]);

  // Outer structure
  const magic     = Buffer.from('openssh-key-v1\0', 'binary');
  const noneStr   = lpStr('none');
  const emptyStr  = lpStr('');
  const numKeys   = Buffer.alloc(4); numKeys.writeUInt32BE(1);

  const blob = Buffer.concat([
    magic,
    noneStr,   // ciphername
    noneStr,   // kdfname
    emptyStr,  // kdfoptions
    numKeys,
    lpBytes(pubBlock),
    lpBytes(privBlock),
  ]);

  // Wrap as PEM, 70-char lines
  const b64 = blob.toString('base64');
  const lines = b64.match(/.{1,70}/g).join('\n');
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

// ── Private key export ────────────────────────────────────────────────────────

function exportPrivateKey(id) {
  const keys = data.read('ssh-keys.json');
  if (!keys.find(k => k.id === id)) throw new Error('SSH key not found');
  const store = readCredStore();
  const pem   = store[`sshkey_priv_${id}`];
  if (!pem) throw new Error('Private key material not found in credential store');

  // Ed25519: convert stored PKCS#8 to OpenSSH format (required by PuTTY, WinSCP, etc.)
  // RSA: return PKCS#8 PEM as-is (PuTTYgen imports it without issues)
  const keyType = crypto.createPrivateKey(pem).asymmetricKeyType;
  if (keyType === 'ed25519') return convertToOpenSshPrivateKey(pem);
  return pem;
}

// ── List / get ────────────────────────────────────────────────────────────────

function listKeys() {
  return data.read('ssh-keys.json');
}

function getKey(id) {
  const key = data.read('ssh-keys.json').find(k => k.id === id);
  if (!key) throw new Error('SSH key not found');
  return key;
}

module.exports = {
  generateKeypair,
  importKey,
  deleteKey,
  exportPublicKey,
  exportPrivateKey,
  listKeys,
  getKey,
  // exposed for profiles.js / executor.js
  readCredStore,
  writeCredStore,
};
