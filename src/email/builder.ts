import nodemailer from 'nodemailer';
import 'dotenv/config';
import { getUnnotifiedJobs,           markJobsNotified,         type JobRow }         from '../db/jobs.js';
import { getUnnotifiedConferences,    markConferencesNotified,  type ConferenceRow }   from '../db/conferences.js';
import { buildJobsSection }                                                            from './jobs-section.js';
import { buildConferenceSection }                                                      from './conf-section.js';

// ─── Region detection ────────────────────────────────────────────────────────

const FOREIGN_COUNTRIES = /\b(germany|uk|united kingdom|england|scotland|wales|canada|australia|india|france|spain|netherlands|ireland|poland|brazil|mexico|singapore|japan|china|sweden|norway|denmark|finland|austria|switzerland|belgium|portugal|new zealand|south africa|israel|italy|czech|romania|ukraine|pakistan|argentina|chile|colombia|philippines|malaysia|thailand|vietnam|indonesia|kenya|nigeria|egypt|turkey|greece|hungary|serbia|croatia|latvia|estonia|lithuania|slovakia|slovenia|bulgaria)\b/i;

const USA_STATE_CODES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

export function classifyRegion(location: string | null): 'usa' | 'international' {
  if (!location) return 'usa';                        // unspecified → default USA
  if (FOREIGN_COUNTRIES.test(location)) return 'international';

  // "Remote in [non-USA country]" pattern
  if (/remote\s+in\s+/i.test(location)) {
    if (!/remote\s+in\s+(the\s+)?(usa|united\s+states)/i.test(location)) {
      return 'international';
    }
  }

  // Has a two-letter code — check if it's a US state
  const m = location.match(/,\s*([A-Z]{2})(?:\s*,|\s*$)/);
  if (m) return USA_STATE_CODES.has(m[1]) ? 'usa' : 'international';

  return 'usa';                                       // "Remote", city-only, etc. → USA
}

export interface DigestResult {
  sent:      boolean;
  jobCount:  number;
  confCount: number;
  error?:    string;
}

export type DigestMode = 'daily' | 'weekly';

const MIN_SCORE          = Number(process.env.MIN_JOB_SCORE       ?? 0);
const MAX_PER_DOMAIN     = Number(process.env.MAX_JOBS_PER_DOMAIN ?? 25);

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * mode='daily'  → jobs only (no conferences section)
 * mode='weekly' → jobs + conferences
 */
export async function sendDigestEmail(mode: DigestMode = 'daily'): Promise<DigestResult> {
  const rawJobs = getUnnotifiedJobs(MIN_SCORE);

  // Split into USA and international before applying per-domain cap
  const rawUSA  = rawJobs.filter(j => classifyRegion(j.location) === 'usa');
  const rawIntl = rawJobs.filter(j => classifyRegion(j.location) === 'international');

  const capByDomain = (rows: JobRow[]): JobRow[] => {
    const counts = new Map<string, number>();
    return rows.filter(j => {
      const c = counts.get(j.domain) ?? 0;
      if (c >= MAX_PER_DOMAIN) return false;
      counts.set(j.domain, c + 1);
      return true;
    });
  };

  const usaJobs  = capByDomain(rawUSA);
  const intlJobs = capByDomain(rawIntl);
  const jobs     = [...usaJobs, ...intlJobs];        // combined for notified marking

  const confs = mode === 'weekly' ? getUnnotifiedConferences() : [];

  if (jobs.length === 0 && confs.length === 0) {
    return { sent: false, jobCount: 0, confCount: 0, error: 'Nothing new to report.' };
  }

  const required = ['SMTP_USER', 'SMTP_PASS', 'NOTIFY_EMAIL'];
  for (const k of required) {
    if (!process.env[k]) throw new Error(`Missing env var: ${k}`);
  }

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const subjectTag = mode === 'weekly' ? 'Weekly Digest' : 'Daily Jobs';
  const totalJobs  = rawJobs.length;
  const subject    = `&#128640; ${subjectTag} — ${dateLabel} | ${usaJobs.length} USA · ${intlJobs.length} intl${confs.length ? ` · ${confs.length} conf` : ''}`;
  const html       = buildHtml({ usaJobs, intlJobs, confs, dateLabel, mode, totalJobs });

  const transport = nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });

  try {
    await transport.sendMail({
      from:    `"Tech Digest Bot" <${process.env.SMTP_USER}>`,
      to:      process.env.NOTIFY_EMAIL!,
      subject,
      html,
    });

    // Mark ALL fetched jobs notified (not just the capped subset shown in email)
    markJobsNotified(rawJobs.map(j => j.id));
    if (confs.length) markConferencesNotified(confs.map(c => c.id));

    return { sent: true, jobCount: rawJobs.length, confCount: confs.length };
  } catch (err) {
    return { sent: false, jobCount: 0, confCount: 0, error: String(err) };
  }
}

// ─── HTML shell ──────────────────────────────────────────────────────────────

function buildHtml(opts: {
  usaJobs:   JobRow[];
  intlJobs:  JobRow[];
  confs:     ConferenceRow[];
  dateLabel: string;
  mode:      DigestMode;
  totalJobs: number;
}): string {
  const { usaJobs, intlJobs, confs, dateLabel, mode, totalJobs } = opts;
  const isWeekly = mode === 'weekly';

  const confCountPill = isWeekly && confs.length
    ? `<span style="background:rgba(255,255,255,.12);color:#fff;padding:6px 16px;
                    border-radius:20px;font-size:13px;font-weight:600;">
         &#127881; ${confs.length} conferences
       </span>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:16px 8px;background:#f1f5f9;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:700px;margin:0 auto;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 50%,#1d4ed8 100%);
                border-radius:14px 14px 0 0;padding:30px 28px;text-align:center;">
      <div style="font-size:36px;">&#128640;</div>
      <h1 style="margin:6px 0 2px;color:#fff;font-size:22px;font-weight:800;letter-spacing:-.3px;">
        ${isWeekly ? 'Weekly Tech Digest' : 'Daily Job Openings'}
      </h1>
      <p style="margin:0 0 14px;color:#93c5fd;font-size:13px;">${dateLabel}</p>
      <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">
        <span style="background:rgba(255,255,255,.12);color:#fff;padding:6px 14px;
                     border-radius:20px;font-size:13px;font-weight:600;">
          &#127482;&#127480; ${usaJobs.length} USA roles
        </span>
        ${intlJobs.length ? `<span style="background:rgba(255,255,255,.08);color:#c7d2fe;padding:6px 14px;
                     border-radius:20px;font-size:13px;font-weight:600;">
          &#127758; ${intlJobs.length} international
        </span>` : ''}
        ${confCountPill}
      </div>
    </div>

    <!-- Profile strip -->
    <div style="background:#1e293b;padding:10px 20px;text-align:center;
                border-left:1px solid #334155;border-right:1px solid #334155;">
      ${['Cybersecurity', 'Cloud/DevOps', 'Web Dev', 'SysAdmin',
         'Entry-Level &amp; Interns', 'F-1 OPT Friendly', 'Remote + USA']
        .map(t => `<span style="display:inline-block;margin:3px;padding:3px 9px;
                               background:#334155;color:#94a3b8;border-radius:20px;font-size:11px;">${t}</span>`)
        .join('')}
    </div>

    <!-- Body -->
    <div style="padding:16px 0;">
      ${buildJobsSection(usaJobs, 'usa')}
      ${isWeekly ? buildConferenceSection(confs) : ''}
      ${intlJobs.length ? buildJobsSection(intlJobs, 'international') : ''}
    </div>

    <!-- Footer -->
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:0 0 14px 14px;
                padding:14px 20px;text-align:center;">
      <p style="margin:0;font-size:11px;color:#94a3b8;">
        Generated locally &mdash; 100% private, zero cloud dependency.
        <br>Jobs: SimplifyJobs &middot; RemoteOK &middot; The Muse
        ${isWeekly ? '&nbsp;|&nbsp; Conferences: confs.tech' : ''}
      </p>
    </div>

  </div>
</body>
</html>`;
}
