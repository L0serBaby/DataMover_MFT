'use strict';

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');

const data      = require('../data');
const scheduler = require('../scheduler');
const { requireAuth, requireAdmin, requireSetupComplete } = require('../auth');
const logger    = require('../logger');

const STAGING_FILE = path.join(__dirname, '../../data/import-staging/gs-import.json');
const CONFIG_FILE  = path.join(__dirname, '../../data/config.json');

router.use(requireAuth);
router.use(requireSetupComplete);

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return {}; throw err; }
}

// Optional feature — off by default. Enabled per-instance in Settings → Features.
router.use((req, res, next) => {
  const cfg = readConfig();
  if (!cfg.FEATURES?.ruleImport) {
    return res.status(403).json({ error: 'Rule Import is disabled — enable it in Settings → Features.' });
  }
  next();
});

// ── GET /api/import/staging ───────────────────────────────────────────────────

router.get('/staging', (req, res) => {
  let raw;
  try {
    raw = fs.readFileSync(STAGING_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Staging file not found — expected data/import-staging/gs-import.json' });
    }
    return res.status(500).json({ error: err.message });
  }

  try {
    res.json(JSON.parse(raw.replace(/^﻿/, '')));
  } catch (err) {
    res.status(500).json({ error: `Staging file is not valid JSON: ${err.message}` });
  }
});

// ── POST /api/import/commit ───────────────────────────────────────────────────

router.post('/commit', requireAdmin, async (req, res) => {
  try {
    const { rules: inRules = [], profiles: inProfiles = [] } = req.body || {};

    const existingRules    = data.read('rules.json');
    const existingProfiles = data.read('profiles.json');
    const existingGroups   = data.read('groups.json');

    const existingRuleIds    = new Set(existingRules.map(r => r.id));
    const existingProfileIds = new Set(existingProfiles.map(p => p.id));
    const existingGroupIds   = new Set(existingGroups.map(g => g.id));

    const summary = {
      imported: { rules: 0, profiles: 0, groups: 0 },
      skipped:  { rules: 0, profiles: 0 },
    };

    // ── Profiles ──────────────────────────────────────────────────────────────
    const newProfiles = [];
    for (const p of inProfiles) {
      if (!p.id) continue;
      if (existingProfileIds.has(p.id)) { summary.skipped.profiles++; continue; }
      newProfiles.push(p);
      existingProfileIds.add(p.id);
      summary.imported.profiles++;
    }

    // ── Groups — auto-create any groupId referenced by incoming rules ─────────
    const newGroups = [];
    const referencedGroupIds = new Set(inRules.filter(r => r.groupId).map(r => r.groupId));
    for (const gid of referencedGroupIds) {
      if (!existingGroupIds.has(gid)) {
        newGroups.push({ id: gid, name: gid, tags: [] });
        existingGroupIds.add(gid);
        summary.imported.groups++;
      }
    }

    // ── Rules ─────────────────────────────────────────────────────────────────
    const newRules = [];
    for (const r of inRules) {
      if (!r.id) continue;
      if (existingRuleIds.has(r.id)) { summary.skipped.rules++; continue; }
      newRules.push({ ...r, enabled: r.enabled !== false });
      existingRuleIds.add(r.id);
      summary.imported.rules++;
    }

    // ── Atomic writes (skip files with no new records) ────────────────────────
    if (newProfiles.length > 0) {
      await data.write('profiles.json', [...existingProfiles, ...newProfiles]);
    }
    if (newGroups.length > 0) {
      await data.write('groups.json', [...existingGroups, ...newGroups]);
    }
    if (newRules.length > 0) {
      await data.write('rules.json', [...existingRules, ...newRules]);
      await scheduler.reloadAll();
    }

    logger.info(
      `[api/import] Commit by "${req.session?.user?.username}" — ` +
      `rules=${summary.imported.rules} profiles=${summary.imported.profiles} ` +
      `groups=${summary.imported.groups} ` +
      `skipped(rules=${summary.skipped.rules} profiles=${summary.skipped.profiles})`
    );

    res.json(summary);
  } catch (err) {
    logger.error(`[api/import] Commit error: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
