import { scrapeSimplify } from './simplify.js';
import { scrapeRemoteOK } from './remoteok.js';
import { scrapeTheMuse }  from './themuse.js';

export interface SourceResult {
  added:    number;
  skipped:  number;
  excluded: number;
}

export interface JobScrapeResult {
  total:   SourceResult;
  sources: Record<string, SourceResult>;
  errors:  string[];
}

export async function scrapeAllJobs(): Promise<JobScrapeResult> {
  const errors: string[] = [];

  const [r1, r2, r3] = await Promise.allSettled([
    scrapeSimplify(),
    scrapeRemoteOK(),
    scrapeTheMuse(),
  ]);

  const resolve = (
    r: PromiseSettledResult<SourceResult>,
    name: string,
  ): SourceResult => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${name}: ${r.reason}`);
    return { added: 0, skipped: 0, excluded: 0 };
  };

  const s1 = resolve(r1, 'simplify');
  const s2 = resolve(r2, 'remoteok');
  const s3 = resolve(r3, 'themuse');

  return {
    total: {
      added:    s1.added    + s2.added    + s3.added,
      skipped:  s1.skipped  + s2.skipped  + s3.skipped,
      excluded: s1.excluded + s2.excluded + s3.excluded,
    },
    sources: { simplify: s1, remoteok: s2, themuse: s3 },
    errors,
  };
}
