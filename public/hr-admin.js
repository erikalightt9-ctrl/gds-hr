// Data sheet review (HR) and Settings (System Administrator).
import { fmtDateTime, who } from './hr-common.js';

export function createAdmin(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  const SHEET = { submitted: ['Submitted', 'pending'], 'under-review': ['Under review', 'pending'], approved: ['Approved', ''], returned: ['Returned for correction', 'neutral'], rejected: ['Rejected', 'rejected'], draft: ['Draft', 'neutral'] };
  const LABELS = { firstName: 'First name', middleName: 'Middle name', lastName: 'Last name', suffix: 'Suffix', preferredName: 'Preferred name', sex: 'Sex', birthDate: 'Date of birth', birthPlace: 'Place of birth', civilStatus: 'Civil status', nationality: 'Nationality', personalEmail: 'Personal email', mobile: 'Mobile', currentAddress: 'Current address', permanentAddress: 'Permanent address', name: 'Contact person', relationship: 'Relationship', contact: 'Contact number', tin: 'TIN', sss: 'SSS', philHealth: 'PhilHealth', pagIbig: 'Pag-IBIG' };

  // ---------- Data sheet submissions (Nov 25, 2026 design) ----------
  const DS_PAGE = 10;
  const dsIco = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const DSI = {
    doc: dsIco('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    people: dsIco('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'),
    check: dsIco('<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>'),
    clock: dsIco('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    issue: dsIco('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>'),
    arrow: dsIco('<path d="M5 12h14M13 6l6 6-6 6"/>'),
    history: dsIco('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
    search: dsIco('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    filter: dsIco('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    export: dsIco('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
    dept: dsIco('<rect x="4" y="4" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>'),
    more: dsIco('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    prev: dsIco('<path d="m14 6-6 6 6 6"/>'), next: dsIco('<path d="m10 6 6 6-6 6"/>'),
  };
  const DS_TONES = ['blue', 'green', 'violet', 'teal', 'orange'];
  const OPEN = s => ['submitted', 'under-review'].includes(s.status);
  const ISSUE = s => ['returned', 'rejected'].includes(s.status);
  const thisMonth = s => (s.submittedAt || '').slice(0, 7) === new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
  const dsWhen = iso => (iso ? `${esc(new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }))}<small>${esc(new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }))}</small>` : '—');
  const dsView = { tab: 'open', q: '', status: '', dept: '', kpi: '', page: 1 };
  let dsList = [], dsPeople = new Map();

  async function datasheets() {
    shell('<div class="loading">Loading…</div>');
    const [list, people] = await Promise.all([api('/hr/datasheets'), api('/hr/employees').catch(() => [])]);
    dsList = list; dsPeople = new Map((Array.isArray(people) ? people : []).map(p => [p.id, p]));
    drawSheets();
  }
  function sheetRows() {
    const q = dsView.q.trim().toLowerCase();
    return dsList.filter(s => dsView.kpi === 'month' || (dsView.tab === 'open' ? OPEN(s) : !OPEN(s)))
      .filter(s => !dsView.kpi || (dsView.kpi === 'month' ? thisMonth(s) : dsView.kpi === 'issues' ? ISSUE(s) : dsView.kpi === 'approved' ? s.status === 'approved' : true))
      .filter(s => !dsView.status || s.status === dsView.status)
      .filter(s => !dsView.dept || (s.department || '') === dsView.dept)
      .filter(s => !q || `${s.name} ${dsPeople.get(s.employeeId)?.number || s.employeeId}`.toLowerCase().includes(q));
  }
  function drawSheets() {
    const open = dsList.filter(OPEN), rows = sheetRows(), pages = Math.max(1, Math.ceil(rows.length / DS_PAGE));
    dsView.page = Math.min(dsView.page, pages);
    const shown = rows.slice((dsView.page - 1) * DS_PAGE, dsView.page * DS_PAGE);
    const depts = [...new Set(dsList.map(s => s.department).filter(Boolean))].sort();
    const kpi = (key, tone, icon, value, label) => `<button class="ds-kpi ds-${tone}${dsView.kpi === key ? ' on' : ''}" data-ds-kpi="${key}"><span class="ds-kpi-ico">${icon}</span><span><strong>${value}</strong><small>${label}</small></span><i>${DSI.arrow}</i></button>`;
    const avatar = s => { const ini = String(s.name).split(',').reverse().join(' ').trim().split(/\s+/).filter(Boolean).map(x => x[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join('').toUpperCase(); return `<span class="ds-av"><span>${esc(ini)}</span><img src="/api/hr/employees/${encodeURIComponent(s.employeeId)}/photo" alt="" data-ds-photo></span>`; };
    const tone = d => DS_TONES[[...String(d)].reduce((n, c) => n + c.charCodeAt(0), 0) % DS_TONES.length];
    const decision = s => `<span class="ds-badge ds-b-${esc(s.status)}">${s.status === 'approved' ? DSI.check : DSI.clock}${esc(SHEET[s.status]?.[0] || s.status)}</span>`;
    const pageBtns = Array.from({ length: pages }, (_, i) => i + 1).filter(n => pages <= 7 || Math.abs(n - dsView.page) <= 2 || n === 1 || n === pages);
    shell(`<div class="ds">
      <section class="ds-hero"><span class="ds-hero-ico">${DSI.doc}</span><div><h1>Data Sheet Submissions</h1><p>Employees submit their information from their own account.<br>Nothing changes in the employee record until HR approves it.</p></div><p class="ds-motto">“Build on Trust,<br>Backed by Expertise”</p></section>
      <div class="ds-kpis">${kpi('', 'blue', DSI.people, open.length, 'Pending Review')}${kpi('approved', 'green', DSI.check, dsList.filter(s => s.status === 'approved').length, 'Approved')}${kpi('month', 'orange', DSI.clock, dsList.filter(thisMonth).length, 'This Month')}${kpi('issues', 'violet', DSI.issue, dsList.filter(ISSUE).length, 'With Issues')}</div>
      <div class="ds-bar"><div class="ds-tabs" role="tablist"><button role="tab" aria-selected="${dsView.tab === 'open'}" class="${dsView.tab === 'open' ? 'on' : ''}" data-ds-tab="open">${DSI.clock}Waiting for Review (${open.length})</button><button role="tab" aria-selected="${dsView.tab === 'history'}" class="${dsView.tab === 'history' ? 'on' : ''}" data-ds-tab="history">${DSI.history}History</button></div>
        <label class="ds-search">${DSI.search}<input type="search" data-ds-q value="${esc(dsView.q)}" placeholder="Search by employee name…" aria-label="Search by employee name or ID"></label>
        <details class="ds-filter"><summary>${DSI.filter}Filter${dsView.status || dsView.dept ? ' •' : ''}</summary><div class="ds-pop"><label>Decision<select data-ds-status><option value="">All</option>${Object.entries(SHEET).filter(([k]) => k !== 'draft').map(([k, [l]]) => `<option value="${k}" ${dsView.status === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label>Department<select data-ds-dept><option value="">All</option>${depts.map(d => `<option ${dsView.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label><button class="small" data-ds-clear>Clear filters</button></div></details>
        <button class="ds-export" data-ds-export>${DSI.export}Export</button></div>
      <section class="ds-table"><table><thead><tr><th>Employee</th><th>Department</th><th>Submitted On</th><th>Decision</th><th>By</th><th>When</th><th class="ds-act">Action</th></tr></thead><tbody>
        ${shown.length ? shown.map(s => `<tr><td><span class="ds-emp">${avatar(s)}<span><strong>${esc(s.name)}</strong><small>${esc(dsPeople.get(s.employeeId)?.number || s.employeeId)}</small></span></span></td><td>${s.department ? `<span class="ds-dept"><i class="ds-t-${tone(s.department)}">${DSI.dept}</i>${esc(s.department)}</span>` : '—'}</td><td class="ds-when">${dsWhen(s.submittedAt)}</td><td>${decision(s)}</td><td>${esc(who(s.reviewedBy) || '—')}</td><td class="ds-when">${dsWhen(s.reviewedAt)}</td><td class="ds-act"><button class="ds-view" data-sheet="${esc(s.id)}">${OPEN(s) ? 'Review' : 'View'}</button><details class="ds-more"><summary aria-label="More actions">${DSI.more}</summary><div class="ds-pop"><button data-ds-file="${esc(s.employeeId)}">Open 201 file</button><button data-sheet="${esc(s.id)}">Open data sheet</button></div></details></td></tr>`).join('') : `<tr><td colspan="7" class="ds-empty">${dsView.tab === 'open' ? 'No data sheets waiting for review.' : 'No decisions yet.'}</td></tr>`}
      </tbody></table>
      <div class="ds-foot"><strong>${rows.length ? `Showing ${(dsView.page - 1) * DS_PAGE + 1}–${(dsView.page - 1) * DS_PAGE + shown.length} of ${rows.length} submission${rows.length === 1 ? '' : 's'}` : 'Showing 0 submissions'}</strong>
        <nav class="ds-pages" aria-label="Pages"><button data-ds-page="${dsView.page - 1}" ${dsView.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${DSI.prev}</button>${pageBtns.map(n => `<button data-ds-page="${n}" class="${n === dsView.page ? 'on' : ''}" ${n === dsView.page ? 'aria-current="page"' : ''}>${n}</button>`).join('')}<button data-ds-page="${dsView.page + 1}" ${dsView.page >= pages ? 'disabled' : ''} aria-label="Next page">${DSI.next}</button></nav></div></section>
      <p class="legend">Employees can no longer edit their profile in the portal (Nov 24, 2026); earlier submissions stay here for review and history.</p></div>`);
    const root = document.querySelector('.content');
    root.querySelectorAll('[data-ds-photo]').forEach(img => { img.addEventListener('error', () => img.remove()); img.addEventListener('load', () => { if (img.naturalWidth) img.closest('.ds-av').classList.add('has-photo'); else img.remove(); }); });
    const q = root.querySelector('[data-ds-q]');
    q.addEventListener('input', () => { dsView.q = q.value; dsView.page = 1; const pos = q.selectionStart; drawSheets(); const again = document.querySelector('[data-ds-q]'); again.focus(); again.setSelectionRange(pos, pos); });
    root.querySelector('[data-ds-status]').addEventListener('change', e => { dsView.status = e.target.value; dsView.page = 1; drawSheets(); });
    root.querySelector('[data-ds-dept]').addEventListener('change', e => { dsView.dept = e.target.value; dsView.page = 1; drawSheets(); });
    root.onclick = event => {
      const t = event.target;
      const b = t.closest('[data-sheet]'); if (b) { sheet(b.dataset.sheet); return; }
      const f = t.closest('[data-ds-file]'); if (f) { ctx.go({ page: 'employee201', id: f.dataset.dsFile }); return; }
      const tab = t.closest('[data-ds-tab]'); if (tab) { dsView.tab = tab.dataset.dsTab; dsView.page = 1; dsView.kpi = ''; drawSheets(); return; }
      const k = t.closest('[data-ds-kpi]'); if (k) { dsView.kpi = k.dataset.dsKpi; if (k.dataset.dsKpi !== 'month') dsView.tab = k.dataset.dsKpi ? 'history' : 'open'; dsView.page = 1; drawSheets(); return; }
      const p = t.closest('[data-ds-page]'); if (p && !p.disabled) { dsView.page = Number(p.dataset.dsPage); drawSheets(); return; }
      if (t.closest('[data-ds-clear]')) { dsView.status = ''; dsView.dept = ''; dsView.page = 1; drawSheets(); return; }
      if (t.closest('[data-ds-export]')) { exportSheets(rows); return; }
      root.querySelectorAll('.ds details[open]').forEach(d => { if (!d.contains(t)) d.open = false; });
    };
  }
  function exportSheets(rows) {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const line = r => r.map(cell).join(',');
    const csv = [line(['Employee', 'Employee ID', 'Department', 'Submitted on', 'Decision', 'By', 'When'])].concat(rows.map(s => line([s.name, dsPeople.get(s.employeeId)?.number || s.employeeId, s.department, s.submittedAt ? fmtDateTime(s.submittedAt) : '', SHEET[s.status]?.[0] || s.status, who(s.reviewedBy) || '', s.reviewedAt ? fmtDateTime(s.reviewedAt) : '']))).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = `data-sheet-submissions-${dsView.tab}.csv`; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function sheet(id) {
    try {
      const s = await api(`/hr/datasheets/${id}`), editable = ['submitted', 'under-review'].includes(s.status);
      const rows = Object.entries(s.fields).flatMap(([group, values]) => Object.entries(values).map(([k, v]) => [group, k, v, s.current[group]?.[k] ?? ''])).filter(([, , v, c]) => v || c);
      openDialog(`Data sheet · ${s.employee?.name || s.employeeId}`, `<div class="dialog-body"><p class="sub">${badge(...SHEET[s.status])} Submitted ${fmtDateTime(s.submittedAt)}</p>
        ${table(['Field', 'Submitted by employee', 'Current record', ''], rows.map(([, k, v, c]) => [esc(LABELS[k] || k), esc(v || '—'), esc(c || '—'), v && v !== c ? badge('Changed', 'pending') : '']))}
        <p class="legend">Approving copies only the fields the employee filled in. Blank fields never erase existing information. Employment details stay HR-controlled.</p>
        <h3 class="spaced">History</h3><ul class="plain-list">${s.history.map(h => `<li>${fmtDateTime(h.at)} · ${esc(h.by)} · ${esc(h.action)}${h.note ? ` — ${esc(h.note)}` : ''}</li>`).join('')}</ul></div>`,
        `<div class="dialog-foot">${editable ? `${s.status === 'submitted' ? '<button data-d="under-review">Mark under review</button>' : ''}<button data-d="return">Return for correction</button>${s.canApprove ? '<button class="danger" data-d="reject">Reject</button><button class="primary" data-d="approve">Approve and update record</button>' : '<span class="legend">An HR Manager approves.</span>'}` : ''}<button data-close>Close</button></div>`);
      dialog.querySelector('.dialog-foot').onclick = async event => {
        const d = event.target.closest('[data-d]')?.dataset.d; if (!d) return;
        const note = ['return', 'reject'].includes(d) ? window.prompt(d === 'return' ? 'What should the employee correct?' : 'Reason for rejecting:') : '';
        if (['return', 'reject'].includes(d) && !note) return;
        if (d === 'approve' && !window.confirm('Approve and copy these details into the employee record?')) return;
        try { await api(`/hr/datasheets/${id}/review`, { decision: d, note: note || '' }); toast({ approve: 'Approved. The employee record is updated.', return: 'Returned to the employee.', reject: 'Rejected.', 'under-review': 'Marked under review.' }[d]); dialog.close(); await datasheets(); } catch (error) { toast(error.message); }
      };
    } catch (error) { toast(error.message); }
  }

  // ---------- Settings ----------
  let settings = null;
  async function settingsPage() {
    shell(heading('Settings', 'Loading…') + '<div class="loading">Loading…</div>');
    settings = await api('/hr/settings');
    drawSettings();
  }
  const lines = list => esc(list.join('\n'));
  const SI = { wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 15.8a4.8 4.8 0 0 1 6.4 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>', lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>', info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>', plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>' };
  const sIcon = (k, cls = '') => `<svg class="st-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SI[k]}</svg>`;
  function reqRow(r, i) {
    return `<tr data-row="${i}"><td><input data-k="name" value="${esc(r.name)}" maxlength="200" aria-label="Requirement name"></td><td><input data-k="category" value="${esc(r.category)}" maxlength="80" aria-label="Category"></td>
      <td><input type="checkbox" data-k="required" ${r.required ? 'checked' : ''} aria-label="Required"></td><td><input type="checkbox" data-k="expires" ${r.expires ? 'checked' : ''} aria-label="Has expiry"></td><td><select data-k="providedBy" aria-label="Provided by"><option value="employee"${r.providedBy !== 'company' ? ' selected' : ''}>Employee</option><option value="company"${r.providedBy === 'company' ? ' selected' : ''}>Company / HR</option></select></td><td><input type="checkbox" data-k="restricted" ${r.restricted ? 'checked' : ''} aria-label="Restricted"></td>
      <td><input type="number" min="0" max="365" data-k="dueDays" value="${r.dueDays ?? ''}" aria-label="Due days after hire" class="narrow"></td><td><input data-k="departments" value="${esc(r.departments.join(', '))}" placeholder="All" aria-label="Departments"></td><td><input data-k="classifications" value="${esc(r.classifications.join(', '))}" placeholder="All" aria-label="Classifications"></td>
      <td><button type="button" class="st-trash" data-del="${i}" title="Remove requirement" aria-label="Remove requirement">${sIcon('trash')}</button></td></tr>`;
  }
  function drawSettings() {
    const s = settings, preview = `${[s.idFormat.prefix, s.idFormat.includeYear ? ctx.today().slice(0, 4) : ''].filter(Boolean).join('-')}${s.idFormat.prefix || s.idFormat.includeYear ? '-' : ''}${'1'.padStart(s.idFormat.digits, '0')}`;
    const field = (label, name, value, extra = '') => `<label class="field">${label}<input name="${name}" value="${esc(value ?? '')}" ${extra}></label>`;
    const ST_TAB_ICON = { 'st-wifi': '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>', 'st-phones': '<path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>', 'st-feishu': '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/>', 'st-feishu-login': '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H3"/>', 'st-company': '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3"/>', 'st-numbers': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>', 'st-requirements': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>' };
    shell(`<section class="dp-hero st-hero"><span class="st-hero-art" aria-hidden="true"><svg viewBox="0 0 100 100"><g fill="#1f4fc8"><path d="M42 8h14l2 10 8 4 9-6 10 10-6 9 4 8 10 2v14l-10 2-4 8 6 9-10 10-9-6-8 4-2 10H42l-2-10-8-4-9 6-10-10 6-9-4-8-10-2V44l10-2 4-8-6-9 10-10 9 6 8-4Z" transform="scale(.72) translate(4 4)"/></g><circle cx="38" cy="38" r="11" fill="#fff"/><g fill="#2f6df0" transform="translate(52 52) scale(.42)"><path d="M42 8h14l2 10 8 4 9-6 10 10-6 9 4 8 10 2v14l-10 2-4 8 6 9-10 10-9-6-8 4-2 10H42l-2-10-8-4-9 6-10-10 6-9-4-8-10-2V44l10-2 4-8-6-9 10-10 9 6 8-4Z"/></g><circle cx="73" cy="73" r="8" fill="#fff"/></svg></span><div class="dp-hello"><span>People Operations</span><h1>Settings</h1><p>Manage company details, attendance access, and employee records.</p></div><span class="st-admin st-admin-hero">${sIcon('lock')}System administrators only</span></section>` +
      `<nav class="st-tabs st-tabbar">${[['st-wifi', 'Office Wi-Fi'], ['st-phones', 'Phone Sign-in'], ['st-feishu', 'Feishu Alerts'], ['st-feishu-login', 'Feishu Sign-in'], ['st-company', 'Company Details'], ['st-numbers', 'Employee Numbers'], ['st-requirements', 'Document Requirements']].map(([id, label], i) => `<button type="button" data-st-jump="${id}" class="${i === 0 ? 'active' : ''}"><svg class="st-tab-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ST_TAB_ICON[id]}</svg>${label}</button>`).join('')}</nav>
      <form id="settings-form">
      <section class="panel st-panel" id="st-company"><div class="st-head"><h2>Company details</h2></div><div class="panel-body">
        <h3 class="st-group">Company identity</h3><div class="form-grid">${field('Company name', 'company.name', s.company.name, 'required maxlength="120"')}${field('System title', 'company.systemTitle', s.company.systemTitle, 'required maxlength="120"')}</div>
        <h3 class="st-group">Office location</h3><p class="legend">Time in / out on the office Wi-Fi, or within the radius of these coordinates, is shown with this address.</p><div class="form-grid">${field('Office address', 'company.officeAddress', s.company.officeAddress || '', 'maxlength="300"')}${field('Latitude', 'company.officeLatitude', s.company.officeLatitude ?? '', 'type="number" step="any" min="-90" max="90"')}${field('Longitude', 'company.officeLongitude', s.company.officeLongitude ?? '', 'type="number" step="any" min="-180" max="180"')}${field('Radius (meters)', 'company.officeRadius', s.company.officeRadius ?? 150, 'type="number" min="10" max="5000"')}${field('Off-site GPS accuracy limit (meters)', 'company.offsiteAccuracyMeters', s.company.offsiteAccuracyMeters ?? 50, 'type="number" min="5" max="1000" title="Off-site readings less accurate than this are recorded but flagged for HR review"')}</div><h3 class="st-group">Employer registration</h3><div class="form-grid">${field('SSS employer ID no.', 'company.sssEmployerNo', s.company.sssEmployerNo, 'maxlength="40"')}${field('PhilHealth employer ID no.', 'company.philhealthEmployerNo', s.company.philhealthEmployerNo, 'maxlength="40"')}${field('Pag-IBIG (HDMF) employer ID no.', 'company.pagibigEmployerNo', s.company.pagibigEmployerNo, 'maxlength="40"')}<label class="field">eGov payment fee (₱, per remittance)<span class="st-peso"><input type="number" min="0" step="0.01" name="company.egovFee" value="${s.company.egovFee ?? 15}"></span><small>Per remittance.</small></label></div>
        <h3 class="st-group">Leave form signatories</h3><div class="form-grid">${field('Verified by (name)', 'company.leaveVerifiedName', s.company.leaveVerifiedName, 'maxlength="120"')}${field('Verified by (position)', 'company.leaveVerifiedTitle', s.company.leaveVerifiedTitle, 'maxlength="120"')}${field('Approved by (name)', 'company.leaveApprovedName', s.company.leaveApprovedName, 'maxlength="120"')}${field('Approved by (position)', 'company.leaveApprovedTitle', s.company.leaveApprovedTitle, 'maxlength="120"')}</div>
        <div class="form-grid st-appearance"><div><h3 class="st-group">Appearance</h3><label class="field">Theme<span class="st-theme"><select name="company.theme"><option value="gds" ${s.company.theme === 'gds' ? 'selected' : ''}>GDS red and gold</option><option value="forest" ${s.company.theme === 'forest' ? 'selected' : ''}>Forest green</option></select><i class="st-swatch red"></i><i class="st-swatch gold"></i></span></label></div>
          <div><h3 class="st-group st-group-light">Company logo</h3><div class="st-logo"><span><img src="/gds-logo.png" alt="Company logo"></span><small>Managed by your system administrator.</small></div></div></div>
      </div></section>
      <section class="panel st-panel" id="st-numbers"><div class="st-head"><h2>Employee numbers</h2></div><div class="panel-body st-numbers">
        <div class="st-numbers-fields"><label class="field">Prefix (letters / digits)<input name="idFormat.prefix" maxlength="10" pattern="[A-Z0-9]*" value="${esc(s.idFormat.prefix)}"></label><label class="field">Digits<input type="number" name="idFormat.digits" min="3" max="8" value="${s.idFormat.digits}"></label><label class="field check"><input type="checkbox" name="idFormat.includeYear" ${s.idFormat.includeYear ? 'checked' : ''}> Include year hired</label></div>
        <div class="st-next"><span>Next employee number</span><strong>${esc(preview)}</strong><small>Or the next available number.</small></div></div></section>
      <section class="panel st-panel" id="st-requirements"><div class="st-head"><div><h2>201 document requirements</h2><p>Define required documents, deadlines, and access.</p></div><button type="button" class="st-outline" data-add-req>${sIcon('plus')}Add requirement</button></div>
        <div class="scroll-table"><table class="settings-table st-req"><thead><tr><th>Requirement</th><th>Category</th><th>Required</th><th>Expires</th><th>Provided by</th><th>Restricted</th><th>Due after hire (days)</th><th>Departments</th><th>Classifications</th><th>Action</th></tr></thead><tbody id="req-rows">${s.documentRequirements.map(reqRow).join('')}</tbody></table></div>
        <p class="panel-body legend">Restricted documents (e.g. medical or disciplinary) are visible only to HR Managers and Administrators. Leave departments / classifications blank for everyone. Company / HR documents are not shown in employee accounts.</p></section>
      <section class="panel"><div class="panel-head"><h2>Lists</h2><span class="legend">One per line</span></div><div class="panel-body form-grid three">
        <label class="field">Departments<textarea name="departments" rows="8">${lines(s.departments)}</textarea></label>
        <label class="field">Positions<textarea name="positions" rows="8">${lines(s.positions)}</textarea></label>
        <label class="field">Employment classifications<textarea name="classifications" rows="8" required>${lines(s.classifications)}</textarea></label></div></section>
      <section class="panel"><div class="panel-head"><h2>Uploads, reminders and fields</h2></div><div class="panel-body form-grid three">
        <label class="field">Photo size limit (MB)<input type="number" step="0.5" min="0.5" max="10" name="uploads.photoMB" value="${s.uploads.photoMB}"></label>
        <label class="field">Document size limit (MB)<input type="number" min="1" max="20" name="uploads.documentMB" value="${s.uploads.documentMB}"></label>
        <label class="field">Archived records kept for (years)<input type="number" min="1" max="50" name="retention.archivedYears" value="${s.retention.archivedYears}"><small>Archived records are never deleted automatically.</small></label>
        <label class="field">Probation reminder (days before)<input type="number" min="0" max="180" name="reminders.probationDays" value="${s.reminders.probationDays}"></label>
        <label class="field">Review reminder (days before)<input type="number" min="0" max="180" name="reminders.reviewDays" value="${s.reminders.reviewDays}"></label>
        <label class="field">Document expiry warning (days before)<input type="number" min="0" max="365" name="reminders.expiryDays" value="${s.reminders.expiryDays}"></label>
        <label class="field check"><input type="checkbox" name="optionalFields.birthPlace" ${s.optionalFields.birthPlace ? 'checked' : ''}> Ask for place of birth</label>
        <label class="field check"><input type="checkbox" name="optionalFields.civilStatus" ${s.optionalFields.civilStatus ? 'checked' : ''}> Ask for civil status</label>
        <label class="field check"><input type="checkbox" name="optionalFields.bloodType" ${s.optionalFields.bloodType ? 'checked' : ''}> Ask for blood type <small>Off by default. Turn on only for a defined purpose (e.g. emergency response); visible to HR Managers only.</small></label>
        <label class="field">Feb 29 birthdays and start dates, in other years<select name="celebrations.leapDay"><option value="feb28" ${(s.celebrations?.leapDay || 'feb28') === 'feb28' ? 'selected' : ''}>Celebrate on Feb 28</option><option value="mar1" ${s.celebrations?.leapDay === 'mar1' ? 'selected' : ''}>Celebrate on Mar 1</option></select></label>
        <input type="hidden" name="reminders.memoDays" value="${s.reminders.memoDays}"></div>
        </section>
      <div class="st-footer"><span>Changes apply across your organization.</span><span><button type="button" data-st-cancel>Cancel</button><button class="primary">Save settings</button></span></div></form>`);
    const form = document.querySelector('#settings-form');
    officeWifi(form);
    letterheads(form);
    phoneSignIn(form);
    feishuAlerts(form);
    feishuSignIn(form);
    document.querySelector('.st-tabs').addEventListener('click', event => {
      const b = event.target.closest('[data-st-jump]'); if (!b) return;
      document.querySelectorAll('.st-tabs button').forEach(x => x.classList.toggle('active', x === b));
      document.getElementById(b.dataset.stJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    form.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-add-req')) { collectReqs(); settings.documentRequirements.push({ id: '', name: '', category: 'Other', required: true, expires: false, restricted: false, providedBy: 'employee', dueDays: null, departments: [], classifications: [] }); drawSettings(); }
      if (b.dataset.del) { collectReqs(); settings.documentRequirements.splice(Number(b.dataset.del), 1); drawSettings(); }
      if (b.hasAttribute('data-accounts')) ctx.openAccounts();
      if (b.hasAttribute('data-st-cancel')) drawSettings();   // discard unsaved edits
    });
    form.onsubmit = async event => {
      event.preventDefault();
      collectReqs();
      const g = n => form.elements[n], list = n => g(n).value.split('\n').map(x => x.trim()).filter(Boolean);
      const next = { ...settings,
        company: { name: g('company.name').value.trim(), systemTitle: g('company.systemTitle').value.trim(), theme: g('company.theme').value, sssEmployerNo: g('company.sssEmployerNo').value.trim(), philhealthEmployerNo: g('company.philhealthEmployerNo').value.trim(), pagibigEmployerNo: g('company.pagibigEmployerNo').value.trim(), egovFee: Number(g('company.egovFee').value || 0), leaveVerifiedName: g('company.leaveVerifiedName').value.trim(), leaveVerifiedTitle: g('company.leaveVerifiedTitle').value.trim(), leaveApprovedName: g('company.leaveApprovedName').value.trim(), leaveApprovedTitle: g('company.leaveApprovedTitle').value.trim(), officeAddress: g('company.officeAddress').value.trim(), officeLatitude: g('company.officeLatitude').value === '' ? null : Number(g('company.officeLatitude').value), officeLongitude: g('company.officeLongitude').value === '' ? null : Number(g('company.officeLongitude').value), officeRadius: Number(g('company.officeRadius').value || 150), offsiteAccuracyMeters: Number(g('company.offsiteAccuracyMeters').value || 50) },
        departments: list('departments'), positions: list('positions'), classifications: list('classifications'),
        idFormat: { prefix: g('idFormat.prefix').value.trim().toUpperCase(), includeYear: g('idFormat.includeYear').checked, digits: Number(g('idFormat.digits').value) },
        uploads: { photoMB: Number(g('uploads.photoMB').value), documentMB: Number(g('uploads.documentMB').value) },
        reminders: { probationDays: Number(g('reminders.probationDays').value), reviewDays: Number(g('reminders.reviewDays').value), expiryDays: Number(g('reminders.expiryDays').value), memoDays: Number(g('reminders.memoDays').value) },
        optionalFields: { birthPlace: g('optionalFields.birthPlace').checked, civilStatus: g('optionalFields.civilStatus').checked, bloodType: g('optionalFields.bloodType').checked },
        retention: { archivedYears: Number(g('retention.archivedYears').value) },
        celebrations: { leapDay: g('celebrations.leapDay').value },
      };
      try { settings = await api('/hr/settings', next); toast('Settings saved.'); await ctx.reloadContext(); drawSettings(); } catch (error) { toast(error.message); }
    };
  }
  // Phone & fingerprint sign-in for employee accounts (src/devices.mjs): off until turned on here.
  async function phoneSignIn(form) {
    const box = document.createElement('section'); box.className = 'panel st-panel'; box.id = 'st-phones'; form.before(box);
    const draw = (d, message = '') => {
      box.innerHTML = `<div class="st-head"><h2>Phone &amp; fingerprint sign-in</h2><span class="st-chip ${d.enforce ? 'ok' : ''}"><i></i>${d.enforce ? 'On' : 'Off'}</span></div><div class="panel-body">
        <p class="legend">Employee accounts only. The first phone an employee signs in on is their registered phone. <strong>On:</strong> another phone can sign in only with the fingerprint the employee set up in Account &amp; security → Fingerprint sign-in; without it the sign-in is refused and HR is notified. <strong>Off:</strong> every phone can sign in; phones are only remembered. Phones used while it was off stay recognised.</p>
        <label class="field check"><input type="checkbox" data-phone-enforce ${d.enforce ? 'checked' : ''}> On: require the registered phone or fingerprint for employees</label>
        ${d.changedAt ? `<p class="legend">Last changed by ${ctx.esc(d.changedBy)} on ${ctx.esc(new Date(d.changedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }))}.</p>` : ''}
        ${message ? `<p class="notice success" role="status">${ctx.esc(message)}</p>` : ''}</div>`;
    };
    box.addEventListener('change', async event => {
      if (!event.target.matches('[data-phone-enforce]')) return;
      const on = event.target.checked;
      if (on && !window.confirm('Turn on phone & fingerprint sign-in? Employees who sign in on a phone other than their registered one will be refused unless they set up fingerprint sign-in first.')) { event.target.checked = false; return; }
      try { draw(await ctx.api('/devices/settings', { enforce: on }), on ? 'Turned on.' : 'Turned off.'); } catch (error) { ctx.toast(error.message); event.target.checked = !on; }
    });
    try { draw(await ctx.api('/devices/settings')); } catch (error) { box.innerHTML = `<div class="panel-body"><p class="muted">Phone sign-in settings are available after the HR server restarts. (${ctx.esc(error.message)})</p></div>`; }
  }
  // Feishu group alerts: HR notices are posted to an HR group chat through a Feishu custom bot (src/feishu.mjs).
  async function feishuAlerts(form) {
    const box = document.createElement('section'); box.className = 'panel st-panel'; box.id = 'st-feishu'; form.before(box);
    const when = s => (s ? new Date(s).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '');
    const draw = (d, message = '', ok = true) => {
      box.innerHTML = `<div class="st-head"><h2>Feishu alerts</h2><span class="st-chip ${d.enabled ? 'ok' : ''}"><i></i>${d.enabled ? 'On' : d.configured ? 'Off' : 'Not set up'}</span></div><div class="panel-body">
        <p class="legend">HR notices (attendance requests, explanations, overtime, documents, loans, leave applications, off-site time in / out, blocked sign-ins) are posted to a Feishu group. Employees' own notices are never sent.</p>
        <ol class="legend"><li>In the Feishu HR group: Settings → Bots → Add bot → <strong>Custom bot</strong>.</li><li>Copy its <strong>webhook address</strong>. Optional: turn on <strong>Signature verification</strong> and copy the secret. If you use keywords, add <strong>HR</strong>.</li><li>Paste them here, tick On, Save, then Send test message.</li></ol>
        <form data-feishu-form class="form-grid">
          <label class="field">Webhook address<input name="webhook" type="password" autocomplete="off" placeholder="${ctx.esc(d.webhook || 'https://open.feishu.cn/open-apis/bot/v2/hook/…')}"><small>${d.configured ? 'Saved. Leave blank to keep it.' : 'Not saved yet.'}</small></label>
          <label class="field">Signing secret (optional)<input name="secret" type="password" autocomplete="off" placeholder="${d.hasSecret ? 'Saved — leave blank to keep' : 'Only if signature verification is on'}"></label>
          <label class="field check"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}> On: send HR alerts to Feishu</label>
          <div class="actions"><button class="primary">Save</button><button type="button" data-feishu-test ${d.configured ? '' : 'disabled'}>Send test message</button>${d.hasSecret ? '<button type="button" data-feishu-nosecret>Remove secret</button>' : ''}${d.configured ? '<button type="button" class="danger" data-feishu-remove>Remove</button>' : ''}</div>
        </form>
        <p class="legend">${d.lastSentAt ? `Last sent: ${ctx.esc(when(d.lastSentAt))}` : 'Nothing sent yet.'}${d.lastError ? ` · <span class="st-warn">Last error (${ctx.esc(when(d.lastErrorAt))}): ${ctx.esc(d.lastError)}</span>` : ''}</p>
        ${message ? `<p class="${ok ? 'notice success' : 'form-error'}" role="status">${ctx.esc(message)}</p>` : ''}</div>`;
    };
    const run = async (body, path = '/integrations/feishu', done = '') => {
      try { const r = await ctx.api(path, body); const status = r.status || r; draw(status, r.error ? r.error : done, !r.error); }
      catch (error) { draw(await ctx.api('/integrations/feishu'), error.message, false); }
    };
    box.addEventListener('submit', event => {
      event.preventDefault(); const f = event.target;
      run({ webhook: f.elements.webhook.value, secret: f.elements.secret.value, enabled: f.elements.enabled.checked }, '/integrations/feishu', 'Saved.');
    });
    box.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-feishu-test')) run({}, '/integrations/feishu/test', 'Test message sent. Check the Feishu group.');
      if (b.hasAttribute('data-feishu-nosecret')) run({ removeSecret: true }, '/integrations/feishu', 'Secret removed.');
      if (b.hasAttribute('data-feishu-remove') && window.confirm('Remove the Feishu connection? HR alerts stop going to the group.')) run({ remove: true }, '/integrations/feishu', 'Removed.');
    });
    try { draw(await ctx.api('/integrations/feishu')); } catch (error) { box.innerHTML = `<div class="panel-body"><p class="muted">Feishu alerts are available after the HR server restarts. (${ctx.esc(error.message)})</p></div>`; }
  }
  // Sign in with Feishu (src/feishu-login.mjs): the GDS HR System app's App ID and App Secret; people link their own
  // Feishu account in Account & security. Administrator accounts keep password sign-in only.
  async function feishuSignIn(form) {
    const box = document.createElement('section'); box.className = 'panel st-panel'; box.id = 'st-feishu-login'; form.before(box);
    const draw = (d, message = '', ok = true) => {
      box.innerHTML = `<div class="st-head"><h2>Feishu sign-in</h2><span class="st-chip ${d.enabled ? 'ok' : ''}"><i></i>${d.enabled ? 'On' : d.configured ? 'Off' : 'Not set up'}</span></div><div class="panel-body">
        <p class="legend">Employees and HR staff can sign in with their Feishu account after linking it once in Account &amp; security (while signed in with their password). The HR system keeps every record; Feishu only confirms who the person is. Administrator accounts keep password sign-in. Linked accounts: <strong>${d.linked}</strong>.</p>
        <ol class="legend"><li>Feishu Developer Console → <strong>Create custom app</strong> (name it GDS HR System).</li><li>Security settings → Redirect URL: add <code>${ctx.esc(d.callbackUrl)}</code></li><li>Copy the <strong>App ID</strong> and <strong>App Secret</strong> from Credentials &amp; Basic Info and type them here (never in a chat or screenshot). Publish the app version, then tick On and Save.</li></ol>
        <form data-fl-form class="form-grid">
          <label class="field">App ID<input name="appId" autocomplete="off" value="${ctx.esc(d.appId)}" placeholder="cli_…"></label>
          <label class="field">App Secret<input name="appSecret" type="password" autocomplete="off" placeholder="${d.hasSecret ? 'Saved — leave blank to keep' : 'Not saved yet'}"></label>
          <label class="field">Feishu or Lark<select name="domain"><option value="feishu" ${d.domain === 'feishu' ? 'selected' : ''}>Feishu (feishu.cn)</option><option value="lark" ${d.domain === 'lark' ? 'selected' : ''}>Lark (larksuite.com)</option></select></label>
          <label class="field check"><input type="checkbox" name="enabled" ${d.enabled ? 'checked' : ''}> On: show “Sign in with Feishu”</label>
          <div class="actions"><button class="primary">Save</button>${d.configured ? '<button type="button" class="danger" data-fl-remove>Remove</button>' : ''}</div>
        </form>
        ${message ? `<p class="${ok ? 'notice success' : 'form-error'}" role="status">${ctx.esc(message)}</p>` : ''}</div>`;
    };
    const run = async (body, done) => { try { draw(await ctx.api('/integrations/feishu-login', body), done); } catch (error) { draw(await ctx.api('/integrations/feishu-login'), error.message, false); } };
    box.addEventListener('submit', event => { event.preventDefault(); const f = event.target; run({ appId: f.elements.appId.value, appSecret: f.elements.appSecret.value, domain: f.elements.domain.value, enabled: f.elements.enabled.checked }, 'Saved.'); });
    box.addEventListener('click', event => { if (event.target.closest('[data-fl-remove]') && window.confirm('Remove Feishu sign-in? The button disappears; linked accounts stay linked for when it is set up again.')) run({ remove: true }, 'Removed.'); });
    try { draw(await ctx.api('/integrations/feishu-login')); } catch (error) { box.innerHTML = `<div class="panel-body"><p class="muted">Feishu sign-in settings are available after the HR server restarts. (${ctx.esc(error.message)})</p></div>`; }
  }
  // Office Wi-Fi for time in / out: recognised by the office's internet address. Add it while on the office Wi-Fi.
  // Letterhead per issuing company (memo PDFs): a JPEG uploaded here replaces the built-in image.
  async function letterheads(form) {
    if (ctx.context?.()?.roleLabel && !/Administrator|HR Manager/.test(ctx.context().roleLabel)) return;
    const box = document.createElement('section'); box.className = 'panel st-panel'; box.id = 'st-letterheads'; form.before(box);
    const draw = list => { box.innerHTML = `<div class="st-head"><h2>Company letterheads (memo PDFs)</h2></div><div class="panel-body"><p class="legend">Each issuing company prints its own letterhead at the top of memo PDFs. Upload a JPEG (up to 3 MB, wide banner). Already issued memos keep the PDF they were issued with.</p>
      <ul class="plain-list">${list.map(l => `<li><strong>${ctx.esc(l.company)}</strong> · ${l.uploaded ? `uploaded by ${ctx.esc(l.uploaded.by)} ${ctx.esc(l.uploaded.at.slice(0, 10))}` : l.builtIn ? 'built-in letterhead' : 'none yet: the company name is printed'} <label class="button small">Upload JPEG<input type="file" accept="image/jpeg" data-letterhead="${ctx.esc(l.company)}" hidden></label></li>`).join('')}</ul></div>`; };
    box.addEventListener('change', async event => { const input = event.target.closest('[data-letterhead]'); const file = input?.files?.[0]; if (!file) return; try { const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => no(new Error('Unable to read the file.')); r.readAsDataURL(file); }); draw(await ctx.api('/hr/letterheads', { company: input.dataset.letterhead, data })); ctx.toast('Letterhead saved.'); } catch (error) { ctx.toast(error.message); } });
    try { draw(await ctx.api('/hr/letterheads')); } catch { box.remove(); }
  }
  async function officeWifi(form) {
    const box = document.createElement('section'); box.className = 'panel st-panel'; box.id = 'st-wifi'; form.before(box);
    const draw = d => {
      const here = d.networks.some(n => n.ip === d.current);
      box.innerHTML = `<div class="st-head"><h2 class="st-wifi-title">${sIcon('wifi', 'st-wifi')}Office Wi-Fi for time in / out</h2><span class="st-chip ${d.networks.length ? 'ok' : ''}"><i></i>${d.networks.length ? 'Configured' : 'Not configured'}</span></div><div class="panel-body">
        <p class="legend">Limit time in and out to your office network. Off-site entries require a reason and HR or Admin approval.</p>
        <label class="field st-ip">This device's network address<input value="${ctx.esc(d.current || 'unknown')}" readonly></label>
        ${d.networks.length ? `<ul class="plain-list office-net-list">${d.networks.map(n => `<li><span><strong>${ctx.esc(n.label)}</strong> · ${ctx.esc(n.ip)} <small>added by ${ctx.esc(n.addedBy)}</small>${n.ip === d.current ? ' <span class="badge">✓ This network</span>' : ''}</span><button type="button" class="small danger" data-net-remove="${ctx.esc(n.ip)}">Remove</button></li>`).join('')}</ul>` : `<p class="st-warn">${sIcon('info')}No office network saved. Time in / out is currently unrestricted.</p>`}
        ${here ? '' : '<div class="st-wifi-add"><button type="button" class="primary" data-net-add>Add this network as office Wi-Fi</button><small>Connect to office Wi-Fi before adding. Add the network again if your public address changes.</small></div>'}
        <div data-net-suggest></div><p class="form-error hidden" role="alert" data-net-error></p></div>`;
      ctx.api('/office-networks/suggestions').then(list => { const s = box.querySelector('[data-net-suggest]'); if (s && list.length) s.innerHTML = `<div class="notice"><strong>Suggested office addresses</strong> — seen on office time in / out confirmed by the office GPS area but not on the saved Wi-Fi (the office may have a second internet line):<ul class="plain-list">${list.map(x => `<li>${ctx.esc(x.ip)} · ${x.punches} time in / out by ${x.employees} employees, last ${ctx.esc(x.last)} <button type="button" class="small primary" data-net-suggested="${ctx.esc(x.ip)}">Add as office Wi-Fi</button></li>`).join('')}</ul></div>`; }).catch(() => {});
    };
    const show = async body => {
      try { draw(await ctx.api('/office-networks', body)); }
      catch (error) { const e = box.querySelector('[data-net-error]'); if (e) { e.textContent = error.message; e.classList.remove('hidden'); } else ctx.toast(error.message); }
    };
    box.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-net-add')) show({ action: 'add-current', label: 'Office Wi-Fi' });
      if (b.dataset.netSuggested && window.confirm(`Add ${b.dataset.netSuggested} as office Wi-Fi? Time in / out from it will count as verified office attendance.`)) show({ action: 'add-suggested', ip: b.dataset.netSuggested, label: 'Office Wi-Fi (second line)' });
      if (b.dataset.netRemove && window.confirm(`Remove ${b.dataset.netRemove}? Time in from that network will need Off-site work.`)) show({ action: 'remove', ip: b.dataset.netRemove });
    });
    await show();
  }
  function collectReqs() {
    const slug = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'requirement';
    const taken = new Set();
    settings.documentRequirements = [...document.querySelectorAll('#req-rows tr')].map((tr, i) => {
      const old = settings.documentRequirements[i] || {}, v = k => tr.querySelector(`[data-k="${k}"]`);
      const name = v('name').value.trim();
      let id = old.id || slug(name); while (taken.has(id)) id = `${id}-2`; taken.add(id);
      const split = s => s.split(',').map(x => x.trim()).filter(Boolean);
      return { id, name, category: v('category').value.trim() || 'Other', required: v('required').checked, expires: v('expires').checked, restricted: v('restricted').checked, providedBy: v('providedBy').value === 'company' ? 'company' : 'employee', dueDays: v('dueDays').value === '' ? null : Number(v('dueDays').value), departments: split(v('departments').value), classifications: split(v('classifications').value) };
    });
  }
  return { datasheets, settingsPage };
}
