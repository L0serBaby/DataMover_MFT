'use strict';

const cron   = require('node-cron');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const data   = require('./data');
const logger = require('./logger');
const pgp    = require('./pgp');

// Internal transferRule reference — replaced by _setTransferRule() in tests
let _transferRule = require('./executor').transferRule;

// ── Schedule timezone ───────────────────────────────────────────────────────
// Cron expressions are ambiguous without an explicit IANA timezone — node-cron
// (and cron-parser, see app/api/rules.js) silently fall back to whatever
// timezone the OS process happens to be running under if none is given. On a
// server whose system clock isn't in the same zone as the people setting
// schedules, "8am" in a rule fires at 8am server-time, not 8am for anyone
// looking at it. SCHEDULE_TIMEZONE in config.json (set via Settings) makes
// this explicit instead of implicit. Left unset, behavior is unchanged
// (system-local), so existing deployments aren't affected until an admin
// opts in.
const CONFIG_FILE = path.join(__dirname, '../data/config.json');
function _getScheduleTimezone() {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return cfg.SCHEDULE_TIMEZONE || undefined;
  } catch {
    return undefined;
  }
}

// ── Module state ──────────────────────────────────────────────────────────────

const _cronTasks = new Map();  // ruleId → ScheduledTask
const _running   = new Map();  // ruleId → Promise<jobResult>
let _shuttingDown    = false;
let _sigtermHandled  = false;

// ── Chain node execution ──────────────────────────────────────────────────────

async function _executeChainNode(node, parentRuleName) {
  // Backward-compat: plain string = rule ID
  if (typeof node === 'string') {
    logger.info(`[scheduler] Chain: triggering rule "${node}" after "${parentRuleName}"`);
    return _executeChainRule(node, parentRuleName);
  }

  switch (node.type) {
    case 'rule':
      return _executeChainRule(node.ruleId, parentRuleName);

    case 'pgp-decrypt': {
      logger.info(`[scheduler] Chain: PGP decrypt "${node.sourcePath}" after "${parentRuleName}"`);
      await pgp.decryptFile(
        node.sourcePath, node.outputPath, node.privateKeyId,
        { deleteSource: node.deleteSource }
      );
      break;
    }

    case 'pgp-encrypt': {
      logger.info(`[scheduler] Chain: PGP encrypt "${node.sourcePath}" after "${parentRuleName}"`);
      await pgp.encryptFile(
        node.sourcePath, node.outputPath, node.publicKeyIds || [],
        { sign: node.sign, signKeyId: node.signKeyId, deleteSource: node.deleteSource }
      );
      break;
    }

    default:
      logger.warn(`[scheduler] Unknown chain node type "${node.type}" — skipped`);
  }
}

async function _executeChainRule(ruleId, parentRuleName) {
  if (!ruleId) return;
  if (_shuttingDown) {
    logger.warn(`[scheduler] Chain rule skipped (shutting down) — ruleId=${ruleId} after "${parentRuleName}"`);
    return;
  }
  if (_running.has(ruleId)) {
    logger.warn(`[scheduler] Chain rule already running — ruleId=${ruleId}`);
    return;
  }
  const rule = data.read('rules.json').find(r => r.id === ruleId);
  if (!rule) {
    logger.warn(`[scheduler] Chain rule not found — ruleId=${ruleId}`);
    return;
  }
  return _executeJob(rule);
}

// ── Core job execution ────────────────────────────────────────────────────────

// Runs a rule, tracking it in _running for double-fire prevention.
// Callers are responsible for the "already running" / shutting-down guards.
// Always writes a history entry — even if _transferRule throws catastrophically.
function _executeJob(rule) {
  logger.info(`[scheduler] Job starting — "${rule.name}" (${rule.id})`);
  const _start = Date.now();
  const jobPromise = (async () => {
    let result;
    try {
      result = await _transferRule(rule);
    } catch (err) {
      logger.error(`[scheduler] Job failed — "${rule.name}": ${err.message}`);
      result = {
        id:               crypto.randomUUID(),
        ruleId:           rule.id,
        ruleName:         rule.name,
        startTime:        new Date(_start).toISOString(),
        endTime:          new Date().toISOString(),
        status:           'failed',
        filesTransferred: 0,
        bytesTransferred: 0,
        files:            [],
        errors:           [err.message],
      };
    } finally {
      _running.delete(rule.id);
    }

    try {
      await data.append('history.json', result, { maxRecords: 10_000 });
    } catch (appendErr) {
      logger.error(`[scheduler] History write failed for "${rule.name}": ${appendErr.message}`);
    }

    const dur = Date.now() - _start;
    const sub = result.subStatus === 'idle' ? ' (idle)' : '';
    logger.info(`[scheduler] Job complete — "${rule.name}" status=${result.status}${sub} files=${result.filesTransferred} bytes=${result.bytesTransferred} (${dur}ms)`);

    // ── Chain execution ───────────────────────────────────────────────
    const chainNodes = result.status === 'failed'
      ? (rule.chainOnFailure || [])
      : (rule.chainOnSuccess || []);

    for (const node of chainNodes) {
      await _executeChainNode(node, rule.name).catch(err => {
        logger.error(`[scheduler] Chain node failed after "${rule.name}": ${err.message}`);
      });
    }

    return result;
  })();

  _running.set(rule.id, jobPromise);
  return jobPromise;
}

// Called by cron ticks — skips silently if the rule is already in flight.
function _executeCron(rule) {
  if (_shuttingDown) return null;

  if (_running.has(rule.id)) {
    logger.warn(`[scheduler] "${rule.name}" already running — cron tick skipped`);
    return null;
  }

  return _executeJob(rule);
}

// ── Cron registration ─────────────────────────────────────────────────────────

function _registerCron(rule, cronExpr) {
  const tz   = _getScheduleTimezone();
  const opts = { scheduled: true };
  if (tz) opts.timezone = tz;

  const task = cron.schedule(cronExpr, () => {
    _executeCron(rule)?.catch(err => {
      logger.error(`[scheduler] Unhandled error in "${rule.name}": ${err.message}`);
    });
  }, opts);

  _cronTasks.set(rule.id, task);
  logger.info(`[scheduler] Cron registered — "${rule.name}" expr="${cronExpr}"${tz ? ` tz="${tz}"` : ' tz=system-local'}`);
}

function _cancelCron(ruleId) {
  const task = _cronTasks.get(ruleId);
  if (task) {
    task.stop();
    _cronTasks.delete(ruleId);
    logger.info(`[scheduler] Cron deregistered — ruleId=${ruleId}`);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Loads all enabled rules and registers their cron schedules.
 * Cancels any existing cron tasks first (safe to call multiple times).
 */
function reloadAll() {
  for (const [id] of _cronTasks) _cancelCron(id);

  const rules = data.read('rules.json');

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!rule.cron || rule.cron === 'manual') continue;

    if (!cron.validate(rule.cron)) {
      logger.warn(`[scheduler] "${rule.name}": invalid cron expression "${rule.cron}"`);
      continue;
    }

    _registerCron(rule, rule.cron);
  }

  logger.info(`[scheduler] Initialised — ${_cronTasks.size} rule(s) scheduled`);
}

/**
 * Cancels and re-registers a single rule's cron task.
 * Call after a rule is saved or its enabled flag is toggled.
 */
function reloadRule(ruleId) {
  _cancelCron(ruleId);

  const rule = data.read('rules.json').find(r => r.id === ruleId);
  if (!rule || !rule.enabled || !rule.cron || rule.cron === 'manual') return;

  if (!cron.validate(rule.cron)) {
    logger.warn(`[scheduler] "${rule.name}": invalid cron "${rule.cron}"`);
    return;
  }

  _registerCron(rule, rule.cron);
}

/**
 * Manually triggers a rule outside its cron schedule.
 * Throws if the rule is not found, the scheduler is shutting down,
 * or the rule is already running.
 */
async function runRule(ruleId) {
  const rule = data.read('rules.json').find(r => r.id === ruleId);
  if (!rule) throw new Error(`Rule not found: ${ruleId}`);
  if (_shuttingDown) throw new Error('Scheduler is shutting down');
  if (_running.has(ruleId)) throw new Error(`Rule "${rule.name}" is already running`);

  return _executeJob(rule);
}

/** Returns an array of ruleIds for jobs currently in flight. */
function getRunningJobs() {
  return [..._running.keys()];
}

/**
 * Graceful shutdown: stops all cron tasks, waits up to timeoutMs for
 * in-flight jobs to finish, then returns.
 */
async function shutdown(timeoutMs = 60_000) {
  _shuttingDown = true;

  for (const [id] of [..._cronTasks]) _cancelCron(id);

  const inFlight = [..._running.values()];
  if (inFlight.length === 0) return;

  logger.info(`[scheduler] Shutdown — waiting for ${inFlight.length} in-flight job(s) (max ${timeoutMs}ms)`);

  await Promise.race([
    Promise.allSettled(inFlight),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ]);

  if (_running.size > 0) {
    logger.warn(`[scheduler] Shutdown timeout — ${_running.size} job(s) did not finish`);
  }
}

/**
 * Initialises the scheduler: loads rules, registers crons, and arms the
 * SIGTERM handler (registered at most once per process lifetime).
 */
// SIGTERM is handled by server.js, which calls shutdown() directly.
function init() {
  reloadAll();
}

// ── Test helpers ──────────────────────────────────────────────────────────────

// Replace the transferRule implementation (for unit tests)
function _setTransferRule(fn) { _transferRule = fn; }

// Reset all mutable state between tests
function _reset() {
  for (const [id] of [..._cronTasks]) _cancelCron(id);
  _running.clear();
  _shuttingDown = false;
}

// Simulate a cron tick firing for a given ruleId (without real timer waits)
async function _testCronFire(ruleId) {
  const rule = data.read('rules.json').find(r => r.id === ruleId);
  if (!rule) throw new Error(`Rule not found: ${ruleId}`);
  return _executeCron(rule);
}

module.exports = {
  init, runRule, reloadRule, reloadAll, getRunningJobs, shutdown,
  _setTransferRule, _reset, _testCronFire,
};
