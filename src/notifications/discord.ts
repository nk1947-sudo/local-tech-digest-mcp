import axios from 'axios';
import 'dotenv/config';
import type { JobRow } from '../db/jobs.js';

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

const D_EMOJI: Record<string, string> = {
  'Cybersecurity':   '🔒',
  'Cloud / DevOps':  '☁️',
  'Web Development': '🌐',
  'SysAdmin':        '🖥️',
};

const D_COLOR: Record<string, number> = {
  'Cybersecurity':   0xdc2626,
  'Cloud / DevOps':  0x2563eb,
  'Web Development': 0x059669,
  'SysAdmin':        0x7c3aed,
};

/** Post top high-score jobs to Discord channel. */
export async function notifyHighScoreJobs(jobs: JobRow[]): Promise<void> {
  if (!WEBHOOK) return;
  const top = jobs.filter(j => j.score >= 8).slice(0, 5);
  if (!top.length) return;

  const embeds = top.map(j => ({
    title:       `${D_EMOJI[j.domain] ?? '💼'} ${j.title}`,
    url:         j.url,
    description: `**${j.company}** · ${j.location ?? 'Remote'}`,
    color:       D_COLOR[j.domain] ?? 0x1d4ed8,
    fields: [
      { name: 'Domain',    value: j.domain,                          inline: true },
      { name: 'Score',     value: `⭐ ${j.score} pts`,               inline: true },
      { name: 'Type',      value: j.job_type,                        inline: true },
      ...(j.salary_min ? [{
        name: 'Salary', value: `$${Math.round(j.salary_min / 1000)}k${j.salary_max ? `–$${Math.round(j.salary_max / 1000)}k` : '+'}`, inline: true,
      }] : []),
      ...(j.date_posted ? [{ name: 'Posted', value: j.date_posted, inline: true }] : []),
    ],
    timestamp: new Date().toISOString(),
    footer: { text: `Source: ${j.source}` },
  }));

  try {
    await axios.post(WEBHOOK, {
      username: 'Tech Digest Bot',
      content:  `🚀 **${top.length} high-match job${top.length > 1 ? 's' : ''} found** (score ≥ 8)`,
      embeds,
    }, { timeout: 8_000 });
    console.log(`  Discord: notified ${top.length} high-score jobs`);
  } catch (err) {
    console.warn('  Discord notification failed:', String(err));
  }
}

/** Post a short digest-sent summary to Discord. */
export async function notifyDigestSent(
  jobCount: number,
  confCount: number,
  mode: string,
): Promise<void> {
  if (!WEBHOOK) return;
  try {
    await axios.post(WEBHOOK, {
      username: 'Tech Digest Bot',
      content:  `📬 **${mode === 'weekly' ? 'Weekly' : 'Daily'} digest sent** — ${jobCount} jobs · ${confCount} conferences`,
    }, { timeout: 8_000 });
  } catch {}
}
