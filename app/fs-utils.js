'use strict';

const fs = require('fs');

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Windows Defender / search indexing can transiently hold a lock on a
// just-written file for a few milliseconds, making rename() fail with
// EPERM/EBUSY/EACCES even when nothing in-process is racing for the same
// path. This is a real, known OS-level transient condition — retry with a
// short backoff rather than failing the write outright. Any other error
// (including a genuine permissions problem) is rethrown immediately.
function renameWithRetry(tmpFile, destFile) {
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      fs.renameSync(tmpFile, destFile);
      return;
    } catch (err) {
      const transient = err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES';
      if (!transient || attempt === MAX_ATTEMPTS) throw err;
      sleepSync(20 * attempt);
    }
  }
}

module.exports = { renameWithRetry };
