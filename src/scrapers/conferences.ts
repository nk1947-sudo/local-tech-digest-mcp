import axios from 'axios';
import { upsertConference, makeConfHash, type Conference } from '../db/conferences.js';

const CURRENT_YEAR = new Date().getFullYear();
const NEXT_YEAR    = CURRENT_YEAR + 1;
const TODAY        = new Date().toISOString().slice(0, 10);

const TOPIC_MAP: Record<string, string[]> = {
  security:   ['Cybersecurity', 'SecOps', 'DevSecOps'],
  devops:     ['Cloud Computing', 'DevOps', 'SysAdmin'],
  javascript: ['Web Development', 'JavaScript'],
  typescript: ['Web Development', 'TypeScript'],
  react:      ['Web Development', 'React'],
  css:        ['Web Development', 'CSS / Frontend'],
  networking: ['Networking', 'SysAdmin'],
  general:    ['General Tech'],
};

const USA_VARIANTS = new Set([
  'u.s.a.', 'usa', 'us', 'u.s.', 'united states', 'united states of america',
]);

interface ConftechEntry {
  name:        string;
  url:         string;
  startDate:   string;
  endDate?:    string;
  city:        string;
  country:     string;
  cfpUrl?:     string;
  cfpEndDate?: string;
}

function isUSA(country: string): boolean {
  return USA_VARIANTS.has((country ?? '').toLowerCase().trim());
}

async function fetchTopic(topic: string, year: number): Promise<ConftechEntry[]> {
  const url = [
    'https://raw.githubusercontent.com',
    'tech-conferences/conference-data/main',
    `conferences/${year}/${topic}.json`,
  ].join('/');
  try {
    const { data } = await axios.get<ConftechEntry[]>(url, {
      timeout: 12_000,
      headers: { 'User-Agent': 'tech-digest-mcp/1.0' },
    });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export interface ConferenceScrapeResult {
  added:   number;
  skipped: number;
}

export async function scrapeConferences(): Promise<ConferenceScrapeResult> {
  let added = 0, skipped = 0;
  const now = new Date().toISOString();

  for (const [topic, labels] of Object.entries(TOPIC_MAP)) {
    for (const year of [CURRENT_YEAR, NEXT_YEAR]) {
      const entries = await fetchTopic(topic, year);
      for (const entry of entries) {
        if (!entry.country || !isUSA(entry.country)) continue;
        if (entry.startDate < TODAY) continue;

        const conf: Conference = {
          name:        entry.name,
          url:         entry.url,
          startDate:   entry.startDate,
          endDate:     entry.endDate ?? null,
          city:        entry.city,
          state:       null,
          country:     'USA',
          topics:      labels,
          cfpDeadline: entry.cfpEndDate ?? null,
          cfpUrl:      entry.cfpUrl ?? null,
          source:      `confs.tech/${topic}`,
          hash:        makeConfHash(entry.name, entry.startDate, entry.city),
          firstSeen:   now,
        };

        if (upsertConference(conf)) added++;
        else skipped++;
      }
    }
  }

  return { added, skipped };
}
