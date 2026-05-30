import { getDb } from './schema.js';

export interface Job {
  external_id: string;
  title:       string;
  company:     string;
  url:         string;
  apply_url:   string | null;
  location:    string | null;
  remote:      number;
  job_type:    string;
  domain:      string;
  tags:        string[];
  description: string | null;
  date_posted: string | null;
  sponsorship: string | null;
  source:      string;
  hash:        string;
  score:       number;
  first_seen:  string;
  salary_min:  number | null;
  salary_max:  number | null;
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
  tags:        string;        // JSON string
  description: string | null;
  date_posted: string | null;
  sponsorship: string | null;
  source:      string;
  hash:        string;
  score:       number;
  first_seen:  string;
  notified:    number;
  salary_min:  number | null;
  salary_max:  number | null;
  status:      string;        // new|saved|applied|interviewing|rejected|offer
}

export const JOB_STATUSES = ['new', 'saved', 'applied', 'interviewing', 'rejected', 'offer'] as const;
export type JobStatus = typeof JOB_STATUSES[number];

// ─── write ───────────────────────────────────────────────────────────────────

export function upsertJob(job: Job): boolean {
  const db = getDb();
  if (db.prepare('SELECT 1 FROM jobs WHERE hash = ?').get(job.hash)) return false;
  db.prepare(`
    INSERT INTO jobs
      (external_id, title, company, url, apply_url, location, remote, job_type,
       domain, tags, description, date_posted, sponsorship, source, hash, score,
       first_seen, notified, salary_min, salary_max, status)
    VALUES
      (@external_id, @title, @company, @url, @apply_url, @location, @remote, @job_type,
       @domain, @tags, @description, @date_posted, @sponsorship, @source, @hash, @score,
       @first_seen, 0, @salary_min, @salary_max, 'new')
  `).run({ ...job, tags: JSON.stringify(job.tags) });
  return true;
}

export function markJobsNotified(ids: number[]): void {
  if (!ids.length) return;
  const db   = getDb();
  const stmt = db.prepare('UPDATE jobs SET notified = 1 WHERE id = ?');
  db.transaction(() => ids.forEach(id => stmt.run(id)))();
}

export function setJobStatus(id: number, status: JobStatus): boolean {
  const db = getDb();
  const r  = db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id);
  return r.changes > 0;
}

// ─── read ────────────────────────────────────────────────────────────────────

export function getUnnotifiedJobs(minScore = 0): JobRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM jobs WHERE notified = 0 AND score >= ?
    ORDER BY score DESC, domain ASC, date_posted DESC
  `).all(minScore) as JobRow[];
}

export function getTopJobs(limit = 20, minScore = 0): JobRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM jobs WHERE score >= ?
    ORDER BY score DESC, first_seen DESC LIMIT ?
  `).all(minScore, limit) as JobRow[];
}

export function getPipeline(): Record<JobStatus, JobRow[]> {
  const db     = getDb();
  const result = {} as Record<JobStatus, JobRow[]>;
  for (const status of JOB_STATUSES) {
    result[status] = db.prepare(
      'SELECT * FROM jobs WHERE status = ? ORDER BY score DESC, date_posted DESC LIMIT 50',
    ).all(status) as JobRow[];
  }
  return result;
}

export function searchJobs(query: string): JobRow[] {
  const db = getDb();
  const q  = `%${query.toLowerCase()}%`;
  return db.prepare(`
    SELECT * FROM jobs
    WHERE  lower(title) LIKE ? OR lower(company) LIKE ?
        OR lower(tags)  LIKE ? OR lower(domain)  LIKE ?
    ORDER  BY score DESC, date_posted DESC LIMIT 100
  `).all(q, q, q, q) as JobRow[];
}

export function filterJobs(opts: {
  domain?:    string;
  job_type?:  string;
  min_score?: number;
  status?:    string;
  limit?:     number;
}): JobRow[] {
  const db      = getDb();
  const clauses = ['1=1'];
  const params: (string | number)[] = [];
  if (opts.domain)    { clauses.push('lower(domain) LIKE ?');  params.push(`%${opts.domain.toLowerCase()}%`); }
  if (opts.job_type)  { clauses.push('job_type = ?');          params.push(opts.job_type); }
  if (opts.status)    { clauses.push('status = ?');            params.push(opts.status); }
  if (opts.min_score !== undefined) { clauses.push('score >= ?'); params.push(opts.min_score); }
  params.push(opts.limit ?? 50);
  return db.prepare(`
    SELECT * FROM jobs WHERE ${clauses.join(' AND ')}
    ORDER BY score DESC, date_posted DESC LIMIT ?
  `).all(...params) as JobRow[];
}

/** Return top tech terms appearing in tags + descriptions — for skill suggestions. */
export function getFrequentTechTerms(limit = 15): { term: string; count: number }[] {
  const db   = getDb();
  const rows = db.prepare(
    'SELECT tags, description FROM jobs ORDER BY score DESC, first_seen DESC LIMIT 300',
  ).all() as { tags: string; description: string | null }[];

  const TECH_TERMS = [
    'react', 'typescript', 'javascript', 'node.js', 'django', 'flask', 'fastapi', 'vue', 'angular',
    'kubernetes', 'k8s', 'terraform', 'ansible', 'helm', 'argocd', 'jenkins', 'github actions',
    'go', 'golang', 'rust', 'java', 'ruby', 'php', 'scala',
    'postgresql', 'mysql', 'sql', 'mongodb', 'redis', 'elasticsearch', 'cassandra',
    'grafana', 'prometheus', 'datadog', 'elk', 'splunk',
    'burp suite', 'metasploit', 'wireshark', 'nmap', 'owasp', 'snort',
    'azure', 'gcp', 'google cloud',
  ];
  // User's existing stack — excluded from suggestions
  const KNOWN = new Set(['python', 'bash', 'linux', 'debian', 'ubuntu', 'aws', 'security', 'vulnerability', 'git', 'networking', 'docker']);

  const freq = new Map<string, number>();
  for (const row of rows) {
    const text = `${row.tags} ${row.description ?? ''}`.toLowerCase();
    for (const term of TECH_TERMS) {
      if (text.includes(term.toLowerCase()) && !KNOWN.has(term.toLowerCase())) {
        freq.set(term, (freq.get(term) ?? 0) + 1);
      }
    }
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
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
    applied:     n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'applied'"),
    saved:       n("SELECT COUNT(*) AS n FROM jobs WHERE status = 'saved'"),
    withSalary:  n('SELECT COUNT(*) AS n FROM jobs WHERE salary_min IS NOT NULL'),
  };
}
