'use strict';

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const gsLogs = require('../gs-logs');
const logger = require('../logger');
const { requireAuth, requireSetupComplete } = require('../auth');

const CONFIG_FILE = path.join(__dirname, '../../data/config.json');

router.use(requireAuth);
router.use(requireSetupComplete);

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
}

// Optional feature — off by default. Enabled per-instance in Settings → Features.
router.use((req, res, next) => {
  const cfg = readConfig();
  if (!cfg.FEATURES?.gsLogsBrowser) {
    return res.status(403).json({ error: 'GS Logs Browser is disabled — enable it in Settings → Features.' });
  }
  next();
});

// GET /api/gs-logs — parsed GlobalScape EFT log records from the configured staging folder
router.get('/', (req, res) => {
  const cfg = readConfig();

  if (!cfg.GS_LOGS_PROFILE_ID) {
    return res.status(400).json({ error: 'GS Logs source folder is not configured yet — set it in Settings.' });
  }

  try {
    const records = gsLogs.getRecords(cfg.GS_LOGS_PROFILE_ID, cfg.GS_LOGS_PATH || '');
    res.json({ records });
  } catch (err) {
    logger.error(`[api/gs-logs] Failed to read logs: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
