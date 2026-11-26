// Administration → Approval matrix and Users & roles (Nov 20, 2026; Nov 25 design). Both read what the server enforces.
const ic = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const I = {
  people: ic('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'),
  person: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
  shield: ic('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  clock: ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  layers: ic('<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>'),
  list: ic('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
  key: ic('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>'),
  crown: ic('<path d="m3 8 4.5 4L12 5l4.5 7L21 8l-2 11H5Z"/>'),
  gear: ic('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>'),
  folder: ic('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
  bars: ic('<path d="M6 20V12M12 20V6M18 20v-9"/>'),
  coins: ic('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>'),
  search: ic('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  info: ic('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'),
  check: ic('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
  eye: ic('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  lock: ic('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  pen: ic('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/>'),
  doc: ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  dl: ic('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
  plus: ic('<path d="M12 5v14M5 12h14"/>'),
  userplus: ic('<circle cx="9" cy="8" r="4"/><path d="M2 21c0-3.9 3.1-7 7-7 1.8 0 3.4.7 4.6 1.8M19 14v6M16 17h6"/>'),
  money: ic('<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>'),
  cal: ic('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
  edit: ic('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="m10 15 5-5 2 2-5 5H10Z"/>'),
};
const head = (icon, title, sub, tools = '') => `<header class="ax-head"><span class="ax-head-ico">${icon}</span><div><small>People Operations</small><h1>${title}</h1><p>${sub}</p></div><div class="ax-tools">${tools}</div></header>`;
const card = (tone, icon, value, label, sub = '') => `<div class="ax-card ax-${tone}"><span>${icon}</span><div><strong>${value}</strong><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;

export async function approvalsPage({ api, esc, shell }) {
  shell('<div class="loading">Loading…</div>');
  const rows = await api('/approval-matrix');
  const areas = [...new Set(rows.map(r => r.area))], roles = [...new Set(rows.flatMap(r => `${r.prepares}, ${r.approves}`.split(/,| or /).map(x => x.trim()).filter(x => x && x !== '—' && x !== '-')))];
  const f = { area: '', role: '', q: '' };
  const actIcon = a => (/payroll|salary|rate/i.test(a) ? I.money : /overtime|late|time/i.test(a) ? I.clock : /attendance|correction|leave/i.test(a) ? I.cal : /rule|version|memo|policy/i.test(a) ? I.doc : I.edit);
  const tone = area => ['red', 'violet', 'blue', 'green', 'amber'][areas.indexOf(area) % 5];
  const draw = () => {
    const q = f.q.trim().toLowerCase();
    const list = rows.filter(r => (!f.area || r.area === f.area) && (!f.role || `${r.prepares} ${r.approves}`.includes(f.role)) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
    shell(`<div class="ax">${head(I.edit, 'Approval Matrix', 'Who prepares and who approves each action. Built from the rules the system enforces.', `<label class="ax-search">${I.search}<input type="search" data-ax="q" value="${esc(f.q)}" placeholder="Search action, area, or role…" aria-label="Search action, area, or role"></label><button class="ax-btn" data-ax-export>${I.dl}Export</button>`)}
      <div class="ax-cards">${card('red', I.layers, areas.length, 'Areas', esc(areas.join(', ')))}${card('amber', I.list, rows.length, 'Actions', 'System rules')}${card('green', I.people, roles.length, 'Roles Involved', esc(roles.slice(0, 3).join(', ')) + (roles.length > 3 ? '…' : ''))}${card('violet', I.shield, 'Automated', 'Rule-Based Approvals', 'Enforced by the system')}</div>
      <section class="ax-panel"><div class="ax-filters"><select data-ax="area" aria-label="Area"><option value="">All Areas</option>${areas.map(a => `<option ${a === f.area ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select><select data-ax="role" aria-label="Role"><option value="">All Roles</option>${roles.map(r => `<option ${r === f.role ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
        <div class="ax-table"><table><thead><tr><th>#</th><th>Area</th><th>Action</th><th>Prepared / Requested By</th><th>Approved By</th><th>Rule / Notes</th></tr></thead><tbody>
        ${list.map((r, i) => `<tr><td><span class="ax-num">${i + 1}</span></td><td><span class="ax-area ax-a-${tone(r.area)}">${esc(r.area)}</span></td><td><span class="ax-action"><i>${actIcon(r.action)}</i><strong>${esc(r.action)}</strong></span></td><td><span class="ax-who"><i>${I.people}</i>${esc(r.prepares)}</span></td><td>${r.approves && r.approves !== '—' ? `<span class="ax-who ax-ok"><i>${I.check}</i>${esc(r.approves)}</span>` : '—'}</td><td><span class="ax-rule"><i>${I.doc}</i>${esc(r.rule)}</span></td></tr>`).join('') || '<tr><td colspan="6" class="ax-empty">No rules match these filters.</td></tr>'}
        </tbody></table></div></section>
      <p class="ax-note">${I.info}<strong>Approvals are recorded with the approver's own account.</strong> Shared logins cannot be traced to a person; give each approver a named account (Users &amp; roles). The service account (AI assistant) can only read.</p></div>`);
    const root = document.querySelector('.content');
    const q2 = root.querySelector('[data-ax="q"]');
    q2.oninput = () => { f.q = q2.value; const pos = q2.selectionStart; draw(); const again = document.querySelector('[data-ax="q"]'); again.focus(); again.setSelectionRange(pos, pos); };
    root.querySelectorAll('select[data-ax]').forEach(el => { el.onchange = () => { f[el.dataset.ax] = el.value; draw(); }; });
    root.querySelector('[data-ax-export]').onclick = () => {
      const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`, csv = [['Area', 'Action', 'Prepared / requested by', 'Approved by', 'Rule'], ...list.map(r => [r.area, r.action, r.prepares, r.approves, r.rule])].map(r => r.map(cell).join(',')).join('\r\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'approval-matrix.csv'; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    };
  };
  draw();
}
// Simplified (Nov 23, 2026): roles in use with their accounts; a note only where something needs doing; unused roles in one line.
export async function usersPage({ api, esc, shell, badge, account }) {
  shell('<div class="loading">Loading…</div>');
  const rows = await api('/users-roles'), used = rows.filter(r => r.accounts), unused = rows.filter(r => !r.accounts);
  const total = used.reduce((n, r) => n + r.accounts, 0), attention = used.reduce((n, r) => n + (r.mfaRequired ? r.accounts - r.withMfa : 0) + (r.unnamed || 0), 0);
  const roleIcon = l => (/system administrator/i.test(l) ? I.crown : /company admin|hr head/i.test(l) ? I.gear : /hr|maker/i.test(l) ? I.folder : /auditor|viewer|finance/i.test(l) ? I.bars : /payroll/i.test(l) ? I.coins : /supervisor/i.test(l) ? I.people : I.person);
  const access = l => (/system administrator/i.test(l) ? ['green', I.check, 'Full Access'] : /company admin|hr head/i.test(l) ? ['amber', I.pen, 'Limited (HR & People Modules)'] : /payroll/i.test(l) ? ['amber', I.pen, 'Payroll Modules'] : /hr|maker/i.test(l) ? ['green', I.check, 'HR Module Access'] : /auditor|viewer|finance|service/i.test(l) ? ['amber', I.eye, 'View Only (Reports & Records)'] : /supervisor/i.test(l) ? ['amber', I.pen, 'Team Approvals'] : ['grey', I.lock, 'Own Records Only']);
  const notes = r => [
    r.mfaRequired && r.withMfa < r.accounts ? badge(`${r.accounts - r.withMfa} must set up two-factor sign-in`, 'pending') : '',
    r.unnamed ? badge(`${r.unnamed} not linked to a person`, 'rejected') : '',
  ].filter(Boolean).join(' ');
  const draw = (q = '') => {
    const list = used.filter(r => !q || `${r.label} ${r.scope}`.toLowerCase().includes(q.toLowerCase()));
    shell(`<div class="ax">${head(I.people, 'Users &amp; Roles', 'View and manage user roles, permissions, and access across the system.', `<label class="ax-search">${I.search}<input type="search" data-ur-q value="${esc(q)}" placeholder="Search role…" aria-label="Search role"></label><button class="ax-btn ax-primary" data-open-accounts>${I.userplus}Manage Accounts</button>`)}
      <div class="ax-cards">${card('red', I.people, used.length, 'Roles Configured')}${card('amber', I.person, total, 'Total Accounts')}${card('green', I.shield, total - attention, 'Accounts Ready', 'Two-factor and named where required')}${card('amber', I.clock, attention, 'Needs Attention')}</div>
      <section class="ax-panel"><div class="ax-table"><table><thead><tr><th>${I.person}Role</th><th>${I.layers}What they can do</th><th>${I.people}Accounts</th><th>${I.key}Access &amp; Actions</th></tr></thead><tbody>
      ${list.map(r => { const [tone, aIcon, aText] = access(r.label); return `<tr><td><span class="ur-role"><i>${roleIcon(r.label)}</i>${esc(r.label)}</span></td><td class="ur-scope">${esc(r.scope)}${notes(r) ? `<div class="ur-notes">${notes(r)}</div>` : ''}</td><td>${r.people ? `<details class="role-people ur-count"><summary title="Show who has this role">${r.accounts}</summary><ul>${r.people.map(p => `<li><strong>${esc(p.name || p.username)}</strong>${p.name ? ` <small class="muted">${esc(p.username)}</small>` : ''}${r.mfaRequired && !p.twoFactor ? ' <small class="muted">· two-factor not set up</small>' : ''}</li>`).join('')}</ul></details>` : `<span class="ur-count"><summary>${r.accounts}</summary></span>`}</td><td><span class="ur-access ur-${tone}">${aIcon}${aText}</span></td></tr>`; }).join('') || '<tr><td colspan="4" class="ax-empty">No roles match.</td></tr>'}
      </tbody></table></div>
      ${unused.length ? `<p class="ax-sub">No accounts yet: ${unused.map(r => esc(r.label)).join(' · ')}</p>` : ''}</section>
      <p class="ax-note">${I.info}<strong>Note:</strong> Permissions are based on each role (role-based access); a login's companies and salary / sensitive-file access are set per account in Account &amp; access.</p></div>`);
    document.querySelector('[data-open-accounts]')?.addEventListener('click', () => account());
    const box = document.querySelector('[data-ur-q]');
    box.oninput = () => { const pos = box.selectionStart, v = box.value; draw(v); const again = document.querySelector('[data-ur-q]'); again.focus(); again.setSelectionRange(pos, pos); };
  };
  draw();
}
