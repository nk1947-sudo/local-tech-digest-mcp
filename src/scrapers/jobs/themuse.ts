import axios from 'axios';
import { createHash } from 'crypto';
import { upsertJob, type Job } from '../../db/jobs.js';
import { runPipeline, stripHtml } from '../../filters/jobs.js';
import { extractSalary } from '../../utils/salary.js';
import { withRetry } from '../../utils/retry.js';

const BASE       = 'https://www.themuse.com/api/public/jobs';
const CATEGORIES = ['Software Engineer', 'IT & Networking', 'Data & Analytics'];

interface MuseJob {
  id:                 number;
  name:               string;
  short_description?: string;
  publication_date?:  string;
  refs:               { landing_page: string };
  locations:          { name: string }[];
  levels:             { short_name: string; name: string }[];
  company:            { name: string };
  categories:         { name: string }[];
}

interface MuseResponse {
  results:    MuseJob[];
  page_count: number;
  page:       number;
}

export async function scrapeTheMuse(): Promise<{ added: number; skipped: number; excluded: number }> {
  let added = 0, skipped = 0, excluded = 0;
  const now = new Date().toISOString();

  for (const category of CATEGORIES) {
    for (const page of [0, 1]) {
      let data: MuseResponse;
      try {
        const res = await withRetry(
          () => axios.get<MuseResponse>(BASE, {
            params:  { category, level: 'entry', page },
            timeout: 12_000,
            headers: { 'User-Agent': 'tech-digest-mcp/2.0' },
          }),
          { label: `themuse/${category}` },
        );
        data = res.data;
      } catch {
        break;
      }

      for (const job of data.results) {
        const desc   = stripHtml(job.short_description ?? '');
        const tags   = job.categories.map(c => c.name);
        const dateStr = job.publication_date?.slice(0, 10) ?? null;

        const result = runPipeline({
          title:       job.name,
          description: desc,
          tags,
          company:     job.company.name,
          datePosted:  dateStr,
        });
        if (!result.accepted) { excluded++; continue; }

        const sal         = extractSalary(desc);
        const locationStr = job.locations.map(l => l.name).join(', ') || 'USA';
        const isRemote    = job.locations.some(l => /remote/i.test(l.name));
        const hash        = createHash('md5')
          .update(`${job.name}|${job.company.name}|${job.refs.landing_page}`)
          .digest('hex');

        const jobRow: Job = {
          external_id: String(job.id),
          title:       job.name,
          company:     job.company.name,
          url:         job.refs.landing_page,
          apply_url:   job.refs.landing_page,
          location:    locationStr,
          remote:      isRemote ? 1 : 0,
          job_type:    'full-time',
          domain:      result.domain!,
          tags,
          description: desc.slice(0, 2000),
          date_posted: dateStr,
          sponsorship: null,
          source:      'themuse',
          hash,
          score:       result.score,
          first_seen:  now,
          salary_min:  sal.min,
          salary_max:  sal.max,
        };

        if (upsertJob(jobRow)) added++;
        else skipped++;
      }

      if (page >= data.page_count - 1) break;
    }
  }

  return { added, skipped, excluded };
}
