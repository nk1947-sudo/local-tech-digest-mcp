export type Domain = 'Cybersecurity' | 'Cloud / DevOps' | 'Web Development' | 'SysAdmin';

// ─── Gate 1: level ───────────────────────────────────────────────────────────
// Title must indicate an entry-level position.

const LEVEL_RE = /\b(junior|entry[\s\-]?level|associate|\bl1\b|graduate|new[\s\-]?grad|intern(ship)?)\b/i;

export function passesLevelFilter(title: string): boolean {
  return LEVEL_RE.test(title);
}

// ─── Gate 2: exclusion ───────────────────────────────────────────────────────
// Reject if title OR description contains any of these patterns.

const EXCLUDE_PATTERNS: RegExp[] = [
  /\bus[\s\-]?citizen(ship)?[\s\-]?(required|only|mandatory|preferred)\b/i,
  /\bmust[\s\-]?be[\s\-]?a?[\s\-]?(us|u\.s\.?)[\s\-]?citizen\b/i,
  /\bcitizenship[\s\-]?required\b/i,
  /\b(secret|top[\s\-]?secret|ts\/sci|ts\-sci)[\s\-]?(clearance|cleared)\b/i,
  /\bsecurity[\s\-]?clearance[\s\-]?(required|needed|mandatory)\b/i,
  /\b(active|current|valid)[\s\-]?(secret|clearance)\b/i,
  /\b(dod|department[\s\-]?of[\s\-]?defense|itar[\s\-]?compliance|u\.?s\.?\s?government[\s\-]?contractor)\b/i,
  /\bno[\s\-]?(sponsorship|visa[\s\-]?support|work[\s\-]?visa[\s\-]?sponsor)\b/i,
  /\bsponsorship[\s\-]?(is[\s\-]?not|not|cannot[\s\-]?be)[\s\-]?(available|offered|provided)\b/i,
  /\bwe[\s\-]?do[\s\-]?not[\s\-]?sponsor\b/i,
];

export function passesExclusionFilter(title: string, description: string): boolean {
  const combined = `${title} ${description}`;
  return !EXCLUDE_PATTERNS.some(re => re.test(combined));
}

// ─── Gate 3: domain detection ─────────────────────────────────────────────────
// Checks title, tags, and first 600 chars of description.

const DOMAIN_PATTERNS: [Domain, RegExp][] = [
  [
    'Cybersecurity',
    /\b(security|infosec|cyber|soc\b|devsecops|secops|siem|sast|dast|penetration|pentest|vulnerabilit|threat[\s\-]?intel|incident[\s\-]?response|blue[\s\-]?team|red[\s\-]?team|malware|forensic|appsec|security[\s\-]?analyst|security[\s\-]?engineer)\b/i,
  ],
  [
    'Cloud / DevOps',
    /\b(cloud|aws|azure|gcp|devops|dev[\s\-]?ops|kubernetes|k8s|docker|terraform|ci[\s\-]?cd|jenkins|ansible|infrastructure|platform[\s\-]?eng|site[\s\-]?reliab|sre\b|observabilit|helm|argocd|gitops)\b/i,
  ],
  [
    'Web Development',
    /\b(web[\s\-]?dev|frontend|front[\s\-]?end|backend|back[\s\-]?end|full[\s\-]?stack|react|vue|angular|node\.?js|django|flask|fast[\s\-]?api|next\.?js|rest\b|graphql|typescript|javascript|software[\s\-]?engineer|software[\s\-]?developer)\b/i,
  ],
  [
    'SysAdmin',
    /\b(linux|sysadmin|system[\s\-]?admin|server[\s\-]?admin|network[\s\-]?admin|systems[\s\-]?engineer|it[\s\-]?support|help[\s\-]?desk|desktop[\s\-]?support|windows[\s\-]?admin|active[\s\-]?directory|network[\s\-]?engineer)\b/i,
  ],
];

export function detectDomain(title: string, tags: string[], description: string): Domain | null {
  const haystack = `${title} ${tags.join(' ')} ${description.slice(0, 600)}`;
  for (const [domain, re] of DOMAIN_PATTERNS) {
    if (re.test(haystack)) return domain;
  }
  return null;
}

// ─── Scorer ──────────────────────────────────────────────────────────────────
// Scores how well a job matches the user's core tech stack.

const STACK_RULES: [RegExp, number, string][] = [
  [/\bpython\b/i,                                    2, 'Python'],
  [/\bbash\b|\bshell[\s\-]?script(ing)?\b/i,         2, 'Bash/Shell'],
  [/\blinux\b|\bdebian\b|\bubuntu\b/i,               2, 'Linux'],
  [/\baws\b|\bamazon[\s\-]?web[\s\-]?services\b/i,   2, 'AWS'],
  [/\bvulnerabilit|\bcve\b|\bnist\b|\bsoc[\s\-]?2\b|\bmitre\b|\bowasp\b/i, 2, 'Security concepts'],
  [/\bdocker\b|\bkubernetes\b|\bk8s\b/i,             1, 'Docker/K8s'],
  [/\bterraform\b|\biac\b|\binfrastructure[\s\-]?as[\s\-]?code\b/i, 1, 'Terraform/IaC'],
  [/\bgit\b|\bgithub\b|\bgitlab\b/i,                 1, 'Git'],
  [/\bnetwork(ing)?\b/i,                             1, 'Networking'],
];

export interface ScoreResult {
  score:   number;
  matched: string[];
}

export function scoreJob(title: string, description: string): ScoreResult {
  const haystack = `${title} ${description}`;
  let score = 0;
  const matched: string[] = [];
  for (const [re, pts, label] of STACK_RULES) {
    if (re.test(haystack)) { score += pts; matched.push(label); }
  }
  return { score, matched };
}

// ─── HTML stripper ───────────────────────────────────────────────────────────

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Full pipeline ────────────────────────────────────────────────────────────

export interface PipelineResult {
  accepted:      boolean;
  domain:        Domain | null;
  score:         number;
  stackHits:     string[];
  rejectReason?: 'level' | 'exclusion' | 'domain';
}

export function runPipeline(opts: {
  title:       string;
  description: string;
  tags:        string[];
}): PipelineResult {
  const { title, tags } = opts;
  const desc = stripHtml(opts.description);

  if (!passesLevelFilter(title)) {
    return { accepted: false, domain: null, score: 0, stackHits: [], rejectReason: 'level' };
  }
  if (!passesExclusionFilter(title, desc)) {
    return { accepted: false, domain: null, score: 0, stackHits: [], rejectReason: 'exclusion' };
  }

  const domain = detectDomain(title, tags, desc);
  if (!domain) {
    return { accepted: false, domain: null, score: 0, stackHits: [], rejectReason: 'domain' };
  }

  const { score, matched } = scoreJob(title, desc);
  return { accepted: true, domain, score, stackHits: matched };
}
