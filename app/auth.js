'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const { deriveSessionSecret } = require('./crypto');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '../data');
const BCRYPT_ROUNDS = 12;
const DEFAULT_TIMEOUT_MINUTES = 30;
const DEFAULT_PASSWORD = 'changeme123';
const FORCED_CHANGE_MIN_LENGTH = 12;

// Overridable via _setFilePaths() for testing
let _usersFile = path.join(DATA_DIR, 'users.json');
let _configFile = path.join(DATA_DIR, 'config.json');

// Pre-computed at bootstrap for timing-safe login (prevents user enumeration via response time)
let _dummyHash = null;

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(_usersFile, 'utf8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  const tmp = _usersFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), 'utf8');
  fs.renameSync(tmp, _usersFile);
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(_configFile, 'utf8'));
  } catch {
    return {};
  }
}

async function bootstrap() {
  // Compute dummy hash first — same rounds as stored passwords for timing parity
  _dummyHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), BCRYPT_ROUNDS);

  const users = loadUsers();
  if (users.length > 0) return;

  const hash = await bcrypt.hash('changeme123', BCRYPT_ROUNDS);
  saveUsers([{
    id: crypto.randomUUID(),
    username: 'admin',
    passwordHash: hash,
    role: 'admin',
    createdAt: new Date().toISOString(),
    mustChangePassword: true,
  }]);

  // Log username only — never log the default password
  logger.warn('[auth] Default admin user created (username: admin) — change the password immediately via Settings');
}

function initAuth(app, { tlsEnabled = false, behindTlsProxy = false } = {}) {
  const config = loadConfig();
  const timeoutMinutes = config.SESSION_TIMEOUT_MINUTES ?? DEFAULT_TIMEOUT_MINUTES;
  const secret = deriveSessionSecret();

  app.use(session({
    secret,
    name: 'datamover.sid', // don't advertise express-session
    resave: false,
    saveUninitialized: false,
    proxy: behindTlsProxy, // only honour X-Forwarded-Proto when a proxy is actually trusted
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: tlsEnabled,
      maxAge: timeoutMinutes * 60 * 1000,
    },
  }));

  bootstrap().catch(err => {
    logger.error(`[auth] Bootstrap error: ${err.message}`);
  });
}

async function login(username, password) {
  if (!username || !password) throw new Error('Username and password are required');

  const users = loadUsers();
  const user = users.find(u => u.username === username);

  // Always run bcrypt work regardless of whether the user exists.
  // _dummyHash may be null if login is called before bootstrap completes (narrow
  // startup window); .catch ensures that edge case returns false cleanly.
  const hashToCheck = user ? user.passwordHash : _dummyHash;
  const match = hashToCheck
    ? await bcrypt.compare(password, hashToCheck).catch(() => false)
    : false;

  if (!user || !match) throw new Error('Invalid username or password');

  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

function logout(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy(err => (err ? reject(err) : resolve()));
  });
}

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  res.status(401).json({ error: 'Authentication required' });
}

function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Blocks every route except the login/logout/me/self-password-change allowlist
// (enforced by callers choosing where to mount this) until a forced password
// change is completed. Reads users.json fresh on every request rather than
// req.session.user — the session is only updated once the change succeeds, so
// trusting a session-cached copy of the flag would either miss a change made
// by another route or, worse, go stale and lock the admin in the setup screen
// even after they've already changed the password.
function requireSetupComplete(req, res, next) {
  const sessionUser = req.session?.user;
  if (!sessionUser) return res.status(401).json({ error: 'Authentication required' });

  const users = loadUsers();
  const user = users.find(u => u.id === sessionUser.id);
  if (user?.mustChangePassword) {
    return res.status(403).json({ error: 'Password change required', mustChangePassword: true });
  }
  next();
}

// Password-policy check for the forced-change path (stricter than the
// general 8-char floor). Throws a descriptive Error on rejection; otherwise
// resolves. Kept separate from persistence so it stays testable without
// touching users.json — app/api/auth.js owns loading/saving the record.
async function validateForcedPasswordChange(newPassword, currentPasswordHash) {
  // Checked before the length floor: "changeme123" is only 11 characters, so
  // it would otherwise be rejected as "too short" — a misleading reason that
  // could read as "just add one more character" instead of "this is banned".
  if (typeof newPassword === 'string' && newPassword.toLowerCase() === DEFAULT_PASSWORD) {
    throw new Error('New password must not be the default password');
  }
  if (typeof newPassword !== 'string' || newPassword.length < FORCED_CHANGE_MIN_LENGTH) {
    throw new Error(`New password must be at least ${FORCED_CHANGE_MIN_LENGTH} characters`);
  }
  const matchesCurrent = await bcrypt.compare(newPassword, currentPasswordHash).catch(() => false);
  if (matchesCurrent) {
    throw new Error('New password must be different from the current password');
  }
}

// Test helper — never call in production code
function _setFilePaths({ usersFile, configFile } = {}) {
  if (usersFile !== undefined) _usersFile = usersFile;
  if (configFile !== undefined) _configFile = configFile;
}

module.exports = {
  initAuth, login, logout, requireAuth, requireAdmin, requireSetupComplete,
  validateForcedPasswordChange, _setFilePaths, _bootstrap: bootstrap,
};
