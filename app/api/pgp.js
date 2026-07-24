'use strict';

const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const pgp    = require('../pgp');
const { requireAuth, requireAdmin } = require('../auth');
const logger = require('../logger');

router.use(requireAuth);

// ── GET /api/pgp — list all keys (armoredKey redacted) ────────────────────────
router.get('/', (req, res) => {
  try {
    const keys = pgp.readKeys().map(({ armoredKey: _, ...k }) => k);
    res.json(keys);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/pgp/import — import armored key ─────────────────────────────────
router.post('/import', requireAdmin, async (req, res) => {
  try {
    const { armoredKey, passphrase } = req.body || {};
    if (!armoredKey || typeof armoredKey !== 'string' || !armoredKey.trim()) {
      return res.status(400).json({ error: 'armoredKey is required' });
    }
    const result = await pgp.importKey(armoredKey.trim(), passphrase || undefined);
    if (result?.requiresPassphrase) {
      return res.status(200).json({ requiresPassphrase: true });
    }
    logger.info(`[api/pgp] Key imported — type=${result.type} id=${result.id} by="${req.session?.user?.username}"`);
    res.status(201).json(result);
  } catch (err) {
    logger.warn(`[api/pgp] Import failed: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/pgp/generate — generate new keypair ─────────────────────────────
router.post('/generate', requireAdmin, async (req, res) => {
  try {
    const { name, email, passphrase, bits, expiresInDays } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'email is required' });
    }
    if (expiresInDays != null && (!Number.isInteger(+expiresInDays) || +expiresInDays < 0)) {
      return res.status(400).json({ error: 'expiresInDays must be a non-negative integer' });
    }
    const rsaBits = [2048, 4096].includes(+bits) ? +bits : 4096;
    const result = await pgp.generateKeypair(name.trim(), email.trim(), passphrase || undefined, rsaBits, expiresInDays ? +expiresInDays : undefined);
    logger.info(`[api/pgp] Keypair generated — fingerprint=${result.fingerprint} by="${req.session?.user?.username}"`);
    res.status(201).json(result);
  } catch (err) {
    logger.error(`[api/pgp] Generate failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/pgp/:id — delete key ─────────────────────────────────────────
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    pgp.deleteKey(req.params.id);
    logger.info(`[api/pgp] Key deleted — id=${req.params.id} by="${req.session?.user?.username}"`);
    res.json({ ok: true });
  } catch (err) {
    const status = err.message.includes('not found') ? 404
      : err.message.includes('referenced') ? 409
      : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── GET /api/pgp/:id/export — export public key armored text ──────────────────
router.get('/:id/export', async (req, res) => {
  try {
    const armored = await pgp.exportPublicKey(req.params.id);
    res.json({ armoredKey: armored });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── POST /api/pgp/test — test decrypt a small payload ────────────────────────
// Body: { privateKeyId, armoredMessage }
// Creates a test encrypt+decrypt roundtrip using the identified private key's
// public counterpart so no existing encrypted data is needed.
router.post('/test', requireAdmin, async (req, res) => {
  const { privateKeyId } = req.body || {};
  if (!privateKeyId) {
    return res.status(400).json({ error: 'privateKeyId is required' });
  }

  const tmpDir = path.join(os.tmpdir(), `dm_pgptest_${crypto.randomUUID()}`);
  try {
    fs.mkdirSync(tmpDir, { recursive: true });

    // Write a small plaintext file
    const plainPath = path.join(tmpDir, 'test.txt');
    const encPath   = path.join(tmpDir, 'test.txt.pgp');
    const decPath   = path.join(tmpDir, 'test_decrypted.txt');
    const testPayload = `DataMover PGP test ${new Date().toISOString()}`;
    fs.writeFileSync(plainPath, testPayload, 'utf8');

    // Find the matching public key for this private key
    const privRecord = pgp.getKey(privateKeyId);
    const allKeys    = pgp.readKeys();
    const pubRecord  = allKeys.find(k =>
      k.type === 'public' && k.fingerprint === privRecord.fingerprint
    );
    if (!pubRecord) {
      return res.status(400).json({
        error: 'No matching public key found for this private key. Import the public key first.',
      });
    }

    // Encrypt with public key
    await pgp.encryptFile(plainPath, encPath, [pubRecord.id]);
    // Decrypt with private key
    await pgp.decryptFile(encPath, decPath, privateKeyId);

    const recovered = fs.readFileSync(decPath, 'utf8');
    const ok = recovered === testPayload;

    logger.info(`[api/pgp] Test ${ok ? 'passed' : 'FAILED'} — privateKeyId=${privateKeyId}`);
    res.json({ ok, message: ok ? 'Roundtrip encrypt/decrypt succeeded' : 'Content mismatch after decrypt' });
  } catch (err) {
    logger.warn(`[api/pgp] Test failed — privateKeyId=${privateKeyId}: ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

module.exports = router;
