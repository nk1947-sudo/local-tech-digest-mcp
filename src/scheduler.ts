/**
 * Two-track scheduler:
 *
 *   Daily  08:00 ET (Mon–Sun)  →  scrape jobs  →  send jobs-only digest
 *   Monday 08:00 ET            →  also scrape conferences, send full digest
 *
 * Run:  node dist/scheduler.js
 * Test: node dist/scheduler.js --now-daily    (immediate jobs run)
 *       node dist/scheduler.js --now-weekly   (immediate full run)
 */

import cron from 'node-cron';
import 'dotenv/config';
import { scrapeAllJobs }    from './scrapers/jobs/index.js';
import { scrapeConferences } from './scrapers/conferences.js';
import { sendDigestEmail }   from './email/builder.js';

const TZ = process.env.TZ ?? 'America/New_York';

// ─── daily job digest ────────────────────────────────────────────────────────

async function runDailyDigest(): Promise<void> {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] ── Daily job digest starting ──`);

  const scrape = await scrapeAllJobs();
  console.log(`  Jobs scraped: +${scrape.total.added} new · ${scrape.total.skipped} dup · ${scrape.total.excluded} filtered`);
  if (scrape.errors.length) scrape.errors.forEach(e => console.warn(`  ⚠ ${e}`));

  const email = await sendDigestEmail('daily');
  if (email.sent) console.log(`  Email sent: ${email.jobCount} jobs`);
  else            console.log(`  Email skipped: ${email.error}`);

  console.log(`[${new Date().toISOString()}] ── Daily done ──\n`);
}

// ─── weekly full digest (Monday) ─────────────────────────────────────────────

async function runWeeklyDigest(): Promise<void> {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] ── Weekly full digest starting ──`);

  // Scrape both in parallel
  const [jobResult, confResult] = await Promise.allSettled([
    scrapeAllJobs(),
    scrapeConferences(),
  ]);

  if (jobResult.status === 'fulfilled') {
    const r = jobResult.value;
    console.log(`  Jobs: +${r.total.added} · ${r.total.skipped} dup · ${r.total.excluded} filtered`);
  } else {
    console.warn('  ⚠ Job scrape failed:', jobResult.reason);
  }

  if (confResult.status === 'fulfilled') {
    const r = confResult.value;
    console.log(`  Conferences: +${r.added} · ${r.skipped} dup`);
  } else {
    console.warn('  ⚠ Conference scrape failed:', confResult.reason);
  }

  const email = await sendDigestEmail('weekly');
  if (email.sent) console.log(`  Email sent: ${email.jobCount} jobs · ${email.confCount} conferences`);
  else            console.log(`  Email skipped: ${email.error}`);

  console.log(`[${new Date().toISOString()}] ── Weekly done ──\n`);
}

// ─── cron schedules ──────────────────────────────────────────────────────────

// Every day 08:00 — runs daily digest
// On Mondays we let the weekly cron take over (it also scrapes jobs)
cron.schedule('0 8 * * 2-7', runDailyDigest, { timezone: TZ });   // Tue–Sun daily

// Every Monday 08:00 — runs full digest (jobs + conferences)
cron.schedule('0 8 * * 1', runWeeklyDigest, { timezone: TZ });     // Mon weekly

console.log('Tech Digest Scheduler started.');
console.log(`  Daily  (Tue–Sun) : 08:00 ${TZ}  →  jobs digest`);
console.log(`  Weekly (Mon)     : 08:00 ${TZ}  →  jobs + conferences digest`);
console.log('  Press Ctrl+C to stop.\n');

// ─── CLI test flags ───────────────────────────────────────────────────────────

const flag = process.argv.find(a => a.startsWith('--now'));
if (flag === '--now-daily')  { console.log('Running daily digest now...\n');  runDailyDigest(); }
if (flag === '--now-weekly') { console.log('Running weekly digest now...\n'); runWeeklyDigest(); }

// ─── On-open trigger ──────────────────────────────────────────────────────────
// If the scheduler starts after 20:00 (8 PM) local time, fire a digest
// immediately instead of waiting for the next 8 AM cron tick.
// This handles the case where the laptop is opened in the evening.

if (!flag) {
  const hour    = new Date().getHours();
  const isMonday = new Date().getDay() === 1;

  if (hour >= 20) {
    const digestType = isMonday ? 'weekly' : 'daily';
    console.log(`Started after 8 PM (hour=${hour}) — running ${digestType} digest now...\n`);
    if (isMonday) runWeeklyDigest();
    else          runDailyDigest();
  }
}
