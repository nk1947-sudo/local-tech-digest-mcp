import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(__dirname, '..', '..', '..', 'data');
export const DB_PATH  = join(DATA_DIR, 'digest.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  applySchema(_db);
  return _db;
}

function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conferences (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      url         TEXT    NOT NULL,
      startDate   TEXT    NOT NULL,
      endDate     TEXT,
      city        TEXT    NOT NULL,
      state       TEXT,
      country     TEXT    NOT NULL DEFAULT 'USA',
      topics      TEXT    NOT NULL DEFAULT '[]',
      cfpDeadline TEXT,
      cfpUrl      TEXT,
      source      TEXT    NOT NULL,
      hash        TEXT    UNIQUE NOT NULL,
      firstSeen   TEXT    NOT NULL,
      notified    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_conf_start  ON conferences(startDate);
    CREATE INDEX IF NOT EXISTS idx_conf_hash   ON conferences(hash);
    CREATE INDEX IF NOT EXISTS idx_conf_notify ON conferences(notified);

    CREATE TABLE IF NOT EXISTS jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT    NOT NULL,
      title       TEXT    NOT NULL,
      company     TEXT    NOT NULL,
      url         TEXT    NOT NULL,
      apply_url   TEXT,
      location    TEXT,
      remote      INTEGER NOT NULL DEFAULT 0,
      job_type    TEXT    NOT NULL DEFAULT 'full-time',
      domain      TEXT    NOT NULL,
      tags        TEXT    NOT NULL DEFAULT '[]',
      description TEXT,
      date_posted TEXT,
      sponsorship TEXT,
      source      TEXT    NOT NULL,
      hash        TEXT    UNIQUE NOT NULL,
      score       INTEGER NOT NULL DEFAULT 0,
      first_seen  TEXT    NOT NULL,
      notified    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_hash   ON jobs(hash);
    CREATE INDEX IF NOT EXISTS idx_jobs_score  ON jobs(score);
    CREATE INDEX IF NOT EXISTS idx_jobs_notify ON jobs(notified);
    CREATE INDEX IF NOT EXISTS idx_jobs_domain ON jobs(domain);
    CREATE INDEX IF NOT EXISTS idx_jobs_type   ON jobs(job_type);
  `);
}
