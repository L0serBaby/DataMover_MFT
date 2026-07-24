'use strict';

// Run with: .\runtime\node.exe tests/data.test.js

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const crypto = require('crypto');

// ── Temp directory setup ─────────────────────────────────────────────────────

const TMP_DIR = path.join(os.tmpdir(), `dm_data_test_${crypto.randomBytes(4).toString('hex')}`);
fs.mkdirSync(TMP_DIR, { recursive: true });

const { read, write, append, _setDataDir } = require('../app/data');
_setDataDir(TMP_DIR);

function cleanup() {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

function filePath(name) {
  return path.join(TMP_DIR, name);
}

function writeRaw(name, content) {
  fs.writeFileSync(filePath(name), content, 'utf8');
}

function readRaw(name) {
  return fs.readFileSync(filePath(name), 'utf8');
}

function exists(name) {
  return fs.existsSync(filePath(name));
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

function assertDeepEqual(a, b, msg) {
  const as = JSON.stringify(a);
  const bs = JSON.stringify(b);
  if (as !== bs) throw new Error(msg || `Expected ${bs}, got ${as}`);
}

async function assertRejects(fn, pattern) {
  try { await fn(); } catch (err) {
    if (pattern && !pattern.test(err.message)) {
      throw new Error(`Rejection "${err.message}" did not match ${pattern}`);
    }
    return;
  }
  throw new Error('Expected a rejection but none was thrown');
}

function assertThrows(fn, pattern) {
  try { fn(); } catch (err) {
    if (pattern && !pattern.test(err.message)) {
      throw new Error(`Error "${err.message}" did not match ${pattern}`);
    }
    return;
  }
  throw new Error('Expected an error but none was thrown');
}

// ── Tests ────────────────────────────────────────────────────────────────────

(async () => {

  console.log('\ndata.js tests\n');

  // ── read — missing file ────────────────────────────────────────────────────

  await test('read returns [] for missing profiles.json', () => {
    assertDeepEqual(read('profiles.json'), []);
  });

  await test('read returns [] for missing rules.json', () => {
    assertDeepEqual(read('rules.json'), []);
  });

  await test('read returns [] for missing schedules.json', () => {
    assertDeepEqual(read('schedules.json'), []);
  });

  await test('read returns [] for missing history.json', () => {
    assertDeepEqual(read('history.json'), []);
  });

  await test('read returns [] for missing users.json', () => {
    assertDeepEqual(read('users.json'), []);
  });

  await test('read default is a fresh copy — mutations do not affect subsequent reads', () => {
    const a = read('profiles.json');
    a.push({ id: 'x' });
    const b = read('profiles.json');
    assertDeepEqual(b, [], 'Second read should still return empty array');
  });

  // ── read — existing file ───────────────────────────────────────────────────

  await test('read returns parsed contents of an existing file', () => {
    writeRaw('rules.json', JSON.stringify([{ id: '1', name: 'Test Rule' }]));
    const result = read('rules.json');
    assertEqual(result.length, 1);
    assertEqual(result[0].name, 'Test Rule');
  });

  // ── read — corrupt JSON ────────────────────────────────────────────────────

  await test('read throws on corrupt JSON', () => {
    writeRaw('schedules.json', '{ not valid json ]]');
    assertThrows(() => read('schedules.json'), /Corrupt JSON/);
  });

  // ── read — unknown file ────────────────────────────────────────────────────

  await test('read throws on unrecognized filename', () => {
    assertThrows(() => read('secrets.json'), /Unrecognized data file/);
  });

  // ── write — basic ─────────────────────────────────────────────────────────

  await test('write creates file with correct content', async () => {
    const data = [{ id: 'p1', name: 'Test SFTP' }];
    await write('profiles.json', data);
    assertDeepEqual(read('profiles.json'), data);
  });

  await test('write overwrites existing file', async () => {
    await write('profiles.json', [{ id: 'p2' }]);
    await write('profiles.json', [{ id: 'p3' }]);
    const result = read('profiles.json');
    assertEqual(result.length, 1);
    assertEqual(result[0].id, 'p3');
  });

  await test('write is atomic — no .tmp file left behind after success', async () => {
    await write('rules.json', [{ id: 'r1' }]);
    assert(!exists('rules.json.tmp'), '.tmp file should be gone after write');
  });

  await test('write works on a previously missing file (creates it)', async () => {
    // history.json has not been written yet in this test run
    if (exists('history.json')) fs.unlinkSync(filePath('history.json'));
    await write('history.json', [{ id: 'h1' }]);
    assert(exists('history.json'), 'history.json should now exist');
    assertEqual(read('history.json')[0].id, 'h1');
  });

  await test('write throws on unrecognized filename', async () => {
    await assertRejects(() => write('passwords.json', []), /Unrecognized data file/);
  });

  // ── append ────────────────────────────────────────────────────────────────

  await test('append creates file when missing and adds first record', async () => {
    if (exists('schedules.json')) fs.unlinkSync(filePath('schedules.json'));
    await append('schedules.json', { id: 's1', name: 'Every 15 min' });
    const result = read('schedules.json');
    assertEqual(result.length, 1);
    assertEqual(result[0].id, 's1');
  });

  await test('append adds a record to an existing file', async () => {
    await append('schedules.json', { id: 's2', name: 'Daily 6am' });
    const result = read('schedules.json');
    assertEqual(result.length, 2);
    assertEqual(result[1].id, 's2');
  });

  await test('append drops oldest records when maxRecords is exceeded', async () => {
    writeRaw('history.json', JSON.stringify(
      Array.from({ length: 5 }, (_, i) => ({ id: String(i) }))
    ));
    await append('history.json', { id: '5' }, { maxRecords: 5 });
    const result = read('history.json');
    assertEqual(result.length, 5, 'Should be capped at 5');
    assertEqual(result[0].id, '1', 'Oldest record (id:0) should have been dropped');
    assertEqual(result[4].id, '5', 'Newest record should be last');
  });

  await test('append cap drops multiple oldest when far over limit', async () => {
    writeRaw('history.json', JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ id: String(i) }))
    ));
    await append('history.json', { id: '20' }, { maxRecords: 10 });
    const result = read('history.json');
    assertEqual(result.length, 10);
    assertEqual(result[0].id, '11');
    assertEqual(result[9].id, '20');
  });

  await test('append default maxRecords is 10000 — does not cap smaller arrays', async () => {
    writeRaw('history.json', JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({ id: String(i) }))
    ));
    await append('history.json', { id: '100' });
    assertEqual(read('history.json').length, 101);
  });

  await test('append is atomic — no .tmp file left behind', async () => {
    await append('schedules.json', { id: 's3' });
    assert(!exists('schedules.json.tmp'), '.tmp file should be gone after append');
  });

  await test('append throws on corrupt JSON in existing file', async () => {
    writeRaw('users.json', '{ bad json ');
    await assertRejects(() => append('users.json', { id: 'u1' }), /Corrupt JSON/);
  });

  // ── lock contention ────────────────────────────────────────────────────────

  await test('concurrent appends both land (lock prevents race condition)', async () => {
    writeRaw('history.json', '[]');
    // Fire both without awaiting — they compete for the lock
    await Promise.all([
      append('history.json', { id: 'concurrent-a' }),
      append('history.json', { id: 'concurrent-b' }),
    ]);
    const result = read('history.json');
    assertEqual(result.length, 2, 'Both records should be present');
    const ids = result.map(r => r.id).sort();
    assertDeepEqual(ids, ['concurrent-a', 'concurrent-b']);
  });

  await test('concurrent writes do not corrupt the file', async () => {
    await Promise.all([
      write('rules.json', [{ id: 'w-a', seq: 1 }]),
      write('rules.json', [{ id: 'w-b', seq: 2 }]),
    ]);
    // One writer wins; file must be valid JSON with exactly one record
    const result = read('rules.json');
    assertEqual(result.length, 1, 'File should have exactly one record (last writer wins)');
    assert(result[0].id === 'w-a' || result[0].id === 'w-b', 'Record should be from one of the writers');
  });

  await test('high-concurrency append — all 10 records land', async () => {
    writeRaw('profiles.json', '[]');
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => append('profiles.json', { id: `p${i}` }))
    );
    assertEqual(read('profiles.json').length, 10);
  });

  // ── Results ───────────────────────────────────────────────────────────────

  cleanup();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);

})();
