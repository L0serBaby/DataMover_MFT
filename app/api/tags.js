'use strict';

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const data   = require('../data');
const { requireAuth, requireAdmin, requireSetupComplete } = require('../auth');

const CONFIG_FILE = path.join(__dirname, '../../data/config.json');

router.use(requireAuth);
router.use(requireSetupComplete);

// ── Config helpers ────────────────────────────────────────────────────────────

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeConfig(cfg) {
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
}

// ── GET /api/tags — all unique tags in use across rules + groups ──────────────
router.get('/', (req, res) => {
  const rules  = data.read('rules.json');
  const groups = data.read('groups.json');
  const tagSet = new Set();

  for (const r of rules)  (r.tags  || []).forEach(t => tagSet.add(t));
  for (const g of groups) (g.tags  || []).forEach(t => tagSet.add(t));

  res.json([...tagSet].sort());
});

// ── GET /api/tags/keys — defined tag-key prefixes ─────────────────────────────
router.get('/keys', (req, res) => {
  const cfg = readConfig();
  res.json(cfg.tagKeys || []);
});

// ── POST /api/tags/keys — add a tag-key prefix (admin only) ──────────────────
router.post('/keys', requireAdmin, (req, res) => {
  try {
    const { key } = req.body || {};
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'key is required' });
    }
    const cfg = readConfig();
    const keys = cfg.tagKeys || [];
    if (!keys.includes(key)) {
      keys.push(key);
      cfg.tagKeys = keys;
      writeConfig(cfg);
    }
    res.json(cfg.tagKeys);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/tags/keys/:key — remove a tag-key prefix (admin only) ────────
router.delete('/keys/:key', requireAdmin, (req, res) => {
  try {
    const cfg = readConfig();
    const keys = cfg.tagKeys || [];
    const idx = keys.indexOf(req.params.key);
    if (idx === -1) return res.status(404).json({ error: 'Key not found' });
    keys.splice(idx, 1);
    cfg.tagKeys = keys;
    writeConfig(cfg);
    res.json(cfg.tagKeys);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
