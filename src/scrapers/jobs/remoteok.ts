import axios from 'axios';
import { createHash } from 'crypto';
import { upsertJob, type Job } from '../../db/jobs.js';
import { runPipeline, stripHtml } from '../../filters/jobs.js';
import { extractSalary } from '../../utils/salary.js';
import { withRetry } from '../../utils/retry.js';

interface RemoteOKEntry {
  slug?:        string;
  id?:          string | number;
  epoch?:       number;
  date?:        string;
  company?:     string;
  position?:    string;
  tags?:        string[];
  description?: string;
  url?:         string;
  apply_url?:   string;
  salary_min?:  number;
  salary_max?:  number;
  legal?:       string;
}

export async function scrapeRemoteOK(): Promise<{ added: number; skipped: number; excluded: number }> {
  let added = 0, skipped = 0, excluded = 0;
  const now = new Date().toISOString();

  let entries: RemoteOKEntry[];
  try {
    const { data } = await withRetry(
      () => axios.get<RemoteOKEntry[]>('https://remoteok.com/api', {
        timeout: 15_000,
        headers: { 'User-Agent': 'tech-digest-mcp/2.0', Accept: 'application/json' },
      }),
      { label: 'remoteok' },
    );
    entries = Array.isArray(data) ? data.slice(1) : [];
  } catch {
    return { added, skipped, excluded };
  }

  for (const entry of entries) {
    if (!entry.position || !entry.url) continue;

    const title = entry.position.replace(/['"\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) continue;

    const rawDesc = stripHtml(entry.description ?? '');
    const tags    = entry.tags ?? [];
    const dateStr = entry.date
      ? new Date(entry.date).toISOString().slice(0, 10)
      : entry.epoch
        ? new Date(entry.epoch * 1000).toISOString().slice(0, 10)
        : null;

    const result = runPipeline({
      title,
      description: rawDesc,
      tags,
      company:     entry.company ?? '',
      datePosted:  dateStr,
    });
    if (!result.accepted) { excluded++; continue; }

    const sal = {
      min: entry.salary_min ?? extractSalary(rawDesc).min,
      max: entry.salary_max ?? extractSalary(rawDesc).max,
    };

    const hash = createHash('md5')
      .update(`${title}|${entry.company ?? ''}|${entry.url}`)
      .digest('hex');

    const job: Job = {
      external_id: String(entry.id ?? entry.slug ?? hash),
      title,
      company:     entry.company ?? 'Unknown',
      url:         entry.url,
      apply_url:   entry.apply_url ?? entry.url,
      location:    'Remote',
      remote:      1,
      job_type:    'full-time',
      domain:      result.domain!,
      tags,
      description: rawDesc.slice(0, 2000),
      date_posted: dateStr,
      sponsorship: null,
      source:      'remoteok',
      hash,
      score:       result.score,
      first_seen:  now,
      salary_min:  sal.min,
      salary_max:  sal.max,
    };

    if (upsertJob(job)) added++;
    else skipped++;
  }

  return { added, skipped, excluded };
}
