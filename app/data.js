'use strict';

const path = require('path');
const fs = require('fs');
const lockfile = require('proper-lockfile');
const { renameWithRetry } = require('./fs-utils');

let DATA_DIR = path.join(__dirname, '../data');

const DEFAULTS = {
  'profiles.json':  [],
  'rules.json':     [],
  'schedules.json': [],
  'history.json':   [],
  'users.json':     [],
  'groups.json':    [],
  'pgp-keys.json':  [],
  'ssh-keys.json':  [],
};

const MANAGED = new Set(Object.keys(DEFAULTS));

function resolvedPath(filename) {
  if (!MANAGED.has(filename)) throw new Error(`Unrecognized data file: ${filename}`);
  return path.join(DATA_DIR, filename);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Reads a managed JSON file synchronously.
 * Returns the file's parsed contents, or the default empty value if the file
 * does not exist.  Throws on JSON parse errors (corrupt file).
 */
function read(filename) {
  const file = resolvedPath(filename);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return JSON.parse(JSON.stringify(DEFAULTS[filename]));
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Corrupt JSON in ${filename}: ${err.message}`);
  }
}

/**
 * Atomically writes data to a managed JSON file.
 * Acquires a file-level lock, writes to a .tmp file, then renames into place.
 */
async function write(filename, data) {
  const file = resolvedPath(filename);
  await withLock(file, () => atomicWrite(file, data));
}

/**
 * Appends a single record to a managed JSON array file.
 * Options:
 *   maxRecords {number} — cap on total records; oldest are dropped (default 10000)
 * Acquires a file-level lock for the entire read-modify-write cycle.
 */
async function append(filename, record, options = {}) {
  const maxRecords = options.maxRecords ?? 10_000;
  const file = resolvedPath(filename);

  await withLock(file, () => {
    let records;
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') raw = null;
      else throw err;
    }

    if (raw === null) {
      records = [];
    } else {
      try {
        records = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Corrupt JSON in ${filename}: ${err.message}`);
      }
    }

    records.push(record);

    if (records.length > maxRecords) {
      records = records.slice(records.length - maxRecords);
    }

    atomicWrite(file, records);
  });
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameWithRetry(tmp, file);
}

// Per-file in-process queue. Serialises callers within this process so that
// proper-lockfile never sees competing acquisition attempts from the same PID —
// it only needs to guard against *other* processes (e.g. a second service
// instance or a manual admin script).
const _queue = new Map();

async function withLock(file, fn) {
  const prev = _queue.get(file) ?? Promise.resolve();

  const current = prev.then(async () => {
    // realpath:false lets proper-lockfile lock paths that don't exist on disk yet
    const release = await lockfile.lock(file, {
      realpath: false,
      stale: 10_000,
      retries: { retries: 5, minTimeout: 100, maxTimeout: 1_000 },
    });
    try {
      fn(); // all work inside the lock is synchronous
    } finally {
      await release();
    }
  });

  // Keep the chain alive for the next waiter; swallow errors so one failure
  // does not block the queue permanently.
  _queue.set(file, current.catch(() => {}));

  return current;
}

// Test helper — redirects DATA_DIR to a temp location; never call in production
function _setDataDir(dir) {
  DATA_DIR = dir;
}

module.exports = { read, write, append, _setDataDir };
