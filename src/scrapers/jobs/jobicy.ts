import axios from 'axios';
import { createHash } from 'crypto';
import { upsertJob, type Job } from '../../db/jobs.js';
import { runPipeline, stripHtml } from '../../filters/jobs.js';
import { withRetry } from '../../utils/retry.js';

const BASE = 'https://jobicy.com/api/v2/remote-jobs';

interface JobicyEntry {
  id:             string | number;
  url:            string;
  jobTitle:       string;
  companyName:    string;
  jobGeo:         string;
  jobLevel?:      string;
  jobType?:       string;
  jobIndustry?:   string[];
  jobDescription: string;
  annualSalaryMin?: number;
  annualSalaryMax?: number;
  pubDate:        string;
}

interface JobicyResponse {
  jobs: JobicyEntry[];
}

export async function scrapeJobicy(): Promise<{ added: number; skipped: number; excluded: number }> {
  let added = 0, skipped = 0, excluded = 0;
  const now = new Date().toISOString();

  let entries: JobicyEntry[];
  try {
    const { data } = await withRetry(
      () => axios.get<JobicyResponse>(BASE, {
        params:  { count: 50, geo: 'usa' },
        timeout: 15_000,
        headers: { 'User-Agent': 'tech-digest-mcp/2.0' },
      }),
      { label: 'jobicy' },
    );
    entries = data.jobs ?? [];
  } catch {
    return { added, skipped, excluded };
  }

  for (const entry of entries) {
    if (!entry.jobTitle || !entry.url) continue;

    const desc   = stripHtml(entry.jobDescription ?? '');
    const tags   = entry.jobIndustry ?? [];
    const dateStr = entry.pubDate?.slice(0, 10) ?? null;

    const result = runPipeline({
      title:       entry.jobTitle,
      description: desc,
      tags,
      company:     entry.companyName,
      datePosted:  dateStr,
    });

    if (!result.accepted) { excluded++; continue; }

    const hash = createHash('md5')
      .update(`${entry.jobTitle}|${entry.companyName}|${entry.url}`)
      .digest('hex');

    const job: Job = {
      external_id: String(entry.id),
      title:       entry.jobTitle,
      company:     entry.companyName,
      url:         entry.url,
      apply_url:   entry.url,
      location:    entry.jobGeo || 'Remote, USA',
      remote:      1,
      job_type:    /intern/i.test(entry.jobType ?? '') ? 'internship' : 'full-time',
      domain:      result.domain!,
      tags,
      description: desc.slice(0, 2000),
      date_posted: dateStr,
      sponsorship: null,
      source:      'jobicy',
      hash,
      score:       result.score,
      first_seen:  now,
      salary_min:  entry.annualSalaryMin ?? null,
      salary_max:  entry.annualSalaryMax ?? null,
    };

    if (upsertJob(job)) added++;
    else skipped++;
  }

  return { added, skipped, excluded };
}
