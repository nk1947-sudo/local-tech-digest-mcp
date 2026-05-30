import { type ConferenceRow } from '../db/conferences.js';

const DOMAIN_ICON: Record<string, string> = {
  'Cybersecurity':    '&#128274;',
  'SecOps':           '&#128737;',
  'DevSecOps':        '&#128272;',
  'Cloud Computing':  '&#9729;',
  'DevOps':           '&#9881;',
  'SysAdmin':         '&#128421;',
  'Web Development':  '&#127760;',
  'JavaScript':       '&#128123;',
  'TypeScript':       '&#128310;',
  'React':            '&#9883;',
  'Networking':       '&#128279;',
  'General Tech':     '&#128187;',
  'CSS / Frontend':   '&#127912;',
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
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

  const groups   = groupByPrimary(rows);
  const sections = [...groups.entries()].map(([domain, confs]) => {
    const ico = DOMAIN_ICON[domain] ?? '&#128197;';
    const cards = confs.map(c => {
      const dateRange = c.endDate && c.endDate !== c.startDate
        ? `${fmtDate(c.startDate)} &ndash; ${fmtDate(c.endDate)}`
        : fmtDate(c.startDate);
      const cfp = c.cfpDeadline
        ? `<div style="margin-top:5px;">
             <span style="background:#fef2f2;color:#b91c1c;font-size:11px;
                          padding:2px 8px;border-radius:10px;border:1px solid #fecaca;">
               &#9200; CFP closes ${fmtDate(c.cfpDeadline)}
               ${c.cfpUrl ? `&nbsp;&mdash;&nbsp;<a href="${c.cfpUrl}" style="color:#b91c1c;">Submit</a>` : ''}
             </span>
           </div>`
        : '';
      return `
        <div style="padding:12px 0;border-bottom:1px solid #f1f5f9;">
          <a href="${c.url}" style="font-weight:600;color:#1d4ed8;text-decoration:none;font-size:14px;"
             target="_blank">${c.name}</a>
          <div style="font-size:12px;color:#64748b;margin-top:3px;">
            &#128205; ${c.city}&nbsp; &bull; &nbsp;&#128197; ${dateRange}
          </div>
          ${cfp}
        </div>`;
    }).join('');

    return `
      <div style="margin-bottom:22px;">
        <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:4px;">
          ${ico}&nbsp; ${domain}
          <span style="font-size:12px;font-weight:400;color:#94a3b8;">(${confs.length})</span>
        </div>
        ${cards}
      </div>`;
  }).join('');

  return `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px;margin-bottom:20px;">
      <h2 style="margin:0 0 18px;font-size:18px;font-weight:800;color:#0f172a;
                 padding-bottom:10px;border-bottom:3px solid #7c3aed;">
        &#127881; Upcoming USA Tech Conferences
        <span style="font-size:13px;font-weight:400;color:#94a3b8;margin-left:6px;">
          ${rows.length} event${rows.length !== 1 ? 's' : ''}
        </span>
      </h2>
      ${sections}
      <div style="margin-top:12px;font-size:11px;color:#94a3b8;text-align:right;">
        Source: confs.tech open dataset
      </div>
    </div>`;
}
