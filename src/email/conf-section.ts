import { type ConferenceRow } from '../db/conferences.js';

const DOMAIN_ICON: Record<string, string> = {
  'Cybersecurity':   '&#128274;',
  'SecOps':          '&#128737;',
  'DevSecOps':       '&#128272;',
  'Cloud Computing': '&#9729;',
  'DevOps':          '&#9881;',
  'SysAdmin':        '&#128421;',
  'Web Development': '&#127760;',
  'JavaScript':      '&#128123;',
  'TypeScript':      '&#128310;',
  'React':           '&#9883;',
  'Networking':      '&#128279;',
  'General Tech':    '&#128187;',
  'CSS / Frontend':  '&#127912;',
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso + 'T00:00:00').getTime() - Date.now()) / 86_400_000);
}

function groupByPrimary(rows: ConferenceRow[]): Map<string, ConferenceRow[]> {
  const map = new Map<string, ConferenceRow[]>();
  for (const r of rows) {
    const topics: string[] = JSON.parse(r.topics);
    const primary = topics[0] ?? 'General Tech';
    if (!map.has(primary)) map.set(primary, []);
    map.get(primary)!.push(r);
  }
  return map;
}

export function buildConferenceSection(rows: ConferenceRow[]): string {
  if (!rows.length) return '';

  const today   = new Date().toISOString().slice(0, 10);
  const cfpSoon = rows.filter(c => c.cfpDeadline && c.cfpDeadline >= today && daysUntil(c.cfpDeadline) <= 14);
  const groups  = groupByPrimary(rows);

  // ─── CFP closing soon banner ─────────────────────────────────────────────
  const cfpBanner = cfpSoon.length ? `
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;
                padding:14px 16px;margin-bottom:18px;">
      <div style="font-size:14px;font-weight:700;color:#c2410c;margin-bottom:8px;">
        &#9889; CFP Closing Soon
      </div>
      ${cfpSoon.map(c => {
        const d = daysUntil(c.cfpDeadline!);
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;
                      padding:6px 0;border-bottom:1px solid #fed7aa;flex-wrap:wrap;gap:6px;">
            <div>
              <a href="${c.cfpUrl ?? c.url}" style="font-weight:600;color:#9a3412;text-decoration:none;font-size:13px;"
                 target="_blank">${c.name}</a>
              <div style="font-size:11px;color:#c2410c;">Deadline: ${fmtDate(c.cfpDeadline!)}</div>
            </div>
            <span style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;
                         padding:3px 10px;border-radius:20px;white-space:nowrap;">
              ${d <= 1 ? 'TODAY!' : `${d} days left`}
            </span>
          </div>`;
      }).join('')}
    </div>` : '';

  // ─── Domain sections ──────────────────────────────────────────────────────
  const sections = [...groups.entries()].map(([domain, confs]) => {
    const ico   = DOMAIN_ICON[domain] ?? '&#128197;';
    const items = confs.map(c => {
      const dateRange = c.endDate && c.endDate !== c.startDate
        ? `${fmtDate(c.startDate)} &ndash; ${fmtDate(c.endDate)}`
        : fmtDate(c.startDate);
      const cfp = c.cfpDeadline
        ? `<div style="margin-top:3px;">
             <span style="background:#fef2f2;color:#b91c1c;font-size:11px;padding:2px 8px;
                          border-radius:10px;border:1px solid #fecaca;">
               &#9200; CFP: ${fmtDate(c.cfpDeadline)}${c.cfpUrl ? ` &mdash; <a href="${c.cfpUrl}" style="color:#b91c1c;">Submit</a>` : ''}
             </span>
           </div>` : '';
      return `
        <div style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
          <a href="${c.url}" style="font-weight:600;color:#1d4ed8;text-decoration:none;font-size:13px;"
             target="_blank">${c.name}</a>
          <div style="font-size:12px;color:#64748b;margin-top:3px;">
            &#128205; ${c.city} &bull; &#128197; ${dateRange}
          </div>
          ${cfp}
        </div>`;
    }).join('');

    return `
      <div style="margin-bottom:20px;">
        <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:4px;">
          ${ico}&nbsp; ${domain}
          <span style="font-size:11px;font-weight:400;color:#94a3b8;">(${confs.length})</span>
        </div>
        ${items}
      </div>`;
  }).join('');

  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:20px;">
      <h2 style="margin:0 0 18px;font-size:18px;font-weight:800;color:#0f172a;
                 padding-bottom:10px;border-bottom:3px solid #7c3aed;">
        &#127881; Upcoming USA Tech Conferences
        <span style="font-size:13px;font-weight:400;color:#94a3b8;margin-left:6px;">${rows.length} events</span>
      </h2>
      ${cfpBanner}${sections}
      <div style="margin-top:8px;font-size:11px;color:#94a3b8;text-align:right;">Source: confs.tech</div>
    </div>`;
}
