'use strict';

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const net    = require('net');
const tls    = require('tls');
const crypto = require('crypto');
const { execSync } = require('child_process');
const forge  = require('node-forge');
const logger = require('./logger');

// Overridable via _setCertsDir() for testing — never call in production
let CERTS_DIR = path.join(__dirname, '../certs');

function certPath() { return path.join(CERTS_DIR, 'server.crt'); }
function keyPath()  { return path.join(CERTS_DIR, 'server.key'); }

function _setCertsDir(dir) { CERTS_DIR = dir; }

// ── Fingerprint ────────────────────────────────────────────────────────────────

function fingerprintOf(certPem) {
  const der  = forge.pki.pemToDer(certPem).getBytes();
  const hash = crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex');
  return hash.match(/.{2}/g).join(':').toUpperCase();
}

function randomSerialNumber() {
  // Ensure the leading byte's high bit is clear — otherwise DER encodes the
  // INTEGER as negative, which some strict certificate parsers reject.
  let hex = crypto.randomBytes(16).toString('hex');
  if (parseInt(hex[0], 16) >= 8) hex = '00' + hex;
  return hex;
}

// ── Key-file ACL hardening (best-effort) ──────────────────────────────────────

function restrictPrivateKeyAcl(filePath) {
  const account = process.env.USERDOMAIN
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME;
  try {
    // *S-1-5-32-544 = well-known SID for BUILTIN\Administrators — locale-independent
    execSync(
      `icacls "${filePath}" /inheritance:r /grant:r "${account}:F" /grant:r "*S-1-5-32-544:F"`,
      { stdio: 'ignore' }
    );
  } catch (err) {
    logger.warn(`[setup-tls] Could not restrict ACL on ${filePath}: ${err.message} — file permissions were left at their default`);
  }
}

// ── Certificate generation ─────────────────────────────────────────────────────

/**
 * Generates a self-signed RSA-2048 certificate and writes certs/server.crt /
 * certs/server.key. Refuses to overwrite an existing certs/server.crt unless
 * `overwrite` is set — it may be a real CA-issued certificate.
 *
 * subjectAltName is mandatory: browsers reject a certificate with no SAN
 * entries regardless of CN, and since this only takes effect after a service
 * restart, that failure would surface with no way back into the UI to fix it.
 */
function generateSelfSignedCert({ hostname, days = 3650, overwrite = false } = {}) {
  if (!hostname || typeof hostname !== 'string' || !hostname.trim()) {
    throw new Error('hostname is required');
  }
  if (fs.existsSync(certPath()) && !overwrite) {
    throw new Error('certs/server.crt already exists — pass overwrite to replace it');
  }

  const trimmedHostname = hostname.trim();

  // RSA via Node's native (OpenSSL-backed) keygen — node-forge's pure-JS RSA
  // generation at comparable strength is slow enough to stall this request,
  // since it runs synchronously inside a web request.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const forgePublicKey  = forge.pki.publicKeyFromPem(publicKey);
  const forgePrivateKey = forge.pki.privateKeyFromPem(privateKey);

  const cert = forge.pki.createCertificate();
  cert.publicKey    = forgePublicKey;
  cert.serialNumber = randomSerialNumber();

  const notBefore = new Date();
  const notAfter  = new Date(notBefore);
  notAfter.setDate(notAfter.getDate() + days);
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter  = notAfter;

  const subject = [{ name: 'commonName', value: trimmedHostname }];
  cert.setSubject(subject);
  cert.setIssuer(subject);

  const dnsNames = [...new Set([trimmedHostname, os.hostname(), 'localhost'].filter(Boolean))];
  const altNames = dnsNames.map(value => ({ type: 2, value }));
  altNames.push({ type: 7, ip: '127.0.0.1' });

  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames },
  ]);

  cert.sign(forgePrivateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);

  fs.mkdirSync(CERTS_DIR, { recursive: true });
  const tmpCert = certPath() + '.tmp';
  const tmpKey  = keyPath()  + '.tmp';
  fs.writeFileSync(tmpCert, certPem, 'utf8');
  fs.writeFileSync(tmpKey,  privateKey, 'utf8');
  fs.renameSync(tmpCert, certPath());
  fs.renameSync(tmpKey,  keyPath());

  restrictPrivateKeyAcl(keyPath());

  logger.info(`[setup-tls] Self-signed certificate generated for "${trimmedHostname}" — expires ${notAfter.toISOString()}`);

  return {
    fingerprint: fingerprintOf(certPem),
    notAfter:    notAfter.toISOString(),
  };
}

/**
 * Verifies that certs/server.crt and certs/server.key exist, parse, and form
 * a valid pair — the same check https.createServer performs internally, run
 * ahead of time so a bad cert/key can never make it into config.json.
 */
function verifyCertAndKey() {
  const cert = fs.readFileSync(certPath());
  const key  = fs.readFileSync(keyPath());
  tls.createSecureContext({ cert, key }); // throws on anything invalid or mismatched
}

// ── Port availability ─────────────────────────────────────────────────────────

/**
 * Attempts a real TCP bind on `port`, then closes it. A raw bind is the only
 * reliable free/busy check on Windows — http.sys URL reservations can block a
 * port that would otherwise look free to a lighter-weight probe.
 *
 * If `port` equals `currentPort` (the port this service is already listening
 * on), it is reported available without attempting a bind — the running
 * service is holding that port itself, so a real bind would always fail and
 * the admin could never keep their existing port.
 */
function checkPort(port, currentPort) {
  return new Promise(resolve => {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return resolve({ available: false, reason: 'Port must be an integer between 1 and 65535' });
    }
    if (currentPort != null && p === Number(currentPort)) {
      return resolve({ available: true, reason: 'currently in use by this service' });
    }

    const tester = net.createServer();
    tester.once('error', err => {
      resolve({
        available: false,
        reason: err.code === 'EADDRINUSE' ? 'Port is already in use' : err.message,
      });
    });
    tester.once('listening', () => {
      tester.close(() => resolve({ available: true, reason: null }));
    });
    tester.listen(p);
  });
}

// ── Complete setup ─────────────────────────────────────────────────────────────

/**
 * Verifies everything, in order, BEFORE writing anything:
 *   1. cert/key parse and form a valid pair (skipped when behindTlsProxy)
 *   2. the requested port actually binds
 * Only if both pass does it write SSL_CERT/SSL_KEY, PORT and
 * SETUP_COMPLETED_AT to config.json. Throws (writing nothing) on any failure.
 */
async function completeSetup({ port, currentPort, behindTlsProxy = false, configPath }) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    throw new Error('port must be an integer between 1 and 65535');
  }

  if (!behindTlsProxy) {
    try {
      verifyCertAndKey();
    } catch (err) {
      throw new Error(`Certificate/key check failed: ${err.message}`);
    }
  }

  const portResult = await checkPort(p, currentPort);
  if (!portResult.available) {
    throw new Error(portResult.reason || 'Port is not available');
  }

  // Every precondition passed — only now do we touch config.json.
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') cfg = {};
    else throw err;
  }

  if (!behindTlsProxy) {
    cfg.SSL_CERT = 'certs/server.crt';
    cfg.SSL_KEY  = 'certs/server.key';
  }
  cfg.PORT = p;
  cfg.SETUP_COMPLETED_AT = new Date().toISOString();

  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, configPath);

  return { port: p, setupCompletedAt: cfg.SETUP_COMPLETED_AT };
}

module.exports = {
  generateSelfSignedCert,
  verifyCertAndKey,
  checkPort,
  completeSetup,
  getDefaultHostname: () => os.hostname(),
  _setCertsDir,
  _certPath: certPath,
  _keyPath: keyPath,
  _fingerprintOf: fingerprintOf,
};
