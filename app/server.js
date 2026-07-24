'use strict';

const path    = require('path');
const fs      = require('fs');
const express = require('express');
const logger  = require('./logger');

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const auth      = require('./auth');
const scheduler = require('./scheduler');

// Ensure data dir exists
const DATA_DIR = path.join(__dirname, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Session + auth middleware
auth.initAuth(app);

// ── API routes ────────────────────────────────────────────────────────────────

app.use('/api/auth',     require('./api/auth'));
app.use('/api/ssh-keys', require('./api/ssh-keys'));
app.use('/api/profiles', require('./api/profiles'));
app.use('/api/rules',    require('./api/rules'));
app.use('/api/groups',   require('./api/groups'));
app.use('/api/jobs',     require('./api/jobs'));
app.use('/api/logs',     require('./api/logs'));
app.use('/api/pgp',      require('./api/pgp'));
app.use('/api/tags',     require('./api/tags'));
app.use('/api/settings', require('./api/settings'));

// ── Static UI ─────────────────────────────────────────────────────────────────

const UI_DIR = path.join(__dirname, 'ui');
app.use(express.static(UI_DIR));

// SPA fallback — serve index.html for any non-API GET
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const index = path.join(UI_DIR, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send('UI not found');
});

// ── Start server ──────────────────────────────────────────────────────────────

const config = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'config.json'), 'utf8'));
  } catch { return {}; }
})();

const PORT     = config.PORT || process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');

let server;
let protocol;

const _tlsOpts = (() => {
  // PFX / PKCS#12 — takes priority over PEM cert+key
  if (config.SSL_PFX) {
    const pfxPath = path.resolve(ROOT_DIR, config.SSL_PFX);
    if (fs.existsSync(pfxPath)) {
      const opts = { pfx: fs.readFileSync(pfxPath) };
      if (config.SSL_PFX_PASS) opts.passphrase = config.SSL_PFX_PASS;
      return opts;
    }
    logger.warn(`SSL_PFX file not found (${pfxPath}) — checking for PEM cert/key`);
  }

  // PEM cert + key
  const certPath = path.resolve(ROOT_DIR, config.SSL_CERT || 'certs/server.crt');
  const keyPath  = path.resolve(ROOT_DIR, config.SSL_KEY  || 'certs/server.key');
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }

  if (config.SSL_CERT || config.SSL_KEY) {
    logger.warn(`SSL cert/key not found (cert=${certPath}, key=${keyPath}) — falling back to HTTP`);
  }
  return null;
})();

if (_tlsOpts) {
  const https = require('https');
  server   = https.createServer(_tlsOpts, app);
  protocol = 'https';
} else {
  const http = require('http');
  server   = http.createServer(app);
  protocol = 'http';
}

// ── PGP private key migration ─────────────────────────────────────────────────
// One-time, re-runnable: moves any armoredKey still in pgp-keys.json (private
// records) into credentials.enc, then strips it from the JSON file.

function migratePgpKeys() {
  const { encrypt: encryptCred, decrypt: decryptCred } = require('./crypto');

  const keysFile = path.join(DATA_DIR, 'pgp-keys.json');
  const credFile = path.join(DATA_DIR, 'credentials.enc');

  let keys;
  try {
    keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return; // nothing to migrate
    logger.warn(`[pgp-migrate] Could not read pgp-keys.json: ${err.message}`);
    return;
  }

  let migrated = 0;

  for (const record of keys) {
    if (record.type !== 'private' || !record.armoredKey) continue;

    try {
      // Read current cred store
      let store = {};
      try {
        store = JSON.parse(decryptCred(fs.readFileSync(credFile, 'utf8').trim()));
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }

      // Write armored key to credentials.enc
      store[`pgp_armored_${record.id}`] = record.armoredKey;
      const tmp1 = credFile + '.tmp';
      fs.writeFileSync(tmp1, encryptCred(JSON.stringify(store)), 'utf8');
      fs.renameSync(tmp1, credFile);

      // Verify the write
      const verify = JSON.parse(decryptCred(fs.readFileSync(credFile, 'utf8').trim()));
      if (verify[`pgp_armored_${record.id}`] !== record.armoredKey) {
        throw new Error('Verification failed — stored value does not match source');
      }

      // Strip armoredKey from the record in the array
      delete record.armoredKey;
      migrated++;
      logger.info(`[pgp-migrate] Migrated private key id=${record.id} fingerprint=${record.fingerprint}`);
    } catch (err) {
      logger.error(`[pgp-migrate] Failed to migrate key id=${record.id}: ${err.message}`);
      // Leave record untouched — still has armoredKey, next startup will retry
    }
  }

  if (migrated > 0) {
    // Write updated pgp-keys.json atomically
    try {
      const tmp2 = keysFile + '.tmp';
      fs.writeFileSync(tmp2, JSON.stringify(keys, null, 2), 'utf8');
      fs.renameSync(tmp2, keysFile);
    } catch (err) {
      logger.error(`[pgp-migrate] Failed to write updated pgp-keys.json: ${err.message}`);
    }
  }

  logger.info(`[pgp-migrate] Migration complete — ${migrated} key(s) migrated`);
}

migratePgpKeys();

scheduler.init();

server.listen(PORT, () => {
  logger.info(`DataMover starting — log dir: ${logger.LOG_DIR}`);
  logger.info(`DataMover listening on ${protocol.toUpperCase()} port ${PORT}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

let _stopping = false;

async function shutdown(signal) {
  if (_stopping) return;
  _stopping = true;
  logger.info(`${signal} received — shutting down`);

  try {
    await scheduler.shutdown(60_000);
  } catch (err) {
    logger.warn(`Scheduler shutdown error: ${err.message}`);
  }

  server.close(() => {
    logger.info(`${protocol.toUpperCase()} server closed`);
    process.exit(0);
  });

  // Force exit after 70 s if close stalls
  setTimeout(() => {
    logger.warn('Forced exit after timeout');
    process.exit(1);
  }, 70_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
