'use strict';

// Runs every test file in this directory as its own process so one suite's
// failure can't hide the results of the suites after it (unlike `a && b && c`).

const { spawnSync } = require('child_process');
const path = require('path');

const FILES = [
  'crypto.test.js',
  'data.test.js',
  'auth.test.js',
  'api-auth.test.js',
  'executor.test.js',
  'pgp.test.js',
  'scheduler.test.js',
  'setup-tls.test.js',
  'migrate-credentials.test.js',
];

const results = FILES.map(file => {
  const fullPath = path.join(__dirname, file);
  console.log(`\n=== ${file} ===`);
  const { status } = spawnSync(process.execPath, [fullPath], { stdio: 'inherit' });
  return { file, status };
});

console.log('\n=== Summary ===');
let anyFailed = false;
for (const { file, status } of results) {
  const passed = status === 0;
  if (!passed) anyFailed = true;
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${file}${passed ? '' : ` (exit code ${status})`}`);
}

process.exit(anyFailed ? 1 : 0);
