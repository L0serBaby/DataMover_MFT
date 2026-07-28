'use strict';

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const Sftp   = require('ssh2-sftp-client');

const { encrypt, decrypt } = require('../crypto');
const data                 = require('../data');
const sshKeys              = require('../ssh-keys');
const { requireAuth, requireAdmin, requireSetupComplete } = require('../auth');
const logger               = require('../logger');
const { renameWithRetry }  = require('../fs-utils');

const CRED_FILE = path.join(__dirname, '../../data/credentials.enc');

// ── Credential store helpers ──────────────────────────────────────────────────

function readCredStore() {
  try {
    return JSON.parse(decrypt(fs.readFileSync(CRED_FILE, 'utf8').trim()));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeCredStore(store) {
  const tmp = CRED_FILE + '.tmp';
  fs.writeFileSync(tmp, encrypt(JSON.stringify(store)), 'utf8');
  renameWithRetry(tmp, CRED_FILE);
}

function redact(profile) {
  const safe = { ...profile };
  delete safe.password;
  return safe;
}

// ── SFTP connect helper (connect, run fn, always end) ─────────────────────────

async function withSftp(profile, fn) {
  const store      = readCredStore();
  const credential = store[profile.credentialRef];
  if (!credential) throw new Error(`No credential found for ref "${profile.credentialRef}"`);

  const client = new Sftp();
  const connOpts = { host: profile.host, port: profile.port || 22, username: profile.username };
  if (profile.authType === 'key') {
    connOpts.privateKey = credential;
  } else {
    connOpts.password = credential;
  }
  await client.connect(connOpts);
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.use(requireAuth);
router.use(requireSetupComplete);

// GET /api/profiles
router.get('/', (req, res) => {
  res.json(data.read('profiles.json').map(redact));
});

// POST /api/profiles
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { password, ...body } = req.body || {};
    if (!body.name) return res.status(400).json({ error: 'name is required' });
    if (!body.type) return res.status(400).json({ error: 'type is required' });

    const profile = { ...body, id: crypto.randomUUID() };

    if (profile.favorite === undefined) {
      profile.favorite = false;
    }

    if (profile.type === 'sftp') {
      if (profile.authType === 'key' && profile.sshKeyId) {
        const keyRecord = sshKeys.getKey(profile.sshKeyId);
        profile.credentialRef = `sshkey_priv_${keyRecord.id}`;
      } else if (password) {
        const ref = profile.credentialRef || `sftp_${profile.id}`;
        profile.credentialRef = ref;
        const store = readCredStore();
        store[ref] = password;
        writeCredStore(store);
      }
    }

    const profiles = data.read('profiles.json');
    profiles.push(profile);
    await data.write('profiles.json', profiles);
    res.status(201).json(redact(profile));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profiles/:id
router.put('/:id', requireAdmin, async (req, res) => {
  try {
    const profiles = data.read('profiles.json');
    const idx = profiles.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Profile not found' });

    const { password, ...body } = req.body || {};
    const existing = profiles[idx];
    const updated  = { ...existing, ...body, id: existing.id };

    if (updated.type === 'sftp') {
      if (updated.authType === 'key' && updated.sshKeyId) {
        const keyRecord = sshKeys.getKey(updated.sshKeyId);
        updated.credentialRef = `sshkey_priv_${keyRecord.id}`;
      } else if (password) {
        const ref = updated.credentialRef || `sftp_${updated.id}`;
        updated.credentialRef = ref;
        const store = readCredStore();
        store[ref] = password;
        writeCredStore(store);
      }
    }

    profiles[idx] = updated;
    await data.write('profiles.json', profiles);
    res.json(redact(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/profiles/:id
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const profiles = data.read('profiles.json');
    const profile  = profiles.find(p => p.id === req.params.id);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const rules = data.read('rules.json');
    const refs  = rules.filter(r =>
      r.source?.profileId === req.params.id ||
      (r.destinations || []).some(d => d.profileId === req.params.id)
    );
    if (refs.length > 0) {
      return res.status(409).json({
        error:  'Profile is referenced by one or more rules',
        rules:  refs.map(r => ({ id: r.id, name: r.name })),
      });
    }

    await data.write('profiles.json', profiles.filter(p => p.id !== req.params.id));

    if (profile.credentialRef) {
      try {
        const store = readCredStore();
        delete store[profile.credentialRef];
        writeCredStore(store);
      } catch {} // non-fatal
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/profiles/:id/test
router.post('/:id/test', requireAdmin, async (req, res) => {
  const profile = data.read('profiles.json').find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  try {
    if (profile.type === 'sftp') {
      const count = await withSftp(profile, async client => {
        const listing = await client.list(profile.remotePath || '/');
        return listing.length;
      });
      logger.info(`[api/profiles] Test OK — "${profile.name}" (sftp) files=${count}`);
      res.json({ ok: true, files: count });
    } else {
      const stat = fs.statSync(profile.path);
      logger.info(`[api/profiles] Test OK — "${profile.name}" (${profile.type}) isDirectory=${stat.isDirectory()}`);
      res.json({ ok: true, isDirectory: stat.isDirectory() });
    }
  } catch (err) {
    logger.warn(`[api/profiles] Test failed — "${profile.name}": ${err.message}`);
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /api/profiles/:id/browse?path=
router.get('/:id/browse', requireAdmin, async (req, res) => {
  const profile = data.read('profiles.json').find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const rawPath    = req.query.path || '';
  const profileBase = profile.type === 'sftp'
    ? (profile.remotePath || '/')
    : (profile.path       || '');

  const browsePath = rawPath || profileBase || '.';

  // For local/SMB profiles: confine browsing to within the profile's configured root.
  // This prevents authenticated users from enumerating arbitrary server paths.
  if (profile.type !== 'sftp' && profileBase) {
    const normalizeP = p => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const normBase    = normalizeP(profileBase);
    const normRequest = normalizeP(browsePath);
    const withinBase  = normRequest === normBase ||
      normRequest.startsWith(normBase + '/');
    if (!withinBase) {
      logger.warn(`[api/profiles] Browse blocked — "${browsePath}" outside root for profile "${profile.name}"`);
      return res.status(403).json({ error: 'Path is outside the profile root directory' });
    }
  }

  try {
    if (profile.type === 'sftp') {
      const entries = await withSftp(profile, client => client.list(browsePath));
      res.json(entries.map(e => ({
        name:     e.name,
        type:     e.type === 'd' ? 'directory' : 'file',
        size:     e.size,
        modified: e.modifyTime,
      })));
    } else {
      const entries = fs.readdirSync(browsePath, { withFileTypes: true });
      res.json(entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      })));
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
