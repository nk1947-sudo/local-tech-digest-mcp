import axios from 'axios';
import { createHash } from 'crypto';
import { upsertJob, type Job } from '../../db/jobs.js';
import { runPipeline, stripHtml } from '../../filters/jobs.js';
import { extractSalary } from '../../utils/salary.js';
import { withRetry } from '../../utils/retry.js';

const BASE = 'https://www.arbeitnow.com/api/job-board-api';

interface ArbeitnowEntry {
  slug:         string;
  title:        string;
  company_name: string;
  location:     string;
  remote:       boolean;
  tags:         string[];
  job_types:    string[];
  description:  string;
  created_at:   number;
  url:          string;
}

interface ArbeitnowResponse {
  data: ArbeitnowEntry[];
  meta: { current_page: number; last_page: number };
}

export async function scrapeArbeitnow(): Promise<{ added: number; skipped: number; excluded: number }> {
  let added = 0, skipped = 0, excluded = 0;
  const now = new Date().toISOString();

  // Fetch pages 1 and 2 (50 jobs/page)
  for (const page of [1, 2]) {
    let data: ArbeitnowResponse;
    try {
      const res = await withRetry(
        () => axios.get<ArbeitnowResponse>(BASE, {
          params:  { page },
          timeout: 12_000,
          headers: { 'User-Agent': 'tech-digest-mcp/2.0' },
        }),
        { label: `arbeitnow/page${page}` },
      );
      data = res.data;
    } catch {
      break;
    }

    for (const entry of data.data) {
      if (!entry.title || !entry.url) continue;

      const desc     = stripHtml(entry.description ?? '');
      const tags     = entry.tags ?? [];
      const dateStr  = entry.created_at
        ? new Date(entry.created_at * 1000).toISOString().slice(0, 10)
        : null;

      const result = runPipeline({
        title:       entry.title,
        description: desc,
        tags,
        company:     entry.company_name,
        datePosted:  dateStr,
      });

      if (!result.accepted) { excluded++; continue; }

      const sal  = extractSalary(desc);
      const hash = createHash('md5')
        .update(`${entry.title}|${entry.company_name}|${entry.url}`)
        .digest('hex');

      const job: Job = {
        external_id: entry.slug,
        title:       entry.title,
        company:     entry.company_name,
        url:         entry.url,
        apply_url:   entry.url,
        location:    entry.remote ? 'Remote' : entry.location,
        remote:      entry.remote ? 1 : 0,
        job_type:    entry.job_types.some(t => /intern/i.test(t)) ? 'internship' : 'full-time',
        domain:      result.domain!,
        tags,
        description: desc.slice(0, 2000),
        date_posted: dateStr,
        sponsorship: null,
        source:      'arbeitnow',
        hash,
        score:       result.score,
        first_seen:  now,
        salary_min:  sal.min,
        salary_max:  sal.max,
      };

      if (upsertJob(job)) added++;
      else skipped++;
    }

    if (page >= data.meta.last_page) break;
  }

  return { added, skipped, excluded };
}
