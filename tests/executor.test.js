'use strict';

// Run with: .\runtime\node.exe tests/executor.test.js
// Uses local temp paths only — no live SFTP required.

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');

// ── Temp directory setup ─────────────────────────────────────────────────────

const ROOT    = path.join(os.tmpdir(), `dm_exec_${crypto.randomBytes(4).toString('hex')}`);
const SRC_DIR = path.join(ROOT, 'source');
const DST1    = path.join(ROOT, 'dest1');
const DST2    = path.join(ROOT, 'dest2');
const DATA_DIR = path.join(ROOT, 'data');

for (const d of [SRC_DIR, DST1, DST2, DATA_DIR]) fs.mkdirSync(d, { recursive: true });

// Set up data + executor AFTER creating dirs so _setDataDir sees them
const { _setDataDir: setData } = require('../app/data');
const { copyFile, moveFile, deleteFile, listFiles, transferRule, _setDataDir } = require('../app/executor');
_setDataDir(DATA_DIR);  // points executor + data.js at DATA_DIR, cred file too

function cleanup() {
  fs.rmSync(ROOT, { recursive: true, force: true });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeFile(dir, name, content = 'hello') {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function writeProfiles(profiles) {
  fs.writeFileSync(
    path.join(DATA_DIR, 'profiles.json'),
    JSON.stringify(profiles, null, 2),
    'utf8'
  );
}

function makeLocalProfile(id, dirPath) {
  return { id, type: 'local', path: dirPath };
}

// An SFTP profile with no credentials.enc in DATA_DIR — getSftpClient will
// throw "Credentials file missing", giving us a real, mock-free error path.
function makeBadSftpProfile(id) {
  return { id, type: 'sftp', host: 'sftp.example.invalid', port: 22,
           username: 'test', credentialRef: 'test_cred', remotePath: '/dest/' };
}

function makeRule(overrides) {
  return Object.assign({
    id:           crypto.randomUUID(),
    name:         'Test Rule',
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    action:       'copy',
    postTransfer: 'leave',
    onError:      'continue',
    retryCount:   0,
  }, overrides);
}

// ── Test runner ───────────────────────────────────────────────────────────────

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

function assert(cond, msg)    { if (!cond)    throw new Error(msg || 'Assertion failed'); }
function assertEqual(a, b, m) { if (a !== b)  throw new Error(m  || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

async function assertRejects(fn, pattern) {
  try { await fn(); }
  catch (err) {
    if (pattern && !pattern.test(err.message))
      throw new Error(`Rejection "${err.message}" did not match ${pattern}`);
    return;
  }
  throw new Error('Expected a rejection but none was thrown');
}

// ── copyFile ─────────────────────────────────────────────────────────────────

(async () => {

console.log('\nexecutor.js tests\n');

await test('copyFile copies content to destination', async () => {
  const src  = writeFile(SRC_DIR, 'copy_basic.txt', 'content-abc');
  const dest = path.join(DST1, 'copy_basic.txt');
  await copyFile(src, dest);
  assertEqual(fs.readFileSync(dest, 'utf8'), 'content-abc');
});

await test('copyFile creates destination directory if missing', async () => {
  const src     = writeFile(SRC_DIR, 'copy_mkdir.txt', 'data');
  const destDir = path.join(DST1, 'nested', 'deep');
  const dest    = path.join(destDir, 'copy_mkdir.txt');
  await copyFile(src, dest);
  assert(fs.existsSync(dest), 'file should exist in new nested dir');
});

await test('copyFile leaves no .tmp file behind', async () => {
  const src  = writeFile(SRC_DIR, 'copy_tmp.txt', 'x');
  const dest = path.join(DST1, 'copy_tmp.txt');
  await copyFile(src, dest);
  assert(!fs.existsSync(dest + '.tmp'), '.tmp should be gone after copy');
});

await test('copyFile does not delete the source', async () => {
  const src  = writeFile(SRC_DIR, 'copy_src.txt', 'keep');
  const dest = path.join(DST1, 'copy_src.txt');
  await copyFile(src, dest);
  assert(fs.existsSync(src), 'source should still exist after copyFile');
});

// ── moveFile ──────────────────────────────────────────────────────────────────

await test('moveFile copies content and removes source', async () => {
  const src  = writeFile(SRC_DIR, 'move_basic.txt', 'move-me');
  const dest = path.join(DST1, 'move_basic.txt');
  await moveFile(src, dest);
  assertEqual(fs.readFileSync(dest, 'utf8'), 'move-me');
  assert(!fs.existsSync(src), 'source should be deleted after move');
});

await test('moveFile leaves no .tmp file behind', async () => {
  const src  = writeFile(SRC_DIR, 'move_tmp.txt', 'y');
  const dest = path.join(DST1, 'move_tmp.txt');
  await moveFile(src, dest);
  assert(!fs.existsSync(dest + '.tmp'), '.tmp should be gone after move');
});

await test('moveFile creates destination directory if missing', async () => {
  const src  = writeFile(SRC_DIR, 'move_mkdir.txt', 'z');
  const dest = path.join(DST1, 'sub', 'move_mkdir.txt');
  await moveFile(src, dest);
  assert(fs.existsSync(dest));
  assert(!fs.existsSync(src));
});

// ── deleteFile ────────────────────────────────────────────────────────────────

await test('deleteFile removes an existing file', async () => {
  const p = writeFile(SRC_DIR, 'del_existing.txt');
  await deleteFile(p);
  assert(!fs.existsSync(p), 'file should be gone');
});

await test('deleteFile does not throw for a missing file', async () => {
  await deleteFile(path.join(SRC_DIR, 'does_not_exist.txt'));
  // no throw = pass
});

// ── listFiles ─────────────────────────────────────────────────────────────────

await test('listFiles returns all files when no filter given', async () => {
  const dir = path.join(ROOT, 'list_all');
  fs.mkdirSync(dir, { recursive: true });
  writeFile(dir, 'a.txt');
  writeFile(dir, 'b.csv');
  writeFile(dir, 'c.log');
  const files = await listFiles(dir);
  assertEqual(files.length, 3);
});

await test('listFiles filters by *.txt', async () => {
  const dir = path.join(ROOT, 'list_txt');
  fs.mkdirSync(dir, { recursive: true });
  writeFile(dir, 'report.txt');
  writeFile(dir, 'data.csv');
  writeFile(dir, 'notes.txt');
  const files = await listFiles(dir, '*.txt');
  assertEqual(files.length, 2);
  assert(files.every(f => f.name.endsWith('.txt')), 'all results should be .txt');
});

await test('listFiles returns [] for missing directory', async () => {
  const files = await listFiles(path.join(ROOT, 'no_such_dir'));
  assertEqual(files.length, 0);
});

await test('listFiles returns [] for empty directory', async () => {
  const dir = path.join(ROOT, 'list_empty');
  fs.mkdirSync(dir, { recursive: true });
  assertEqual((await listFiles(dir)).length, 0);
});

await test('listFiles recursive **/*.csv finds files in subdirectories', async () => {
  const dir = path.join(ROOT, 'list_recursive');
  fs.mkdirSync(path.join(dir, 'sub', 'deep'), { recursive: true });
  writeFile(dir,                   'root.csv');
  writeFile(path.join(dir, 'sub'), 'nested.csv');
  writeFile(path.join(dir, 'sub', 'deep'), 'deep.csv');
  writeFile(dir,                   'ignore.txt');
  const files = await listFiles(dir, '**/*.csv');
  assertEqual(files.length, 3);
  assert(files.every(f => f.name.endsWith('.csv')));
});

await test('listFiles ** matches all files recursively', async () => {
  const dir = path.join(ROOT, 'list_all_recursive');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  writeFile(dir,                   'a.txt');
  writeFile(path.join(dir, 'sub'), 'b.csv');
  const files = await listFiles(dir, '**/*');
  assertEqual(files.length, 2);
});

await test('listFiles accepts a profile object with .path', async () => {
  const dir = path.join(ROOT, 'list_profile');
  fs.mkdirSync(dir, { recursive: true });
  writeFile(dir, 'f.txt');
  const profile = { type: 'local', path: dir };
  assertEqual((await listFiles(profile)).length, 1);
});

await test('listFiles result includes name, path, size fields', async () => {
  const dir  = path.join(ROOT, 'list_fields');
  fs.mkdirSync(dir, { recursive: true });
  writeFile(dir, 'sized.txt', '12345');
  const [f] = await listFiles(dir);
  assert(f.name === 'sized.txt', 'name should match');
  assert(fs.existsSync(f.path),  'path should be absolute and valid');
  assertEqual(f.size, 5,         'size should be byte count of content');
});

// ── transferRule — copy ───────────────────────────────────────────────────────

await test('transferRule copy: single destination receives file', async () => {
  const srcDir = path.join(ROOT, 'tr_copy_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_copy_dst'); fs.mkdirSync(dstDir, { recursive: true });
  writeFile(srcDir, 'report.csv', 'col1,col2\n1,2');
  writeProfiles([makeLocalProfile('src', srcDir), makeLocalProfile('dst1', dstDir)]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    action:       'copy',
  }));

  assertEqual(result.status, 'success');
  assertEqual(result.filesTransferred, 1);
  assert(fs.existsSync(path.join(dstDir, 'report.csv')), 'file should be in dest');
  assert(fs.existsSync(path.join(srcDir, 'report.csv')), 'source preserved for copy');
});

await test('transferRule copy: fan-out to two destinations', async () => {
  const srcDir = path.join(ROOT, 'tr_fanout_src'); fs.mkdirSync(srcDir, { recursive: true });
  const d1     = path.join(ROOT, 'tr_fanout_d1');  fs.mkdirSync(d1,     { recursive: true });
  const d2     = path.join(ROOT, 'tr_fanout_d2');  fs.mkdirSync(d2,     { recursive: true });
  writeFile(srcDir, 'fanout.txt');
  writeProfiles([
    makeLocalProfile('src', srcDir),
    makeLocalProfile('d1',  d1),
    makeLocalProfile('d2',  d2),
  ]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'd1', path: null }, { profileId: 'd2', path: null }],
  }));

  assertEqual(result.status, 'success');
  assert(fs.existsSync(path.join(d1, 'fanout.txt')), 'file in dest1');
  assert(fs.existsSync(path.join(d2, 'fanout.txt')), 'file in dest2');
});

await test('transferRule copy: multiple files all transferred', async () => {
  const srcDir = path.join(ROOT, 'tr_multi_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_multi_dst'); fs.mkdirSync(dstDir, { recursive: true });
  writeFile(srcDir, 'a.txt');
  writeFile(srcDir, 'b.txt');
  writeFile(srcDir, 'c.txt');
  writeProfiles([makeLocalProfile('src', srcDir), makeLocalProfile('dst1', dstDir)]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
  }));

  assertEqual(result.filesTransferred, 3);
  assertEqual(result.status, 'success');
});

// ── transferRule — move ───────────────────────────────────────────────────────

await test('transferRule move: source file deleted after successful transfer', async () => {
  const srcDir = path.join(ROOT, 'tr_move_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_move_dst'); fs.mkdirSync(dstDir, { recursive: true });
  const srcFile = writeFile(srcDir, 'moveme.txt', 'data');
  writeProfiles([makeLocalProfile('src', srcDir), makeLocalProfile('dst1', dstDir)]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    action:       'move',
  }));

  assertEqual(result.status, 'success');
  assert(fs.existsSync(path.join(dstDir, 'moveme.txt')), 'file should be in dest');
  assert(!fs.existsSync(srcFile), 'source should be deleted after move');
});

// ── transferRule — filter ─────────────────────────────────────────────────────

await test('transferRule filter: only matching files transferred', async () => {
  const srcDir = path.join(ROOT, 'tr_filter_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_filter_dst'); fs.mkdirSync(dstDir, { recursive: true });
  writeFile(srcDir, 'data.csv');
  writeFile(srcDir, 'data.txt');
  writeFile(srcDir, 'report.csv');
  writeProfiles([makeLocalProfile('src', srcDir), makeLocalProfile('dst1', dstDir)]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: '*.csv' },
    destinations: [{ profileId: 'dst1', path: null }],
  }));

  assertEqual(result.filesTransferred, 2, 'only 2 CSV files should transfer');
  assert( fs.existsSync(path.join(dstDir, 'data.csv')));
  assert( fs.existsSync(path.join(dstDir, 'report.csv')));
  assert(!fs.existsSync(path.join(dstDir, 'data.txt')), 'txt should not transfer');
});

// ── transferRule — postTransfer ───────────────────────────────────────────────

await test('transferRule postTransfer:delete removes source even on copy action', async () => {
  const srcDir = path.join(ROOT, 'tr_ptdel_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_ptdel_dst'); fs.mkdirSync(dstDir, { recursive: true });
  const srcFile = writeFile(srcDir, 'del.txt');
  writeProfiles([makeLocalProfile('src', srcDir), makeLocalProfile('dst1', dstDir)]);

  await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    action:       'copy',
    postTransfer: 'delete',
  }));

  assert(!fs.existsSync(srcFile), 'source should be deleted by postTransfer:delete');
  assert( fs.existsSync(path.join(dstDir, 'del.txt')), 'dest should still exist');
});

await test('transferRule postTransfer:archive moves source to _archive subdirectory', async () => {
  const srcDir = path.join(ROOT, 'tr_arch_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_arch_dst'); fs.mkdirSync(dstDir, { recursive: true });
  const srcFile = writeFile(srcDir, 'arch.txt');
  writeProfiles([makeLocalProfile('src', srcDir), makeLocalProfile('dst1', dstDir)]);

  await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
    action:       'copy',
    postTransfer: 'archive',
  }));

  assert(!fs.existsSync(srcFile), 'original source should be gone (archived)');
  assert(fs.existsSync(path.join(srcDir, '_archive', 'arch.txt')), 'file in _archive subdir');
  assert(fs.existsSync(path.join(dstDir, 'arch.txt')), 'dest still has the file');
});

// ── transferRule — error handling ─────────────────────────────────────────────

await test('transferRule onError:continue — bad dest does not block other dests', async () => {
  const srcDir = path.join(ROOT, 'tr_cont_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_cont_dst'); fs.mkdirSync(dstDir, { recursive: true });
  writeFile(srcDir, 'f1.txt');
  writeFile(srcDir, 'f2.txt');
  writeProfiles([
    makeLocalProfile('src', srcDir),
    makeLocalProfile('dst1', dstDir),
    makeBadSftpProfile('bad'),   // will throw "Credentials file missing"
  ]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }, { profileId: 'bad', path: null }],
    action:       'copy',
    onError:      'continue',
  }));

  // Both files attempted (onError:continue); good dest received them even though
  // bad dest failed.  Status is 'failed' because no file fully completed to ALL
  // destinations (filesTransferred = 0).
  assertEqual(result.status, 'failed', 'no file fully completed to all dests');
  assert(result.errors.length > 0, 'should have recorded errors');
  // The critical assertion: onError:continue means the good dest received the files
  assert(fs.existsSync(path.join(dstDir, 'f1.txt')), 'good dest still got f1');
  assert(fs.existsSync(path.join(dstDir, 'f2.txt')), 'good dest still got f2');
  assertEqual(result.files.length, 2, 'both files should appear in result (continue, not stop)');
});

await test('transferRule onError:stop — processing stops after first failing file', async () => {
  const srcDir = path.join(ROOT, 'tr_stop_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_stop_dst'); fs.mkdirSync(dstDir, { recursive: true });
  // Create 3 files — all will fail (only bad SFTP dest)
  writeFile(srcDir, 'a.txt');
  writeFile(srcDir, 'b.txt');
  writeFile(srcDir, 'c.txt');
  writeProfiles([
    makeLocalProfile('src', srcDir),
    makeBadSftpProfile('bad'),
  ]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'bad', path: null }],
    onError:      'stop',
  }));

  assertEqual(result.filesTransferred, 0, 'nothing should have transferred');
  assertEqual(result.files.length, 1, 'only first file attempted before stop');
  assertEqual(result.status, 'failed');
});

await test('transferRule — empty source directory returns success with 0 files', async () => {
  const srcDir = path.join(ROOT, 'tr_empty_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_empty_dst'); fs.mkdirSync(dstDir, { recursive: true });
  writeProfiles([makeLocalProfile('src', srcDir), makeLocalProfile('dst1', dstDir)]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
  }));

  assertEqual(result.status, 'success');
  assertEqual(result.filesTransferred, 0);
  assertEqual(result.files.length, 0);
});

await test('transferRule — unknown source profile returns failed status', async () => {
  writeProfiles([]);
  const result = await transferRule(makeRule({
    source: { profileId: 'does-not-exist', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
  })).catch(err => ({ status: 'failed', errors: [err.message], _threw: true }));
  // transferRule may throw or return failed — either is acceptable
  assert(result.status === 'failed' || result._threw, 'should report failure for missing profile');
});

await test('transferRule result has required jobResult fields', async () => {
  const srcDir = path.join(ROOT, 'tr_fields_src'); fs.mkdirSync(srcDir, { recursive: true });
  const dstDir = path.join(ROOT, 'tr_fields_dst'); fs.mkdirSync(dstDir, { recursive: true });
  writeFile(srcDir, 'x.txt');
  writeProfiles([makeLocalProfile('src', srcDir), makeLocalProfile('dst1', dstDir)]);

  const result = await transferRule(makeRule({
    source:       { profileId: 'src', path: null, filter: null },
    destinations: [{ profileId: 'dst1', path: null }],
  }));

  assert(result.id,        'id should be set');
  assert(result.ruleId,    'ruleId should be set');
  assert(result.startTime, 'startTime should be set');
  assert(result.endTime,   'endTime should be set');
  assert(result.endTime >= result.startTime, 'endTime should be >= startTime');
  assert(typeof result.filesTransferred === 'number', 'filesTransferred should be a number');
  assert(typeof result.bytesTransferred === 'number', 'bytesTransferred should be a number');
  assert(Array.isArray(result.files),  'files should be an array');
  assert(Array.isArray(result.errors), 'errors should be an array');
});

// ── Results ───────────────────────────────────────────────────────────────────

cleanup();
console.log(`
${passed} passed, ${failed} failed
`);
if (failed > 0) process.exit(1);

})();
