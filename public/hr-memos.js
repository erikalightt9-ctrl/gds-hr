// Memos: drafts, issuing to all / departments / named employees, revisions, archive, and acknowledgement tracking.
import { fmtDate, fmtDateTime, readFile, who } from './hr-common.js';
// Loaded on demand, never at start-up: if the file cannot be loaded the rest of the app keeps working.
let viewer = null;
const loadViewer = () => (viewer ? Promise.resolve(viewer) : import('./memo-viewer.js').then(m => (viewer = m)).catch(() => null));
// Routine memo categories (older memos keep their original category). Notices to Explain and disciplinary documents
// go through Due Process & Discipline (confidential case workflow), never as memos.
const MEMO_CATEGORIES = ['General Announcement', 'Policy / Guidelines', 'Advisory / Reminder', 'Office Order / Schedule', 'Confidential HR notice'];
const COMPANIES = ['GDS CAPITAL INC.', 'Philippine Dragon Media Network', 'PDMN RECHARGE'];

export function createMemos(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  let view = 'all', memos = [], people = [];
  const STATUS = { draft: ['Draft', 'neutral'], published: ['Issued', ''], archived: ['Archived', 'neutral'] };

  async function render(openId = null) {
    shell(heading('Memos', 'Loading…') + '<div class="loading">Loading memos…</div>');
    [memos, people] = await Promise.all([api('/hr/memos'), ctx.context().can.manage ? api('/hr/employees') : Promise.resolve([])]);
    // Servers started before the names were added to the list: read them from each issued memo's details instead.
    memos = await Promise.all(memos.map(async m => {
      if (m.recipientNames || !m.version) return m;
      try { const v = (await api(`/hr/memos/${m.id}`)).versions.at(-1), rows = v?.assignments || [], name = a => a.name || a.employeeId; return { ...m, recipientNames: rows.map(name), pendingNames: m.ackRequired ? rows.filter(a => !a.acknowledgedAt).map(name) : [] }; }
      catch { return m; }
    }));
    draw();
    if (openId) detail(openId);
  }
  // Memos list (Nov 25, 2026 design): red hero, KPI cards with monthly trend, search + filters, tabs, table, pages.
  const PER_PAGE = 10;
  const ico = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const MI = {
    people: ico('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'),
    check: ico('<path d="m6 12.5 4 4 8-9"/>'),
    draft: ico('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
    archive: ico('<rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>'),
    search: ico('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    cal: ico('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'),
    filter: ico('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    export: ico('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
    eye: ico('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
    pen: ico('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
    more: ico('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
    prev: ico('<path d="m14 6-6 6 6 6"/>'), next: ico('<path d="m10 6 6 6-6 6"/>'),
    dept: ico('<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7.5 20c0-2.8 2-4.8 4.5-4.8s4.5 2 4.5 4.8M1.5 19c0-2.2 1.5-3.8 3.5-3.8M22.5 19c0-2.2-1.5-3.8-3.5-3.8"/>'),
    person: ico('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
    megaphone: ico('<path d="M3 10v4h3l7 5V5L6 10H3Z"/><path d="M17 8a5 5 0 0 1 0 8"/>'),
    info: ico('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>'),
    bell: ico('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
    lock: ico('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
    plus: ico('<path d="M12 5v14M5 12h14"/>'),
  };
  // Category → icon and tone.
  const CAT = c => (/announce/i.test(c) ? ['megaphone', 'red'] : /policy|guideline/i.test(c) ? ['info', 'blue'] : /office|schedule/i.test(c) ? ['cal', 'orange'] : /confidential/i.test(c) ? ['lock', 'violet'] : /advisory|reminder/i.test(c) ? ['bell', 'green'] : ['draft', 'blue']);
  const BUCKET = m => (m.status === 'published' ? 'published' : m.status === 'draft' ? 'draft' : 'archived');
  const memoDate = m => m.publishedAt || m.issueDate || m.updatedAt || '';
  const ui = { q: '', status: '', dept: '', category: '', from: '', to: '', page: 1 };
  const manila = (iso, opts) => new Date(iso.length === 10 ? `${iso}T00:00:00+08:00` : iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', ...opts });
  const initials = name => String(name || '?').split(/\s+/).filter(Boolean).map(x => x[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join('').toUpperCase();
  const whoName = u => who(u) || u || '';

  // Six months of counts for a KPI card: trend line and the change this month against last month.
  function trend(list) {
    const now = new Date(Date.now() + 8 * 3600000), months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5 + i, 1)); return d.toISOString().slice(0, 7); });
    const counts = months.map(mo => list.filter(m => (memoDate(m) ? manila(memoDate(m), { year: 'numeric', month: '2-digit' }).replace(/(\d+)\/(\d+)/, '$2-$1') : '') === mo).length);
    const [prev, cur] = counts.slice(-2), change = prev ? Math.round((cur - prev) / prev * 100) : null;
    const max = Math.max(1, ...counts), pts = counts.map((c, i) => `${(i * 120 / 5).toFixed(1)},${(34 - c / max * 28).toFixed(1)}`).join(' ');
    return { change, line: `<svg class="mm-spark" viewBox="0 0 120 38" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,38 ${pts} 120,38" class="mm-area"/><polyline points="${pts}" class="mm-line"/></svg>` };
  }
  function filtered() {
    const q = ui.q.trim().toLowerCase();
    return memos.filter(m => view === 'all' || BUCKET(m) === view)
      .filter(m => !ui.status || BUCKET(m) === ui.status)
      .filter(m => !ui.category || m.category === ui.category)
      .filter(m => !ui.dept || (ui.dept === '__all' ? (m.recipientMode || 'all') === 'all' : (m.departments || []).includes(ui.dept)))
      .filter(m => { const d = (m.issueDate || memoDate(m)).slice(0, 10); return (!ui.from || d >= ui.from) && (!ui.to || d <= ui.to); })
      .filter(m => !q || `${m.title} ${m.excerpt || ''} ${m.reference || ''} ${whoName(m.author)} ${m.category || ''}`.toLowerCase().includes(q))
      .sort((a, b) => memoDate(b).localeCompare(memoDate(a)));
  }
  function audience(m) {
    const mode = m.recipientMode || (m.recipientNames?.length === 1 ? 'employees' : 'all');
    if (mode === 'departments' && m.departments?.length) return [MI.dept, m.departments.length === 1 ? m.departments[0] : `${m.departments.length} departments`, 'blue'];
    if (mode === 'employees') return [MI.person, m.recipientNames?.length === 1 ? m.recipientNames[0] : `${m.recipients || m.recipientNames?.length || 0} employees`, 'violet'];
    return [MI.dept, 'All employees', 'blue'];
  }
  function draw() {
    if (!['all', 'published', 'draft', 'archived'].includes(view)) view = 'all';
    const can = ctx.context().can, rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
    ui.page = Math.min(ui.page, pages);
    const start = (ui.page - 1) * PER_PAGE, shown = rows.slice(start, start + PER_PAGE);
    const count = b => memos.filter(m => BUCKET(m) === b).length;
    const kpi = (tone, icon, list, label, tab) => { const t = trend(list); return `<button class="mm-kpi mm-${tone}" data-view="${tab}"><span class="mm-kpi-ico">${icon}</span><span class="mm-kpi-text"><strong>${list.length}</strong><small>${label}</small></span><em class="${t.change > 0 ? 'up' : t.change < 0 ? 'down' : ''}" title="This month against last month">${t.change === null ? '—' : `${t.change > 0 ? '↑ +' : t.change < 0 ? '↓ ' : '— '}${t.change}%`}</em>${t.line}</button>`; };
    const tabs = [['all', 'All Memos', memos.length], ['published', 'Published', count('published')], ...(can.manage ? [['draft', 'Draft', count('draft')]] : []), ['archived', 'Archived', count('archived')]];
    const status = m => { const b = BUCKET(m); return `<span class="mm-badge mm-b-${b}">${b === 'published' ? MI.check : b === 'draft' ? MI.pen : MI.archive}${{ published: 'Published', draft: 'Draft', archived: 'Archived' }[b]}</span>`; };
    const pageBtns = Array.from({ length: pages }, (_, i) => i + 1).filter(n => pages <= 7 || n === 1 || n === pages || Math.abs(n - ui.page) <= 1);
    const cats = [...new Set(memos.map(m => m.category).filter(Boolean))].sort();
    shell(`<div class="mm">
      <section class="mm-hero"><span class="mm-horn" aria-hidden="true"><svg viewBox="0 0 120 120"><defs><linearGradient id="mmRed" x1="0" x2="1"><stop offset="0" stop-color="#ff4b3e"/><stop offset="1" stop-color="#b3121f"/></linearGradient></defs><path d="M22 52h18l46-26v68L40 68H22a8 8 0 0 1-8-8v0a8 8 0 0 1 8-8Z" fill="#fff" stroke="#d7141a" stroke-width="5" stroke-linejoin="round"/><path d="M86 26c10 6 14 20 14 34s-4 28-14 34Z" fill="url(#mmRed)"/><path d="M30 68l8 30a6 6 0 0 0 11-3l-4-27" fill="#c8102e"/><rect x="14" y="52" width="14" height="16" rx="4" fill="#d7141a"/><path d="M104 44l10-6M106 60h12M104 76l10 6" stroke="#d7141a" stroke-width="4" stroke-linecap="round"/></svg></span>
        <div class="mm-hello"><span>Communication Hub</span><h1>Memos</h1><p>View and manage company memos, announcements,<br>and important communications.</p></div>
        <p class="mm-motto">“Keep everyone informed,<br>stay connected.”</p>${can.manage ? `<button class="mm-create" data-new>${MI.pen}Create Memo</button>` : ''}</section>
      <div class="mm-kpis">${kpi('navy', MI.people, memos, 'Total Memos', 'all')}${kpi('green', MI.check, memos.filter(m => BUCKET(m) === 'published'), 'Published', 'published')}${can.manage ? kpi('orange', MI.draft, memos.filter(m => BUCKET(m) === 'draft'), 'Draft', 'draft') : ''}${kpi('violet', MI.archive, memos.filter(m => BUCKET(m) === 'archived'), 'Archived', 'archived')}</div>
      <div class="mm-tools">
        <label class="mm-search">${MI.search}<input type="search" data-mm-q value="${esc(ui.q)}" placeholder="Search memo title, content, or author…" aria-label="Search memo title, content, or author"></label>
        <select class="mm-select" data-mm-status aria-label="Status"><option value="">All Status</option>${[['published', 'Published'], ...(can.manage ? [['draft', 'Draft']] : []), ['archived', 'Archived']].map(([v, l]) => `<option value="${v}" ${ui.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select class="mm-select" data-mm-dept aria-label="Department"><option value="">All Departments</option><option value="__all" ${ui.dept === '__all' ? 'selected' : ''}>Sent to all employees</option>${(ctx.context().departments || []).map(d => `<option ${ui.dept === d ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>
        <details class="mm-pop-wrap"><summary class="mm-select mm-range">${ui.from || ui.to ? esc(`${ui.from ? fmtDate(ui.from) : '…'} – ${ui.to ? fmtDate(ui.to) : '…'}`) : 'Date Range'}${MI.cal}</summary><div class="mm-pop"><label>From<input type="date" data-mm-from value="${esc(ui.from)}"></label><label>To<input type="date" data-mm-to value="${esc(ui.to)}"></label><button class="small" data-mm-range-clear>Clear dates</button></div></details>
        <details class="mm-pop-wrap"><summary class="mm-btn">${MI.filter}Filter${ui.category ? ' •' : ''}</summary><div class="mm-pop"><label>Category<select data-mm-cat><option value="">All categories</option>${cats.map(c => `<option ${ui.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><button class="small" data-mm-clear>Clear all filters</button></div></details>
        <button class="mm-btn" data-mm-export>${MI.export}Export</button></div>
      <div class="mm-tabs" role="tablist">${tabs.map(([v, l, n]) => `<button role="tab" data-view="${v}" class="${v === view ? 'on' : ''}" aria-selected="${v === view}">${l} (${n})</button>`).join('')}</div>
      <section class="mm-table"><table><thead><tr><th>#</th><th>Title</th><th>Author</th><th>Department</th><th>Publication Date</th><th>Status</th><th class="mm-act">Actions</th></tr></thead><tbody>
        ${shown.length ? shown.map((m, i) => { const [ic, tone] = CAT(m.category || ''), [aIco, aText, aTone] = audience(m), d = memoDate(m), by = whoName(m.author) || '—'; return `<tr>
          <td class="mm-n">${start + i + 1}</td>
          <td><span class="mm-title"><i class="mm-t-${tone}">${MI[ic]}</i><span><button class="link-button" data-open="${m.id}" title="Open">${esc(m.title)}</button><small>${esc(m.excerpt || [m.reference, m.category].filter(Boolean).join(' · '))}</small>${m.revisionInProgress ? '<small class="mm-rev">Revision in progress</small>' : ''}</span></span></td>
          <td><span class="mm-author"><span class="mm-av">${esc(initials(by))}</span><span><strong>${esc(by)}</strong><small>${esc(m.approvedBy && m.approvedBy !== m.author ? `Approved by ${whoName(m.approvedBy)}` : m.category || '')}</small></span></span></td>
          <td><span class="mm-dept"><i class="mm-t-${aTone}">${aIco}</i>${esc(aText)}</span></td>
          <td class="mm-when">${d ? `${esc(manila(d, { month: 'short', day: 'numeric', year: 'numeric' }))}${d.length > 10 ? `<small>${esc(manila(d, { hour: '2-digit', minute: '2-digit' }))}</small>` : ''}` : '—'}</td>
          <td>${status(m)}</td>
          <td class="mm-act"><button class="mm-view" data-open="${m.id}">${m.status === 'draft' ? `${MI.pen}Edit` : `${MI.eye}View`}</button></td></tr>`; }).join('') : `<tr><td colspan="7" class="mm-empty">${[ui.q, ui.status, ui.dept, ui.category, ui.from, ui.to].some(Boolean) ? 'No memos match these filters.' : view === 'draft' ? 'No drafts.' : 'No memos here yet.'}</td></tr>`}
      </tbody></table>
      <div class="mm-foot"><span>${rows.length ? `Showing ${start + 1}–${start + shown.length} of ${rows.length} memo${rows.length === 1 ? '' : 's'}` : 'Showing 0 memos'}</span><nav class="mm-pages" aria-label="Pages"><button data-mm-page="${ui.page - 1}" ${ui.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${MI.prev}</button>${pageBtns.map((n, i) => `${i && n - pageBtns[i - 1] > 1 ? '<span>…</span>' : ''}<button data-mm-page="${n}" class="${n === ui.page ? 'on' : ''}" ${n === ui.page ? 'aria-current="page"' : ''}>${n}</button>`).join('')}<button data-mm-page="${ui.page + 1}" ${ui.page >= pages ? 'disabled' : ''} aria-label="Next page">${MI.next}</button></nav></div></section></div>`);
    const root = document.querySelector('.content');
    const q = root.querySelector('[data-mm-q]');
    q.addEventListener('input', () => { ui.q = q.value; ui.page = 1; const pos = q.selectionStart; draw(); const again = document.querySelector('[data-mm-q]'); again.focus(); again.setSelectionRange(pos, pos); });
    const bind = (sel, key) => root.querySelector(sel)?.addEventListener('change', e => { ui[key] = e.target.value; ui.page = 1; draw(); });
    bind('[data-mm-status]', 'status'); bind('[data-mm-dept]', 'dept'); bind('[data-mm-cat]', 'category'); bind('[data-mm-from]', 'from'); bind('[data-mm-to]', 'to');
    root.addEventListener('click', onClick);
  }
  function exportMemos() {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`, line = r => r.map(cell).join(',');
    const csv = [line(['Reference', 'Title', 'Category', 'Author', 'Audience', 'Publication date', 'Status', 'Recipients', 'Acknowledged', 'Acknowledge by'])]
      .concat(filtered().map(m => line([m.reference, m.title, m.category, whoName(m.author), audience(m)[1], memoDate(m) ? manila(memoDate(m), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '', BUCKET(m), m.recipients, m.ackRequired ? m.acknowledged : 'Not required', m.ackDeadline || '']))).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = 'memos.csv'; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function onClick(event) {
    const t = event.target;
    t.closest('.mm') && document.querySelectorAll('.mm details[open]').forEach(d => { if (!d.contains(t)) d.open = false; });
    const b = t.closest('button'); if (!b) return;
    if (b.dataset.view) { view = b.dataset.view; ui.page = 1; ui.status = ''; draw(); return; }
    if (b.dataset.mmPage && !b.disabled) { ui.page = Number(b.dataset.mmPage); draw(); return; }
    if (b.hasAttribute('data-mm-range-clear')) { ui.from = ''; ui.to = ''; ui.page = 1; draw(); return; }
    if (b.hasAttribute('data-mm-clear')) { Object.assign(ui, { q: '', status: '', dept: '', category: '', from: '', to: '', page: 1 }); draw(); return; }
    if (b.hasAttribute('data-mm-export')) { exportMemos(); return; }
    if (b.hasAttribute('data-new')) editor(null);
    if (b.dataset.open) { b.closest('details')?.removeAttribute('open'); detail(b.dataset.open, b.dataset.filter || 'all'); }
  }
  function editor(memo, { revision = false } = {}) {
    const d = memo?.draft || { title: '', category: 'General Announcement', reference: '', issueDate: ctx.today(), body: '', recipients: { mode: 'all', departments: [], employees: [] }, ackRequired: true, ackDeadline: '', effectiveDate: '', company: COMPANIES[0] };
    const depts = ctx.context().departments, active = people.filter(p => !p.archived && p.status === 'Active');
    openDialog(revision ? `Revise memo (new version)` : memo ? 'Edit memo draft' : 'Create memo', `<form id="memo-form"><div class="dialog-body"><div id="memo-error" class="form-error hidden" role="alert"></div><div class="form-grid">
      <label class="field full">Title<input name="title" required maxlength="200" value="${esc(d.title)}"></label>
      <label class="field">Category<select name="category" required>${[...MEMO_CATEGORIES, ...(d.category && !MEMO_CATEGORIES.includes(d.category) ? [d.category] : [])].map(c => `<option${c === (d.category || 'General Announcement') ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field">Issuing company (logo on the PDF)<select name="company">${COMPANIES.map(c => `<option ${c === (d.company || COMPANIES[0]) ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field">Effective date (optional)<input type="date" name="effectiveDate" value="${esc(d.effectiveDate || '')}"></label>
      <p class="legend full">Notices to Explain and disciplinary documents are issued in HR Management → Due Process &amp; Discipline, not as memos.</p>
      <label class="field">Reference number<input name="reference" maxlength="60" value="${esc(d.reference)}" placeholder="Assigned on issue if blank"></label>
      <label class="field">Issue date<input type="date" name="issueDate" required value="${esc(d.issueDate)}"></label>
      <label class="field">Recipients<select name="mode"><option value="all" ${d.recipients.mode === 'all' ? 'selected' : ''}>All active employees</option><option value="departments" ${d.recipients.mode === 'departments' ? 'selected' : ''}>Selected departments</option><option value="employees" ${d.recipients.mode === 'employees' ? 'selected' : ''}>Selected employees</option></select></label>
      <label class="field full ${d.recipients.mode === 'departments' ? '' : 'hidden'}" data-pick="departments">Departments (Ctrl/⌘-click for several)<select name="departments" multiple size="5">${depts.map(x => `<option ${d.recipients.departments.includes(x) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="field full ${d.recipients.mode === 'employees' ? '' : 'hidden'}" data-pick="employees">Employees (Ctrl/⌘-click for several)<select name="employees" multiple size="8">${active.map(p => `<option value="${esc(p.id)}" ${d.recipients.employees.includes(p.id) ? 'selected' : ''}>${esc(p.name)} · ${esc(p.department || '')}</option>`).join('')}</select></label>
      <label class="field check"><input type="checkbox" name="ackRequired" ${d.ackRequired ? 'checked' : ''}> Ask recipients to acknowledge receipt</label>
      <label class="field">Acknowledge by (optional)<input type="date" name="ackDeadline" value="${esc(d.ackDeadline)}"><small>Blank = the end of each employee's next scheduled working day after the memo reaches them.</small></label>
      <label class="field full">Memo text<textarea name="body" rows="12" required maxlength="20000">${esc(d.body)}</textarea></label>
      <label class="field full">Attachment (optional · PDF, JPG or PNG up to 10 MB)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"><small>${memo?.attachments?.filter(a => !a.version || revision).length ? `Attached: ${memo.attachments.filter(a => !a.version).map(a => esc(a.name)).join(', ') || 'none for this version yet'}` : 'Attachments become part of the issued version.'}</small></label>
      ${revision ? '<p class="legend full">Issuing the revision creates a new version. The earlier version and its acknowledgements stay on record; recipients are asked to acknowledge the new version.</p>' : ''}
    </div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">${revision ? 'Save revision draft' : 'Save draft'}</button></div></form>`);
    const form = dialog.querySelector('#memo-form');
    form.elements.mode.onchange = () => form.querySelectorAll('[data-pick]').forEach(el => el.classList.toggle('hidden', el.dataset.pick !== form.elements.mode.value));
    form.onsubmit = async event => {
      event.preventDefault();
      const value = { title: form.elements.title.value, category: form.elements.category.value, reference: form.elements.reference.value, issueDate: form.elements.issueDate.value, body: form.elements.body.value, ackRequired: form.elements.ackRequired.checked, ackDeadline: form.elements.ackDeadline.value, effectiveDate: form.elements.effectiveDate.value, company: form.elements.company.value, recipients: { mode: form.elements.mode.value, departments: [...form.elements.departments.selectedOptions].map(o => o.value), employees: [...form.elements.employees.selectedOptions].map(o => o.value) } };
      try {
        const saved = revision ? await api(`/hr/memos/${memo.id}/revision`, value) : await api(memo ? `/hr/memos/${memo.id}` : '/hr/memos', value);
        const id = saved.id || memo.id, file = form.elements.file.files[0];
        if (file) await api(`/hr/memos/${id}/attachments`, { name: file.name, mime: file.type, data: await readFile(file) });
        toast('Draft saved. Open it to issue.'); await render(id);
      } catch (error) { const box = form.querySelector('#memo-error'); box.textContent = error.message; box.classList.remove('hidden'); }
    };
  }
  async function detail(id, filter = 'all') {
    try {
      const [memo, v] = await Promise.all([api(`/hr/memos/${id}`), loadViewer()]), latest = memo.versions.at(-1), draft = memo.draft;
      // Fallbacks while the viewer cannot be loaded: the memo text and a plain recipient list.
      const pdfPane = v ? v.pdfPane : (escape, url) => `<p><a href="${escape(url)}" target="_blank" rel="noopener">📄 Open the memo PDF</a></p><div class="memo-body">${esc((draft && memo.status === 'draft' ? draft : latest)?.body || '')}</div>`;
      const recipientsHtml = v ? v.recipientsHtml : (_c, _m, ver) => table(['Employee', 'Acknowledged'], ver.assignments.map(a => [esc(a.name || a.employeeId), a.acknowledgedAt ? fmtDateTime(a.acknowledgedAt) : 'Pending']));
      const bindPrint = v ? v.bindPrint : () => {}, bindRecipients = v ? v.bindRecipients : () => {};
      const attachments = list => list?.length ? `<p>${list.map(a => `<a href="/api/hr/memo-attachments/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`).join(' ')}</p>` : '';
      const body = draft && memo.status === 'draft' ? draft : latest, rctx = { api, esc, table, toast, openDialog, dialog, today: ctx.today };
      openDialog(`${body.title}`, `<div class="dialog-body">
        <p class="sub">${badge(...STATUS[memo.status])} ${esc(body.reference || 'Reference assigned on issue')} · ${esc(body.category || '')} · Issue date ${fmtDate(body.issueDate)}${latest ? ` · version ${memo.version}` : ''}</p>
        ${memo.status === 'published' && draft ? '<div class="notice compact">A revision draft is in progress. Issue it to create the next version.</div>' : ''}
        ${pdfPane(esc, `/api/hr/memos/${memo.id}.pdf`, body.title)}${attachments(latest ? latest.attachments : memo.attachments)}
        ${memo.versions.map(v => `<details class="memo-version" ${v.version === memo.version ? 'open' : ''}><summary>Version ${v.version} · issued ${fmtDateTime(v.publishedAt)} by ${esc(v.publishedBy)}${v.changeNote ? ` · ${esc(v.changeNote)}` : ''} · ${v.assignments.filter(a => a.acknowledgedAt).length}/${v.assignments.length} acknowledged</summary><div class="memo-recipients">${recipientsHtml(rctx, memo, v, v.version === memo.version ? filter : 'all')}</div></details>`).join('')}
        <p class="legend">Acknowledgement records that the employee received the memo. It does not mean they agree with its contents.</p></div>`,
        `<div class="dialog-foot">${memo.canEdit && memo.status === 'draft' ? '<button data-act="edit">Edit draft</button><button class="danger" data-act="delete">Delete draft</button>' : ''}${memo.canPublish && memo.status === 'published' && !draft ? '<button data-act="revise">Revise (new version)</button>' : ''}${memo.canPublish && memo.status === 'published' && draft ? '<button data-act="edit-revision">Edit revision</button>' : ''}${memo.canPublish && memo.status === 'published' ? '<button data-act="archive">Archive</button>' : ''}${memo.status === 'published' && latest?.ackRequired && latest.assignments.some(a => !a.acknowledgedAt) ? '<button data-act="remind">Send reminder now</button>' : ''}${memo.canPublish && (memo.status === 'draft' || draft) ? `<button class="primary" data-act="publish">${memo.version ? 'Issue revised version' : 'Issue memo'}</button>` : ''}${memo.canEdit && !memo.canPublish && memo.status === 'draft' ? '<span class="legend">An HR Manager issues the memo.</span>' : ''}<button data-close>Close</button></div>`);
      dialog.classList.add('wide-dialog'); dialog.addEventListener('close', () => dialog.classList.remove('wide-dialog'), { once: true });
      bindPrint(dialog); bindRecipients(rctx, dialog.querySelector('.dialog-body'), memo, () => detail(id, filter));
      if (filter !== 'all') dialog.querySelector('.memo-version[open] .memo-recipients')?.scrollIntoView({ block: 'start' });
      dialog.querySelector('.dialog-foot').onclick = async event => {
        const act = event.target.closest('[data-act]')?.dataset.act; if (!act) return;
        try {
          if (act === 'edit') editor(memo);
          if (act === 'edit-revision') editor(memo, { revision: true });
          if (act === 'revise') { const updated = await api(`/hr/memos/${id}/revise`, {}); editor(updated, { revision: true }); }
          if (act === 'publish') {
            const changeNote = memo.version ? window.prompt('What changed in this version? (shown to recipients)') : '';
            if (memo.version && !changeNote) return;
            if (!memo.version && !window.confirm('Issue this memo now? Recipients will see it and the issued text cannot be edited afterwards.')) return;
            await api(`/hr/memos/${id}/publish`, { changeNote: changeNote || '' }); toast('Memo issued to its recipients.'); await render(id);
          }
          if (act === 'remind') { const r = await api(`/hr/memos/${id}/remind`, {}); toast(`Reminder sent to ${r.reminded} employee${r.reminded === 1 ? '' : 's'}.`); await render(id); }
          if (act === 'archive' && window.confirm('Archive this memo? It stays on record and recipients can still read it.')) { await api(`/hr/memos/${id}/archive`, {}); toast('Memo archived.'); dialog.close(); await render(); }
          if (act === 'delete' && window.confirm('Delete this unissued draft?')) { await api(`/hr/memos/${id}`, null, 'DELETE'); toast('Draft deleted.'); dialog.close(); await render(); }
        } catch (error) { toast(error.message); }
      };
    } catch (error) { toast(error.message); }
  }
  return { render, create: () => { if (!people.length) api('/hr/employees').then(p => { people = p; editor(null); }).catch(e => toast(e.message)); else editor(null); } };
}


