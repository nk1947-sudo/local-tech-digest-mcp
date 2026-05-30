import cron from 'node-cron';
import 'dotenv/config';
import { scrapeAllJobs }     from './scrapers/jobs/index.js';
import { scrapeConferences } from './scrapers/conferences.js';
import { sendDigestEmail }   from './email/builder.js';
import { getTopJobs }        from './db/jobs.js';
import { notifyHighScoreJobs, notifyDigestSent } from './notifications/discord.js';

const TZ = process.env.TZ ?? 'America/New_York';

// ─── Daily job digest ──────────────────────────────────────────────────────────

async function runDailyDigest(): Promise<void> {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] ── Daily digest starting ──`);

  const scrape = await scrapeAllJobs();
  const srcLines = Object.entries(scrape.sources)
    .map(([s, v]) => `    ${s.padEnd(12)} +${v.added}`)
    .join('\n');
  console.log(`  Jobs scraped:\n${srcLines}`);
  console.log(`  Total: +${scrape.total.added} new · ${scrape.total.skipped} dup · ${scrape.total.excluded} filtered`);
  if (scrape.errors.length) scrape.errors.forEach(e => console.warn(`  ⚠ ${e}`));

  // Discord: notify high-score jobs immediately
  const top = getTopJobs(5, 8);
  if (top.length) await notifyHighScoreJobs(top);

  const email = await sendDigestEmail('daily', scrape);
  if (email.sent) {
    console.log(`  Email sent: ${email.jobCount} jobs`);
    await notifyDigestSent(email.jobCount, 0, 'daily');
  } else {
    console.log(`  Email skipped: ${email.error}`);
  }

  console.log(`[${new Date().toISOString()}] ── Daily done ──\n`);
}

// ─── Weekly full digest ────────────────────────────────────────────────────────

async function runWeeklyDigest(): Promise<void> {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] ── Weekly digest starting ──`);

  const [jobResult, confResult] = await Promise.allSettled([
    scrapeAllJobs(),
    scrapeConferences(),
  ]);

  const scrape = jobResult.status === 'fulfilled' ? jobResult.value : null;
  if (scrape) {
    console.log(`  Jobs: +${scrape.total.added} · ${scrape.total.skipped} dup · ${scrape.total.excluded} filtered`);
    if (scrape.errors.length) scrape.errors.forEach(e => console.warn(`  ⚠ ${e}`));
    const top = getTopJobs(5, 8);
    if (top.length) await notifyHighScoreJobs(top);
  } else {
    console.warn('  ⚠ Job scrape failed');
  }

  if (confResult.status === 'fulfilled') {
    console.log(`  Conferences: +${confResult.value.added} · ${confResult.value.skipped} dup`);
  }

  const email = await sendDigestEmail('weekly', scrape ?? undefined);
  if (email.sent) {
    console.log(`  Email sent: ${email.jobCount} jobs · ${email.confCount} conferences`);
    await notifyDigestSent(email.jobCount, email.confCount, 'weekly');
  } else {
    console.log(`  Email skipped: ${email.error}`);
  }

  console.log(`[${new Date().toISOString()}] ── Weekly done ──\n`);
}

// ─── Cron schedules ────────────────────────────────────────────────────────────

cron.schedule('0 8 * * 2-7', runDailyDigest,  { timezone: TZ });   // Tue–Sun daily
cron.schedule('0 8 * * 1',   runWeeklyDigest, { timezone: TZ });   // Mon weekly

console.log('Tech Digest Scheduler v3.0 started.');
console.log(`  Daily  (Tue–Sun) 08:00 ${TZ} → jobs digest`);
console.log(`  Weekly (Mon)     08:00 ${TZ} → jobs + conferences`);
console.log('  Press Ctrl+C to stop.\n');

// ─── On-open after 8 PM trigger ───────────────────────────────────────────────

const flag    = process.argv.find(a => a.startsWith('--now'));
const hour    = new Date().getHours();
const isMonday = new Date().getDay() === 1;

if (flag === '--now-daily')  { console.log('--now-daily\n');  runDailyDigest(); }
else if (flag === '--now-weekly') { console.log('--now-weekly\n'); runWeeklyDigest(); }
else if (hour >= 20) {
  console.log(`Opened after 8 PM (hour=${hour}) — running ${isMonday ? 'weekly' : 'daily'} digest now...\n`);
  if (isMonday) runWeeklyDigest();
  else          runDailyDigest();
}
