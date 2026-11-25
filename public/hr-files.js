// Employee 201 Files: directory (search, filters, sort, pagination) and the tabbed employee profile with the
// digital 201 document checklist.
import { DOC_BADGE, fmtDate, fmtDateTime, progress, initials, readFile, openEmployeeForm, fieldBoxes, sectionCard as sharedCard, who, idTypeSelect } from './hr-common.js';

const PAGE_SIZE = 10;
// Profile icons (Nov 25, 2026 design): red line icons instead of emoji.
const pIco = p => `<svg class="pf-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const PF = {
  overview: pIco('<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7 18c.8-2.4 2.8-3.5 5-3.5s4.2 1.1 5 3.5"/>'),
  case: pIco('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18"/>'),
  coins: pIco('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4"/>'),
  umbrella: pIco('<path d="M3 12a9 9 0 0 1 18 0Z"/><path d="M12 12v7a2 2 0 0 0 4 0"/>'),
  clock: pIco('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  family: pIco('<circle cx="8" cy="7" r="3"/><circle cx="17" cy="8" r="2.5"/><path d="M2.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5M14 20c0-2.6 1.3-4.5 3-4.5s3 1.9 3 4.5"/>'),
  cap: pIco('<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>'),
  ids: pIco('<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 16c.6-1.6 1.9-2.4 3.5-2.4s2.9.8 3.5 2.4M15 10h3M15 13h3"/>'),
  memo: pIco('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  medal: pIco('<path d="M7 3h10l-3 6h-4Z"/><circle cx="12" cy="15" r="5"/><path d="m12 13 .9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3Z"/>'),
  cal: pIco('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>'),
  chart: pIco('<path d="M4 20h16"/><rect x="6" y="12" width="3" height="6" rx="1"/><rect x="11" y="8" width="3" height="10" rx="1"/><rect x="16" y="4" width="3" height="14" rx="1"/>'),
  people: pIco('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'),
  archive: pIco('<rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>'),
};
const TABS = [['overview', 'Overview & Personal', PF.overview], ['employment', 'Employment', PF.case], ['compensation', 'Compensation', PF.coins], ['leave', 'Leave Credits', PF.umbrella], ['attendance', 'Attendance', PF.clock], ['family', 'Family', PF.family], ['education', 'Education', PF.cap], ['requirements', 'Government IDs & Documents', PF.ids], ['memos', 'Memos', PF.memo], ['trainings', 'Trainings', PF.medal]];
const EDUCATION_LEVELS = ['Elementary', 'High School', 'Senior High School', 'Vocational', 'College', 'Post-graduate', 'Other'];
const SCHEDULE_LABEL = { 'every-cutoff': 'Every cutoff', 'second-cutoff': 'Monthly, 2nd cutoff', 'first-cutoff': 'Monthly, 1st cutoff', once: 'One time' };
function serviceLength(start, today) {
  if (!start || start > today) return 'Not started';
  const a = new Date(`${start}T00:00:00Z`), b = new Date(`${today}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  if (months < 12) return months < 1 ? 'Less than a month' : `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12); months %= 12;
  return `${years} year${years === 1 ? '' : 's'}${months ? ` ${months} mo` : ''}`;
}

export function createFiles(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  let people = [], query = { q: '', department: '', position: '', status: '', classification: '', docs: '' }, sort = { key: 'name', dir: 1 }, pageNo = 1;
  let profileId = null, tab = 'overview';

  const statusBadge = s => badge(s, s === 'Active' ? '' : s === 'Archived' ? 'neutral' : 'rejected');
  const can = () => ctx.context().can;

  // ---------- Directory ----------
  function filtered() {
    const q = query.q.toLowerCase();
    let list = people.filter(p => (query.status === 'Archived' ? p.archived : query.status === 'Resigned' ? p.resigned : !p.archived && !p.resigned) && (!q || [p.number, p.name, p.department, p.position, p.workEmail].join(' ').toLowerCase().includes(q))
      && (!query.department || p.department === query.department) && (!query.position || p.position === query.position)
      && (!query.status || query.status === 'Archived' || query.status === 'Resigned' || p.status === query.status) && (!query.classification || p.classification === query.classification)
      && (!query.docs || (query.docs === 'missing' ? p.documents?.missing : query.docs === 'review' ? p.documents?.review : query.docs === 'expired' ? p.documents?.expired : query.docs === 'newhires' ? p.dateHired >= ctx.daysAgo(30) : true)));
    list = [...list].sort((a, b) => String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), undefined, { numeric: true }) * sort.dir);
    return list;
  }
  const options = (values, chosen, all) => `<option value="">${all}</option>${[...new Set(values.filter(Boolean))].sort().map(v => `<option ${v === chosen ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
  // Employee Masterlist: count cards (click to filter), search + subsidiary + status, the employee table, and a profile
  // preview on the right for the selected employee (tabs and links open the full 201 file).
  const ICON = {
    all: '<path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.7 0-6 1.3-6 3.5V19h12v-2.5C14 14.3 10.7 13 8 13Zm8 0c-.3 0-.7 0-1.1.1A4.4 4.4 0 0 1 16 16.5V19h6v-2.5c0-2.2-3.3-3.5-6-3.5Z"/>',
    active: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 4.5V21h10.3a6 6 0 0 1-.3-2 6 6 0 0 1 .6-2.6A13 13 0 0 0 12 14Zm8.3 1.3-3.6 3.6-1.6-1.6-1.1 1.1 2.7 2.7 4.7-4.7Z"/>',
    inactive: '<path d="M10 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 4.5V21h16v-2.5c0-2.8-4.7-4.5-8-4.5Zm12.3-5.9-1.4-1.4-1.9 1.9-1.9-1.9-1.4 1.4 1.9 1.9-1.9 1.9 1.4 1.4 1.9-1.9 1.9 1.9 1.4-1.4-1.9-1.9Z"/>',
    search: '<path d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1-5 5 5 5 0 0 1 5-5Z"/>',
    export: '<path d="M12 3 7 8l1.4 1.4L11 6.8V15h2V6.8l2.6 2.6L17 8Zm-7 13v4h14v-4h-2v2H7v-2Z"/>',
    plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6Z"/>',
    check: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1.4 14.6-4.2-4.2 1.4-1.4 2.8 2.8 5.8-5.8 1.4 1.4Z"/>',
    minus: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm5 11H7v-2h10Z"/>',
    pen: '<path d="m15.2 4.2 4.6 4.6L8.6 20H4v-4.6Zm2.1-2.1 1-1a1.5 1.5 0 0 1 2.1 0l2.5 2.5a1.5 1.5 0 0 1 0 2.1l-1 1Z"/>',
    building: '<path d="M4 21V5l8-3v19Zm2-2h4V5L6 6.5ZM14 21V9h6v12Zm2-2h2v-8h-2Z"/>',
    bag: '<path d="M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-10-2h4v2h-4Zm10 14H4v-5h6v2h4v-2h6Zm0-7H4V9h16Z"/>',
    calendar: '<path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3Zm12 8H5v9h14ZM5 8h14V6H5Z"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 2.4L17.6 8H14ZM8 12h8v1.6H8Zm0 3.4h8V17H8Z"/>',
    pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z"/>',
    people: '<path d="M9 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM9 13c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4Zm8 0h-.8a5 5 0 0 1 2.8 4v3h4v-3c0-2.5-3.6-3.8-6-4Z"/>',
    mail: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2.4V17h16V7.4l-8 5.3Zm.9-.4L12 11.7 19.1 7Z"/>',
    phone: '<path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.2 11.4 11.4 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .6 3.6 1 1 0 0 1-.3 1Z"/>',
    user: '<path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4 0-9 2-9 5v2h18v-2c0-3-5-5-9-5Z"/>',
    chevron: '<path d="m9 6 6 6-6 6-1.4-1.4L12.2 12 7.6 7.4Z"/>',
    left: '<path d="m15 6-6 6 6 6 1.4-1.4L11.8 12l4.6-4.6Z"/>',
  };
  const svg = (name, cls = '') => `<svg class="ml-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${ICON[name]}</svg>`;
  const tone = p => (p.status === 'Active' ? 'active' : 'inactive');
  const personName = name => { const [last, first] = String(name).split(',').map(x => x.trim()); return first ? `${first} ${last}` : name; };
  const avatar = (p, cls = '') => `<span class="ml-avatar ml-${tone(p)} ${cls}" aria-hidden="true"><img src="/api/hr/employees/${encodeURIComponent(p.id)}/photo${photoStamp ? `?t=${photoStamp}` : ''}" alt="" loading="lazy" data-dir-photo>${esc(initials(p.name))}</span>`;
  const pill = p => `<span class="ml-pill ml-${tone(p)}">${svg(p.status === 'Active' ? 'check' : 'minus')}${esc(p.archived ? 'Archived' : p.status || '—')}</span>`;
  let selectedId = null, photoStamp = 0;
  function previewHtml(p) {
    if (!p) return '<aside class="ml-preview"><h2>Employee profile</h2><p class="muted">Choose an employee to see their profile.</p></aside>';
    const info = (ic, label, value) => `<div class="ml-info">${svg(ic)}<span><small>${esc(label)}</small><strong>${esc(value || 'Not set')}</strong></span></div>`;
    const link = (ic, label, tabId) => `<button class="ml-link" data-open="${esc(p.id)}" data-start-tab="${tabId}">${svg(ic)}<span>${esc(label)}</span>${svg('chevron', 'ml-chev')}</button>`;
    return `<aside class="ml-preview"><h2 class="ml-pv-title"><span>${svg('user')}</span>Employee Profile</h2>
      <div class="ml-pv-head"><span class="ml-pv-photo">${avatar(p, 'ml-avatar-lg')}${can().manage ? `<label class="ml-photo-pen" title="Change photo" aria-label="Change photo">${svg('pen')}<input type="file" accept="image/png,image/jpeg" data-ml-photo="${esc(p.id)}" hidden></label>` : ''}</span><div><button class="ml-pv-name ml-name" data-open="${esc(p.id)}" data-start-tab="overview" title="Open the full profile (with Edit)">${esc(personName(p.name))}</button><span>${esc(p.position || '—')}</span><span>${esc(p.number)}</span>${pill(p)}</div></div>
      <nav class="ml-tabs">${[['overview', 'Overview'], ['employment', 'Employment'], ['requirements', 'Documents'], ['overview', 'More']].map(([id, label], i) => `<button class="${i === 0 ? 'active' : ''}" data-open="${esc(p.id)}" data-start-tab="${id}">${label}</button>`).join('')}</nav>
      <section class="ml-block"><h3>${svg('bag')}Work Information</h3><div class="ml-grid">${info('building', 'Subsidiary', p.department)}${info('bag', 'Position', p.position)}${info('calendar', 'Date hired', p.dateHired ? fmtDate(p.dateHired) : '')}${info('doc', 'Employment type', p.employmentType || p.classification)}${info('pin', 'Office location', p.workLocation)}${info('people', 'Reporting manager', p.supervisor)}</div></section>
      <section class="ml-block"><h3>${svg('phone')}Contact Information</h3><div class="ml-grid">${info('mail', 'Work email', p.workEmail)}${info('phone', 'Work phone', p.mobile)}</div></section>
      <div class="ml-links">${link('user', 'Personal Information', 'overview')}${link('people', 'Emergency Contacts', 'overview')}${link('calendar', 'Leave & Attendance', 'leave')}</div></aside>`;
  }
  function directoryHtml() {
    const list = filtered(), size = PAGE_SIZE, pages = Math.max(1, Math.ceil(list.length / size)); pageNo = Math.min(pageNo, pages);
    const rows = list.slice((pageNo - 1) * size, pageNo * size);
    if (!selectedId || !people.some(p => p.id === selectedId)) selectedId = rows[0]?.id || null;
    const current = people.filter(p => !p.archived && !p.resigned), active = current.filter(p => p.status === 'Active').length, resigned = people.filter(p => p.resigned).length;
    const card = (key, ic, value, label) => `<button class="ml-card${(query.status || '') === key ? ' active' : ''}" data-ml-status="${key}"><span class="ml-card-ico ml-${ic}">${svg(ic)}</span><span><strong>${value}</strong><small>${label}</small></span></button>`;
    const from = list.length ? (pageNo - 1) * size + 1 : 0, to = Math.min(pageNo * size, list.length);
    return `<section class="dp-hero ml-hero"><span class="ml-hero-art" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#fff" opacity=".85"/><circle cx="50" cy="34" r="12" fill="#1f4fc8"/><circle cx="27" cy="42" r="9" fill="#2f6df0"/><circle cx="73" cy="42" r="9" fill="#2f6df0"/><path d="M28 76c0-13 10-22 22-22s22 9 22 22Z" fill="#1f4fc8"/><path d="M10 74c0-10 7-17 17-17 4 0 8 1 11 4-6 4-9 9-10 13Z M90 74c0-10-7-17-17-17-4 0-8 1-11 4 6 4 9 9 10 13Z" fill="#2f6df0"/></svg></span><div class="dp-hello"><span>Employee</span><h1>Employee Masterlist</h1><p>Manage employee profiles and employment records.</p></div><div class="ml-hero-tools"><a class="ml-btn" href="/api/reports/employees.xlsx" download>${svg('export')}Export</a>${can().manage ? `<button class="ml-btn primary" data-hr-add-employee>${svg('plus')}Add Employee</button>` : ''}</div></section>
      <div class="ml-layout"><section class="ml-main">
        <div class="ml-cards">${card('', 'all', current.length, 'Employee records')}${card('Active', 'active', active, 'Active')}${card('Inactive', 'inactive', current.length - active, 'Inactive')}${card('Resigned', 'minus', resigned, 'Resigned employees')}</div>
        <div class="ml-filters"><label class="ml-search">${svg('search')}<input type="search" data-q value="${esc(query.q)}" placeholder="Search name or employee ID" aria-label="Search name or employee ID"></label>
          <select data-f="department" aria-label="Subsidiary">${options(people.map(p => p.department), query.department, 'Subsidiary')}</select>
          <select data-f="status" aria-label="Status"><option value="">Status</option>${['Active', 'Inactive', 'Resigned', 'Archived'].map(s => `<option ${s === query.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="ml-table-wrap"><table class="ml-table"><thead><tr><th><button class="ml-sort" data-sort="name">Employee <span>${sort.key === 'name' ? (sort.dir > 0 ? '▲' : '▼') : '⇅'}</span></button></th><th>Subsidiary / Position</th><th>Status</th><th><button class="ml-sort" data-sort="dateHired">Date Hired <span>${sort.key === 'dateHired' ? (sort.dir > 0 ? '▲' : '▼') : '⇅'}</span></button></th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
          ${rows.map(p => `<tr class="${p.id === selectedId ? 'selected' : ''}" data-ml-row="${esc(p.id)}"><td><div class="ml-emp">${avatar(p)}<span><button class="ml-name" data-open="${esc(p.id)}" data-start-tab="overview" title="Open personal information">${esc(personName(p.name))}</button><small>${esc(p.number)}</small></span></div></td><td><span class="ml-co">${svg('building')}<span class="ml-two"><strong>${esc(p.department || '—')}</strong><small>${esc(p.position || '—')}</small></span></span></td><td>${pill(p)}</td><td>${p.dateHired ? `<span class="ml-date">${svg('calendar')}${fmtDate(p.dateHired)}</span>` : '—'}</td><td class="ml-act"><details class="ml-more"><summary aria-label="Actions for ${esc(personName(p.name))}">•••</summary><div class="ml-more-menu"><button data-open="${esc(p.id)}" data-start-tab="overview">Open profile</button><button data-open="${esc(p.id)}" data-start-tab="employment">Employment</button><button data-open="${esc(p.id)}" data-start-tab="requirements">Documents</button>${can().manage ? `<button data-edit-emp="${esc(p.id)}">Edit</button>` : ''}</div></details></td></tr>`).join('') || `<tr><td colspan="5" class="empty">${query.q || query.department || query.status ? 'No employees match these filters.' : 'No employees yet.'}</td></tr>`}
        </tbody></table></div>
        <div class="ml-pager"><span>Showing ${from}–${to} of ${list.length} employee${list.length === 1 ? '' : 's'}</span><span class="ml-pages"><button data-page="${pageNo - 1}" ${pageNo === 1 ? 'disabled' : ''} aria-label="Previous page">${svg('left')}</button>${Array.from({ length: pages }, (_, i) => `<button data-page="${i + 1}" class="${i + 1 === pageNo ? 'active' : ''}">${i + 1}</button>`).join('')}<button data-page="${pageNo + 1}" ${pageNo === pages ? 'disabled' : ''} aria-label="Next page">${svg('chevron')}</button></span></div>
      </section>${previewHtml(people.find(p => p.id === selectedId))}</div>`;
  }
  async function directory(preset = null) {
    if (preset) { query = { q: '', department: '', position: '', status: '', classification: '', docs: '', ...preset }; pageNo = 1; }
    shell(heading('Employee 201 Files', 'Loading employees…') + '<div class="loading">Loading…</div>');
    people = await api('/hr/employees');
    draw();
  }
  function draw() {
    shell(directoryHtml());
    const root = document.querySelector('.content');
    root.querySelectorAll('[data-dir-photo]').forEach(img => { img.addEventListener('error', () => img.remove()); img.addEventListener('load', () => img.parentElement.classList.add('has-photo')); });
    root.querySelector('[data-q]').addEventListener('input', event => { query.q = event.target.value; pageNo = 1; const pos = event.target.selectionStart; draw(); const box = document.querySelector('[data-q]'); box.focus(); box.setSelectionRange(pos, pos); });
    root.addEventListener('change', event => { const f = event.target.dataset.f; if (f) { query[f] = event.target.value; pageNo = 1; draw(); } });
    root.addEventListener('click', onDirectoryClick);
    root.addEventListener('click', event => root.querySelectorAll('.ml-more[open]').forEach(d => { if (!d.contains(event.target) || event.target.closest('.ml-more-menu button')) d.open = false; }));
    // Change photo (profile panel): upload a JPG / PNG portrait for the selected employee.
    root.addEventListener('change', async event => {
      const input = event.target.closest('[data-ml-photo]'); if (!input) return;
      const file = input.files[0]; input.value = ''; if (!file) return;
      try {
        if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Choose a JPG or PNG photo.');
        await api(`/hr/employees/${encodeURIComponent(input.dataset.mlPhoto)}/photo`, { name: file.name, mime: file.type, data: await readFile(file) });
        photoStamp = Date.now(); toast('Photo updated.'); draw();
      } catch (error) { toast(error.message); }
    });
    // Clicking anywhere on a row shows that employee in the profile panel.
    root.addEventListener('click', event => { const row = event.target.closest('[data-ml-row]'); if (row && !event.target.closest('button') && row.dataset.mlRow !== selectedId) { selectedId = row.dataset.mlRow; draw(); } });
  }
  async function onDirectoryClick(event) {
    const b = event.target.closest('button'); if (!b) return;
    if (b.dataset.sort) { sort = { key: b.dataset.sort, dir: sort.key === b.dataset.sort ? -sort.dir : 1 }; draw(); }
    if (b.hasAttribute('data-reset')) { query = { q: '', department: '', position: '', status: '', classification: '', docs: '' }; pageNo = 1; draw(); }
    if (b.dataset.page) { pageNo = Number(b.dataset.page); draw(); }
    if (b.dataset.mlSelect) { selectedId = b.dataset.mlSelect; draw(); }
    if (b.dataset.mlStatus !== undefined) { query.status = b.dataset.mlStatus; pageNo = 1; draw(); }
    if (b.dataset.open) await openProfile(b.dataset.open, b.dataset.startTab || 'overview');
    if (b.hasAttribute('data-hr-add-employee')) addEmployee();
    if (b.dataset.editEmp) editEmployee(b.dataset.editEmp, () => directory());
    if (b.dataset.archive) archive(b.dataset.archive);
    if (b.dataset.restore) { try { await api(`/hr/employees/${encodeURIComponent(b.dataset.restore)}/restore`, {}); toast('Employee restored.'); await directory(); } catch (e) { toast(e.message); } }
  }
  function addEmployee() { openEmployeeForm({ ...ctx, context: ctx.context() }, { title: 'Add employee', values: { employment: { dateHired: ctx.today(), status: 'Active' } }, onSaved: id => openProfile(id) }); }
  async function editEmployee(id, after, only = null, label = '') {
    try { const data = await api(`/hr/employees/${encodeURIComponent(id)}`); openEmployeeForm({ ...ctx, context: ctx.context() }, { id, title: `Edit ${label ? `${label} · ` : ''}${data.name}`, values: data.form, only, locked: data.locked || [], onSaved: () => after() }); } catch (e) { toast(e.message); }
  }
  function archive(id) {
    const person = people.find(p => p.id === id);
    openDialog(`Archive ${person?.name || id}`, `<form id="archive-form"><div class="dialog-body"><p>Archiving moves the employee out of the active directory and stops future payroll from their end date. Their 201 documents and history are kept and stay visible to authorised HR users. You can restore the record later.</p><div class="form-grid"><label class="field">Reason<input name="reason" required minlength="3" maxlength="500" placeholder="e.g. Resigned effective 30 Sept"></label><label class="field">Last day (end date)<input name="endDate" type="date" value="${ctx.today()}"></label></div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Archive employee</button></div></form>`);
    dialog.querySelector('#archive-form').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.target);
      try { await api(`/hr/employees/${encodeURIComponent(id)}/archive`, { reason: f.get('reason'), endDate: f.get('endDate') }); dialog.close(); toast('Employee archived. Records are kept.'); await ctx.refresh().catch(() => {}); await directory(); } catch (e) { toast(e.message); }
    };
  }

  // ---------- Profile ----------
  async function openProfile(id, startTab = 'overview') {
    profileId = id; tab = startTab; ctx.setPage('employee201'); otCache = null; dayCache.clear();   // fresh overtime decisions on every opening
    await drawProfile();
  }
  async function drawProfile() {
    const id = profileId;
    shell('<div class="loading">Loading employee…</div>');
    const enc = encodeURIComponent(id);
    const [record, checklist, extra, extras, leave] = await Promise.all([api(`/hr/employees/${enc}`), api(`/hr/employees/${enc}/documents`), api(`/hr/employees/${enc}/activity`), api(`/hr/employees/${enc}/extras`), api(`/hr/employees/${enc}/leave`).catch(() => null)]);
    extras.leave = leave;
    // Loans (pay information): only roles allowed to see loans get the tab.
    extras.loans = await api('/loans/dashboard').then(d => ({ loans: d.loans.filter(l => l.employeeId === id), applications: d.applications.filter(a => a.employeeId === id) })).catch(() => null);
    if (profileId !== id) return;
    const f = record.form, today = ctx.today();
    const tabs = TABS.filter(([key]) => (key !== 'compensation' || extras.compensation) && (key !== 'leave' || extras.leave) && (key !== 'attendance' || ctx.getState?.()?.attendance) && (!['family', 'education', 'history'].includes(key) || extras.family));
    if (!tabs.some(([key]) => key === tab)) tab = 'overview';
    const header = `<section class="panel hr-profile-head"><div class="hr-profile-id"><span class="hr-avatar large"><img src="/api/hr/employees/${enc}/photo" alt="" data-photo>${esc(initials(record.name))}</span><div><h1>${esc(record.name)}</h1><p class="sub">${esc(record.number)} · ${esc(f.employment.position || 'No position')} · ${esc(f.employment.department || 'No department')}</p><p>${statusBadge(record.archived ? 'Archived' : record.activity)} ${f.employment.classification ? badge(f.employment.classification, 'neutral') : ''} ${record.draft ? badge('Pay setup incomplete', 'pending') : ''}</p></div></div>
      <div class="actions pf-actions"><button class="pf-btn" data-back>${PF.people}All Employees</button>${can().approve ? (record.archived ? `<button class="pf-btn" data-restore="${esc(id)}">Restore</button>` : `<button class="pf-btn pf-btn-red" data-archive="${esc(id)}">${PF.archive}Archive</button>`) : ''}</div></section>`;
    const infoCard = (icon, label, value) => `<div class="info-card"><span class="info-icon" aria-hidden="true">${icon}</span><span><small>${esc(label)}</small><strong>${esc(value || '—')}</strong></span></div>`;
    const info = `<div class="info-cards">${infoCard(PF.cal, 'Years of Service', serviceLength(f.employment.dateHired, today))}${infoCard(PF.case, 'Employment Type', f.employment.employmentType || 'Not set')}${infoCard(PF.chart, 'Job Level', f.employment.jobLevel || 'Not set')}${infoCard(PF.cal, 'Date Hired', fmtDate(f.employment.dateHired))}</div>`;
    const tabBar = `<section class="panel profile-tabs-panel"><div class="tabs hr-tabs profile-tab-grid" role="tablist">${tabs.map(([key, text, icon]) => `<button role="tab" aria-selected="${key === tab}" class="${key === tab ? 'active' : ''}" data-tab-select="${key}"><span aria-hidden="true">${icon}</span> ${text}</button>`).join('')}</div><div class="hr-tab-body">${safeBody(record, checklist, extra, extras)}</div></section>`;
    shell(header + info + tabBar);
    const root = document.querySelector('.content');
    root.querySelector('[data-photo]')?.addEventListener('error', event => event.target.remove());
    root.querySelector('[data-photo]')?.addEventListener('load', event => event.target.parentElement.classList.add('has-photo'));
    root.addEventListener('click', event => onProfileClick(event, record, checklist, extras));
    root.addEventListener('change', event => { if (!event.target.matches('[data-att-month]')) return; attMonth = event.target.value; root.querySelector('[data-att-box]').innerHTML = attendanceHtml(record.id); });
  }
  const dl = rows => boxes(rows);   // all profile details use the boxed field layout
  // Read-only field boxes and section cards come from hr-common.js, shared with the employee portal.
  const boxes = rows => fieldBoxes(esc, rows);
  const sectionCard = (icon, title, body, action = '') => sharedCard(esc, icon, title, body, action);
  const emergencyRows = f => [['Contact person', f.emergency.name], ['Relationship', f.emergency.relationship], ['Contact number', f.emergency.contact]];
  const block = (icon, title, body, action = '') => sectionCard(icon, title, body, action);
  // Work schedule: the same schedule attendance and payroll use (late, overtime, undertime, rest days).
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const scheduleCard = record => { const s = record.schedule || {}; return block('🕘', 'Work schedule', dl([...(s.flexible ? [['Time in / out', 'Flexible time: any time (event call time); the regular hours must be worked']] : [['Time in', s.start || 'Not set'], ['Time out', s.end || 'Not set']]), ['Regular hours', s.hoursPerDay ? `${s.hoursPerDay} h per day` : 'Not set'], ['Meal break', s.mealBreakMinutes === null || s.mealBreakMinutes === undefined ? 'Not set' : `${s.mealBreakMinutes} min`], ['Rest days', (s.restDays || []).length ? s.restDays.map(d => DAYS[d]).join(', ') : 'None'], ['Arrangement', s.arrangement || 'Office']]), record.canEdit && !record.archived ? '<button class="small" data-edit-schedule>Edit schedule</button>' : ''); };
  function scheduleDialog(id, record, after) {
    const s = record.schedule || {};
    openDialog(`Work schedule · ${record.name}`, `<form id="schedule-form" class="dialog-body form-grid">
      <label class="check full flex-time"><input type="checkbox" name="flexible" ${s.flexible ? 'checked' : ''}> <span><strong>Flexible time</strong> · no fixed time in / out (e.g. events with their own call time). Never late; the regular hours must be worked; overtime counts after them.</span></label>
      <label class="field"><span data-flex-label="Usual time in (reference)">Time in</span><input type="time" name="start" required value="${esc(s.start || '09:00')}"></label>
      <label class="field"><span data-flex-label="Usual time out (reference)">Time out</span><input type="time" name="end" required value="${esc(s.end || '18:00')}"></label>
      <label class="field">Regular hours per day<input type="number" name="hoursPerDay" min="1" max="16" step="0.5" required value="${esc(s.hoursPerDay ?? 8)}"></label>
      <label class="field">Meal break (minutes)<input type="number" name="mealBreakMinutes" min="0" max="240" step="5" required value="${esc(s.mealBreakMinutes ?? 60)}"></label>
      <fieldset class="field full rest-days"><legend>Rest days</legend>${DAYS.map((d, i) => `<label class="inline-check"><input type="checkbox" name="restDays" value="${i}" ${(s.restDays || []).includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</fieldset>
      <label class="field">Arrangement<select name="arrangement">${['Office', 'WFH', 'Hybrid'].map(a => `<option ${a === (s.arrangement || 'Office') ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <p class="legend full" data-flex-legend>Attendance and payroll use this schedule: lateness from the time in, overtime and undertime from the regular hours, and rest days.</p>
      <p class="form-error full hidden" role="alert" data-schedule-error></p>
      <div class="full"><button class="primary">Save schedule</button></div></form>`);
    const form = dialog.querySelector('#schedule-form'), flexBox = form.elements.flexible;
    const showFlex = () => { form.querySelectorAll('[data-flex-label]').forEach(el => { el.dataset.plain ??= el.textContent; el.textContent = flexBox.checked ? el.dataset.flexLabel : el.dataset.plain; }); form.querySelector('[data-flex-legend]').textContent = flexBox.checked ? 'Flexible time: any time in and out; never late. Undertime when fewer than the regular hours are worked; overtime after them (with an approved filing). The meal break is taken off mid-shift on a full day. A time in after the usual time in (+15 min), or a time out before the usual time out or more than 30 min after it, asks the employee for a reason (shown to HR on Live attendance).' : 'Attendance and payroll use this schedule: lateness from the time in, overtime and undertime from the regular hours, and rest days.'; };
    flexBox.onchange = showFlex; showFlex();
    dialog.querySelector('#schedule-form').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.target);
      try {
        await api(`/hr/employees/${encodeURIComponent(id)}/schedule`, { start: f.get('start'), end: f.get('end'), hoursPerDay: Number(f.get('hoursPerDay')), mealBreakMinutes: Number(f.get('mealBreakMinutes')), restDays: f.getAll('restDays').map(Number), arrangement: f.get('arrangement'), flexible: f.get('flexible') === 'on' });
        dialog.close(); toast('Work schedule saved. Attendance and payroll now use it.'); await after();
      } catch (error) { const e = dialog.querySelector('[data-schedule-error]'); e.textContent = error.message; e.classList.remove('hidden'); }
    };
  }
  const editBtn = (section, canEdit) => (canEdit ? ` <button class="small" data-edit-section="${section}">Edit</button>` : '');
  const formBtn = (part, canEdit) => (canEdit ? ` <button class="small" data-edit-part="${part}">Edit</button>` : '');
  function personalRows(f) { return [['First name', f.personal.firstName], ['Middle name', f.personal.middleName], ['Last name', f.personal.lastName], ['Suffix', f.personal.suffix], ['Preferred name', f.personal.preferredName], ['Sex', f.personal.sex], ['Date of birth', f.personal.birthDate && fmtDate(f.personal.birthDate)], ['Place of birth', f.personal.birthPlace], ['Civil status', f.personal.civilStatus], ['Nationality', f.personal.nationality], ...(f.personal.bloodType ? [['Blood type', f.personal.bloodType]] : []), ['Mobile', f.contact.mobile], ['Work email', f.contact.workEmail], ['Personal email', f.contact.personalEmail], ['Current address', f.contact.currentAddress], ['Permanent address', f.contact.permanentAddress]]; }
  function employmentRows(record) { const f = record.form; return [['Employee number', record.number], ['Subsidiary', f.employment.department], ['Position', f.employment.position], ['Job level', f.employment.jobLevel], ['Employment type', f.employment.employmentType], ['Classification', f.employment.classification], ['Status', f.employment.status], ['Immediate supervisor', f.employment.supervisor], ['Work location', f.employment.workLocation], ['Date hired', fmtDate(f.employment.dateHired)], ['Contract start', f.employment.contractStart && fmtDate(f.employment.contractStart)], ['Contract end', f.employment.contractEnd && fmtDate(f.employment.contractEnd)], ['Probation end', f.employment.probationEnd && fmtDate(f.employment.probationEnd)], ['Performance review', f.employment.reviewDate && fmtDate(f.employment.reviewDate)]]; }
  // Attendance history for one month: recorded attendance and approved leave, newest first.
  let attMonth = '';
  // Consolidated Attendance History (Nov 20, 2026): every date of the month in order, from the server (attendance-days):
  // kind of day, time in / out, late, gaps (Missing Time-In, Missing Time-Out, No Time-In / Time-Out), days recorded but
  // not yet approved (Attendance for Verification), the correction case, remarks and off-site reasons / places.
  const dayCache = new Map();
  const CHIP = { 'missing-in': ['Missing Time-In', 'att-chip-in'], 'missing-out': ['Missing Time-Out', 'att-chip-out'], 'no-record': ['Absent', 'att-chip-none'], verify: ['Attendance for Verification', 'att-chip-verify'], rest: ['Rest day', 'att-chip-rest'], holiday: ['Holiday', 'att-chip-holiday'], leave: ['Approved leave', 'att-chip-leave'], wfh: ['Work from home', 'att-chip-wfh'] };
  const chip = (key, text) => `<span class="att-chip ${CHIP[key][1]}">${esc(text || CHIP[key][0])}</span>`;
  function historyHtml(id, month) {
    const key = `${id}|${month}`;
    if (!dayCache.has(key)) {
      dayCache.set(key, null);
      ctx.api(`/attendance-days?employeeId=${encodeURIComponent(id)}&month=${month}`).then(list => { dayCache.set(key, list); const box = document.querySelector('[data-att-box]'); if (box && (attMonth || ctx.today().slice(0, 7)) === month) box.innerHTML = attendanceHtml(id); }).catch(error => dayCache.set(key, { error: error.message }));
    }
    const list = dayCache.get(key);
    if (list === null) return '<p class="muted">Loading attendance…</p>';
    if (list.error) return `<div class="notice">${list.error === 'Not found.' ? 'The attendance history is available after the HR server restarts.' : esc(list.error)}</div>`;
    const day = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const today = ctx.today(), verify = d => !d.issue && d.status === 'present' && !d.approved && d.timeIn && d.timeOut;
    const where = o => (o.latitude === null || o.latitude === undefined ? esc(o.place || '') : `<a href="https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}" target="_blank" rel="noopener noreferrer">${esc(o.place || 'Map')}</a>`);
    const statusCell = d => (d.issue ? chip(d.issue) : verify(d) ? chip('verify') : d.date > today ? '<small class="muted">Not yet</small>' : d.status === 'present' ? (d.late >= 15 ? 'Late' : 'Present') : d.absentByHr ? '<span class="att-chip att-chip-none">Absent</span>' : d.status ? esc(d.status.replace(/-/g, ' ')) : '');
    const kindCell = d => (CHIP[d.kind] && d.kind !== 'workday' ? chip(d.kind, d.label) : esc(d.label));
    const remarks = d => [d.explanation ? esc(d.explanation) : '', ...d.offsite.map(o => `Off-site ${o.kind === 'in' ? 'time in' : 'time out'} ${esc(o.time)}${o.reason ? ` — ${esc(o.reason)}` : ''}${o.place || o.latitude !== null ? ` · ${where(o)}` : ''}`)].filter(Boolean).join('<br>');
    const n = k => list.filter(d => d.issue === k).length;
    const counts = `${list.filter(d => d.status === 'present').length} present · ${n('missing-in')} missing time-in · ${n('missing-out')} missing time-out · ${n('no-record') + list.filter(d => d.absentByHr).length} absent · ${list.filter(verify).length} for verification`;
    const legend = `<div class="att-legend">${Object.keys(CHIP).map(k => chip(k)).join('')}</div>`;
    return `<p class="legend">${counts}</p>${legend}` + table(['Date', 'Day', 'Time in', 'Time out', 'Late (min)', 'Hours worked', 'Status', 'Remarks'], list.map(d => [day(d.date), kindCell(d), esc(d.timeIn || '—'), esc(d.timeOut ? `${d.timeOut}${d.endNextDay ? ' (+1)' : ''}` : '—'), d.flexible ? '—' : d.late || '—', d.hoursWorked === null || d.hoursWorked === undefined ? '—' : `<strong>${d.hoursWorked.toFixed(2)} h</strong>${d.regularHours && d.hoursWorked < d.regularHours && d.kind === 'workday' ? `<br><small class="att-overdue">${(d.regularHours - d.hoursWorked).toFixed(2)} h short</small>` : ''}`, statusCell(d), `<span class="wrap">${remarks(d)}</span>`]), 'No days in this month.');
  }
  // Overtime applications of this employee for the month (filed hours, decision, hours payroll can pay); decided on the
  // Attendance → Overtime applications page. Loaded once per open profile (the whole list, filtered here).
  let otCache = null;
  function overtimeHtml(id, month) {
    if (otCache === null) {
      otCache = 'loading';
      ctx.api('/overtime-requests').then(list => { otCache = list; const box = document.querySelector('[data-att-box]'); if (box) box.innerHTML = attendanceHtml(id); }).catch(() => { otCache = []; });
    }
    if (otCache === 'loading') return '<p class="muted">Loading overtime applications…</p>';
    const STATUS = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
    const rows = otCache.filter(o => o.employeeId === id && o.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date));
    return '<h3>Overtime applications</h3>' + table(['Date', 'Period', 'Hours filed', 'Status', 'Approved', 'Payable (worked)', 'Work / reason', 'Notes'], rows.map(o => [esc(o.date), o.startTime ? `${esc(o.startTime)}–${esc(o.endTime)}${o.breakMinutes ? ` (less ${o.breakMinutes} min break)` : ''}` : '—', esc(o.hours), esc(STATUS[o.status] || o.status), o.status === 'approved' ? esc(o.approvedHours) : '—', o.status === 'approved' ? `${esc(o.payableHours)} h` : '—', `<span class="wrap">${esc(o.reason || o.work || '')}</span>`, `<span class="wrap">${esc([o.remarks, ...(o.flags || [])].filter(Boolean).join(' · '))}</span>`]), 'No overtime applications this month.') + '<p class="legend">Approve or reject them in Attendance → Overtime applications.</p>';
  }
  function attendanceHtml(id) {
    const month = attMonth || ctx.today().slice(0, 7), can = ctx.context?.()?.can || {};
    // HR / Admin / Payroll: the consolidated day-by-day history; other roles keep the recorded list below.
    if (can.approve || can.payroll || ctx.context?.()?.roleLabel === 'Payroll') {
      const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(`${ctx.today().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7); });
      const label = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return block('🕒', 'Attendance history', `<div class="att-tools"><label class="field">Month<select data-att-month>${months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${label(m)}</option>`).join('')}</select></label></div>` + historyHtml(id, month) + (can.approve ? overtimeHtml(id, month) : ''));
    }
    const state = ctx.getState();
    const mins = hm => { const [h, m] = String(hm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
    const grace = state.rules.filter(r => r.approvedBy).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.graceMinutes ?? 15;
    const typeName = tid => state.leaveTypes.find(x => x.id === tid)?.name || tid;
    const rows = new Map();
    for (const a of state.attendance.filter(x => x.employeeId === id && x.date.startsWith(month))) {
      const late = a.status === 'present' && mins(a.timeIn) !== null && mins(a.scheduledIn) !== null ? Math.max(0, mins(a.timeIn) - mins(a.scheduledIn)) : 0;
      const status = a.status === 'present' ? (late >= Math.max(1, grace) ? 'Late' : 'Present') : a.status === 'absent' ? 'Absent' : a.status === 'off' ? 'Off' : a.status.replace(/-/g, ' ');
      rows.set(a.date, { date: a.date, status, timeIn: a.timeIn, timeOut: a.timeOut ? `${a.timeOut}${a.endNextDay ? ' (+1)' : ''}` : '', late, note: /^Employee clock events:/.test(a.explanation || '') ? '' : a.explanation || '' });   // the automatic time in / out note is not a remark
    }
    for (const l of state.leaves.filter(x => x.employeeId === id && x.status === 'approved')) for (const d of (l.countedDates || []).filter(x => x.startsWith(month))) {
      const half = (l.partialDates || []).includes(d), row = rows.get(d) || { date: d, timeIn: '', timeOut: '', late: 0, note: '' };
      rows.set(d, { ...row, status: half && row.status ? `${row.status} · ${typeName(l.typeId)} (half day)` : `On leave · ${typeName(l.typeId)}${half ? ' (half day)' : ''}` });
    }
    const list = [...rows.values()].sort((a, b) => b.date.localeCompare(a.date));
    const months = [...new Set([ctx.today().slice(0, 7), ...state.attendance.filter(x => x.employeeId === id).map(x => x.date.slice(0, 7))])].sort().reverse();
    const label = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const day = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
    const count = s => list.filter(r => r.status.startsWith(s)).length;
    return block('🕒', 'Attendance history', `<div class="att-tools"><label class="field">Month<select data-att-month>${months.map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${label(m)}</option>`).join('')}</select></label><span class="legend">${count('Present')} present · ${count('Late')} late · ${count('Absent')} absent · ${count('On leave')} on leave</span></div>`
      + table(['Date', 'Status', 'Time in', 'Time out', 'Late (min)', 'Remarks'], list.map(r => [day(r.date), esc(r.status), esc(r.timeIn || '—'), esc(r.timeOut || '—'), r.late || '—', `<span class="wrap">${esc(r.note || '')}</span>`]), 'No attendance recorded for this month.')
      + (ctx.context?.()?.can?.approve ? overtimeHtml(id, month) : ''));
  }
  function safeBody(...args) {
    try { return tabBody(...args); } catch (error) { return `<div class="notice">This tab could not be shown: ${esc(error.message)}. Reload the page (Ctrl+F5) and try again.</div>`; }
  }
  function tabBody(record, checklist, extra, extras) {
    const f = record.form, edit = extras.canEdit && !record.archived;
    if (tab === 'overview') {
      const docs = checklist.items.flatMap(i => i.versions).length, trainingsDone = extra.trainings.filter(x => x.completion === 'completed').length, acked = extra.memos.filter(m => m.acknowledgedAt).length;
      const stat = (icon, label, value, sub, percent = null) => `<div class="overview-stat"><span><span aria-hidden="true">${icon}</span> ${esc(label)}</span><strong>${value}</strong><small>${esc(sub)}</small>${percent === null ? '' : `<span class="hr-progress full"><span class="hr-progress-bar w${Math.round(percent / 5) * 5}"></span></span>`}</div>`;
      const outstanding = checklist.items.filter(i => i.requirement.required && !['Verified', 'Not Applicable'].includes(i.status));
      return `<div class="overview-stats">${stat('✅', 'Requirements', `${checklist.completeCount} / ${checklist.requiredCount}`, 'Complete', checklist.percent)}${stat('📁', 'Documents', docs, 'Total files')}${stat('🏅', 'Trainings', `${trainingsDone} / ${extra.trainings.length}`, 'Complete', extra.trainings.length ? Math.round(trainingsDone / extra.trainings.length * 100) : 0)}${stat('📝', 'Memos', extra.memos.length, `${acked} acknowledged`)}</div>
        ${sectionCard('👤', 'Personal Information', boxes(personalRows(f)), formBtn('personal', edit))}
        ${sectionCard('📞', 'Emergency Contact', boxes(emergencyRows(f)), formBtn('emergency', edit))}
        ${block('💼', 'Employment information', dl(employmentRows(record)))}
        ${scheduleCard(record)}
        ${outstanding.length ? block('⚠️', 'Outstanding requirements', `<ul class="plain-list">${outstanding.map(i => `<li>${badge(i.status, DOC_BADGE[i.status])} ${esc(i.requirement.name)}${i.overdue ? ' <strong class="danger-text">overdue</strong>' : ''}</li>`).join('')}</ul>`) : ''}`;
    }
    if (tab === 'employment' || tab === 'history') return block('💼', 'Employment information', dl([...employmentRows(record), ['Length of service', serviceLength(f.employment.dateHired, ctx.today())]]), formBtn('employment', edit)) + (ctx.context?.()?.can?.manage ? (setTimeout(() => import('./movements-ui.js').then(m => m.mountMovements(document.querySelector('[data-mv-box]'), { api: ctx.api, esc, badge, toast: ctx.toast, openDialog: ctx.openDialog, dialog: ctx.dialog, today: ctx.today }, record.id)).catch(() => {}), 0), '<div data-mv-box></div>') : '') + (extras.history ? block('🕘', 'Previous employment', table(['Company', 'Position', 'From', 'To', 'Reason for leaving'], extras.history.entries.map(x => [esc(x.company), esc(x.position || '—'), x.from ? fmtDate(x.from) : '—', x.to ? fmtDate(x.to) : '—', esc(x.reason || '—')]), 'No previous employment recorded.'), editBtn('history', edit)) : '');
    const loansHtml = () => {
      const L = extras.loans;
      const rows = L.loans.map(l => [esc(l.type), l.loanDate ? fmtDate(l.loanDate) : '—', ctx.money(l.original), ctx.money(l.perPayroll), ctx.money(l.totalRepaid), `<strong>${ctx.money(l.outstanding)}</strong>`, l.nextDeduction ? fmtDate(l.nextDeduction) : '—', esc(l.status)]);
      const paid = L.loans.flatMap(l => (l.history || []).map(h => ({ ...h, type: l.type, reference: l.reference }))).sort((a, b) => String(b.end || b.date || '').localeCompare(String(a.end || a.date || '')));
      return block('💳', 'Loans', `${table(['Loan', 'Loan date', 'Original', 'Per payroll', 'Repaid', 'Outstanding', 'Next deduction', 'Status'], rows)}`)
        + (paid.length ? block('🧾', 'Payment history', table(['Date / cutoff', 'Loan', 'Amount', 'Balance after'], paid.map(h => [esc(h.prior ? fmtDate(h.end) : h.start && h.end ? `${fmtDate(h.start)} – ${fmtDate(h.end)}` : fmtDate(h.end || h.date || '')), esc(h.type), ctx.money(h.amount ?? (h.principal || 0) + (h.interest || 0)), ctx.money(h.balanceAfter ?? h.remainingBalance ?? 0)]))) : '')
        + (L.applications.length ? block('📝', 'Loan applications', table(['Type', 'Requested', 'Months', 'Applied', 'Status'], L.applications.map(a => [esc(a.type), ctx.money(a.amount), a.months, fmtDate(a.appliedAt), esc(a.status)]))) : '');
    };
    if (tab === 'compensation' || tab === 'loans') {
      const c = extras.compensation, daily = c.basis === 'daily';
      return block('💰', 'Pay', dl([['Pay basis', daily ? 'Daily-paid' : c.basis === 'days-worked' ? 'Per day worked (monthly ÷ 26 × days worked)' : 'Monthly'], [daily ? 'Daily rate' : 'Monthly salary', ctx.money(daily ? c.dailyRate : c.monthlySalary)], ...(daily ? [['Monthly equivalent', ctx.money(c.monthlySalary)]] : [['Daily rate', c.dailyRate === null ? 'From company divisor' : ctx.money(c.dailyRate)]]), ['Payroll frequency', c.frequency || 'Company default'], ['Payroll status', c.status]]), extras.canEditPay ? ' <button class="small" data-edit-pay>Edit pay</button>' : '')
        + block('✔️', 'Pay coverage', dl([['Overtime', c.coveredOT ? 'Covered' : 'Not covered'], ['Night differential', c.coveredNSD ? 'Covered' : 'Not covered'], ['Holiday pay', c.coveredHoliday ? 'Covered' : 'Not covered'], ['13th month pay', c.covered13th ? 'Covered' : 'Not covered'], ['Withholding tax', c.withholdingTax === 'exempt' ? 'Exempt (no withholding tax)' : 'Withheld per tax table']]), extras.canEditPay ? ' <button class="small" data-edit-pay>Edit coverage</button>' : '')
        + block('➖', 'Company deductions', table(['Deduction', 'Amount', 'When'], c.deductions.map(d => [esc(d.name), ctx.money(d.amount), SCHEDULE_LABEL[d.schedule] || esc(d.schedule)]), 'No company deductions.'), ctx.legacy() ? ' <button class="small" data-go-deductions>Manage deductions</button>' : '')
        + (extras.canEditPay ? (setTimeout(() => import('./salary-ui.js').then(m => m.mountSalary(document.querySelector('[data-salary-box]'), { api: ctx.api, esc, toast: ctx.toast, openDialog: ctx.openDialog, dialog: ctx.dialog, today: ctx.today }, record.id)).catch(() => {}), 0), '<div data-salary-box></div>') : '')
        + (extras.loans ? loansHtml() : '')
        + (extras.finalPay?.length ? block('🧾', 'Final pay', table(['Separation', 'Net final pay', 'Release due', 'Status', 'Released on', 'Reference / recorded by'], extras.finalPay.map(r => [fmtDate(r.separationDate), `<a href="/api/final-pay/${esc(r.id)}.pdf" target="_blank" rel="noopener" title="Open the final pay PDF"><strong>${ctx.money(r.net)}</strong></a>`, fmtDate(r.releaseDue), r.release?.released ? '<span class="badge">Released</span>' : r.stage === 'prepared' ? '<span class="badge neutral">Awaiting approval</span>' : '<span class="badge pending">Approved · awaiting settlement</span>', r.release?.released ? fmtDate(r.release.releasedOn) : '—', r.release ? `${r.release.reference ? `${esc(r.release.reference)} · ` : ''}${esc(who(r.release.by))}` : '—']), 'No final pay computed.')) : '')
        + (ctx.legacy() ? `<p class="legend">Salary, schedule and contributions are edited under <button class="link-button" data-legacy-profile="${esc(record.id)}">Attendance, leave &amp; pay</button>.</p>` : '');
    }
    const governmentIds = () => block('🪪', 'Government IDs', dl([['TIN', f.government.tin], ['SSS number', f.government.sss], ['PhilHealth number', f.government.philHealth], ['Pag-IBIG MID', f.government.pagIbig]]), formBtn('government', edit && record.sensitiveIds && ctx.context().can.approve)) + `<p class="legend">${record.sensitiveIds ? 'Shown in full to authorised roles only. HR Managers and Administrators can edit them.' : 'Masked for your role.'}</p>`;
    if (tab === 'family') {
      const fam = extras.family;
      return block('💑', 'Spouse', dl([['Name', fam.spouse.name], ['Occupation', fam.spouse.occupation], ['Contact', fam.spouse.contact]]), editBtn('family', edit))
        + block('👪', 'Parents', dl([["Father's name", fam.father.name], ["Father's occupation", fam.father.occupation], ["Mother's maiden name", fam.mother.name], ["Mother's occupation", fam.mother.occupation]]), editBtn('family', edit))
        + block('🧒', 'Children', table(['Name', 'Date of birth'], fam.children.map(c => [esc(c.name), c.birthDate ? fmtDate(c.birthDate) : '—']), 'No children recorded.'), editBtn('family', edit));
    }
    if (tab === 'education') return block('🎓', 'Education', table(['Level', 'School', 'Course / strand', 'Years', 'Honors'], extras.education.entries.map(x => [esc(x.level), esc(x.school), esc(x.course || '—'), esc([x.yearFrom, x.yearTo].filter(Boolean).join('–') || '—'), esc(x.honors || '—')]), 'No education recorded.'), editBtn('education', edit));
    if (tab === 'leave') {
      const L = extras.leave;
      return block('🌴', `Leave Credits · ${L.year}`, table(['Leave Type', 'Eligibility', 'Credits This Year', 'Used Leave', 'Available'], L.types.map(t => [`<span class="lc-type"><i class="lc-ico" aria-hidden="true">${/vacation/i.test(t.name) ? '✈️' : /sick/i.test(t.name) ? '💊' : /emergency/i.test(t.name) ? '🚨' : /bereave/i.test(t.name) ? '🎗️' : /parent|maternity|paternity/i.test(t.name) && !/solo/i.test(t.name) ? '👪' : /service incentive|sil/i.test(t.name) ? '🏅' : /solo/i.test(t.name) ? '❤️' : /women|9710/i.test(t.name) ? '🌸' : '📅'}</i>${esc(t.name)}</span>`, `<span class="lc-pill ${t.eligible ? 'lc-yes' : 'lc-no'}">${t.eligible ? 'Yes' : 'No'}</span>`, `${t.entitled} day${t.entitled === 1 ? '' : 's'}`, (t.taken || []).length || t.usedBefore ? `<button class="ml-name lc-used" data-leave-dates="${esc(t.typeId)}" title="Show the leave dates">${Math.round(t.used * 100) / 100} day(s)</button>` : `${Math.round(t.used * 100) / 100} day(s)`, `<span class="lc-pill lc-days ${t.available > 0 ? 'lc-yes' : 'lc-no'}">${t.available} day${t.available === 1 ? '' : 's'}</span>`]), 'No paid leave types are configured.'), L.canEdit && !record.archived ? ' <button class="small" data-edit-leave>✎ Edit Leave Credits</button>' : '');
    }
    if (tab === 'requirements' || tab === 'documents' || tab === 'government') {
      const files = checklist.items.flatMap(i => i.versions.map(v => ({ ...v, current: i.current?.id === v.id })));
      return governmentIds() + documentsTab(record, checklist) + (files.length ? block('📁', 'All 201 files', table(['File', 'Requirement', 'Uploaded', 'Review'], files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map(v => [`<a href="/api/hr/documents/${v.id}/content" target="_blank" rel="noopener">${esc(v.name)}</a>`, esc(v.requirementName || ''), fmtDateTime(v.uploadedAt), badge(v.reviewStatus, DOC_BADGE[v.reviewStatus])]), 'No files uploaded yet. Upload them from the Requirements tab.')) : '');
    }
    if (tab === 'attendance') return `<div data-att-box>${attendanceHtml(record.id)}</div>`;
    if (tab === 'memos') return block('📝', 'Memos and acknowledgements', table(['Memo', 'Reference', 'Version', 'Issued', 'Received', 'Acknowledged receipt'], extra.memos.map(m => [esc(m.title), esc(m.reference), `v${m.version}`, fmtDate(m.issueDate), fmtDateTime(m.assignedAt), m.acknowledgedAt ? badge(`Acknowledged ${fmtDateTime(m.acknowledgedAt)}`) : m.ackRequired ? badge('Pending', 'pending') : badge('Not required', 'neutral')]), 'No memos addressed to this employee.'), `${edit ? ' <button class="small" data-go-memos>Send a memo</button>' : ''}${ctx.context().can.approve || ctx.context().roleLabel === 'Management' ? ' <button class="small" data-go-discipline>Disciplinary record</button>' : ''}`);
    if (tab === 'trainings') return block('🏅', 'Training records', table(['Training', 'Date', 'Required', 'Registration', 'Attendance', 'Completion'], extra.trainings.map(x => [esc(x.title), fmtDate(x.date), x.required ? 'Required' : 'Optional', esc(x.registration), esc(x.attendance), x.completion === 'completed' ? badge('Completed') : esc(x.completion)]), 'No trainings assigned.'), edit ? ' <button class="small" data-go-trainings>Assign a training</button>' : '');
    return block('↺', 'Activity history', table(['When', 'Who', 'Action', 'Area', 'Previous → updated'], extra.activity.map(a => [fmtDateTime(a.at), esc(who(a.actor)), esc(a.action), esc(a.area), (a.changes || []).length ? `<span class="wrap">${a.changes.map(c => `<small><strong>${esc(c.field)}</strong>: ${esc(c.before)} → ${esc(c.after)}</small>`).join('')}</span>` : '—']), record.canEdit ? 'No recorded activity yet.' : 'Activity history is available to HR.')) + '<p class="legend">The audit trail is permanent: it cannot be edited or deleted. Values you are not authorized to see (such as salary) are left out.</p>';
  }
  // Leave credits typed by HR: credits for the year (blank = the leave policy) and days used before the system.
  function leaveDialog(id, L) {
    const num = (name, value, label) => `<input type="number" min="0" max="366" step="0.5" name="${name}" value="${value ?? ''}" aria-label="${esc(label)}" class="narrow">`;
    openDialog(`Leave credits · ${L.year}`, `<form id="leave-form"><div class="dialog-body"><p class="sub">Type the leave credits for this year. Leave “Credits this year” blank to use the leave policy. “Used before the system” is leave already taken this year before it was recorded here.</p>
      <div class="scroll-table"><table class="edit-rows"><thead><tr><th>Leave type</th><th>Eligible</th><th>Credits this year (days)</th><th>Used before the system (days)</th></tr></thead><tbody>${L.types.map(t => `<tr data-type="${esc(t.typeId)}"><td>${esc(t.name)}</td><td><input type="checkbox" name="eligible" ${t.eligible ? 'checked' : ''} aria-label="Eligible for ${esc(t.name)}"></td><td>${num('credits', t.manualCredits, `Credits for ${t.name}`)}</td><td>${num('used', t.usedBefore || '', `Used before the system for ${t.name}`)}</td></tr>`).join('')}</tbody></table></div>
      <label class="field">Remarks (kept in the audit trail)<input name="remarks" maxlength="500"></label></div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save leave credits</button></div></form>`);
    dialog.classList.add('wide-dialog');
    dialog.querySelector('#leave-form').onsubmit = async event => {
      event.preventDefault();
      const items = [...dialog.querySelectorAll('tr[data-type]')].map(tr => { const credits = tr.querySelector('[name=credits]').value; return { typeId: tr.dataset.type, eligible: tr.querySelector('[name=eligible]').checked, manualCredits: credits === '' ? null : Number(credits), usedBefore: Number(tr.querySelector('[name=used]').value || 0) }; });
      try { await api(`/hr/employees/${encodeURIComponent(id)}/leave`, { year: L.year, items, remarks: event.target.elements.remarks.value }); dialog.close(); toast('Leave credits saved. The employee sees the same balance.'); tab = 'leave'; await drawProfile(); } catch (error) { toast(error.message); }
    };
  }
  // Repeating-row editors for family, education and previous employment.
  function sectionDialog(section, extras) {
    const row = (cells, removable = true) => `<tr>${cells}<td>${removable ? '<button type="button" class="small danger" data-row-del>Remove</button>' : ''}</td></tr>`;
    const input = (name, value = '', type = 'text', extra = '') => `<td><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></td>`;
    let body, template;
    if (section === 'family') {
      const fam = extras.family;
      template = row(input('childName', '', 'text', 'required maxlength="200" aria-label="Child name"') + input('childBirth', '', 'date', 'aria-label="Date of birth"'));
      body = `<div class="form-grid"><label class="field">Spouse name<input name="spouseName" value="${esc(fam.spouse.name)}" maxlength="200"></label><label class="field">Spouse occupation<input name="spouseOccupation" value="${esc(fam.spouse.occupation)}" maxlength="200"></label><label class="field">Spouse contact<input name="spouseContact" value="${esc(fam.spouse.contact)}" maxlength="40"></label><span></span>
        <label class="field">Father's name<input name="fatherName" value="${esc(fam.father.name)}" maxlength="200"></label><label class="field">Father's occupation<input name="fatherOccupation" value="${esc(fam.father.occupation)}" maxlength="200"></label>
        <label class="field">Mother's maiden name<input name="motherName" value="${esc(fam.mother.name)}" maxlength="200"></label><label class="field">Mother's occupation<input name="motherOccupation" value="${esc(fam.mother.occupation)}" maxlength="200"></label></div>
        <h3 class="spaced">Children</h3><div class="scroll-table"><table class="edit-rows"><thead><tr><th>Name</th><th>Date of birth</th><th></th></tr></thead><tbody>${fam.children.map(c => row(input('childName', c.name, 'text', 'required maxlength="200" aria-label="Child name"') + input('childBirth', c.birthDate, 'date', 'aria-label="Date of birth"'))).join('')}</tbody></table></div>`;
    } else if (section === 'education') {
      const levelSelect = v => `<td><select name="level" aria-label="Level">${EDUCATION_LEVELS.map(l => `<option ${l === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>`;
      template = row(levelSelect('College') + input('school', '', 'text', 'required maxlength="200" aria-label="School"') + input('course', '', 'text', 'aria-label="Course"') + input('yearFrom', '', 'text', 'maxlength="4" class="narrow" aria-label="From year"') + input('yearTo', '', 'text', 'maxlength="4" class="narrow" aria-label="To year"') + input('honors', '', 'text', 'aria-label="Honors"'));
      body = `<div class="scroll-table"><table class="edit-rows"><thead><tr><th>Level</th><th>School</th><th>Course / strand</th><th>From</th><th>To</th><th>Honors</th><th></th></tr></thead><tbody>${extras.education.entries.map(x => row(levelSelect(x.level) + input('school', x.school, 'text', 'required maxlength="200" aria-label="School"') + input('course', x.course, 'text', 'aria-label="Course"') + input('yearFrom', x.yearFrom, 'text', 'maxlength="4" class="narrow" aria-label="From year"') + input('yearTo', x.yearTo, 'text', 'maxlength="4" class="narrow" aria-label="To year"') + input('honors', x.honors, 'text', 'aria-label="Honors"'))).join('')}</tbody></table></div>`;
    } else {
      template = row(input('company', '', 'text', 'required maxlength="200" aria-label="Company"') + input('position', '', 'text', 'aria-label="Position"') + input('from', '', 'date', 'aria-label="From"') + input('to', '', 'date', 'aria-label="To"') + input('reason', '', 'text', 'aria-label="Reason for leaving"'));
      body = `<div class="scroll-table"><table class="edit-rows"><thead><tr><th>Company</th><th>Position</th><th>From</th><th>To</th><th>Reason for leaving</th><th></th></tr></thead><tbody>${extras.history.entries.map(x => row(input('company', x.company, 'text', 'required maxlength="200" aria-label="Company"') + input('position', x.position, 'text', 'aria-label="Position"') + input('from', x.from, 'date', 'aria-label="From"') + input('to', x.to, 'date', 'aria-label="To"') + input('reason', x.reason, 'text', 'aria-label="Reason for leaving"'))).join('')}</tbody></table></div>`;
    }
    const title = { family: 'Family', education: 'Education', history: 'Previous employment' }[section];
    openDialog(`Edit ${title.toLowerCase()}`, `<form id="section-form"><div class="dialog-body">${body}<button type="button" class="small spaced" data-row-add>＋ Add ${section === 'family' ? 'child' : 'row'}</button><template id="row-template">${template}</template></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save ${title.toLowerCase()}</button></div></form>`);
    dialog.classList.add('wide-dialog');
    const form = dialog.querySelector('#section-form');
    form.addEventListener('click', event => {
      if (event.target.closest('[data-row-del]')) event.target.closest('tr').remove();
      if (event.target.closest('[data-row-add]')) form.querySelector('tbody').append(form.querySelector('#row-template').content.cloneNode(true));
    });
    form.onsubmit = async event => {
      event.preventDefault();
      const rows = [...form.querySelectorAll('tbody tr')].map(tr => Object.fromEntries([...tr.querySelectorAll('[name]')].map(el => [el.name, el.value.trim()])));
      const g = n => form.elements[n]?.value.trim() || '';
      const value = section === 'family'
        ? { spouse: { name: g('spouseName'), occupation: g('spouseOccupation'), contact: g('spouseContact') }, father: { name: g('fatherName'), occupation: g('fatherOccupation') }, mother: { name: g('motherName'), occupation: g('motherOccupation') }, children: rows.map(r => ({ name: r.childName, birthDate: r.childBirth })) }
        : { entries: rows };
      try { await api(`/hr/employees/${encodeURIComponent(profileId)}/sections/${section}`, value); dialog.classList.remove('wide-dialog'); dialog.close(); toast(`${title} saved.`); await drawProfile(); } catch (error) { toast(error.message); }
    };
  }
  function documentsTab(record, checklist) {
    const manage = can().manage && !record.archived, approve = can().approve;
    // Government numbers already on file (Government IDs) need nothing more, so they are not listed; missing ones still are.
    const shown = checklist.items.filter(i => !(i.numberOnly && i.status === 'Verified'));
    const groups = [...new Set(shown.map(i => i.requirement.category))];
    return `<section class="panel checklist-panel"><div class="panel-head"><div><h2>Digital 201 checklist</h2><p>Completion counts only current, verified, required documents.</p></div>${progress(checklist.percent, `${checklist.completeCount}/${checklist.requiredCount} verified`)}</div>
      ${groups.map(g => `<h3 class="hr-group-title">${esc(g)}</h3>${table(['Requirement', 'Status', 'Due / expiry', 'Current file', 'Actions'], shown.filter(i => i.requirement.category === g).map(i => {
        const c = i.current;
        return [`${esc(i.requirement.name)}${i.restricted ? ' <small>🔒 restricted</small>' : ''}`,
          `${i.numberOnly ? badge(i.status === 'Verified' ? 'Number on file' : i.status === 'Missing' ? 'No number yet' : i.status, DOC_BADGE[i.status]) : !i.requirement.required && i.status === 'Missing' ? '<span class="muted">—</span>' : badge(i.status, DOC_BADGE[i.status])}${i.overdue ? ' <small class="danger-text">overdue</small>' : ''}${i.expiringSoon ? ' <small>expiring soon</small>' : ''}${i.notApplicable ? `<small>${esc(i.notApplicable.reason)}</small>` : ''}`,
          c?.expiryDate ? `Expires ${fmtDate(c.expiryDate)}` : i.due && ['Missing', 'Rejected'].includes(i.status) ? `Due ${fmtDate(i.due)}` : '—',
          i.numberOnly ? '<span class="muted">Number only · no file needed</span>' : i.hidden ? '<span class="muted">Restricted</span>' : c ? `<a href="/api/hr/documents/${c.id}/content" target="_blank" rel="noopener">${esc(c.name)}</a>` : '—',
          `<span class="row-actions">${manage && !i.hidden && !i.numberOnly ? `<button class="small" data-upload="${esc(i.requirement.id)}">${c ? 'Replace' : 'Upload'}</button>` : ''}${manage && c && !i.hidden && ['Submitted', 'Under Review', 'Expired'].includes(i.status) ? `<button class="small primary" data-review="${c.id}" data-req="${esc(i.requirement.name)}">Review</button>` : ''}${approve && (!c || i.notApplicable) ? `<button class="small" data-na="${esc(i.requirement.id)}" data-on="${i.notApplicable ? '' : '1'}">${i.notApplicable ? (i.notApplicable.waived ? 'Remove waiver' : 'Mark applicable') : 'Not applicable'}</button>${!i.notApplicable && i.requirement.required ? `<button class="small" data-na="${esc(i.requirement.id)}" data-on="1" data-waive="1">Waive…</button>` : ''}` : ''}${i.notApplicable?.reason ? `<small>${esc(i.notApplicable.waived ? 'Waived' : 'N/A')}: ${esc(i.notApplicable.reason)}</small>` : ''}</span>`];
      }))}`).join('')}</section>`;
  }
  async function onProfileClick(event, record, checklist, extras) {
    const b = event.target.closest('button'); if (!b) return;
    const id = profileId;
    try {
      if (b.dataset.tabSelect) { tab = b.dataset.tabSelect; await drawProfile(); return; }
      if (b.hasAttribute('data-edit-leave')) { leaveDialog(id, extras.leave); return; }
      if (b.hasAttribute('data-back')) { ctx.setPage('files'); await directory(); return; }
      if (b.hasAttribute('data-edit-self')) { editEmployee(id, drawProfile); return; }
      if (b.hasAttribute('data-edit-schedule')) { scheduleDialog(id, record, drawProfile); return; }
      if (b.dataset.archive) { archive(b.dataset.archive); return; }
      if (b.dataset.restore) { try { await api(`/hr/employees/${encodeURIComponent(b.dataset.restore)}/restore`, {}); toast('Employee restored.'); await drawProfile(); } catch (e) { toast(e.message); } return; }
      if (b.dataset.legacyProfile) { ctx.openLegacyProfile(b.dataset.legacyProfile); return; }
      if (b.dataset.editSection) { sectionDialog(b.dataset.editSection, extras); return; }
      if (b.dataset.editPart) {
        const parts = { personal: [['Personal information', 'Contact information'], 'personal information'], emergency: [['Emergency contact'], 'emergency contact'], employment: [['Employment information'], 'employment'], government: [['Government identifiers (restricted)'], 'government IDs'] }[b.dataset.editPart];
        editEmployee(id, drawProfile, parts[0], parts[1]); return;
      }
      if (b.hasAttribute('data-edit-pay')) { ctx.editPay(id); return; }
      if (b.hasAttribute('data-go-deductions')) { ctx.go({ page: 'deductions' }); return; }
      if (b.hasAttribute('data-go-memos')) { ctx.go({ page: 'memos' }); return; }
      if (b.hasAttribute('data-go-discipline')) { ctx.go({ page: 'discipline', employeeId: id }); return; }
      if (b.hasAttribute('data-go-trainings')) { ctx.go({ page: 'trainings' }); return; }
      if (b.hasAttribute('data-go-loans')) { ctx.go({ page: 'loans' }); return; }
      if (b.dataset.leaveDates) {
        const t = extras.leave.types.find(x => x.typeId === b.dataset.leaveDates), nice = d => fmtDate(d);
        openDialog(`${t.name} · ${extras.leave.year}`, `<div class="dialog-body"><p class="sub">${esc(record.name)}</p>${table(['Date', 'Days', 'Reason'], t.taken.map(x => [`${x.startDate === x.endDate ? nice(x.startDate) : `${nice(x.startDate)} – ${nice(x.endDate)}`}`, x.days, esc(x.reason || '—')]))}${t.usedBefore ? `<p class="legend">Plus ${t.usedBefore} day${t.usedBefore === 1 ? '' : 's'} used before the system.</p>` : ''}<div class="bd-total"><span>Used leave</span><strong>${Math.round(t.used * 100) / 100} day(s)</strong></div></div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
        return;
      }
      if (b.dataset.upload) uploadDialog(checklist.items.find(i => i.requirement.id === b.dataset.upload));
      if (b.dataset.review) reviewDialog(b.dataset.review, b.dataset.req);
      if (b.dataset.versions) versionsDialog(checklist.items.find(i => i.requirement.id === b.dataset.versions));
      if (b.dataset.na !== undefined) {
        const on = !!b.dataset.on, waive = !!b.dataset.waive, reason = on ? window.prompt(waive ? 'Reason for waiving this requirement (who approved it, until when):' : 'Why is this requirement not applicable to this employee?') : '';
        if (on && !reason) return;
        await api(`/hr/employees/${encodeURIComponent(id)}/requirements/${b.dataset.na}`, { notApplicable: on, reason: reason || '', ...(waive ? { waive: true } : {}) }); toast(on ? (waive ? 'Requirement waived.' : 'Marked not applicable.') : 'Requirement applies again.'); await drawProfile();
      }
    } catch (error) { toast(error.message); }
  }
  function uploadDialog(item) {
    const c = item.current, needsReason = c && c.reviewStatus === 'Verified';
    openDialog(`${c ? 'Replace' : 'Upload'}: ${item.requirement.name}`, `<form id="doc-upload"><div class="dialog-body form-grid">
      <label class="field full">File (PDF, JPG or PNG, up to ${ctx.context().uploads.documentMB} MB)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required></label>
      ${item.requirement.id === 'valid-id' ? `<label class="field full">Which ID is this?${idTypeSelect(esc, 'idType', 'required')}</label>` : ''}
      <label class="field">Issue date (optional)<input type="date" name="issueDate"></label><label class="field">Expiry date ${item.requirement.expires ? '' : '(optional)'}<input type="date" name="expiryDate" ${item.requirement.expires ? 'required' : ''}></label>
      ${c ? `<label class="field full">Reason for replacing${needsReason ? '' : ' (optional)'}<input name="replaceReason" ${needsReason ? 'required minlength="3"' : ''} maxlength="500" placeholder="e.g. Signed copy received"></label>` : ''}
      <label class="field full">Remarks (optional)<input name="remarks" maxlength="500"></label>
      ${c ? `<p class="legend full">The current version (v${c.version}) is kept in the version history.</p>` : ''}</div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Upload</button></div></form>`);
    dialog.querySelector('#doc-upload').onsubmit = async event => {
      event.preventDefault(); const form = event.target, file = form.elements.file.files[0], limit = ctx.context().uploads.documentMB;
      if (!file) return;
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) { toast('Use a PDF, JPG or PNG file.'); return; }
      if (file.size > limit * 1024 * 1024) { toast(`Files can be up to ${limit} MB.`); return; }
      const button = form.querySelector('.primary'); button.disabled = true; button.textContent = 'Uploading…';
      try {
        await api(`/hr/employees/${encodeURIComponent(profileId)}/documents`, { requirementId: item.requirement.id, name: file.name, mime: file.type, data: await readFile(file), issueDate: form.elements.issueDate.value, expiryDate: form.elements.expiryDate.value, replaceReason: form.elements.replaceReason?.value || '', remarks: form.elements.remarks.value, ...(form.elements.idType ? { idType: form.elements.idType.value } : {}) });   // idType only for the Government-issued ID
        dialog.close(); toast('Document uploaded. Review it to count it as complete.'); await drawProfile();
      } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'Upload'; }
    };
  }
  function reviewDialog(docId, name) {
    openDialog(`Review: ${name}`, `<form id="doc-review"><div class="dialog-body"><p><a href="/api/hr/documents/${docId}/content" target="_blank" rel="noopener">Open the document</a> and check it before deciding.</p><div class="form-grid"><label class="field">Decision<select name="decision"><option value="Verified">Verified</option><option value="Under Review">Under review</option><option value="Rejected">Rejected (tell the employee why)</option></select></label><label class="field">Note${' '}<input name="note" maxlength="500" placeholder="Required when rejecting"></label></div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save review</button></div></form>`);
    dialog.querySelector('#doc-review').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.target);
      try { await api(`/hr/documents/${docId}/review`, { decision: f.get('decision'), note: f.get('note') }); dialog.close(); toast(`Document marked ${f.get('decision').toLowerCase()}.`); await drawProfile(); } catch (error) { toast(error.message); }
    };
  }
  function versionsDialog(item) {
    openDialog(`Versions: ${item.requirement.name}`, `<div class="dialog-body">${table(['Version', 'File', 'Uploaded', 'Status', 'Replacement reason'], item.versions.map(v => [`v${v.version}`, `<a href="/api/hr/documents/${v.id}/content" target="_blank" rel="noopener">${esc(v.name)}</a>`, `${fmtDateTime(v.uploadedAt)}<small>${esc(who(v.uploadedBy))}</small>`, `${esc(v.reviewStatus)}${v.reviewNote ? `<small>${esc(v.reviewNote)}</small>` : ''}`, esc(v.replaceReason || '—')]))}</div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
  }

  return { directory, openProfile, drawProfile, addEmployee, isProfile: () => !!profileId, currentId: () => profileId };
}
