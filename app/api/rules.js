'use strict';

const router      = require('express').Router();
const crypto      = require('crypto');
const fs          = require('fs');
const path        = require('path');
const cronParser  = require('cron-parser');
const data        = require('../data');
const scheduler   = require('../scheduler');
const { requireAuth, requireAdmin, requireSetupComplete } = require('../auth');
const logger = require('../logger');

// Must match SCHEDULE_TIMEZONE handling in scheduler.js — next-fire preview
// and the actual cron trigger need to agree on which timezone "8am" means,
// or the dashboard's "Next Schedule" card lies about when a rule will run.
const CONFIG_FILE = path.join(__dirname, '../../data/config.json');
function _getScheduleTimezone() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return cfg.SCHEDULE_TIMEZONE || undefined;
  } catch {
    return undefined;
  }
}

router.use(requireAuth);
router.use(requireSetupComplete);

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchesTag(rule, tags) {
  const ruleTags = rule.tags || [];
  return tags.every(t => ruleTags.includes(t));
}

// ── GET /api/rules ────────────────────────────────────────────────────────────
// Query params: groupId, q (name search), status (enabled|disabled), tags (comma-separated)
router.get('/', (req, res) => {
  let rules = data.read('rules.json');

  if (req.query.groupId) {
    rules = rules.filter(r => r.groupId === req.query.groupId);
  }
  if (req.query.q) {
    const q = req.query.q.toLowerCase();
    rules = rules.filter(r => r.name.toLowerCase().includes(q));
  }
  if (req.query.status) {
    const enabled = req.query.status === 'enabled';
    rules = rules.filter(r => (r.enabled !== false) === enabled);
  }
  if (req.query.tags) {
    const tags = req.query.tags.split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length) rules = rules.filter(r => matchesTag(r, tags));
  }

  res.json(rules);
});

// ── GET /api/rules/next-fire — soonest upcoming scheduled run ────────────────
// MUST be before /:id
router.get('/next-fire', (req, res) => {
  const rules = data.read('rules.json');
  const scheduled = rules.filter(r => r.cron && r.cron !== 'manual' && r.enabled !== false);
  const tz = _getScheduleTimezone();

  let best = null;
  for (const rule of scheduled) {
    let nextFireTime;
    try {
      nextFireTime = cronParser.parseExpression(rule.cron, tz ? { tz } : {}).next().toDate();
    } catch (err) {
      logger.warn(`[api/rules] next-fire: invalid cron on rule "${rule.name}" (${rule.id}): ${err.message}`);
      continue;
    }
    if (!best || nextFireTime < best.nextFireTime) {
      best = { id: rule.id, name: rule.name, cron: rule.cron, nextFireTime };
    }
  }

  res.json(best ? { ...best, nextFireTime: best.nextFireTime.toISOString(), scheduleTimezone: tz || null } : null);
});

// ── POST /api/rules/bulk-tag — MUST be before /:id ────────────────────────────
router.post('/bulk-tag', requireAdmin, async (req, res) => {
  try {
    const { ids, tags, action } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    if (!Array.isArray(tags) || tags.length === 0) {
      return res.status(400).json({ error: 'tags array is required' });
    }
    if (!['add', 'remove'].includes(action)) {
      return res.status(400).json({ error: 'action must be "add" or "remove"' });
    }

    const rules = data.read('rules.json');
    let modified = 0;

    for (const rule of rules) {
      if (!ids.includes(rule.id)) continue;
      const current = rule.tags || [];
      if (action === 'add') {
        rule.tags = [...new Set([...current, ...tags])];
      } else {
        rule.tags = current.filter(t => !tags.includes(t));
      }
      modified++;
    }

    await data.write('rules.json', rules);
    res.json({ ok: true, modified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/rules ───────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'name is required' });
    if (!body.source) return res.status(400).json({ error: 'source is required' });

    const rule = { ...body, id: crypto.randomUUID(), enabled: body.enabled !== false };
    const rules = data.read('rules.json');
    rules.push(rule);
    await data.write('rules.json', rules);

    if (rule.cron) {
      await scheduler.reloadRule(rule.id);
    }

    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/rules/:id ────────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const rules = data.read('rules.json');
    const idx = rules.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Rule not found' });

    const updated = { ...rules[idx], ...req.body, id: rules[idx].id };
    rules[idx] = updated;
    await data.write('rules.json', rules);

    await scheduler.reloadRule(updated.id);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/rules/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const rules = data.read('rules.json');
    const idx = rules.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Rule not found' });

    await data.write('rules.json', rules.filter(r => r.id !== req.params.id));
    await scheduler.reloadRule(req.params.id);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/rules/:id/run — manual trigger ──────────────────────────────────
router.post('/:id/run', requireAdmin, async (req, res) => {
  try {
    logger.info(`[api/rules] Manual run — ruleId=${req.params.id} by="${req.session?.user?.username}"`);
    const result = await scheduler.runRule(req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.message === 'Rule not found' ? 404
      : err.message.includes('already running') ? 409
      : err.message.includes('shutting down') ? 503
      : 400;
    if (status >= 500) logger.error(`[api/rules] Run error ruleId=${req.params.id}: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
