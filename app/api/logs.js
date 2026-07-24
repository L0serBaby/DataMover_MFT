'use strict';

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const { requireAuth } = require('../auth');

const LOG_DIR = path.join(__dirname, '../../logs');

router.use(requireAuth);

// Returns the path of the most-recent dated log file, or null if none exist.
function getCurrentLogFile() {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => /^datamover-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
      .reverse();
    return files.length ? path.join(LOG_DIR, files[0]) : null;
  } catch { return null; }
}

const TAIL_MAX_BYTES = 1 * 1024 * 1024; // read at most 1 MB from end of file

// GET /api/logs?lines=100
router.get('/', (req, res) => {
  const n = Math.min(parseInt(req.query.lines || '100', 10), 2000);
  const logFile = getCurrentLogFile();

  if (!logFile) return res.json({ lines: [], total: 0 });

  try {
    const stat = fs.statSync(logFile);
    const fileSize = stat.size;
    if (fileSize === 0) return res.json({ lines: [], total: 0 });

    const readBytes = Math.min(fileSize, TAIL_MAX_BYTES);
    const offset    = fileSize - readBytes;
    const buf       = Buffer.alloc(readBytes);
    const fd        = fs.openSync(logFile, 'r');
    try {
      fs.readSync(fd, buf, 0, readBytes, offset);
    } finally {
      fs.closeSync(fd);
    }

    let text = buf.toString('utf8');
    // Discard a partial first line when we started mid-file
    if (offset > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }

    const lines = text.split('\n').filter(l => l.trim().length > 0);
    res.json({ lines: lines.slice(-n), total: lines.length });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ lines: [], total: 0 });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
