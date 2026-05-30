import { getDb } from './schema.js';

export interface Job {
  external_id: string;
  title:       string;
  company:     string;
  url:         string;
  apply_url:   string | null;
  location:    string | null;
  remote:      number;           // 0 | 1
  job_type:    string;           // 'full-time' | 'internship'
  domain:      string;
  tags:        string[];
  description: string | null;
  date_posted: string | null;
  sponsorship: string | null;
  source:      string;
  hash:        string;
  score:       number;
  first_seen:  string;
}

export interface JobRow {
  id:          number;
  external_id: string;
  title:       string;
  company:     string;
  url:         string;
  apply_url:   string | null;
  location:    string | null;
  remote:      number;
  job_type:    string;
  domain:      string;
  tags:        string;           // JSON string
  description: string | null;
  date_posted: string | null;
  sponsorship: string | null;
  source:      string;
  hash:        string;
  score:       number;
  first_seen:  string;
  notified:    number;
}

export function upsertJob(job: Job): boolean {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM jobs WHERE hash = ?').get(job.hash)) return false;
  db.prepare(`
    INSERT INTO jobs
      (external_id, title, company, url, apply_url, location, remote, job_type,
       domain, tags, description, date_posted, sponsorship, source, hash, score, first_seen, notified)
    VALUES
      (@external_id, @title, @company, @url, @apply_url, @location, @remote, @job_type,
       @domain, @tags, @description, @date_posted, @sponsorship, @source, @hash, @score, @first_seen, 0)
  `).run({ ...job, tags: JSON.stringify(job.tags) });
  return true;
}

export function getUnnotifiedJobs(minScore = 0): JobRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM jobs
    WHERE  notified = 0 AND score >= ?
    ORDER  BY score DESC, domain ASC, date_posted DESC
  `).all(minScore) as JobRow[];
}

export function getTopJobs(limit = 20, minScore = 0): JobRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM jobs WHERE score >= ?
    ORDER  BY score DESC, first_seen DESC
    LIMIT  ?
  `).all(minScore, limit) as JobRow[];
}

export function searchJobs(query: string): JobRow[] {
  const db = getDb();
  const q  = `%${query.toLowerCase()}%`;
  return db.prepare(`
    SELECT * FROM jobs
    WHERE  lower(title) LIKE ? OR lower(company) LIKE ?
        OR lower(tags)  LIKE ? OR lower(domain)  LIKE ?
    ORDER  BY score DESC, date_posted DESC
    LIMIT  100
  `).all(q, q, q, q) as JobRow[];
}

export function filterJobs(opts: {
  domain?:    string;
  job_type?:  string;
  min_score?: number;
  limit?:     number;
}): JobRow[] {
  const db      = getDb();
  const clauses = ['1=1'];
  const params: (string | number)[] = [];

  if (opts.domain)    { clauses.push('lower(domain) LIKE ?');  params.push(`%${opts.domain.toLowerCase()}%`); }
  if (opts.job_type)  { clauses.push('job_type = ?');          params.push(opts.job_type); }
  if (opts.min_score !== undefined) { clauses.push('score >= ?'); params.push(opts.min_score); }
  params.push(opts.limit ?? 50);

  return db.prepare(`
    SELECT * FROM jobs WHERE ${clauses.join(' AND ')}
    ORDER  BY score DESC, date_posted DESC
    LIMIT  ?
  `).all(...params) as JobRow[];
}

export function markJobsNotified(ids: number[]): void {
  if (!ids.length) return;
  const db   = getDb();
  const stmt = db.prepare('UPDATE jobs SET notified = 1 WHERE id = ?');
  db.transaction(() => ids.forEach(id => stmt.run(id)))();
}

export function jobStats(): Record<string, number> {
  const db = getDb();
  const n  = (q: string) => (db.prepare(q).get() as { n: number }).n;
  return {
    total:       n('SELECT COUNT(*) AS n FROM jobs'),
    pending:     n('SELECT COUNT(*) AS n FROM jobs WHERE notified = 0'),
    internships: n("SELECT COUNT(*) AS n FROM jobs WHERE job_type = 'internship'"),
    fullTime:    n("SELECT COUNT(*) AS n FROM jobs WHERE job_type = 'full-time'"),
    highScore:   n('SELECT COUNT(*) AS n FROM jobs WHERE score >= 6'),
  };
}
