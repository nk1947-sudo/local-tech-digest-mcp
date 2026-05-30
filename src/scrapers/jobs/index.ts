import { scrapeSimplify }   from './simplify.js';
import { scrapeRemoteOK }   from './remoteok.js';
import { scrapeTheMuse }    from './themuse.js';
import { scrapeRemotive }   from './remotive.js';
import { scrapeJobicy }     from './jobicy.js';
import { scrapeArbeitnow }  from './arbeitnow.js';
import { scrapeInternList } from './internlist.js';

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

  // Run all 7 sources in parallel
  const [r1, r2, r3, r4, r5, r6, r7] = await Promise.allSettled([
    scrapeSimplify(),
    scrapeRemoteOK(),
    scrapeTheMuse(),
    scrapeRemotive(),
    scrapeJobicy(),
    scrapeArbeitnow(),
    scrapeInternList(),
  ]);

  const resolve = (r: PromiseSettledResult<SourceResult>, name: string): SourceResult => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${name}: ${r.reason}`);
    return { added: 0, skipped: 0, excluded: 0 };
  };

  const s1 = resolve(r1, 'simplify');
  const s2 = resolve(r2, 'remoteok');
  const s3 = resolve(r3, 'themuse');
  const s4 = resolve(r4, 'remotive');
  const s5 = resolve(r5, 'jobicy');
  const s6 = resolve(r6, 'arbeitnow');
  const s7 = resolve(r7, 'internlist');

  const sum = (key: keyof SourceResult) =>
    [s1, s2, s3, s4, s5, s6, s7].reduce((acc, s) => acc + s[key], 0);

  return {
    total:   { added: sum('added'), skipped: sum('skipped'), excluded: sum('excluded') },
    sources: { simplify: s1, remoteok: s2, themuse: s3, remotive: s4, jobicy: s5, arbeitnow: s6, internlist: s7 },
    errors,
  };
}
