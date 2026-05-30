import axios from 'axios';
import { createHash } from 'crypto';
import { upsertJob, type Job } from '../../db/jobs.js';
import { runPipeline, stripHtml } from '../../filters/jobs.js';

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
  legal?:       string;   // metadata row marker
}

export async function scrapeRemoteOK(): Promise<{ added: number; skipped: number; excluded: number }> {
  let added = 0, skipped = 0, excluded = 0;
  const now = new Date().toISOString();

  let entries: RemoteOKEntry[];
  try {
    const { data } = await axios.get<RemoteOKEntry[]>('https://remoteok.com/api', {
      timeout: 15_000,
      headers: {
        'User-Agent': 'tech-digest-mcp/1.0',
        'Accept':     'application/json',
      },
    });
    // first element is always a legal/metadata object
    entries = Array.isArray(data) ? data.slice(1) : [];
  } catch {
    return { added, skipped, excluded };
  }

  for (const entry of entries) {
    if (!entry.position || !entry.url) continue;

    // Sanitize title — RemoteOK occasionally has mangled data with SQL fragments
    const title = entry.position
      .replace(/['"\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    if (!title) continue;

    const rawDesc = stripHtml(entry.description ?? '');
    const tags    = entry.tags ?? [];
    const result  = runPipeline({ title, description: rawDesc, tags });
    if (!result.accepted) { excluded++; continue; }

    const dateStr = entry.date
      ? new Date(entry.date).toISOString().slice(0, 10)
      : entry.epoch
        ? new Date(entry.epoch * 1000).toISOString().slice(0, 10)
        : null;

    const hash = createHash('md5')
      .update(`${entry.position}|${entry.company ?? ''}|${entry.url}`)
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
    };

    if (upsertJob(job)) added++;
    else skipped++;
  }

  return { added, skipped, excluded };
}
