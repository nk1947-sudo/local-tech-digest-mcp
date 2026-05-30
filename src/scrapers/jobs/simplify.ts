import axios from 'axios';
import { createHash } from 'crypto';
import { upsertJob, type Job } from '../../db/jobs.js';
import { runPipeline } from '../../filters/jobs.js';

const ENDPOINTS: Record<string, string> = {
  newGrad:    'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json',
  intern2025: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2025-Internships/dev/.github/scripts/listings.json',
  intern2026: 'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/.github/scripts/listings.json',
};

interface SimplifyEntry {
  id:            string;
  company_name:  string;
  title:         string;
  url:           string;
  date_posted?:  string | number;
  locations:     string[];
  active:        boolean;
  is_visible:    boolean;
  terms?:        string[];
  sponsorship?:  string;
}

// State codes used to verify a location is in the USA
const USA_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

function isUSACompatible(locations: string[]): boolean {
  if (!locations.length) return true;                    // unspecified → assume USA
  return locations.some(loc => {
    if (/remote/i.test(loc))          return true;       // Remote = allowed
    if (/usa|united\s+states/i.test(loc)) return true;
    // Match ", XX" state code at end of "City, XX" or "City, XX, ..."
    const m = loc.match(/,\s*([A-Z]{2})(?:\s*,|\s*$)/);
    return !!(m && USA_STATES.has(m[1]));
  });
}

function parseEpochDate(raw: string | number | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  // Unix timestamp (seconds) — values > 1 billion are post-2001
  if (!isNaN(n) && n > 1_000_000_000) {
    return new Date(n * 1000).toISOString().slice(0, 10);
  }
  // Already an ISO date string
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

export async function scrapeSimplify(): Promise<{ added: number; skipped: number; excluded: number }> {
  let added = 0, skipped = 0, excluded = 0;
  const now = new Date().toISOString();

  for (const [key, url] of Object.entries(ENDPOINTS)) {
    let entries: SimplifyEntry[];
    try {
      const { data } = await axios.get<SimplifyEntry[]>(url, {
        timeout: 15_000,
        headers: { 'User-Agent': 'tech-digest-mcp/1.0' },
      });
      entries = Array.isArray(data) ? data : [];
    } catch {
      continue;
    }

    const isInternSource = key.startsWith('intern');

    for (const entry of entries) {
      if (!entry.active || !entry.is_visible) continue;
      if (!entry.title || !entry.url) continue;

      // Skip non-USA listings
      if (!isUSACompatible(entry.locations ?? [])) { excluded++; continue; }

      // Exclude "Does Not Offer Sponsorship" — protects F-1 OPT pipeline long-term
      if (entry.sponsorship === 'Does Not Offer Sponsorship') { excluded++; continue; }

      const jobType = isInternSource || (entry.terms ?? []).some(t => /intern/i.test(t))
        ? 'internship'
        : 'full-time';

      const result = runPipeline({ title: entry.title, description: entry.company_name, tags: [] });
      if (!result.accepted) { excluded++; continue; }

      const location = (entry.locations ?? []).join(', ') || 'USA';
      const isRemote = (entry.locations ?? []).some(l => /remote/i.test(l));
      const hash     = createHash('md5')
        .update(`${entry.title}|${entry.company_name}|${entry.url}`)
        .digest('hex');

      const job: Job = {
        external_id: entry.id,
        title:       entry.title,
        company:     entry.company_name,
        url:         entry.url,
        apply_url:   entry.url,
        location,
        remote:      isRemote ? 1 : 0,
        job_type:    jobType,
        domain:      result.domain!,
        tags:        [],
        description: null,
        date_posted: parseEpochDate(entry.date_posted),
        sponsorship: entry.sponsorship ?? null,
        source:      `simplify/${key}`,
        hash,
        score:       result.score,
        first_seen:  now,
      };

      if (upsertJob(job)) added++;
      else skipped++;
    }
  }

  return { added, skipped, excluded };
}
