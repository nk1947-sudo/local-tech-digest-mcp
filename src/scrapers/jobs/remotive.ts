import axios from 'axios';
import { createHash } from 'crypto';
import { upsertJob, type Job } from '../../db/jobs.js';
import { runPipeline, stripHtml } from '../../filters/jobs.js';
import { extractSalary } from '../../utils/salary.js';
import { withRetry } from '../../utils/retry.js';

const BASE = 'https://remotive.com/api/remote-jobs';

// Map Remotive categories to our domain hints
const CATEGORIES = [
  'software-dev',
  'devops-sysadmin',
  'security',
  'data',
];

interface RemotiveJob {
  id:                          number;
  url:                         string;
  title:                       string;
  company_name:                string;
  company_logo?:               string;
  category:                    string;
  tags:                        string[];
  job_type:                    string;
  publication_date:            string;
  candidate_required_location: string;
  salary:                      string;
  description:                 string;
}

interface RemotiveResponse {
  jobs: RemotiveJob[];
}

export async function scrapeRemotive(): Promise<{ added: number; skipped: number; excluded: number }> {
  let added = 0, skipped = 0, excluded = 0;
  const now = new Date().toISOString();

  for (const category of CATEGORIES) {
    let jobs: RemotiveJob[];
    try {
      const { data } = await withRetry(
        () => axios.get<RemotiveResponse>(BASE, {
          params:  { category, limit: 50 },
          timeout: 15_000,
          headers: { 'User-Agent': 'tech-digest-mcp/2.0' },
        }),
        { label: `remotive/${category}` },
      );
      jobs = data.jobs ?? [];
    } catch {
      continue;
    }

    for (const job of jobs) {
      if (!job.title || !job.url) continue;

      const desc   = stripHtml(job.description ?? '');
      const tags   = job.tags ?? [];
      const result = runPipeline({
        title:      job.title,
        description: desc,
        tags,
        company:    job.company_name,
        datePosted: job.publication_date?.slice(0, 10) ?? null,
      });

      if (!result.accepted) { excluded++; continue; }

      const sal  = extractSalary(job.salary || desc);
      const hash = createHash('md5')
        .update(`${job.title}|${job.company_name}|${job.url}`)
        .digest('hex');

      const entry: Job = {
        external_id: String(job.id),
        title:       job.title,
        company:     job.company_name,
        url:         job.url,
        apply_url:   job.url,
        location:    job.candidate_required_location || 'Remote',
        remote:      1,
        job_type:    /intern/i.test(job.job_type) ? 'internship' : 'full-time',
        domain:      result.domain!,
        tags,
        description: desc.slice(0, 2000),
        date_posted: job.publication_date?.slice(0, 10) ?? null,
        sponsorship: null,
        source:      `remotive/${category}`,
        hash,
        score:       result.score,
        first_seen:  now,
        salary_min:  sal.min,
        salary_max:  sal.max,
      };

      if (upsertJob(entry)) added++;
      else skipped++;
    }
  }

  return { added, skipped, excluded };
}
