# 🚀 local-tech-digest-mcp

A **local, privacy-first** Model Context Protocol (MCP) server that automatically tracks entry-level tech job openings and upcoming USA tech conferences — then emails you a clean HTML digest on a smart schedule.

Runs 100% on your machine. No cloud, no tracking, no third-party accounts beyond a Gmail App Password.

---

## ✨ Features

- **Dual digest** — entry-level jobs (daily) + tech conferences (weekly)
- **Smart scheduler** — fires at 08:00 ET daily; also triggers immediately if you open your laptop after 8 PM
- **3-gate job filter** — level → exclusion → domain → stack scoring
- **F-1 OPT aware** — excludes clearance/citizenship-required and no-sponsorship roles
- **USA / International split** — USA roles first, foreign roles in a separate section
- **Zero API keys** — all data sources are free and public
- **Deduplication** — SQLite tracks every job/conference ever seen; emails only new entries
- **10 MCP tools** — query, search, and trigger digests directly from Claude Desktop
- **Auto-start** — silent Windows Startup launcher included

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        local-tech-digest-mcp                        │
│                                                                     │
│  ┌─────────────┐     ┌──────────────────────────────────────────┐  │
│  │ Claude      │     │              Scrapers                    │  │
│  │ Desktop     │────▶│  SimplifyJobs  │  RemoteOK  │  The Muse  │  │
│  │ (MCP tools) │     │  (GitHub JSON) │  (API)     │  (API)     │  │
│  └─────────────┘     └──────────────┬───────────────────────────┘  │
│                                     │                               │
│  ┌─────────────┐     ┌──────────────▼───────────────────────────┐  │
│  │  Scheduler  │     │           Filter Pipeline                │  │
│  │  node-cron  │     │  Gate 1: Level  (junior/entry/intern)    │  │
│  │  08:00 ET   │     │  Gate 2: Exclusion (clearance/no-visa)   │  │
│  │  + 8 PM     │     │  Gate 3: Domain (cyber/cloud/web/sys)    │  │
│  │  on-open    │     │  Scorer: Stack match (Python/AWS/Linux…) │  │
│  └──────┬──────┘     └──────────────┬───────────────────────────┘  │
│         │                           │                               │
│         │            ┌──────────────▼───────────────────────────┐  │
│         │            │         SQLite  (digest.db)              │  │
│         │            │   conferences table  │  jobs table       │  │
│         │            │   hash dedup         │  hash dedup       │  │
│         │            └──────────────┬───────────────────────────┘  │
│         │                           │                               │
│         └──────────────────────────▶│                               │
│                                     ▼                               │
│                      ┌──────────────────────────┐                  │
│                      │      Email Builder       │                  │
│                      │  Section 1: USA Jobs     │                  │
│                      │  Section 2: Conferences  │                  │
│                      │  Section 3: Intl Jobs    │                  │
│                      └──────────────┬───────────┘                  │
│                                     │                               │
│                                     ▼                               │
│                            Gmail SMTP (nodemailer)                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
local-tech-digest-mcp/
├── src/
│   ├── db/
│   │   ├── schema.ts          # SQLite init — creates both tables on first run
│   │   ├── conferences.ts     # Conference CRUD & queries
│   │   └── jobs.ts            # Job CRUD, search, filter, stats
│   ├── filters/
│   │   └── jobs.ts            # 3-gate pipeline, stack scorer, HTML stripper
│   ├── scrapers/
│   │   ├── conferences.ts     # confs.tech GitHub JSON scraper
│   │   └── jobs/
│   │       ├── index.ts       # Parallel orchestrator for all job sources
│   │       ├── simplify.ts    # SimplifyJobs (new-grad + internships)
│   │       ├── remoteok.ts    # RemoteOK public API
│   │       └── themuse.ts     # The Muse public API
│   ├── email/
│   │   ├── builder.ts         # Region classifier, USA/intl split, SMTP send
│   │   ├── jobs-section.ts    # Job cards HTML renderer
│   │   └── conf-section.ts    # Conference cards HTML renderer
│   ├── server.ts              # MCP server — 10 tools for Claude Desktop
│   └── scheduler.ts           # node-cron dual schedule + 8 PM on-open trigger
├── data/                      # Auto-created — SQLite database (gitignored)
├── dist/                      # Auto-created — compiled JS (gitignored)
├── launch-silent.vbs          # Windows Startup silent launcher
├── setup-autostart.ps1        # Register Windows startup task (optional)
├── .env.example               # Environment variable template
├── package.json
└── tsconfig.json
```

---

## 🔌 Data Sources

| Source | Type | Auth | What it provides |
|---|---|---|---|
| [SimplifyJobs New-Grad](https://github.com/SimplifyJobs/New-Grad-Positions) | GitHub raw JSON | None | Entry-level CS full-time roles |
| [SimplifyJobs Internships](https://github.com/SimplifyJobs/Summer2026-Internships) | GitHub raw JSON | None | Summer/fall tech internships |
| [RemoteOK](https://remoteok.com/api) | Public API | None | Remote tech roles globally |
| [The Muse](https://www.themuse.com/api/public/jobs) | Public API | None | Entry-level filtered roles |
| [confs.tech](https://github.com/tech-conferences/conference-data) | GitHub raw JSON | None | USA tech conferences by topic |

---

## 🔍 Job Filter Pipeline

Every scraped job passes three sequential gates before being stored:

```
RAW JOB
   │
   ▼ GATE 1 — LEVEL FILTER  (title must match)
     junior · entry-level · associate · l1 · graduate · new-grad · intern(ship)
   │
   ▼ GATE 2 — EXCLUSION FILTER  (reject if found in title or description)
     us-citizenship-required · must-be-us-citizen · secret-clearance
     top-secret · ts/sci · dod · department-of-defense · itar
     no-sponsorship · sponsorship-not-available
   │
   ▼ GATE 3 — DOMAIN FILTER  (must match at least one)
     Cybersecurity  → security | infosec | soc | devsecops | pentest | siem …
     Cloud/DevOps   → cloud | aws | azure | devops | kubernetes | terraform …
     Web Development → frontend | backend | full-stack | react | node | django …
     SysAdmin       → linux | sysadmin | system-admin | sre | network-admin …
   │
   ▼ STACK SCORER  (points added for matching user's tech stack)
     Python          +2     Linux / Debian / Ubuntu  +2
     Bash / Shell    +2     AWS                      +2
     Security (CVE)  +2     Docker / Kubernetes      +1
     Terraform       +1     Git / GitHub             +1
     Networking      +1
     ────────────────────────────────────
     Maximum score: 14 points
   │
   ▼ STORED in SQLite
     Emailed if score ≥ MIN_JOB_SCORE (default: 0)
     Capped at MAX_JOBS_PER_DOMAIN per email (default: 25)
```

---

## 📧 Email Layout

```
╔════════════════════════════════════════════════════════╗
║          🚀 Weekly Tech Digest — May 29, 2026          ║
║      🇺🇸 82 USA roles · 🌍 18 international · 🎉 15 conf ║
║  [Cybersecurity] [Cloud/DevOps] [Web Dev] [SysAdmin]   ║
╚════════════════════════════════════════════════════════╝

💼 NEW ENTRY-LEVEL OPENINGS (USA)
──────────────────────────────────────────────
🔒 Cybersecurity  (N roles)
  ┌──────────────────────────────────────────┐
  │ Security Analyst Intern — CrowdStrike    │
  │ 🏢 CrowdStrike   📍 Remote              │
  │ [Internship] [Remote] [✓ Visa Sponsor]  │
  │ Tags: python  linux  aws                │
  │ Match ████████░░░░  8/14                │
  │                        [Apply →]        │
  └──────────────────────────────────────────┘
☁️⚙  Cloud / DevOps  (N roles)
🌐 Web Development  (N roles)
🖥️  SysAdmin  (N roles)

🎉 UPCOMING USA TECH CONFERENCES  (Monday only)
──────────────────────────────────────────────
🔒 Cybersecurity
  • DEF CON 34 — Las Vegas  · Aug 7–10
☁️  Cloud / DevOps
  • KubeCon NA — Atlanta  · Nov 10–14  ⏰ CFP: Jul 21

🌍 INTERNATIONAL OPPORTUNITIES
──────────────────────────────────────────────
ℹ️  These roles are outside the USA. Verify work
    authorization before applying.
[Same card layout, purple accent]
```

---

## 🛠️ Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- A Gmail account with [App Password](https://myaccount.google.com/apppasswords) enabled (requires 2-Step Verification)

---

## ⚙️ Setup

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/local-tech-digest-mcp.git
cd local-tech-digest-mcp
npm install
```

### 2. Configure environment

```bash
copy .env.example .env   # Windows
cp  .env.example .env    # Mac/Linux
```

Edit `.env` with your values:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=xxxx_xxxx_xxxx_xxxx     # Gmail App Password (16 chars, no spaces)
NOTIFY_EMAIL=you@gmail.com

TZ=America/New_York               # Your timezone

MIN_JOB_SCORE=0                   # 0 = all jobs  |  4 = strong stack matches only
MAX_JOBS_PER_DOMAIN=25            # Max job cards per domain per email
```

> **Gmail App Password:** Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), create a new app password, and paste the 16-character code (without spaces) as `SMTP_PASS`.

### 3. Build

```bash
npm run build
```

### 4. Register with Claude Desktop

Add to `claude_desktop_config.json`:

- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "tech-digest-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/local-tech-digest-mcp/dist/server.js"]
    }
  }
}
```

Restart Claude Desktop after saving.

### 5. Run the scheduler

```bash
node dist/scheduler.js
```

Keep this terminal open. The scheduler fires automatically on its schedule.

### 6. Auto-start on Windows login (optional)

Copy `launch-silent.vbs` to your Windows Startup folder:

```powershell
Copy-Item .\launch-silent.vbs ([Environment]::GetFolderPath('Startup'))
```

The scheduler will now start silently every time you log in.

---

## 🧪 Test Commands

```bash
# Trigger daily jobs digest immediately
node dist/scheduler.js --now-daily

# Trigger full weekly digest (jobs + conferences)
node dist/scheduler.js --now-weekly
```

---

## 📅 Schedule Behaviour

| When | Action |
|---|---|
| Every day 08:00 ET (Tue–Sun) | Scrape jobs → send jobs-only email |
| Every Monday 08:00 ET | Scrape jobs + conferences → send full email |
| Laptop opened **after 8 PM** | Runs the appropriate digest immediately |
| Nothing new | Email skipped — no empty digests |

---

## 🔧 MCP Tools (Claude Desktop)

| Tool | Description |
|---|---|
| `fetch_jobs` | Scrape all sources, filter, score, store new jobs |
| `list_new_jobs` | Pending (un-emailed) jobs sorted by score |
| `get_top_matches` | Top N jobs by stack-match score |
| `search_jobs` | Full-text search by keyword |
| `filter_jobs` | Filter by domain, type, min score |
| `fetch_conferences` | Scrape confs.tech for upcoming USA events |
| `list_upcoming_conferences` | Conferences in the next N days |
| `search_conferences` | Keyword search across conferences |
| `send_digest_email` | Manually trigger digest (`mode: daily\|weekly`) |
| `get_stats` | Database counts for jobs and conferences |

---

## 🗄️ Database Schema

```sql
-- Conference events
CREATE TABLE conferences (
  id, name, url, startDate, endDate, city, state, country,
  topics TEXT,        -- JSON array of domain labels
  cfpDeadline, cfpUrl, source,
  hash TEXT UNIQUE,   -- md5(name|startDate|city) for deduplication
  firstSeen, notified INTEGER DEFAULT 0
);

-- Job listings
CREATE TABLE jobs (
  id, external_id, title, company, url, apply_url,
  location, remote INTEGER,
  job_type,           -- full-time | internship
  domain,             -- primary domain bucket
  tags TEXT,          -- JSON array
  description TEXT,
  date_posted, sponsorship, source,
  hash TEXT UNIQUE,   -- md5(title|company|url) for deduplication
  score INTEGER,      -- 0–14 stack-match score
  first_seen, notified INTEGER DEFAULT 0
);
```

---

## 🔒 Privacy

- All data stays on your machine
- No analytics, no telemetry, no external accounts required
- The only outbound connections are to public GitHub raw URLs, RemoteOK, The Muse, and your own SMTP relay
- `.env` credentials are gitignored and never leave your machine

---

## 📄 License

MIT — use freely, modify freely.
