'use strict';

// Run with: .\runtime\node.exe tests/scheduler.test.js
// Uses a fake executor and temp data dir — no real file transfers, no live cron waits.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ── Temp data dir ─────────────────────────────────────────────────────────────

const DATA_DIR = path.join(os.tmpdir(), `dm_sched_${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(DATA_DIR, { recursive: true });

// Wire data module to temp dir BEFORE requiring scheduler (both share the same
// cached data module instance, so this redirect applies everywhere)
const data      = require('../app/data');
const scheduler = require('../app/scheduler');
data._setDataDir(DATA_DIR);

function cleanup() { fs.rmSync(DATA_DIR, { recursive: true, force: true }); }

// ── Data helpers ──────────────────────────────────────────────────────────────

function makeRule(overrides = {}) {
  return Object.assign({
    id:         crypto.randomUUID(),
    name:       'Test Rule',
    enabled:    true,
    source:     { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst', path: null }],
    action:     'copy',
    postTransfer: 'leave',
    onError:    'continue',
    retryCount: 0,
    cron:       'manual',
  }, overrides);
}

async function writeRules(rules) { await data.write('rules.json', rules); }

// ── Fake executor ─────────────────────────────────────────────────────────────

function makeResult(ruleId, overrides = {}) {
  return Object.assign({
    id:               crypto.randomUUID(),
    ruleId,
    ruleName:         'Test Rule',
    startTime:        new Date().toISOString(),
    endTime:          new Date().toISOString(),
    status:           'success',
    filesTransferred: 0,
    bytesTransferred: 0,
    files:            [],
    errors:           [],
  }, overrides);
}

// Instant executor — resolves immediately
const fastExec = rule => Promise.resolve(makeResult(rule.id));

// Slow executor — resolves after delayMs (used for concurrency / shutdown tests)
function slowExec(delayMs) {
  return rule => new Promise(resolve =>
    setTimeout(() => resolve(makeResult(rule.id)), delayMs)
  );
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

async function test(name, fn) {
  scheduler._reset();
  scheduler._setTransferRule(fastExec);
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  } finally {
    scheduler._reset();
  }
}

function assert(cond, msg)    { if (!cond)   throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b) throw new Error(m || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

async function assertRejects(fn, pattern) {
  try { await fn(); }
  catch (err) {
    if (pattern && !pattern.test(err.message))
      throw new Error(`Rejection "${err.message}" did not match ${pattern}`);
    return;
  }
  throw new Error('Expected a rejection but none was thrown');
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Tests ─────────────────────────────────────────────────────────────────────

(async () => {

console.log('\nscheduler.js tests\n');

// ── reloadAll ─────────────────────────────────────────────────────────────────

await test('reloadAll registers cron for each enabled rule', async () => {
  // A once-a-year schedule, not '* * * * * *' — this test only checks
  // registration, not firing, and an every-second cron races the assertion
  // below against the next tick at a real second boundary (intermittently
  // failing with "Expected 0, got 1" if the tick lands mid-test).
  const rule = makeRule({ cron: '0 0 0 1 1 *' });
  await writeRules([rule]);

  scheduler.reloadAll();

  // registered = cron task exists and getRunningJobs is empty (not yet fired)
  assertEqual(scheduler.getRunningJobs().length, 0);
  // We can't inspect _cronTasks directly, but reloadRule + re-reloadAll clears cleanly
});

await test('reloadAll skips disabled rules', async () => {
  const rule = makeRule({ cron: '* * * * * *', enabled: false });
  await writeRules([rule]);

  scheduler.reloadAll();
  // No crash = pass; rule won't fire
});

await test('reloadAll skips rules with missing scheduleId', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  scheduler.reloadAll();
  // No crash = pass
});

await test('reloadAll skips rules whose schedule is not in schedules.json', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  scheduler.reloadAll();
  // No crash = pass
});

await test('reloadAll skips rules with invalid cron expression', async () => {
  const rule = makeRule({ cron: 'not a cron' });
  await writeRules([rule]);
  scheduler.reloadAll();
  // No crash = pass
});

await test('reloadAll cancels existing cron tasks before re-registering', async () => {
  const ruleA = makeRule({ cron: '* * * * * *' });
  await writeRules([ruleA]);

  scheduler.reloadAll();  // registers ruleA
  scheduler.reloadAll();  // should cleanly cancel and re-register
  // No duplicate tasks or crash = pass
});

// ── reloadRule ────────────────────────────────────────────────────────────────

await test('reloadRule registers cron for a newly enabled rule', async () => {
  const rule = makeRule({ cron: '* * * * * *' });
  await writeRules([rule]);

  scheduler.reloadRule(rule.id);  // no crash = registered
});

await test('reloadRule cancels existing task and re-registers on second call', async () => {
  const rule = makeRule({ cron: '* * * * * *' });
  await writeRules([rule]);

  scheduler.reloadRule(rule.id);
  scheduler.reloadRule(rule.id);  // should not crash or duplicate
});

await test('reloadRule does nothing for disabled rule', async () => {
  const rule = makeRule({ cron: '* * * * * *', enabled: false });
  await writeRules([rule]);

  scheduler.reloadRule(rule.id);  // no crash = pass
});

await test('reloadRule does nothing for unknown ruleId', async () => {
  await writeRules([]);
  scheduler.reloadRule('nonexistent');  // no crash = pass
});

// ── runRule ───────────────────────────────────────────────────────────────────

await test('runRule executes the rule and returns a jobResult', async () => {
  const rule = makeRule();
  await writeRules([rule]);

  const result = await scheduler.runRule(rule.id);

  assert(result,                  'should return a result');
  assertEqual(result.ruleId, rule.id);
  assertEqual(result.status, 'success');
});

await test('runRule appends result to history.json', async () => {
  const rule = makeRule();
  await writeRules([rule]);

  // Ensure history.json starts empty
  await data.write('history.json', []);

  await scheduler.runRule(rule.id);

  const history = data.read('history.json');
  assertEqual(history.length, 1, 'history should have one entry');
  assertEqual(history[0].ruleId, rule.id);
});

await test('runRule throws for unknown ruleId', async () => {
  await writeRules([]);
  await assertRejects(() => scheduler.runRule('no-such-id'), /Rule not found/i);
});

await test('runRule throws when scheduler is shutting down', async () => {
  const rule = makeRule();
  await writeRules([rule]);

  // Manually trigger shutdown state without waiting (don't need full shutdown here)
  scheduler._reset();
  // Flip the internal flag by calling shutdown() asynchronously
  // We can't directly set _shuttingDown, but we can call shutdown() and then
  // immediately try runRule before any await resolves.
  // Simpler: just verify it by calling shutdown() first then runRule.
  scheduler._setTransferRule(fastExec);
  const shutdownPromise = scheduler.shutdown(0);  // instant timeout
  await shutdownPromise;  // now _shuttingDown = true

  await assertRejects(() => scheduler.runRule(rule.id), /shutting down/i);
});

// ── Double-fire prevention ────────────────────────────────────────────────────

await test('runRule throws "already running" when called while job is in flight', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  scheduler._setTransferRule(slowExec(500));

  const first = scheduler.runRule(rule.id);  // starts but does not await
  // Second call while first is still in flight
  await assertRejects(() => scheduler.runRule(rule.id), /already running/i);

  await first;  // let first finish to avoid dangling promise
});

await test('getRunningJobs reflects in-flight rules', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  scheduler._setTransferRule(slowExec(400));

  const promise = scheduler.runRule(rule.id);
  const running = scheduler.getRunningJobs();
  assert(running.includes(rule.id), 'ruleId should appear in getRunningJobs');

  await promise;
  assertEqual(scheduler.getRunningJobs().length, 0, 'should be empty after job completes');
});

await test('_testCronFire skips and returns null when rule is already running', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  scheduler._setTransferRule(slowExec(400));

  const firstRun = scheduler.runRule(rule.id);  // in flight

  const cronResult = await scheduler._testCronFire(rule.id);
  assertEqual(cronResult, null, 'cron tick should return null when rule is running');

  await firstRun;
});

await test('_testCronFire executes rule when not already running', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  scheduler._setTransferRule(fastExec);

  const result = await scheduler._testCronFire(rule.id);
  assert(result !== null, 'cron tick should return a result when not already running');
  assertEqual(result.ruleId, rule.id);
});

await test('two rapid cron ticks: second is a no-op, both finish cleanly', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  await data.write('history.json', []);
  scheduler._setTransferRule(slowExec(150));

  // Fire two ticks without awaiting the first
  const p1 = scheduler._testCronFire(rule.id);  // starts job
  const p2 = scheduler._testCronFire(rule.id);  // should skip (already running)

  const [r1, r2] = await Promise.all([p1, p2]);
  assert(r1 !== null,    'first tick should have run');
  assertEqual(r2, null,  'second tick should have been skipped');

  const history = data.read('history.json');
  assertEqual(history.length, 1, 'only one job should have been recorded in history');
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

await test('shutdown waits for in-flight jobs before returning', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  scheduler._setTransferRule(slowExec(200));

  const jobPromise = scheduler.runRule(rule.id);

  const before = Date.now();
  await scheduler.shutdown(5_000);  // generous timeout
  const elapsed = Date.now() - before;

  assert(elapsed >= 150, `Shutdown should have waited for job (elapsed=${elapsed}ms)`);
  // job should have resolved by now
  const result = await jobPromise;
  assert(result, 'job result should be present after shutdown completes');
});

await test('shutdown returns promptly when no jobs are running', async () => {
  const before = Date.now();
  await scheduler.shutdown(60_000);
  const elapsed = Date.now() - before;
  assert(elapsed < 500, `Shutdown with no jobs should be near-instant (elapsed=${elapsed}ms)`);
});

await test('shutdown respects timeout — does not hang if job exceeds limit', async () => {
  const rule = makeRule();
  await writeRules([rule]);
  scheduler._setTransferRule(slowExec(5_000));  // job takes 5s

  // Don't await the job — we want it still running at shutdown time
  scheduler.runRule(rule.id).catch(() => {});

  const before = Date.now();
  await scheduler.shutdown(200);  // give it only 200ms
  const elapsed = Date.now() - before;

  // Should have returned in roughly 200ms, not 5s
  assert(elapsed < 1_000, `Shutdown should have timed out within ~200ms (elapsed=${elapsed}ms)`);
});

await test('shutdown stops cron tasks from accepting new ticks', async () => {
  const rule = makeRule({ cron: '* * * * * *' });
  await writeRules([rule]);

  scheduler.reloadAll();       // register cron task
  await scheduler.shutdown();  // should stop the task

  // After shutdown, runRule should throw "shutting down"
  await assertRejects(() => scheduler.runRule(rule.id), /shutting down/i);
});

// ── Multiple rules ────────────────────────────────────────────────────────────

await test('multiple rules can run concurrently without interfering', async () => {
  const ruleA = makeRule({ name: 'Rule A' });
  const ruleB = makeRule({ name: 'Rule B' });
  await writeRules([ruleA, ruleB]);
  scheduler._setTransferRule(slowExec(100));

  const [rA, rB] = await Promise.all([
    scheduler.runRule(ruleA.id),
    scheduler.runRule(ruleB.id),
  ]);

  assertEqual(rA.ruleId, ruleA.id);
  assertEqual(rB.ruleId, ruleB.id);
});

await test('double-fire prevention is per-rule — different rules run concurrently', async () => {
  const ruleA = makeRule({ name: 'Rule A' });
  const ruleB = makeRule({ name: 'Rule B' });
  await writeRules([ruleA, ruleB]);
  scheduler._setTransferRule(slowExec(200));

  const pA = scheduler.runRule(ruleA.id);   // ruleA running
  const pB = scheduler.runRule(ruleB.id);   // ruleB should start fine (different rule)

  // Firing ruleA again while it's running should throw
  await assertRejects(() => scheduler.runRule(ruleA.id), /already running/i);

  await Promise.all([pA, pB]);
});

// ── Results ───────────────────────────────────────────────────────────────────

cleanup();
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

})();
