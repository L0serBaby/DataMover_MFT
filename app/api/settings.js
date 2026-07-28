'use strict';

const router    = require('express').Router();
const path      = require('path');
const fs        = require('fs');
const scheduler = require('../scheduler');
const { requireAuth, requireAdmin, requireSetupComplete } = require('../auth');
const { renameWithRetry } = require('../fs-utils');

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
  renameWithRetry(tmp, CONFIG_FILE);
}

// Feature flags for optional, off-by-default functionality — see Settings →
// Features. Keeping the default list here (rather than only in FEATURES)
// means a flag always has a defined boolean value even before the config
// file has ever been written.
const FEATURE_DEFAULTS = {
  gsLogsBrowser: false,
  ruleImport:    false,
};

function readFeatures(cfg) {
  return { ...FEATURE_DEFAULTS, ...(cfg.FEATURES || {}) };
}

// GET /api/settings — returns user-facing settings (no secrets)
router.get('/', (req, res) => {
  const cfg = readConfig();
  res.json({
    sessionTimeoutMinutes: cfg.SESSION_TIMEOUT_MINUTES ?? 30,
    logRetentionDays:      cfg.LOG_RETENTION_DAYS      ?? 30,
    port:                  cfg.PORT                    ?? 3000,
    gsLogsProfileId:       cfg.GS_LOGS_PROFILE_ID       ?? null,
    gsLogsPath:            cfg.GS_LOGS_PATH             ?? '',
    scheduleTimezone:      cfg.SCHEDULE_TIMEZONE        ?? null,
    features:              readFeatures(cfg),
  });
});

// PUT /api/settings — admin only
router.put('/', requireAdmin, (req, res) => {
  try {
    const { sessionTimeoutMinutes, logRetentionDays, gsLogsProfileId, gsLogsPath, scheduleTimezone, features } = req.body || {};
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

    if (gsLogsProfileId !== undefined) {
      if (gsLogsProfileId !== null && typeof gsLogsProfileId !== 'string')
        return res.status(400).json({ error: 'gsLogsProfileId must be a string or null' });
      cfg.GS_LOGS_PROFILE_ID = gsLogsProfileId || null;
    }

    if (gsLogsPath !== undefined) {
      if (typeof gsLogsPath !== 'string')
        return res.status(400).json({ error: 'gsLogsPath must be a string' });
      cfg.GS_LOGS_PATH = gsLogsPath;
    }

    if (features !== undefined) {
      if (typeof features !== 'object' || features === null || Array.isArray(features))
        return res.status(400).json({ error: 'features must be an object' });
      const merged = { ...FEATURE_DEFAULTS, ...(cfg.FEATURES || {}) };
      for (const key of Object.keys(features)) {
        if (!(key in FEATURE_DEFAULTS))
          return res.status(400).json({ error: `Unknown feature flag: "${key}"` });
        if (typeof features[key] !== 'boolean')
          return res.status(400).json({ error: `features.${key} must be a boolean` });
        merged[key] = features[key];
      }
      cfg.FEATURES = merged;
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
      gsLogsProfileId:       cfg.GS_LOGS_PROFILE_ID       ?? null,
      gsLogsPath:            cfg.GS_LOGS_PATH             ?? '',
      scheduleTimezone:      cfg.SCHEDULE_TIMEZONE        ?? null,
      features:              readFeatures(cfg),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
