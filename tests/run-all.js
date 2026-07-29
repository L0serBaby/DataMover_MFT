'use strict';

// Runs every test file in this directory as its own process so one suite's
// failure can't hide the results of the suites after it (unlike `a && b && c`).

const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');

const FILES = [
  'crypto.test.js',
  'data.test.js',
  'auth.test.js',
  'api-auth.test.js',
  'executor.test.js',
  'azure-blob.test.js',
  'azure-blob-transfer.test.js',
  'azure-blob-archive.test.js',
  'azure-blob-expiry.test.js',
  'pgp.test.js',
  'scheduler.test.js',
  'setup-tls.test.js',
  'migrate-credentials.test.js',
];

// ── Real data/ directory tripwire ────────────────────────────────────────────
// Every test file is expected to redirect its data dir / master-key path /
// credentials path into a temp sandbox via the module's own _set* seams. A
// forgotten seam has twice this session caused a test to read or write the
// real project's data/ directory (real master.key generated; real
// credentials.enc would have been read). Rather than re-auditing every test
// file by hand whenever a new _set*-able path is added to a module, snapshot
// the real data/ directory before and after the full run and fail loudly if
// anything moved — regardless of whether the suites themselves passed.

const REAL_DATA_DIR = path.join(__dirname, '..', 'data');

function snapshotDataDir(dir) {
  const snap = new Map();
  (function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        snap.set(full, fs.statSync(full).mtimeMs);
      }
    }
  })(dir);
  return snap;
}

function diffDataDirSnapshots(before, after) {
  const changes = [];
  for (const [file, mtime] of after) {
    if (!before.has(file)) changes.push(`created:  ${file}`);
    else if (before.get(file) !== mtime) changes.push(`modified: ${file}`);
  }
  for (const file of before.keys()) {
    if (!after.has(file)) changes.push(`deleted:  ${file}`);
  }
  return changes;
}

const dataDirBefore = snapshotDataDir(REAL_DATA_DIR);

const results = FILES.map(file => {
  const fullPath = path.join(__dirname, file);
  console.log(`\n=== ${file} ===`);
  const { status } = spawnSync(process.execPath, [fullPath], { stdio: 'inherit' });
  return { file, status };
});

const dataDirAfter = snapshotDataDir(REAL_DATA_DIR);
const dataDirChanges = diffDataDirSnapshots(dataDirBefore, dataDirAfter);

console.log('\n=== Summary ===');
let anyFailed = false;
for (const { file, status } of results) {
  const passed = status === 0;
  if (!passed) anyFailed = true;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${file}${passed ? '' : ` (exit code ${status})`}`);
}

if (dataDirChanges.length > 0) {
  anyFailed = true;
  console.log(`\n  FAIL  real data/ directory was touched during the run (missing a _set* seam somewhere):`);
  for (const change of dataDirChanges) console.log(`        ${change}`);
} else {
  console.log(`  PASS  real data/ directory untouched`);
}

process.exit(anyFailed ? 1 : 0);
