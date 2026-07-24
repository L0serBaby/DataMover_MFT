'use strict';

// Run with: .\runtime\node.exe tests/auth.test.js
// Requires Windows registry access (MachineGuid) and node_modules installed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ── Temp file setup ──────────────────────────────────────────────────────────

const TMP = os.tmpdir();
const tmpUsers  = path.join(TMP, `dm_test_users_${crypto.randomBytes(4).toString('hex')}.json`);
const tmpConfig = path.join(TMP, `dm_test_config_${crypto.randomBytes(4).toString('hex')}.json`);

fs.writeFileSync(tmpUsers,  '[]', 'utf8');
fs.writeFileSync(tmpConfig, JSON.stringify({ SESSION_TIMEOUT_MINUTES: 15 }), 'utf8');

const { login, logout, requireAuth, requireAdmin, _setFilePaths, _bootstrap } = require('../app/auth');
_setFilePaths({ usersFile: tmpUsers, configFile: tmpConfig });

function cleanup() {
  for (const f of [tmpUsers, tmpUsers + '.tmp', tmpConfig]) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
}

// ── Minimal test runner ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

async function assertRejects(fn, pattern) {
  try { await fn(); } catch (err) {
    if (pattern && !pattern.test(err.message)) {
      throw new Error(`Rejection message "${err.message}" did not match ${pattern}`);
    }
    return;
  }
  throw new Error('Expected a rejection but none was thrown');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function readUsers() {
  return JSON.parse(fs.readFileSync(tmpUsers, 'utf8'));
}

function writeUsers(users) {
  fs.writeFileSync(tmpUsers, JSON.stringify(users, null, 2), 'utf8');
}

function makeRes() {
  return {
    _status: null,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body  = body;  return this; },
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {

  console.log('\nauth.js tests\n');

  // ── bootstrap ──────────────────────────────────────────────────────────────

  await test('bootstrap creates admin user when users.json is empty', async () => {
    fs.writeFileSync(tmpUsers, '[]', 'utf8');
    await _bootstrap();
    const users = readUsers();
    assertEqual(users.length, 1, 'Expected exactly one user');
    assertEqual(users[0].username, 'admin');
    assertEqual(users[0].role, 'admin');
    assert(users[0].id,           'id should be set');
    assert(users[0].passwordHash, 'passwordHash should be set');
    assert(users[0].createdAt,    'createdAt should be set');
    assert(!JSON.stringify(users[0]).includes('changeme123'), 'Raw password must not appear in users.json');
  });

  await test('bootstrap is idempotent — does not create a second user', async () => {
    await _bootstrap();
    assertEqual(readUsers().length, 1, 'Should still be exactly one user after second bootstrap');
  });

  await test('bootstrap leaves existing non-admin users alone', async () => {
    writeUsers([{ id: 'x', username: 'alice', passwordHash: 'h', role: 'readonly', createdAt: 'now' }]);
    await _bootstrap();
    const users = readUsers();
    assertEqual(users.length, 1, 'Should not have added a user');
    assertEqual(users[0].username, 'alice');
  });

  // ── login ──────────────────────────────────────────────────────────────────

  await test('login succeeds with correct admin credentials', async () => {
    fs.writeFileSync(tmpUsers, '[]', 'utf8');
    await _bootstrap();
    const user = await login('admin', 'changeme123');
    assertEqual(user.username, 'admin');
    assertEqual(user.role, 'admin');
    assert(user.id, 'id should be present');
    assert(!user.passwordHash, 'passwordHash must not be returned');
  });

  await test('login rejects wrong password', async () => {
    await assertRejects(() => login('admin', 'wrongpassword'), /invalid username or password/i);
  });

  await test('login rejects unknown username', async () => {
    await assertRejects(() => login('ghost', 'changeme123'), /invalid username or password/i);
  });

  await test('login rejects empty username', async () => {
    await assertRejects(() => login('', 'changeme123'), /required/i);
  });

  await test('login rejects empty password', async () => {
    await assertRejects(() => login('admin', ''), /required/i);
  });

  await test('login rejects null credentials', async () => {
    await assertRejects(() => login(null, null), /required/i);
  });

  // ── logout ─────────────────────────────────────────────────────────────────

  await test('logout resolves and destroys session', async () => {
    let destroyed = false;
    const req = { session: { destroy: (cb) => { destroyed = true; cb(null); } } };
    await logout(req);
    assert(destroyed, 'session.destroy should have been called');
  });

  await test('logout rejects if session.destroy errors', async () => {
    const req = { session: { destroy: (cb) => cb(new Error('store error')) } };
    await assertRejects(() => logout(req), /store error/);
  });

  // ── requireAuth middleware ─────────────────────────────────────────────────

  await test('requireAuth calls next() when session has a user', () => {
    const req = { session: { user: { id: '1', username: 'admin', role: 'admin' } } };
    const res = makeRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert(called, 'next() should have been called');
    assert(res._status === null, 'should not have set a response status');
  });

  await test('requireAuth returns 401 when no session user', () => {
    const req = { session: {} };
    const res = makeRes();
    let called = false;
    requireAuth(req, res, () => { called = true; });
    assert(!called, 'next() should not have been called');
    assertEqual(res._status, 401);
  });

  await test('requireAuth returns 401 when session is missing', () => {
    const req = {};
    const res = makeRes();
    requireAuth(req, res, () => {});
    assertEqual(res._status, 401);
  });

  // ── requireAdmin middleware ────────────────────────────────────────────────

  await test('requireAdmin calls next() for admin user', () => {
    const req = { session: { user: { id: '1', username: 'admin', role: 'admin' } } };
    const res = makeRes();
    let called = false;
    requireAdmin(req, res, () => { called = true; });
    assert(called, 'next() should have been called');
  });

  await test('requireAdmin returns 403 for readonly user', () => {
    const req = { session: { user: { id: '2', username: 'viewer', role: 'readonly' } } };
    const res = makeRes();
    let called = false;
    requireAdmin(req, res, () => { called = true; });
    assert(!called, 'next() should not have been called');
    assertEqual(res._status, 403);
  });

  await test('requireAdmin returns 401 for unauthenticated request', () => {
    const req = { session: {} };
    const res = makeRes();
    requireAdmin(req, res, () => {});
    assertEqual(res._status, 401);
  });

  // ── config ─────────────────────────────────────────────────────────────────

  await test('config file contains SESSION_TIMEOUT_MINUTES', () => {
    const raw = JSON.parse(fs.readFileSync(tmpConfig, 'utf8'));
    assertEqual(raw.SESSION_TIMEOUT_MINUTES, 15, 'Expected 15 from test config');
  });

  // ── Results ────────────────────────────────────────────────────────────────

  cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);

})();
