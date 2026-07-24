'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { deriveSessionSecret } = require('./crypto');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, '../data');
const BCRYPT_ROUNDS = 12;
const DEFAULT_TIMEOUT_MINUTES = 30;

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
  }]);

  // Log username only — never log the default password
  logger.warn('[auth] Default admin user created (username: admin) — change the password immediately via Settings');
}

function initAuth(app) {
  const config = loadConfig();
  const timeoutMinutes = config.SESSION_TIMEOUT_MINUTES ?? DEFAULT_TIMEOUT_MINUTES;
  const secret = deriveSessionSecret();

  app.use(session({
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
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

  return { id: user.id, username: user.username, role: user.role };
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

// Test helper — never call in production code
function _setFilePaths({ usersFile, configFile } = {}) {
  if (usersFile !== undefined) _usersFile = usersFile;
  if (configFile !== undefined) _configFile = configFile;
}

module.exports = { initAuth, login, logout, requireAuth, requireAdmin, _setFilePaths, _bootstrap: bootstrap };
