'use strict';

const router   = require('express').Router();
const sshKeys  = require('../ssh-keys');
const { requireAuth, requireAdmin } = require('../auth');
const logger   = require('../logger');

router.use(requireAuth);

// GET /api/ssh-keys
router.get('/', (req, res) => {
  try {
    res.json(sshKeys.listKeys());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ssh-keys/generate
router.post('/generate', requireAdmin, async (req, res) => {
  try {
    const { name, algorithm } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!algorithm) return res.status(400).json({ error: 'algorithm is required' });
    const record = await sshKeys.generateKeypair(name, algorithm);
    logger.info(`[api/ssh-keys] Generated ${algorithm} key "${name}" (${record.id})`);
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/ssh-keys/import
router.post('/import', requireAdmin, async (req, res) => {
  try {
    const { name, privateKeyPem, passphrase } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!privateKeyPem) return res.status(400).json({ error: 'privateKeyPem is required' });
    const record = await sshKeys.importKey(name, privateKeyPem, passphrase);
    logger.info(`[api/ssh-keys] Imported ${record.algorithm} key "${name}" (${record.id})`);
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/ssh-keys/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    await sshKeys.deleteKey(req.params.id);
    logger.info(`[api/ssh-keys] Deleted key ${req.params.id}`);
    res.json({ ok: true });
  } catch (err) {
    if (err.referenced) {
      return res.status(409).json({ error: err.message, profiles: err.referenced });
    }
    const status = err.message === 'SSH key not found' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/ssh-keys/:id/export-public
router.get('/:id/export-public', (req, res) => {
  try {
    const publicKey = sshKeys.exportPublicKey(req.params.id);
    res.json({ publicKey });
  } catch (err) {
    const status = err.message === 'SSH key not found' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/ssh-keys/:id/export-private
router.get('/:id/export-private', requireAdmin, (req, res) => {
  try {
    const privateKeyPem = sshKeys.exportPrivateKey(req.params.id);
    logger.info(`[api/ssh-keys] Private key exported for ${req.params.id} by ${req.session?.username}`);
    res.json({ privateKeyPem });
  } catch (err) {
    const status = err.message === 'SSH key not found' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
