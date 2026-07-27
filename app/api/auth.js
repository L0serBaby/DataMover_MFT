'use strict';

const router = require('express').Router();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs     = require('fs');
const path   = require('path');
const auth   = require('../auth');
const { requireAuth, requireAdmin, requireSetupComplete } = auth;
const logger = require('../logger');

// Overridable via _setUsersFile() for testing — never call in production
let _usersFile = path.join(__dirname, '../../data/users.json');
const BCRYPT_ROUNDS = 12;

// ── Login rate limiting ────────────────────────────────────────────────────────
// Sliding-window counter keyed on (remoteAddress + username).
// No external dependency — runs entirely in-process.

const _loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS    = 15 * 60 * 1000; // 15 minutes

function _rlKey(req, username) {
  const ip = req.socket?.remoteAddress || req.ip || 'unknown';
  return `${ip}:${(username || '').toLowerCase()}`;
}

function _rlCheck(key) {
  const now   = Date.now();
  const entry = _loginAttempts.get(key);
  if (!entry || now > entry.resetAt) return true;            // window expired
  return entry.count < LOGIN_MAX_ATTEMPTS;
}

function _rlRecord(key) {
  const now   = Date.now();
  let   entry = _loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    _loginAttempts.set(key, entry);
  }
  entry.count++;
}

function _rlClear(key) {
  _loginAttempts.delete(key);
}

// Prune expired entries roughly every 100 login attempts to prevent unbounded growth
let _rlPruneCounter = 0;
function _rlMaybePrune() {
  if (++_rlPruneCounter % 100 !== 0) return;
  const now = Date.now();
  for (const [k, v] of _loginAttempts) {
    if (now > v.resetAt) _loginAttempts.delete(k);
  }
}

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(_usersFile, 'utf8')); }
  catch { return []; }
}

function saveUsers(users) {
  const tmp = _usersFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmp, _usersFile);
}

// Test helper — never call in production code
function _setUsersFile(file) {
  _usersFile = file;
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const rlKey = _rlKey(req, username);
  _rlMaybePrune();

  // Rate-limit check (H1)
  if (!_rlCheck(rlKey)) {
    return res.status(429).json({
      error: 'Too many failed login attempts. Try again in 15 minutes.',
    });
  }

  try {
    const user = await auth.login(username, password);

    // Regenerate session ID before elevating privilege (C1 — session fixation)
    await new Promise((resolve, reject) => {
      req.session.regenerate(err => (err ? reject(err) : resolve()));
    });

    req.session.user = user;
    _rlClear(rlKey); // successful login clears the counter
    logger.info(`[auth] Login — user="${user.username}" ip=${req.socket?.remoteAddress || req.ip || 'unknown'}`);
    // Full user object (id/mustChangePassword included) plus instance-level
    // setup state — enterApp() on the client needs both to decide whether to
    // show the forced-password screen, the TLS/port wizard, or the app itself.
    res.json({ ...user, setupComplete: auth.isSetupComplete() });
  } catch (err) {
    _rlRecord(rlKey); // count failed attempts
    logger.warn(`[auth] Login failed — ip=${req.socket?.remoteAddress || req.ip || 'unknown'}`);
    res.status(401).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const username = req.session?.user?.username || 'unknown';
    await auth.logout(req);
    logger.info(`[auth] Logout — user="${username}"`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ ...req.session.user, setupComplete: auth.isSetupComplete() });
});

// ── User management ───────────────────────────────────────────────────────────

// GET /api/auth/users — admin only
router.get('/users', requireAuth, requireSetupComplete, requireAdmin, (req, res) => {
  const users = loadUsers().map(({ id, username, role, createdAt }) =>
    ({ id, username, role, createdAt }));
  res.json(users);
});

// POST /api/auth/users — create user (admin only)
router.post('/users', requireAuth, requireSetupComplete, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || typeof username !== 'string' || !username.trim())
      return res.status(400).json({ error: 'username is required' });
    if (!password || typeof password !== 'string' || password.length < 8)
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    if (!['admin', 'user'].includes(role))
      return res.status(400).json({ error: 'role must be admin or user' });

    const users = loadUsers();
    if (users.find(u => u.username === username.trim()))
      return res.status(409).json({ error: 'Username already exists' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const newUser = {
      id: crypto.randomUUID(),
      username: username.trim(),
      passwordHash: hash,
      role,
      createdAt: new Date().toISOString(),
    };
    users.push(newUser);
    saveUsers(users);
    res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role, createdAt: newUser.createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/users/:id — update password or role
// Admin can change anyone; regular users can only change their own password
router.put('/users/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const caller = req.session.user;
    const isAdmin = caller.role === 'admin';

    const users        = loadUsers();
    const callerRecord  = users.find(u => u.id === caller.id);
    const forcedChange  = Boolean(callerRecord?.mustChangePassword);

    // While a password change is outstanding, this route only accepts a
    // self-service password change — no editing other users, no role changes.
    if (forcedChange) {
      if (caller.id !== id)
        return res.status(403).json({ error: 'Password change required' });

      const { password, role } = req.body || {};

      if (role !== undefined)
        return res.status(403).json({ error: 'Password change required' });

      const idx = users.findIndex(u => u.id === id);
      if (idx === -1) return res.status(404).json({ error: 'User not found' });

      try {
        await auth.validateForcedPasswordChange(password, users[idx].passwordHash);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      users[idx].passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      delete users[idx].mustChangePassword;
      saveUsers(users);

      // Regenerate session before re-attaching the user (C1 — session fixation)
      await new Promise((resolve, reject) => {
        req.session.regenerate(err => (err ? reject(err) : resolve()));
      });
      req.session.user = {
        id: users[idx].id, username: users[idx].username, role: users[idx].role,
        mustChangePassword: false,
      };

      return res.json({ id: users[idx].id, username: users[idx].username, role: users[idx].role });
    }

    // Non-admins may only change their own password
    if (!isAdmin && caller.id !== id)
      return res.status(403).json({ error: 'Admin access required' });

    const { password, role } = req.body || {};

    // Role changes are admin-only
    if (role !== undefined && !isAdmin)
      return res.status(403).json({ error: 'Admin access required' });

    if (role !== undefined && !['admin', 'user'].includes(role))
      return res.status(400).json({ error: 'role must be admin or user' });

    if (password !== undefined && (typeof password !== 'string' || password.length < 8))
      return res.status(400).json({ error: 'password must be at least 8 characters' });

    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    if (password) {
      users[idx].passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    }
    if (role !== undefined) {
      // Prevent demoting last admin
      if (users[idx].role === 'admin' && role !== 'admin') {
        const adminCount = users.filter(u => u.role === 'admin').length;
        if (adminCount <= 1) return res.status(400).json({ error: 'Cannot demote the last admin' });
      }
      users[idx].role = role;
    }
    saveUsers(users);

    // Refresh session if editing self
    if (caller.id === id && role !== undefined) {
      req.session.user = { ...req.session.user, role: users[idx].role };
    }

    res.json({ id: users[idx].id, username: users[idx].username, role: users[idx].role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auth/users/:id — admin only; cannot delete self or last admin
router.delete('/users/:id', requireAuth, requireSetupComplete, requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const caller = req.session.user;

    if (caller.id === id)
      return res.status(400).json({ error: 'Cannot delete your own account' });

    const users = loadUsers();
    const idx   = users.findIndex(u => u.id === id);
    if (idx === -1) return res.status(404).json({ error: 'User not found' });

    if (users[idx].role === 'admin') {
      const adminCount = users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
    }

    users.splice(idx, 1);
    saveUsers(users);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Express routers are functions — attaching test helpers directly onto the
// exported router is the standard way to reach into it without a parallel
// export shape. Never call _setUsersFile in production code.
router._setUsersFile = _setUsersFile;

module.exports = router;
