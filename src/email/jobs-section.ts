import { type JobRow } from '../db/jobs.js';

const DOMAIN_ICON: Record<string, string> = {
  'Cybersecurity':   '&#128274;',
  'Cloud / DevOps':  '&#9729;&#9881;',
  'Web Development': '&#127760;',
  'SysAdmin':        '&#128421;',
};

const DOMAIN_COLOR: Record<string, string> = {
  'Cybersecurity':   '#dc2626',
  'Cloud / DevOps':  '#2563eb',
  'Web Development': '#059669',
  'SysAdmin':        '#7c3aed',
};

function scoreBar(score: number): string {
  const max   = 14;
  const pct   = Math.min(Math.round((score / max) * 100), 100);
  const color = score >= 8 ? '#16a34a' : score >= 4 ? '#d97706' : '#94a3b8';
  return `
    <div style="display:flex;align-items:center;gap:6px;margin-top:6px;">
      <span style="font-size:11px;color:#94a3b8;white-space:nowrap;">Match</span>
      <div style="flex:1;height:5px;background:#f1f5f9;border-radius:3px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;"></div>
      </div>
      <span style="font-size:11px;color:${color};font-weight:700;min-width:30px;">${score}/${max}</span>
    </div>`;
}

function pill(text: string, bg: string, fg: string, border: string): string {
  return `<span style="display:inline-block;padding:2px 8px;margin:2px 2px 0 0;font-size:11px;
                        border-radius:10px;background:${bg};color:${fg};border:1px solid ${border};">${text}</span>`;
}

function sponsorBadge(s: string | null): string {
  if (!s) return '';
  if (s === 'Offers Sponsorship') return pill('&#10003; Visa Sponsor', '#dcfce7', '#166534', '#bbf7d0');
  return '';
}

function groupByDomain(rows: JobRow[]): Map<string, JobRow[]> {
  const map = new Map<string, JobRow[]>();
  for (const r of rows) {
    if (!map.has(r.domain)) map.set(r.domain, []);
    map.get(r.domain)!.push(r);
  }
  // sort domains by avg score descending
  return new Map(
    [...map.entries()].sort(([, a], [, b]) => {
      const avg = (arr: JobRow[]) => arr.reduce((s, j) => s + j.score, 0) / arr.length;
      return avg(b) - avg(a);
    }),
  );
}

export function buildJobsSection(rows: JobRow[], mode: 'usa' | 'international' = 'usa'): string {
  if (!rows.length) return '';

  const isIntl     = mode === 'international';
  const groups     = groupByDomain(rows);
  const sections   = [...groups.entries()].map(([domain, jobs]) => {
    const ico   = DOMAIN_ICON[domain]  ?? '&#128197;';
    const color = DOMAIN_COLOR[domain] ?? '#64748b';

    const cards = jobs.map(j => {
      const tags: string[] = JSON.parse(j.tags);
      const tagBadges = tags.slice(0, 5)
        .map(t => pill(t, '#f8fafc', '#475569', '#e2e8f0'))
        .join('');

      const typeLabel  = j.job_type === 'internship'
        ? pill('Internship', '#ede9fe', '#5b21b6', '#ddd6fe')
        : pill('Full-Time',  '#e0f2fe', '#0369a1', '#bae6fd');
      const remotePill = j.remote ? pill('&#127968; Remote', '#dcfce7', '#166534', '#bbf7d0') : '';
      const sponsor    = sponsorBadge(j.sponsorship);
      const dateStr    = j.date_posted
        ? `<span style="font-size:11px;color:#94a3b8;">Posted ${j.date_posted}</span>`
        : '';

      const borderColor = j.score >= 8 ? '#16a34a' : j.score >= 4 ? '#d97706' : '#e2e8f0';

      return `
        <div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid ${borderColor};
                    border-radius:8px;padding:14px 16px;margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
            <div style="flex:1;min-width:0;">
              <a href="${j.url}" style="font-weight:700;font-size:14px;color:#1d4ed8;text-decoration:none;
                                        word-break:break-word;" target="_blank">${j.title}</a>
              <div style="font-size:12px;color:#475569;margin-top:2px;">
                &#127970; ${j.company}
                ${j.location ? `&nbsp;&bull;&nbsp;&#128205; ${j.location}` : ''}
              </div>
            </div>
            <div style="flex-shrink:0;text-align:right;">${dateStr}</div>
          </div>

          <div style="margin-top:8px;line-height:1.8;">${typeLabel}${remotePill}${sponsor}</div>
          ${tagBadges ? `<div style="margin-top:4px;line-height:1.8;">${tagBadges}</div>` : ''}

          ${scoreBar(j.score)}

          <div style="margin-top:10px;">
            <a href="${j.apply_url ?? j.url}"
               style="display:inline-block;padding:6px 16px;background:#1d4ed8;color:#fff;
                      font-size:12px;font-weight:700;border-radius:6px;text-decoration:none;"
               target="_blank">Apply &rarr;</a>
          </div>
        </div>`;
    }).join('');

    return `
      <div style="margin-bottom:24px;">
        <div style="font-size:15px;font-weight:700;color:${color};margin-bottom:10px;
                    padding-left:8px;border-left:3px solid ${color};">
          ${ico}&nbsp; ${domain}
          <span style="font-size:12px;font-weight:400;color:#94a3b8;">
            &nbsp;${jobs.length} role${jobs.length !== 1 ? 's' : ''}
          </span>
        </div>
        ${cards}
      </div>`;
  }).join('');

  const headerIcon  = isIntl ? '&#127758;' : '&#128188;';
  const headerTitle = isIntl ? 'International Opportunities' : 'New Entry-Level Openings (USA)';
  const accentColor = isIntl ? '#7c3aed' : '#1d4ed8';
  const bgColor     = isIntl ? '#faf5ff' : '#f8fafc';
  const intlNote    = isIntl
    ? `<div style="background:#ede9fe;border:1px solid #ddd6fe;border-radius:8px;
                   padding:10px 14px;margin-bottom:16px;font-size:12px;color:#5b21b6;">
         &#8505;&#65039; These roles are based outside the USA. Visa/relocation requirements vary.
         Verify work authorization before applying.
       </div>`
    : '';

  return `
    <div style="background:${bgColor};border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:20px;">
      <h2 style="margin:0 0 18px;font-size:18px;font-weight:800;color:#0f172a;
                 padding-bottom:10px;border-bottom:3px solid ${accentColor};">
        ${headerIcon} ${headerTitle}
        <span style="font-size:13px;font-weight:400;color:#94a3b8;margin-left:6px;">
          ${rows.length} position${rows.length !== 1 ? 's' : ''}
        </span>
      </h2>
      ${intlNote}
      ${sections}
      <div style="margin-top:8px;font-size:11px;color:#94a3b8;text-align:right;">
        Sources: SimplifyJobs &middot; RemoteOK &middot; The Muse
      </div>
    </div>`;
}
