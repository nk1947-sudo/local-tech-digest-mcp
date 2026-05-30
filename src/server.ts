import { Server }               from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import 'dotenv/config';

import { scrapeAllJobs }                                                   from './scrapers/jobs/index.js';
import { scrapeConferences }                                                from './scrapers/conferences.js';
import { sendDigestEmail }                                                  from './email/builder.js';
import { notifyHighScoreJobs }                                              from './notifications/discord.js';
import {
  getUnnotifiedJobs, getTopJobs, searchJobs, filterJobs,
  setJobStatus, getPipeline, getFrequentTechTerms, jobStats,
  type JobRow, type JobStatus, JOB_STATUSES,
} from './db/jobs.js';
import {
  getUnnotifiedConferences, getUpcomingConferences, searchConferences, confStats,
} from './db/conferences.js';

const server = new Server(
  { name: 'tech-digest-mcp', version: '3.0.0' },
  { capabilities: { tools: {} } },
);

// ─── tool list ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // ── Jobs ──
    {
      name: 'fetch_jobs',
      description: 'Scrape all 6 job sources (SimplifyJobs, RemoteOK, The Muse, Remotive, Jobicy, Arbeitnow), apply 4-gate filter, score, and store. Returns per-source breakdown.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'list_new_jobs',
      description: 'List un-notified jobs sorted by score. Optional domain and min_score filters.',
      inputSchema: {
        type: 'object',
        properties: {
          domain:    { type: 'string' },
          min_score: { type: 'number' },
        },
        required: [],
      },
    },
    {
      name: 'get_top_matches',
      description: 'Return top N jobs by stack-match score across all stored jobs.',
      inputSchema: {
        type: 'object',
        properties: {
          limit:     { type: 'number', description: 'Default 20' },
          min_score: { type: 'number', description: 'Default 4'  },
        },
        required: [],
      },
    },
    {
      name: 'search_jobs',
      description: 'Full-text search across title, company, tags, domain.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    {
      name: 'filter_jobs',
      description: 'Filter stored jobs by domain, type, status, and min score.',
      inputSchema: {
        type: 'object',
        properties: {
          domain:    { type: 'string' },
          job_type:  { type: 'string', description: 'full-time | internship' },
          status:    { type: 'string', description: 'new | saved | applied | interviewing | rejected | offer' },
          min_score: { type: 'number' },
          limit:     { type: 'number' },
        },
        required: [],
      },
    },
    {
      name: 'mark_job',
      description: 'Update the application status of a job by its ID.',
      inputSchema: {
        type: 'object',
        properties: {
          id:     { type: 'number', description: 'Job ID from the database' },
          status: { type: 'string', description: 'new | saved | applied | interviewing | rejected | offer' },
        },
        required: ['id', 'status'],
      },
    },
    {
      name: 'get_pipeline',
      description: 'Show your job application pipeline grouped by status.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'suggest_skills',
      description: 'Analyse the stored job database to suggest skills most in-demand that are NOT in your current stack.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    // ── Conferences ──
    {
      name: 'fetch_conferences',
      description: 'Scrape confs.tech for upcoming USA tech conferences.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'list_upcoming_conferences',
      description: 'List upcoming conferences in the next N days (default 60).',
      inputSchema: {
        type: 'object',
        properties: { days: { type: 'number' } },
        required: [],
      },
    },
    {
      name: 'search_conferences',
      description: 'Search conferences by keyword.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    },
    // ── Combined ──
    {
      name: 'send_digest_email',
      description: 'Manually trigger a digest email. mode="daily" → jobs only; mode="weekly" → jobs + conferences.',
      inputSchema: {
        type: 'object',
        properties: { mode: { type: 'string', description: 'daily | weekly' } },
        required: [],
      },
    },
    {
      name: 'get_stats',
      description: 'Database counts for jobs (by status, type, salary) and conferences.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ],
}));

// ─── handlers ─────────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const a = args as Record<string, unknown>;

  switch (name) {

    case 'fetch_jobs': {
      const r = await scrapeAllJobs();
      const top = getTopJobs(5, 8);
      if (top.length) await notifyHighScoreJobs(top);
      const lines = Object.entries(r.sources)
        .map(([s, v]) => `  ${s.padEnd(12)} +${v.added} new · ${v.skipped} dup · ${v.excluded} filtered`)
        .join('\n');
      const errs = r.errors.length ? `\n\n⚠️  ${r.errors.join('\n')}` : '';
      return text(`Job scrape complete:\n${lines}\n\n✅ Total new: ${r.total.added}  ⏭️ Dup: ${r.total.skipped}  🚫 Filtered: ${r.total.excluded}${errs}`);
    }

    case 'list_new_jobs': {
      const domain    = String(a.domain ?? '').trim() || undefined;
      const min_score = Number(a.min_score ?? 0);
      let rows = getUnnotifiedJobs(min_score);
      if (domain) rows = rows.filter(r => r.domain.toLowerCase().includes(domain.toLowerCase()));
      if (!rows.length) return text('No new jobs pending. Run `fetch_jobs` to refresh.');
      return text(`**${rows.length} pending**${domain ? ` (${domain})` : ''}\n\n` + rows.slice(0, 30).map(fmtJob).join('\n\n'));
    }

    case 'get_top_matches': {
      const limit = Number(a.limit ?? 20), min = Number(a.min_score ?? 4);
      const rows  = getTopJobs(limit, min);
      if (!rows.length) return text(`No jobs with score ≥ ${min}.`);
      return text(`**Top ${rows.length} matches (score ≥ ${min})**\n\n` + rows.map(fmtJob).join('\n\n'));
    }

    case 'search_jobs': {
      const q = String(a.query ?? '').trim();
      if (!q) return text('Provide a search term.');
      const rows = searchJobs(q);
      if (!rows.length) return text(`No results for "${q}".`);
      return text(`**${rows.length} results for "${q}"**\n\n` + rows.slice(0, 20).map(fmtJob).join('\n\n'));
    }

    case 'filter_jobs': {
      const rows = filterJobs({
        domain:    a.domain    ? String(a.domain)    : undefined,
        job_type:  a.job_type  ? String(a.job_type)  : undefined,
        status:    a.status    ? String(a.status)    : undefined,
        min_score: a.min_score !== undefined ? Number(a.min_score) : undefined,
        limit:     a.limit     !== undefined ? Number(a.limit)     : 50,
      });
      if (!rows.length) return text('No jobs matched those filters.');
      return text(`**${rows.length} jobs**\n\n` + rows.map(fmtJob).join('\n\n'));
    }

    case 'mark_job': {
      const id     = Number(a.id);
      const status = String(a.status ?? '').trim() as JobStatus;
      if (!id || !JOB_STATUSES.includes(status)) {
        return text(`Invalid. id must be a number, status one of: ${JOB_STATUSES.join(', ')}`);
      }
      const ok = setJobStatus(id, status);
      return text(ok ? `✅ Job #${id} → ${status}` : `❌ Job #${id} not found.`);
    }

    case 'get_pipeline': {
      const pipeline = getPipeline();
      const lines: string[] = [];
      for (const [status, jobs] of Object.entries(pipeline)) {
        if (!jobs.length) continue;
        const emoji = { saved: '⭐', applied: '✓', interviewing: '🎤', offer: '🎉', rejected: '✗', new: '🆕' }[status] ?? '•';
        lines.push(`\n**${emoji} ${status.toUpperCase()} (${jobs.length})**`);
        jobs.forEach(j => lines.push(`  • ${j.title} — ${j.company} | score:${j.score}`));
      }
      return text(lines.length ? lines.join('\n') : 'No jobs in your pipeline yet. Use `mark_job` to track applications.');
    }

    case 'suggest_skills': {
      const skills = getFrequentTechTerms(15);
      if (!skills.length) return text('Not enough data yet. Run `fetch_jobs` first.');
      const lines = skills.map((s, i) => `  ${i + 1}. **${s.term}** — appears in ${s.count} job listing${s.count > 1 ? 's' : ''}`);
      return text(`**Skills most in demand (not in your current stack):**\n${lines.join('\n')}\n\n_Based on ${skills[0]?.count ? 'top 300' : 'all'} stored jobs._`);
    }

    case 'fetch_conferences': {
      const r = await scrapeConferences();
      return text(`Conference scrape complete.\n✅ Added: ${r.added}  ⏭️ Skipped: ${r.skipped}`);
    }

    case 'list_upcoming_conferences': {
      const days = Number(a.days ?? 60);
      const rows = getUpcomingConferences(days);
      if (!rows.length) return text(`No conferences in the next ${days} days.`);
      return text(`**${rows.length} upcoming (next ${days} days)**\n\n` + rows.map(fmtConf).join('\n\n'));
    }

    case 'search_conferences': {
      const q = String(a.query ?? '').trim();
      if (!q) return text('Provide a search term.');
      const rows = searchConferences(q);
      if (!rows.length) return text(`No conferences matched "${q}".`);
      return text(`**${rows.length} results**\n\n` + rows.map(fmtConf).join('\n\n'));
    }

    case 'send_digest_email': {
      const mode = String(a.mode ?? 'daily') === 'weekly' ? 'weekly' : 'daily';
      const r    = await sendDigestEmail(mode as DigestMode);
      if (r.sent) return text(`✅ ${mode} digest sent — ${r.jobCount} jobs · ${r.confCount} conferences`);
      return text(`ℹ️  Not sent: ${r.error}`);
    }

    case 'get_stats': {
      const j = jobStats(), c = confStats();
      return text(
        `**Stats**\n\n` +
        `Jobs\n` +
        `  Total      : ${j.total}\n` +
        `  Pending    : ${j.pending}\n` +
        `  Full-time  : ${j.fullTime}\n` +
        `  Internships: ${j.internships}\n` +
        `  Score ≥ 6  : ${j.highScore}\n` +
        `  With salary: ${j.withSalary}\n` +
        `  Saved      : ${j.saved}\n` +
        `  Applied    : ${j.applied}\n\n` +
        `Conferences\n` +
        `  Total   : ${c.total}\n` +
        `  Upcoming: ${c.upcoming}\n` +
        `  Pending : ${c.pending}`,
      );
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

type DigestMode = 'daily' | 'weekly';

function fmtJob(r: JobRow): string {
  const tags: string[] = JSON.parse(r.tags);
  const sal = r.salary_min ? ` | 💰$${Math.round(r.salary_min / 1000)}k${r.salary_max ? `–$${Math.round(r.salary_max / 1000)}k` : '+'}` : '';
  return (
    `• **${r.title}** — ${r.company}  [#${r.id}]\n` +
    `  📍 ${r.location ?? 'USA'} · ${r.job_type} · Score: **${r.score}** · ${r.domain}${sal}\n` +
    `  Status: ${r.status} · Tags: ${tags.join(', ') || 'none'}\n` +
    `  🔗 ${r.url}`
  );
}

function fmtConf(r: Awaited<ReturnType<typeof getUpcomingConferences>>[number]): string {
  const topics: string[] = JSON.parse(r.topics);
  return (
    `• **${r.name}** — ${r.city}\n` +
    `  📅 ${r.startDate}${r.endDate ? ` → ${r.endDate}` : ''}  |  ${topics.join(', ')}\n` +
    `  🔗 ${r.url}`
  );
}

function text(content: string) {
  return { content: [{ type: 'text' as const, text: content }] };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[tech-digest-mcp] MCP server v3.0 running');
}

main().catch(err => { console.error('[tech-digest-mcp] Fatal:', err); process.exit(1); });
