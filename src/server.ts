import { Server }               from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import 'dotenv/config';

import { scrapeAllJobs }                                from './scrapers/jobs/index.js';
import { scrapeConferences }                            from './scrapers/conferences.js';
import { sendDigestEmail }                              from './email/builder.js';
import {
  getUnnotifiedJobs, getTopJobs, searchJobs, filterJobs, jobStats,
} from './db/jobs.js';
import {
  getUnnotifiedConferences, getUpcomingConferences, searchConferences, confStats,
} from './db/conferences.js';

const server = new Server(
  { name: 'tech-digest-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } },
);

// ─── tool definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // Job tools
    {
      name: 'fetch_jobs',
      description: 'Scrape all job sources (SimplifyJobs, RemoteOK, The Muse), apply the filter pipeline (level → exclusion → domain), score against your stack, and persist new results. Returns a breakdown per source.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'list_new_jobs',
      description: 'List jobs not yet emailed, sorted by stack-match score. Optionally filter by domain.',
      inputSchema: {
        type: 'object',
        properties: {
          domain:    { type: 'string', description: 'Domain filter: Cybersecurity | Cloud / DevOps | Web Development | SysAdmin' },
          min_score: { type: 'number', description: 'Minimum stack-match score (0–14, default 0)' },
        },
        required: [],
      },
    },
    {
      name: 'get_top_matches',
      description: 'Return the top N jobs by stack-match score across all stored jobs.',
      inputSchema: {
        type: 'object',
        properties: {
          limit:     { type: 'number', description: 'Number of results (default 20)' },
          min_score: { type: 'number', description: 'Minimum score (default 4)' },
        },
        required: [],
      },
    },
    {
      name: 'search_jobs',
      description: 'Full-text search across job title, company, tags, and domain.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term, e.g. "python aws" or "CrowdStrike"' },
        },
        required: ['query'],
      },
    },
    {
      name: 'filter_jobs',
      description: 'Filter stored jobs by domain, type (full-time/internship), and minimum score.',
      inputSchema: {
        type: 'object',
        properties: {
          domain:    { type: 'string' },
          job_type:  { type: 'string', description: 'full-time | internship' },
          min_score: { type: 'number' },
          limit:     { type: 'number' },
        },
        required: [],
      },
    },
    // Conference tools
    {
      name: 'fetch_conferences',
      description: 'Scrape confs.tech for upcoming USA tech conferences and store them.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'list_upcoming_conferences',
      description: 'List upcoming conferences within the next N days.',
      inputSchema: {
        type: 'object',
        properties: {
          days: { type: 'number', description: 'Look-ahead window in days (default 60)' },
        },
        required: [],
      },
    },
    {
      name: 'search_conferences',
      description: 'Search conferences by keyword (name, city, or topic).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
    // Combined
    {
      name: 'send_digest_email',
      description: 'Manually send a digest email. mode="daily" sends jobs only; mode="weekly" adds the conference section.',
      inputSchema: {
        type: 'object',
        properties: {
          mode: { type: 'string', description: 'daily | weekly (default: daily)' },
        },
        required: [],
      },
    },
    {
      name: 'get_stats',
      description: 'Return counts for both jobs and conferences tables.',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ],
}));

// ─── tool handlers ────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const a = args as Record<string, unknown>;

  switch (name) {

    case 'fetch_jobs': {
      const r = await scrapeAllJobs();
      const sourceLines = Object.entries(r.sources)
        .map(([src, s]) => `  ${src.padEnd(10)} +${s.added} added · ${s.skipped} dup · ${s.excluded} filtered`)
        .join('\n');
      const errNote = r.errors.length ? `\n\n⚠️  ${r.errors.join('\n')}` : '';
      return text(
        `Job scrape complete:\n${sourceLines}\n\n` +
        `Total  ✅ +${r.total.added}  ⏭️ ${r.total.skipped} dup  🚫 ${r.total.excluded} filtered${errNote}`,
      );
    }

    case 'list_new_jobs': {
      const domain    = String(a.domain    ?? '').trim() || undefined;
      const min_score = Number(a.min_score ?? 0);
      let rows = getUnnotifiedJobs(min_score);
      if (domain) rows = rows.filter(r => r.domain.toLowerCase().includes(domain.toLowerCase()));
      if (!rows.length) return text('No new jobs pending notification. Run `fetch_jobs` to refresh.');
      return text(`**${rows.length} pending jobs**${domain ? ` (${domain})` : ''}\n\n` + rows.map(fmtJob).join('\n\n'));
    }

    case 'get_top_matches': {
      const limit     = Number(a.limit     ?? 20);
      const min_score = Number(a.min_score ?? 4);
      const rows = getTopJobs(limit, min_score);
      if (!rows.length) return text(`No jobs found with score ≥ ${min_score}.`);
      return text(`**Top ${rows.length} stack matches (score ≥ ${min_score})**\n\n` + rows.map(fmtJob).join('\n\n'));
    }

    case 'search_jobs': {
      const query = String(a.query ?? '').trim();
      if (!query) return text('Provide a search query.');
      const rows = searchJobs(query);
      if (!rows.length) return text(`No jobs matched "${query}".`);
      return text(`**${rows.length} results for "${query}"**\n\n` + rows.map(fmtJob).join('\n\n'));
    }

    case 'filter_jobs': {
      const rows = filterJobs({
        domain:    a.domain    ? String(a.domain)    : undefined,
        job_type:  a.job_type  ? String(a.job_type)  : undefined,
        min_score: a.min_score !== undefined ? Number(a.min_score) : undefined,
        limit:     a.limit     !== undefined ? Number(a.limit)     : 50,
      });
      if (!rows.length) return text('No jobs matched those filters.');
      return text(`**${rows.length} jobs**\n\n` + rows.map(fmtJob).join('\n\n'));
    }

    case 'fetch_conferences': {
      const r = await scrapeConferences();
      return text(`Conference scrape complete.\n✅ Added: ${r.added}  ⏭️ Skipped (dup): ${r.skipped}`);
    }

    case 'list_upcoming_conferences': {
      const days = Number(a.days ?? 60);
      const rows = getUpcomingConferences(days);
      if (!rows.length) return text(`No conferences in the next ${days} days. Run \`fetch_conferences\`.`);
      return text(`**Upcoming conferences (next ${days} days)**\n\n` + rows.map(fmtConf).join('\n\n'));
    }

    case 'search_conferences': {
      const query = String(a.query ?? '').trim();
      if (!query) return text('Provide a search query.');
      const rows = searchConferences(query);
      if (!rows.length) return text(`No conferences matched "${query}".`);
      return text(`**${rows.length} results for "${query}"**\n\n` + rows.map(fmtConf).join('\n\n'));
    }

    case 'send_digest_email': {
      const mode = String(a.mode ?? 'daily') === 'weekly' ? 'weekly' : 'daily';
      const r    = await sendDigestEmail(mode as 'daily' | 'weekly');
      if (r.sent) {
        return text(`✅ ${mode} digest sent to ${process.env.NOTIFY_EMAIL}\n  Jobs: ${r.jobCount}  Conferences: ${r.confCount}`);
      }
      return text(`ℹ️  Not sent: ${r.error}`);
    }

    case 'get_stats': {
      const j = jobStats();
      const c = confStats();
      return text(
        `**Tech Digest Stats**\n\n` +
        `Jobs\n` +
        `  Total stored    : ${j.total}\n` +
        `  Pending email   : ${j.pending}\n` +
        `  Full-time       : ${j.fullTime}\n` +
        `  Internships     : ${j.internships}\n` +
        `  Score ≥ 6       : ${j.highScore}\n\n` +
        `Conferences\n` +
        `  Total stored    : ${c.total}\n` +
        `  Upcoming        : ${c.upcoming}\n` +
        `  Pending email   : ${c.pending}`,
      );
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ─── formatters ──────────────────────────────────────────────────────────────

function fmtJob(r: Awaited<ReturnType<typeof getUnnotifiedJobs>>[number]): string {
  const tags: string[] = JSON.parse(r.tags);
  return (
    `• **${r.title}** — ${r.company}\n` +
    `  📍 ${r.location ?? 'USA'}  |  ${r.job_type}  |  Score: ${r.score}/14  |  ${r.domain}\n` +
    `  Tags: ${tags.join(', ') || 'none'}\n` +
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

// ─── entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[tech-digest-mcp] MCP server v2.0 running on stdio');
}

main().catch(err => { console.error('[tech-digest-mcp] Fatal:', err); process.exit(1); });
