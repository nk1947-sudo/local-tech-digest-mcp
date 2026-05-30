import { createHash } from 'crypto';
import { getDb } from './schema.js';

export interface Conference {
  name:        string;
  url:         string;
  startDate:   string;
  endDate:     string | null;
  city:        string;
  state:       string | null;
  country:     string;
  topics:      string[];
  cfpDeadline: string | null;
  cfpUrl:      string | null;
  source:      string;
  hash:        string;
  firstSeen:   string;
}

export interface ConferenceRow {
  id:          number;
  name:        string;
  url:         string;
  startDate:   string;
  endDate:     string | null;
  city:        string;
  state:       string | null;
  country:     string;
  topics:      string;          // JSON string[]
  cfpDeadline: string | null;
  cfpUrl:      string | null;
  source:      string;
  hash:        string;
  firstSeen:   string;
  notified:    number;
}

export function makeConfHash(name: string, startDate: string, city: string): string {
  return createHash('md5').update(`${name}|${startDate}|${city}`).digest('hex');
}

export function upsertConference(conf: Conference): boolean {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM conferences WHERE hash = ?').get(conf.hash)) return false;
  db.prepare(`
    INSERT INTO conferences
      (name, url, startDate, endDate, city, state, country, topics,
       cfpDeadline, cfpUrl, source, hash, firstSeen, notified)
    VALUES
      (@name, @url, @startDate, @endDate, @city, @state, @country, @topics,
       @cfpDeadline, @cfpUrl, @source, @hash, @firstSeen, 0)
  `).run({ ...conf, topics: JSON.stringify(conf.topics) });
  return true;
}

export function getUnnotifiedConferences(): ConferenceRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM conferences WHERE notified = 0 AND startDate >= ? ORDER BY startDate ASC'
  ).all(todayStr()) as ConferenceRow[];
}

export function getUpcomingConferences(days = 60): ConferenceRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM conferences WHERE startDate >= ? AND startDate <= ? ORDER BY startDate ASC'
  ).all(todayStr(), offsetDate(days)) as ConferenceRow[];
}

export function searchConferences(query: string): ConferenceRow[] {
  const db = getDb();
  const q  = `%${query.toLowerCase()}%`;
  return db.prepare(`
    SELECT * FROM conferences
    WHERE  lower(name) LIKE ? OR lower(city) LIKE ? OR lower(topics) LIKE ?
    ORDER  BY startDate ASC
  `).all(q, q, q) as ConferenceRow[];
}

export function markConferencesNotified(ids: number[]): void {
  if (!ids.length) return;
  const db   = getDb();
  const stmt = db.prepare('UPDATE conferences SET notified = 1 WHERE id = ?');
  db.transaction(() => ids.forEach(id => stmt.run(id)))();
}

export function confStats(): Record<string, number> {
  const db = getDb();
  const n  = (q: string) => (db.prepare(q).get() as { n: number }).n;
  return {
    total:    n('SELECT COUNT(*) AS n FROM conferences'),
    upcoming: n(`SELECT COUNT(*) AS n FROM conferences WHERE startDate >= date('now')`),
    pending:  n(`SELECT COUNT(*) AS n FROM conferences WHERE notified = 0 AND startDate >= date('now')`),
  };
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function offsetDate(days: number) { return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10); }
