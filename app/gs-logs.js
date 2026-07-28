'use strict';

const path = require('path');
const fs   = require('fs');
const data = require('./data');

// Cache: absolute file path -> { mtimeMs, size, records }
const _cache = new Map();

// ── Log line parsing (ported from sftp-log-explorer.html) ────────────────────

function xPartner(p) {
  if (!p) return '';
  const norm = p.replace(/\//g, '\\');
  const pats = [
    /\\Usr\\Agents\\ag_[^\\]+\\([^\\]+)\\/i,
    /\\Usr\\([^\\]+)\\/i, /\\CarrierFeeds\\([^\\]+)/i, /\\AffiliateData\\([^\\]+)/i,
    /\\DWFeeds\\([^\\]+)/i, /\\FTP\\([^\\]+)/i, /\\Saybrus FTP\\([^\\]+)/i,
    /\\MA_PDP_Dept\\([^\\]+)/i, /\\VenKan_Data\\FTP\\([^\\]+)/i, /\\Inter_Dept\\([^\\]+)/i,
    /\\CoreFTP\\([^\\]+)/i, /\\(MutualComm)\\/i, /\\(mulesoft)\\/i,
    /\\(FirelightDistribution)\\/i, /\\(CRM_RME)\\/i,
  ];
  const skip = new Set(['prod','archive','inbound','outbound','staging','sent','decrypted','DONE','Received','PROD','MCSG']);
  for (const pat of pats) {
    const m = norm.match(pat);
    if (m && !skip.has(m[1])) return m[1];
  }
  const fb = norm.match(/(?:\.alg\.local|\.ALG\.LOCAL|\.algtest\.local)\\([^\\]+?)\\(?:decrypted|inbound|outbound|staging)/i);
  if (fb && !/^[a-z]\$$/i.test(fb[1]) && !/^(Import|Data|data)$/i.test(fb[1])) return fb[1];
  return '';
}

function xFilename(p) {
  if (!p) return '';
  const s = p.replace(/\//g, '\\').split('\\');
  return s[s.length - 1] || '';
}

function deriveSrv(fn) {
  const m = fn.match(/^(FTP-\d+|SFTP-\d+|[A-Za-z0-9_-]+?)_/i);
  return m ? m[1] : fn.replace(/\.[^.]+$/, '');
}

function parseLine(line, srv) {
  line = line.replace(/^﻿/, '').trim();
  if (!line) return null;
  const p = line.split(';').map(s => s.trim());
  if (p.length < 9) return null;
  const [ts, proto, host, port, user, src, dst, act, sz] = p;
  const partner = xPartner(src) || xPartner(dst);
  let fn = xFilename(src);
  if (!fn || fn === '*') { const a = xFilename(dst); if (a && a !== '*') fn = a; }
  return {
    timestamp:  ts,
    protocol:   proto.toLowerCase(),
    host:       host || '',
    port:       port || '',
    user:       user || '',
    sourcePath: src || '',
    destPath:   dst || '',
    action:     act.toLowerCase(),
    size:       parseInt(sz) || 0,
    partner:    partner || '',
    filename:   fn || '',
    server:     srv,
  };
}

// ── File reading ───────────────────────────────────────────────────────────────

function readLogFile(filePath) {
  const buf = fs.readFileSync(filePath);
  const isUtf16 = buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE;
  return buf.toString(isUtf16 ? 'utf16le' : 'utf8');
}

// ── Directory resolution (same path.win32 conventions as executor.js) ────────

function resolveDir(profile, subPath) {
  const base = profile.path || '';
  if (!subPath) return path.win32.normalize(base || '.');
  if (path.win32.isAbsolute(subPath) || subPath.startsWith('\\\\')) {
    return path.win32.normalize(subPath);
  }
  const resolved   = path.win32.normalize(path.win32.join(base, subPath));
  const normalBase = path.win32.normalize(base || '.');
  if (base && !resolved.startsWith(normalBase + path.win32.sep) && resolved !== normalBase) {
    throw new Error(`Path traversal rejected: "${subPath}" escapes profile base "${base}"`);
  }
  return resolved;
}

// ── Records (cached per file, keyed by absolute path) ─────────────────────────

function getRecords(profileId, subPath) {
  const profiles = data.read('profiles.json');
  const profile  = profiles.find(p => p.id === profileId);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);

  const dir = resolveDir(profile, subPath);

  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && /\.(log|txt|csv)$/i.test(e.name));

  const seenPaths = new Set();
  const allRecords = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry.name);
    seenPaths.add(filePath);

    const stat   = fs.statSync(filePath);
    const cached = _cache.get(filePath);

    let records;
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      records = cached.records;
    } else {
      const srv = deriveSrv(entry.name);
      const text = readLogFile(filePath);
      records = [];
      for (const line of text.split('\n')) {
        const rec = parseLine(line, srv);
        if (rec) records.push(rec);
      }
      _cache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, records });
    }

    allRecords.push(...records);
  }

  // Evict cache entries for files no longer present in this directory
  // (e.g. rotated out by the cleanup rule).
  for (const cachedPath of _cache.keys()) {
    if (path.dirname(cachedPath) === dir && !seenPaths.has(cachedPath)) {
      _cache.delete(cachedPath);
    }
  }

  allRecords.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return allRecords;
}

module.exports = { getRecords };
