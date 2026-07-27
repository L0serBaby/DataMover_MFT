'use strict';

const router    = require('express').Router();
const path      = require('path');
const fs        = require('fs');
const scheduler = require('../scheduler');
const { requireAuth, requireAdmin, requireSetupComplete } = require('../auth');

const CONFIG_FILE = path.join(__dirname, '../../data/config.json');

router.use(requireAuth);
router.use(requireSetupComplete);

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
}

function writeConfig(cfg) {
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
}

// GET /api/settings — returns user-facing settings (no secrets)
router.get('/', (req, res) => {
  const cfg = readConfig();
  res.json({
    sessionTimeoutMinutes: cfg.SESSION_TIMEOUT_MINUTES ?? 30,
    logRetentionDays:      cfg.LOG_RETENTION_DAYS      ?? 30,
    port:                  cfg.PORT                    ?? 3000,
    scheduleTimezone:      cfg.SCHEDULE_TIMEZONE        ?? null,
  });
});

// PUT /api/settings — admin only
router.put('/', requireAdmin, (req, res) => {
  try {
    const { sessionTimeoutMinutes, logRetentionDays, scheduleTimezone } = req.body || {};
    const cfg = readConfig();
    let tzChanged = false;

    if (sessionTimeoutMinutes !== undefined) {
      const v = parseInt(sessionTimeoutMinutes, 10);
      if (!Number.isFinite(v) || v < 1 || v > 1440)
        return res.status(400).json({ error: 'sessionTimeoutMinutes must be 1–1440' });
      cfg.SESSION_TIMEOUT_MINUTES = v;
    }

    if (logRetentionDays !== undefined) {
      const v = parseInt(logRetentionDays, 10);
      if (!Number.isFinite(v) || v < 1 || v > 365)
        return res.status(400).json({ error: 'logRetentionDays must be 1–365' });
      cfg.LOG_RETENTION_DAYS = v;
    }

    if (scheduleTimezone !== undefined) {
      if (scheduleTimezone === null || scheduleTimezone === '') {
        // Clearing it reverts cron interpretation to system-local time —
        // same as before this setting existed.
        if (cfg.SCHEDULE_TIMEZONE) tzChanged = true;
        delete cfg.SCHEDULE_TIMEZONE;
      } else {
        if (typeof scheduleTimezone !== 'string')
          return res.status(400).json({ error: 'scheduleTimezone must be a string' });
        try {
          // Throws RangeError on an invalid IANA zone name (e.g. typo).
          new Intl.DateTimeFormat('en-US', { timeZone: scheduleTimezone });
        } catch {
          return res.status(400).json({ error: `"${scheduleTimezone}" is not a recognized timezone` });
        }
        if (cfg.SCHEDULE_TIMEZONE !== scheduleTimezone) tzChanged = true;
        cfg.SCHEDULE_TIMEZONE = scheduleTimezone;
      }
    }

    writeConfig(cfg);

    // Re-register all cron tasks so a timezone change takes effect
    // immediately instead of waiting for the next service restart.
    if (tzChanged) scheduler.reloadAll();

    res.json({
      sessionTimeoutMinutes: cfg.SESSION_TIMEOUT_MINUTES ?? 30,
      logRetentionDays:      cfg.LOG_RETENTION_DAYS      ?? 30,
      scheduleTimezone:      cfg.SCHEDULE_TIMEZONE        ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
