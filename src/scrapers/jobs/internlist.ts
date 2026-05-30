/**
 * intern-list.com scraper
 * Scrapes https://www.intern-list.com/swe-intern-list (server-side rendered HTML)
 * 50 listings per page, scrapes up to 3 pages = ~150 internships per run.
 *
 * Card structure (per <a> element):
 *   <a href="/swe-intern-list/[slug]">
 *     <h3>[Job Title]</h3>
 *     <p>[Date e.g. "May 28, 2026"]</p>
 *     <p>[Company Name]</p>
 *   </a>
 */

import axios from 'axios';
import { load } from 'cheerio';
import { createHash } from 'crypto';
import { upsertJob, type Job } from '../../db/jobs.js';
import { runPipeline } from '../../filters/jobs.js';
import { withRetry } from '../../utils/retry.js';

const BASE        = 'https://www.intern-list.com';
const CATEGORY    = '/swe-intern-list';
const MAX_PAGES   = 3;
const PAGE_PARAM  = 'e3be0bc2_page';   // Webflow pagination key

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

// ─── location hint from title ─────────────────────────────────────────────────

const USA_STATES_RE = /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/i;

function inferLocation(title: string): { location: string; remote: number } {
  if (/\bremote\b/i.test(title))                           return { location: 'Remote',        remote: 1 };
  if (/united\s+states|usa|\bU\.S\.\b/i.test(title))      return { location: 'Remote, USA',   remote: 1 };
  if (/\bhybrid\b/i.test(title))                           return { location: 'Hybrid, USA',   remote: 0 };
  const sm = title.match(USA_STATES_RE);
  if (sm)                                                  return { location: `${sm[1]}, USA`, remote: 0 };
  return { location: 'USA', remote: 1 };                   // default — US jobs board
}

function parseDate(raw: string): string | null {
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return null;
}

// ─── page scraper ─────────────────────────────────────────────────────────────

interface Card { title: string; company: string; date: string; href: string; }

async function scrapePage(page: number): Promise<Card[]> {
  const url = page === 1
    ? `${BASE}${CATEGORY}`
    : `${BASE}${CATEGORY}?${PAGE_PARAM}=${page}`;

  const { data } = await withRetry(
    () => axios.get<string>(url, { timeout: 15_000, headers: HEADERS }),
    { label: `internlist/page${page}` },
  );

  const $ = load(data);
  const cards: Card[] = [];

  // Each listing is an <a> whose href starts with /swe-intern-list/[slug]
  // Each listing has two <a> tags with the same href:
  // 1st = company logo image  2nd = text card (p.jobtitle / p.blogtag / p.companyname_list)
  // Select only the text card by checking for p.jobtitle inside the anchor.
  $(`a[href^="${CATEGORY}/"]`).each((_, el) => {
    const title   = $(el).find('p.jobtitle').text().trim();
    if (!title) return;                         // skip image-only anchors

    const href    = $(el).attr('href') ?? '';
    const date    = $(el).find('p.blogtag').text().trim();
    const company = $(el).find('p.companyname_list').text().trim();

    if (title && company) cards.push({ title, company, date, href });
  });

  return cards;
}

// ─── main export ──────────────────────────────────────────────────────────────

export async function scrapeInternList(): Promise<{ added: number; skipped: number; excluded: number }> {
  let added = 0, skipped = 0, excluded = 0;
  const now = new Date().toISOString();

  for (let page = 1; page <= MAX_PAGES; page++) {
    let cards: Card[];
    try {
      cards = await scrapePage(page);
    } catch {
      break;
    }
    if (!cards.length) break;

    for (const card of cards) {
      const dateStr = parseDate(card.date);

      const result = runPipeline({
        title:       card.title,
        description: card.company,
        tags:        [],
        company:     card.company,
        datePosted:  dateStr,
      });
      if (!result.accepted) { excluded++; continue; }

      const { location, remote } = inferLocation(card.title);
      const detailUrl = `${BASE}${card.href}`;
      const hash      = createHash('md5')
        .update(`${card.title}|${card.company}|${card.href}`)
        .digest('hex');

      // Extract numeric ID from slug tail (e.g. _72404953)
      const idMatch  = card.href.match(/_(\d+)$/);
      const extId    = idMatch ? idMatch[1] : hash;

      const job: Job = {
        external_id: extId,
        title:       card.title,
        company:     card.company,
        url:         detailUrl,
        apply_url:   detailUrl,        // detail page has the real apply button
        location,
        remote,
        job_type:    'internship',
        domain:      result.domain!,
        tags:        [],
        description: null,
        date_posted: dateStr,
        sponsorship: null,
        source:      'internlist',
        hash,
        score:       result.score,
        first_seen:  now,
        salary_min:  null,
        salary_max:  null,
      };

      if (upsertJob(job)) added++;
      else skipped++;
    }
  }

  return { added, skipped, excluded };
}
