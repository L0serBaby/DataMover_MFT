'use strict';

const router   = require('express').Router();
const fs       = require('fs');
const path     = require('path');
const auth     = require('../auth');
const setupTls = require('../setup-tls');
const logger   = require('../logger');

const { requireAuth } = auth;

const CONFIG_FILE = path.join(__dirname, '../../data/config.json');
const USERS_FILE  = path.join(__dirname, '../../data/users.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
}

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}

function resolveCurrentPort(cfg) {
  return cfg.PORT || process.env.PORT || 3000;
}

router.use(requireAuth);

// The TLS/port step only makes sense once the forced password change is
// behind us — enterApp() on the client enforces that ordering, but a client
// is not a security boundary. Reject here too, with the same body shape
// requireSetupComplete uses, so a caller mid-password-change can't jump ahead.
router.use((req, res, next) => {
  const users = loadUsers();
  const user  = users.find(u => u.id === req.session.user.id);
  if (user?.mustChangePassword) {
    return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  }
  next();
});

// Reachable only while the instance-level TLS/port step is still outstanding —
// once SETUP_COMPLETED_AT is written, these routes stop doing anything so an
// already-onboarded admin can't accidentally regenerate certs or rebind the port.
router.use((req, res, next) => {
  if (auth.isSetupComplete()) return res.status(403).json({ error: 'Setup already complete' });
  next();
});

// GET /api/setup/info — form defaults for the TLS/port step
router.get('/info', (req, res) => {
  const cfg = readConfig();
  res.json({
    suggestedHostname: setupTls.getDefaultHostname(),
    currentPort:       resolveCurrentPort(cfg),
    behindTlsProxy:    cfg.BEHIND_TLS_PROXY === true,
  });
});

// GET /api/setup/port-check?port=NNNN
router.get('/port-check', async (req, res) => {
  const cfg    = readConfig();
  const result = await setupTls.checkPort(req.query.port, resolveCurrentPort(cfg));
  res.json(result);
});

// POST /api/setup/tls/generate  { hostname, overwrite? }
router.post('/tls/generate', (req, res) => {
  const cfg = readConfig();
  if (cfg.BEHIND_TLS_PROXY === true) {
    return res.status(400).json({
      error: 'BEHIND_TLS_PROXY is set — a reverse proxy is expected to terminate TLS, so local certificate generation is disabled',
    });
  }

  try {
    const { hostname, overwrite } = req.body || {};
    const result = setupTls.generateSelfSignedCert({ hostname, overwrite: Boolean(overwrite) });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/setup/complete  { port }
router.post('/complete', async (req, res) => {
  try {
    const cfg           = readConfig();
    const behindTlsProxy = cfg.BEHIND_TLS_PROXY === true;

    const result = await setupTls.completeSetup({
      port:        req.body?.port,
      currentPort: resolveCurrentPort(cfg),
      behindTlsProxy,
      configPath:  CONFIG_FILE,
    });

    logger.info(`[setup] Instance setup completed — port=${result.port} behindTlsProxy=${behindTlsProxy}`);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
