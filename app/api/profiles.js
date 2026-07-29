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
const {
  parseSasToken, redactSas, getBlobContainerClient, blobListFiles,
  classifySasExpiry, _getAzureBlobSasWarnDays,
} = require('../executor');

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
  delete safe.sasToken;
  if (safe.type === 'azure-blob') {
    const { status, daysRemaining } = classifySasExpiry(safe.sasMeta?.expiresAt, _getAzureBlobSasWarnDays());
    safe.sasStatus        = status;
    safe.sasDaysRemaining = daysRemaining;
  }
  return safe;
}

// ── Azure Blob SAS helpers ──────────────────────────────────────────────────────

// Translates sp permission letters into what DataMover can actually do with
// this SAS, per spec §3.5 — catches a read-only SAS at profile-save/test time
// rather than at 2am during a delivery.
function sasCapabilities(sp) {
  const perms   = new Set((sp || '').split(''));
  const hasAll  = (...letters) => letters.every(l => perms.has(l));
  const caps    = [];
  if (hasAll('r', 'l'))                caps.push('source-copy');
  if (hasAll('r', 'l', 'd'))            caps.push('source-move');
  if (hasAll('r', 'l', 'c', 'w', 'd'))  caps.push('source-archive');
  if (hasAll('r', 'c', 'w'))            caps.push('destination');
  return caps;
}

function sasDaysRemaining(expiresAt) {
  if (!expiresAt) return null;
  return Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86400000);
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
    const { password, sasToken, sasExpiresAt, ...body } = req.body || {};
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
    } else if (profile.type === 'azure-blob' && sasToken) {
      let sasMeta;
      try {
        sasMeta = parseSasToken(sasToken);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      if (sasMeta.source === 'manual' && sasExpiresAt) {
        sasMeta.expiresAt = new Date(sasExpiresAt).toISOString();
      }
      const ref = profile.credentialRef || `azureblob_${profile.id}`;
      profile.credentialRef = ref;
      const store = readCredStore();
      store[ref] = sasToken;
      writeCredStore(store);
      profile.sasMeta = sasMeta;
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

    const { password, sasToken, sasExpiresAt, ...body } = req.body || {};
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
    } else if (updated.type === 'azure-blob' && sasToken) {
      let sasMeta;
      try {
        sasMeta = parseSasToken(sasToken);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      if (sasMeta.source === 'manual' && sasExpiresAt) {
        sasMeta.expiresAt = new Date(sasExpiresAt).toISOString();
      }
      const ref = updated.credentialRef || `azureblob_${updated.id}`;
      updated.credentialRef = ref;
      const store = readCredStore();
      store[ref] = sasToken;
      writeCredStore(store);
      updated.sasMeta = sasMeta;
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
    } else if (profile.type === 'azure-blob') {
      const containerClient = getBlobContainerClient(profile);
      // Sampled, not a full inventory — a real container can hold far too
      // many blobs to enumerate just to prove connectivity, and this used to
      // have no cap at all.
      const sampled = await blobListFiles(containerClient, profile.prefix, null, null, false, 5);
      const sasMeta = profile.sasMeta || {};
      logger.info(`[api/profiles] Test OK — "${profile.name}" (azure-blob) sampled=${sampled.length}`);
      res.json({
        ok:      true,
        sampled: sampled.length,
        sas: {
          expiresAt:     sasMeta.expiresAt || null,
          daysRemaining: sasDaysRemaining(sasMeta.expiresAt),
          status:        classifySasExpiry(sasMeta.expiresAt, _getAzureBlobSasWarnDays()).status,
          permissions:   sasMeta.permissions || null,
          capabilities:  sasCapabilities(sasMeta.permissions),
          notYetValid:   Boolean(sasMeta.startsAt && new Date(sasMeta.startsAt) > new Date()),
        },
      });
    } else {
      const stat = fs.statSync(profile.path);
      logger.info(`[api/profiles] Test OK — "${profile.name}" (${profile.type}) isDirectory=${stat.isDirectory()}`);
      res.json({ ok: true, isDirectory: stat.isDirectory() });
    }
  } catch (err) {
    let message = redactSas(err.message);
    if (profile.type === 'azure-blob') {
      message += ' (hint: check that the SAS token has not expired, and that HTTP_PROXY/HTTPS_PROXY are not set for the service account in a way that hijacks private-endpoint traffic)';
    }
    logger.warn(`[api/profiles] Test failed — "${profile.name}": ${message}`);
    res.status(400).json({ ok: false, error: message });
  }
});

// GET /api/profiles/:id/browse?path=
router.get('/:id/browse', requireAdmin, async (req, res) => {
  const profile = data.read('profiles.json').find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const rawPath    = req.query.path || '';
  const profileBase = profile.type === 'sftp'
    ? (profile.remotePath || '/')
    : profile.type === 'azure-blob'
      ? (profile.prefix || '')
      : (profile.path   || '');

  // azure-blob has no filesystem-style "." root — an empty prefix means "the
  // whole container", not "current directory".
  const browsePath = rawPath || profileBase || (profile.type === 'azure-blob' ? '' : '.');

  // For local/SMB/azure-blob profiles: confine browsing to within the profile's
  // configured root. This prevents authenticated users from enumerating
  // arbitrary server paths or container prefixes.
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
    } else if (profile.type === 'azure-blob') {
      const containerClient = getBlobContainerClient(profile);
      const prefixArg = browsePath ? (browsePath.endsWith('/') ? browsePath : `${browsePath}/`) : '';
      const entries = [];
      for await (const item of containerClient.listBlobsByHierarchy('/', prefixArg ? { prefix: prefixArg } : {})) {
        if (item.kind === 'prefix') {
          entries.push({ name: path.posix.basename(item.name.replace(/\/$/, '')), type: 'directory' });
        } else {
          entries.push({
            name:     path.posix.basename(item.name),
            type:     'file',
            size:     item.properties.contentLength,
            modified: item.properties.lastModified,
          });
        }
      }
      res.json(entries);
    } else {
      const entries = fs.readdirSync(browsePath, { withFileTypes: true });
      res.json(entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
      })));
    }
  } catch (err) {
    res.status(400).json({ error: redactSas(err.message) });
  }
});

module.exports = router;
