'use strict';

// Run with: .\runtime\node.exe tests/api-auth.test.js
//
// Exercises the Express route handler in app/api/auth.js directly — the
// login response-shape bug (missing id/mustChangePassword) lived entirely in
// this file's res.json(...) call and was invisible to app/auth.js's own
// tests, which only ever exercised auth.login() underneath the route.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ── Temp file setup ──────────────────────────────────────────────────────────

const TMP       = os.tmpdir();
const tmpUsers  = path.join(TMP, `dm_test_apiauth_users_${crypto.randomBytes(4).toString('hex')}.json`);
const tmpConfig = path.join(TMP, `dm_test_apiauth_config_${crypto.randomBytes(4).toString('hex')}.json`);

fs.writeFileSync(tmpUsers, '[]', 'utf8');
fs.writeFileSync(tmpConfig, JSON.stringify({ SETUP_COMPLETED_AT: '2020-01-01T00:00:00.000Z' }), 'utf8');

// auth.login()/auth.isSetupComplete() (called from inside the route) resolve
// paths via app/auth.js's own overrides — both must point at the same temp
// files as this file's own _setUsersFile for the route under test to see
// consistent state.
const auth = require('../app/auth');
auth._setFilePaths({ usersFile: tmpUsers, configFile: tmpConfig });

const apiAuthRouter = require('../app/api/auth');
apiAuthRouter._setUsersFile(tmpUsers);

function cleanup() {
  for (const f of [tmpUsers, tmpUsers + '.tmp', tmpConfig]) {
    try { fs.unlinkSync(f); } catch { /* already gone */ }
  }
}

function writeUsers(users) {
  fs.writeFileSync(tmpUsers, JSON.stringify(users, null, 2), 'utf8');
}

// ── Route-handler extraction ──────────────────────────────────────────────────
// Express stores each router.METHOD(...) call as a stack layer; the final
// entry in that layer's own stack is the route's actual handler function
// (everything before it is middleware, e.g. requireAuth).

function findRouteHandler(router, method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

const loginHandler = findRouteHandler(apiAuthRouter, 'post', '/login');

// ── Minimal test runner ──────────────────────────────────────────────────────

let passed = 0, failed = 0;

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

function assert(cond, msg)    { if (!cond)   throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m  || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

function makeRes() {
  return {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body)   { this._body  = body;  return this; },
  };
}

function makeReq(body) {
  return {
    body,
    session: { regenerate: cb => cb(null) },
    socket:  {},
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

console.log('\napi/auth.js route tests\n');

await test('POST /login response includes id, mustChangePassword, and setupComplete', async () => {
  const hash = await bcrypt.hash('changeme123', 12);
  writeUsers([{
    id: 'user-1', username: 'admin', passwordHash: hash, role: 'admin',
    createdAt: 'now', mustChangePassword: true,
  }]);

  const req = makeReq({ username: 'admin', password: 'changeme123' });
  const res = makeRes();
  await loginHandler(req, res);

  assertEqual(res._body.id, 'user-1');
  assertEqual(res._body.username, 'admin');
  assertEqual(res._body.role, 'admin');
  assertEqual(res._body.mustChangePassword, true);
  assertEqual(res._body.setupComplete, true); // tmpConfig has SETUP_COMPLETED_AT set
});

await test('POST /login reflects mustChangePassword: false once cleared', async () => {
  const hash = await bcrypt.hash('a-real-password-123', 12);
  writeUsers([{
    id: 'user-2', username: 'cleared', passwordHash: hash, role: 'admin', createdAt: 'now',
  }]);

  const req = makeReq({ username: 'cleared', password: 'a-real-password-123' });
  const res = makeRes();
  await loginHandler(req, res);

  assertEqual(res._body.id, 'user-2');
  assertEqual(res._body.mustChangePassword, false);
  assertEqual(res._body.setupComplete, true);
});

await test('POST /login rejects wrong password without leaking user fields', async () => {
  const hash = await bcrypt.hash('correct-password-123', 12);
  writeUsers([{
    id: 'user-3', username: 'bob', passwordHash: hash, role: 'user', createdAt: 'now',
  }]);

  const req = makeReq({ username: 'bob', password: 'wrong-password' });
  const res = makeRes();
  await loginHandler(req, res);

  assertEqual(res._status, 401);
  assert(res._body.error, 'error message should be present');
  assert(!('id' in res._body), 'id should not be present on a failed login');
});

// ── Results ────────────────────────────────────────────────────────────────

cleanup();
console.log(`
${passed} passed, ${failed} failed
`);
if (failed > 0) process.exit(1);

})();
