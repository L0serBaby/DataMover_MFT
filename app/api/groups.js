'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const data   = require('../data');
const { requireAuth, requireAdmin, requireSetupComplete } = require('../auth');

router.use(requireAuth);
router.use(requireSetupComplete);

// ── GET /api/groups ───────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.json(data.read('groups.json'));
});

// ── POST /api/groups/bulk-tag — MUST be before /:id ──────────────────────────
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

    const groups = data.read('groups.json');
    let modified = 0;

    for (const group of groups) {
      if (!ids.includes(group.id)) continue;
      const current = group.tags || [];
      if (action === 'add') {
        group.tags = [...new Set([...current, ...tags])];
      } else {
        group.tags = current.filter(t => !tags.includes(t));
      }
      modified++;
    }

    await data.write('groups.json', groups);
    res.json({ ok: true, modified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/groups ──────────────────────────────────────────────────────────
router.post('/', requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'name is required' });

    const group = { ...body, id: crypto.randomUUID() };
    const groups = data.read('groups.json');
    groups.push(group);
    await data.write('groups.json', groups);
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/groups/:id ───────────────────────────────────────────────────────
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const groups = data.read('groups.json');
    const idx = groups.findIndex(g => g.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Group not found' });

    groups[idx] = { ...groups[idx], ...req.body, id: groups[idx].id };
    await data.write('groups.json', groups);
    res.json(groups[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/groups/:id ────────────────────────────────────────────────────
// ?moveRules=<targetGroupId>  — reassign member rules before deleting
// Without moveRules, member rules have their groupId cleared
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const groups = data.read('groups.json');
    if (!groups.find(g => g.id === req.params.id)) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const targetGroupId = req.query.moveRules || null;
    if (targetGroupId && !groups.find(g => g.id === targetGroupId)) {
      return res.status(400).json({ error: 'Target group not found' });
    }

    const rules = data.read('rules.json');
    let rulesModified = 0;
    for (const rule of rules) {
      if (rule.groupId !== req.params.id) continue;
      if (targetGroupId) {
        rule.groupId = targetGroupId;
      } else {
        delete rule.groupId;
      }
      rulesModified++;
    }

    await data.write('groups.json', groups.filter(g => g.id !== req.params.id));
    if (rulesModified > 0) await data.write('rules.json', rules);

    res.json({ ok: true, rulesModified });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
