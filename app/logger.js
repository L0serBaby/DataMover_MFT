'use strict';

const path = require('path');
const fs   = require('fs');
const winston = require('winston');
require('winston-daily-rotate-file');

const LOG_DIR = path.join(__dirname, '../logs');
fs.mkdirSync(LOG_DIR, { recursive: true });

const DEFAULT_RETENTION_DAYS = 30;
const _configFile = path.join(__dirname, '../data/config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(_configFile, 'utf8'));
  } catch {
    return {};
  }
}

const retentionDays = loadConfig().LOG_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) =>
      `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [
    new winston.transports.DailyRotateFile({
      filename:      path.join(LOG_DIR, 'datamover-%DATE%.log'),
      datePattern:   'YYYY-MM-DD',
      maxFiles:      `${retentionDays}d`,
      zippedArchive: true,
    }),
    new winston.transports.Console(),
  ],
});

logger.LOG_DIR = LOG_DIR;

module.exports = logger;
