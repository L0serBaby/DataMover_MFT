'use strict';

const router = require('express').Router();
const data      = require('../data');
const scheduler = require('../scheduler');
const { requireAuth, requireSetupComplete } = require('../auth');

router.use(requireAuth);
router.use(requireSetupComplete);

// GET /api/jobs — paginated history
router.get('/', (req, res) => {
  const { ruleId, status } = req.query;
  const limit  = Math.min(parseInt(req.query.limit  || '50',  10), 500);
  const offset = Math.max(parseInt(req.query.offset || '0',   10), 0);

  let jobs = data.read('history.json');

  if (ruleId) jobs = jobs.filter(j => j.ruleId === ruleId);
  if (status) jobs = jobs.filter(j => j.status === status);

  const total = jobs.length;
  // Return newest first
  const page = jobs.slice().reverse().slice(offset, offset + limit);

  res.json({ total, offset, limit, jobs: page });
});

// GET /api/jobs/running — in-flight job count for the dashboard
router.get('/running', (req, res) => {
  const ruleIds = scheduler.getRunningJobs();
  res.json({ count: ruleIds.length, ruleIds });
});

// GET /api/jobs/:id — single job detail
router.get('/:id', (req, res) => {
  const job = data.read('history.json').find(j => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

module.exports = router;
