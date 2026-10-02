const brandLogo = '/gds-logo.png'; // 菲龍集團 GDS Capital logo (white background)
import { createProfileView } from './profiles.js';
import { createPortal } from './portal.js';
import { contributionsSection, renderCalculation } from './contributions.js';
import { setupInstall, offerInstall } from './install.js';
import { welcomeScene, welcomeCulture } from './welcome.js';
import { createTimecard } from './timecard.js';
import { createAttendanceImport } from './attendance-import.js';
import { createContributionEditor } from './contribution-basis.js';
const app = document.querySelector('#app'), dialog = document.querySelector('#dialog');
const money = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(n || 0);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const label = key => key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const uid = () => crypto.randomUUID();
let auth, state, balances = [], page = 'overview', currentRun = null, filter = '', subtab = 'requests';
let annualYear = today().slice(0, 4);
let employeeStatusFilter = 'All Employees';
let attendanceView = 'records'; // 'records' (all employees) or 'timecard' (one employee beside pay)
let payrollEmployee = '';
let computationContext = null; // the payroll computation being reviewed, reopened after an adjustment is saved // '' = all employees; otherwise the one Employee ID being calculated
let employeeData = null, liveData = null, eventStream = null, liveTimer = null, liveUser = null, refreshTimer = null;
const portal = createPortal({ api, esc, money, table, toast, openDialog, dialog, refresh, render, app, today, brandLogo, onSecurityReset: () => { auth = { user: null }; dialog.close(); renderLogin(); }, reloadAccount: account });
const contributionEditor = createContributionEditor({ api, esc, money, table, badge, toast, openDialog, dialog });
const attendanceImport = createAttendanceImport({ api, esc, table, badge, toast, openDialog, dialog, refresh, render: () => render(), getState: () => state });
const timecard = createTimecard({ api, esc, money, badge, table, getState: () => state, canEdit: kind => canEdit(kind), editButton, cutoffDefaults }); // canEdit is defined below; look it up when used
const profiles = createProfileView({ api, esc, money, table, shell, heading, toast, refresh, today, openContributions: id => contributionEditor.open(id), isActive: () => page === 'profile', canEditMaster: () => canEdit('employees'), editMaster: id => edit('employees', id), openTimecard: id => { timecard.setEmployee(id); attendanceView = 'timecard'; page = 'attendance'; render(); }, openPayroll: async id => { payrollEmployee = id; const p = cutoffDefaults(); currentRun = await api('/payroll/preview', { start: p.start, end: p.end, pay13th: false, employeeIds: [id] }); page = 'payroll'; render(); }, openDirectory: () => { page = 'employees'; render(); }, openRun: async id => { currentRun = await api(`/runs/${id}`); page = 'payroll'; render(); } });
const names = { basic: 'Basic salary', regularOT: 'Regular OT', restDay: 'Rest day pay', restOT: 'Rest day OT', nsd: 'Night shift differential', specialHoliday: 'Special holiday pay', specialOT: 'Special holiday OT', regularHoliday: 'Regular / double holiday pay', regularHolidayOT: 'Regular / double holiday OT', otherHoliday: 'Other holiday pay', otherOT: 'Other holiday OT', thirteenth: '13th month paid', absence: 'Unpaid leave / absence', loans: 'Loan deductions', tax: 'Withholding tax', other: 'Other authorized deductions' };
Object.assign(names, { SSS: 'SSS', PhilHealth: 'PhilHealth', 'Pag-IBIG': 'Pag-IBIG' });
const canEdit = kind => ({ employees: ['admin', 'hr'], attendance: ['admin', 'hr'], leaves: ['admin', 'hr'], holidays: ['admin', 'hr'], leaveTypes: ['admin'], rules: ['admin', 'hr'], loans: ['admin', 'payroll'], adjustments: ['admin', 'payroll', 'hr'], deductions: ['admin', 'hr'] })[kind]?.includes(auth.user.role);
async function api(path, body, method = body ? 'POST' : 'GET') {
  const res = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth?.csrf || '' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') { auth = { user: null }; renderLogin(); }
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}
let toastTimer;
function toast(text) { const node = document.querySelector('#toast'); node.textContent = text; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 6000); }
async function refresh() {
  const user = auth?.user; if (!user) return;
  if (user.role === 'employee') { const data = await api('/me/dashboard'); if (auth?.user?.id === user.id) employeeData = data; return; }
  const data = await api('/state'); if (auth?.user?.id !== user.id) return; state = data.state; balances = data.balances;
  if (['admin', 'hr'].includes(user.role)) liveData = await api('/live');
}
function stopLive() { eventStream?.close(); eventStream = null; clearInterval(liveTimer); clearTimeout(refreshTimer); liveUser = null; }
function startLive() {
  if (!auth?.user || liveUser === auth.user.id) return;
  stopLive(); liveUser = auth.user.id;
  const update = async () => {
    try {
      await refresh();
      const editing = dialog.open || portal.isEditing() || document.activeElement?.matches('input,select,textarea');
      if (!editing && (auth?.user?.role === 'employee' || ['overview', 'live', 'attendance', 'leave', 'employees'].includes(page))) render();
      else { const indicator = document.querySelector('#portal-sync'); if (indicator) indicator.textContent = '● Updates received · your form is preserved'; }
    } catch { const indicator = document.querySelector('#portal-sync'); if (indicator) indicator.textContent = 'Connection interrupted · reconnecting'; }
  };
  eventStream = new EventSource('/api/events');
  eventStream.addEventListener('change', () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(update, 120); });
  eventStream.addEventListener('ready', () => { document.querySelectorAll('.sync-label').forEach(indicator => { indicator.textContent = '● Connected to live updates'; }); });
  eventStream.addEventListener('error', () => { document.querySelectorAll('.sync-label').forEach(indicator => { indicator.textContent = 'Connection interrupted · reconnecting…'; }); });
  liveTimer = setInterval(update, 20000);
}
function badge(text, kind = '') { return `<span class="badge ${kind}">${esc(text)}</span>`; }
function employee(id) { const e = state.employees.find(e => e.id === id); return `<span class="name">${esc(e?.name || id)}</span><small>${esc(id)}</small>`; }
function table(headers, rows, empty = 'No records yet. Add your first record to get started.') {
  return `<div class="scroll-table"><table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty"><strong>Nothing here yet</strong>${esc(empty)}</td></tr>`}</tbody></table></div>`;
}
function card(title, value, foot, featured = false) { return `<div class="card ${featured ? 'featured' : ''}"><div class="card-label">${title}<span class="tiny-icon">↗</span></div><div class="card-value number">${value}</div><div class="card-foot">${foot}</div></div>`; }
function heading(title, subtitle, actions = '') { return `<div class="page-heading"><div><div class="eyebrow">People operations</div><h1>${title}</h1><p class="sub">${subtitle}</p></div><div class="actions">${actions}</div></div>`; }
function editButton(kind, id) { return canEdit(kind) ? `<button class="small" data-edit="${kind}" data-id="${esc(id)}">Review / edit</button>` : ''; }
function addButton(kind, text = 'Add record') { return canEdit(kind) ? `<button class="primary" data-add="${kind}">＋ ${text}</button>` : ''; }
function searchToolbar(extra = '') { return `<div class="toolbar">${extra}<label class="search">Search records<input type="search" id="search" value="${esc(filter)}" placeholder="Employee name, ID, or keyword…"></label></div>`; }
function filtered(list) { return list.filter(x => JSON.stringify({ ...x, employeeName: state.employees.find(e => e.id === x.employeeId)?.name }).toLowerCase().includes(filter.toLowerCase())); }
const navigationIcons = {"overview":"<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/>","employees":"<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5\"/>","live":"<path d=\"M2 12h4l3-8 6 16 3-8h4\"/>","attendance":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 6v6l4 2\"/>","leave":"<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M8 3v4M16 3v4M3 11h18m-13 5 3 3 5-5\"/>","payroll":"<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M7 15h4M7 18h7\"/>","loans":"<path d=\"M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4\"/>","annual":"<path d=\"M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5\"/>","holidays":"<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M8 3v4M16 3v4M3 11h18M8 15h2M14 15h2M8 18h2\"/>","rules":"<path d=\"M4 6h16M4 12h16M4 18h16\"/><circle cx=\"8\" cy=\"6\" r=\"2\"/><circle cx=\"16\" cy=\"12\" r=\"2\"/><circle cx=\"10\" cy=\"18\" r=\"2\"/>","audit":"<path d=\"M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2\"/>"};
navigationIcons.deductions = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8"/>';
navigationIcons.reports = '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>';
const navItems = [['overview', '◫', 'Overview'], ['employees', '♧', 'Employees'], ['live', '●', 'Live attendance'], ['attendance', '◷', 'Attendance'], ['leave', '▧', 'Leave management'], ['payroll', '▤', 'Payroll'], ['loans', '↔', 'Employee loans'], ['deductions', '−', 'Deductions'], ['annual', '◈', '13th month pay'], ['holidays', '▦', 'Holiday calendar'], ['rules', '⚙', 'Rules & rates'], ['audit', '↺', 'Audit trail'], ['reports', '⇩', 'Reports & downloads']];
function shell(content) {
  if (auth.demo) content = '<div class="notice">Preview workspace · Payroll settings and figures are sample data. Changes here do not update the live HR database.</div>' + content;
  app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img class="brand-logo" src="${brandLogo}" alt="GDS Capital Inc. logo" width="661" height="245"><span>GDS CAPITAL INC.</span></div><div class="nav-label">Workspace</div><nav class="nav" aria-label="HR navigation">${navItems.map(([id, , name], i) => `${i === 7 ? '<div class="nav-label">Administration</div>' : ''}<button data-nav="${id}" class="${page === id ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''}><span class="symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${navigationIcons[id]}</svg></span>${name}</button>`).join('')}</nav><div class="sidebar-bottom"><strong>Every detail, accounted for.</strong>Attendance to take-home pay.<br><button class="small" data-account>Account & access</button></div></aside><main class="main"><header class="topbar"><span>GDS CAPITAL INC. / <strong>${navItems.find(n => n[0] === page)?.[2] || 'Employee profile'}</strong></span><span><span class="optional">${esc(today())} · Asia/Manila &nbsp;&nbsp; </span>${esc(auth.user.username)} ${badge(auth.user.role, 'neutral')}<span class="avatar">${esc(auth.user.username.slice(0, 1).toUpperCase())}</span><button class="small" data-signout>Sign out</button></span></header><div class="content">${content}</div></main></div>`;
}
function overview() {
  const runs = state.runs, last = runs.at(-1), pending = state.leaves.filter(l => l.status === 'pending').length;
  return heading('A clear view of your people.', 'Your leave, attendance, and payroll workspace—all in one place.', '<button class="primary" data-nav="payroll">Open payroll →</button>') +
    `<div class="cards">${card('Employees', state.employees.filter(e => e.active).length, 'Active employee profiles')}${card('Leave requests', pending, 'Awaiting HR review')}${card('Latest net payroll', money(last?.totals.net), last ? `${last.start} — ${last.end}` : 'No payroll posted', true)}${card('Outstanding loans', money(state.loans.reduce((s, l) => s + l.balance, 0)), 'Balances update when payroll posts')}</div>` +
    `<div class="panel"><div class="flow"><span>Employee profile</span><i>→</i><span>Attendance</span><i>→</i><span>Leave & holidays</span><i>→</i><span>Payroll</span><i>→</i><span>13th month ledger</span></div></div><div class="grid2"><section class="panel"><div class="panel-head"><div><h2>Make your first payroll a smooth one</h2><p>A few essentials before you calculate.</p></div>${badge('Getting started', 'neutral')}</div><div class="panel-body"><ol class="steps"><li><div><strong>Add your employees</strong><span>Set salaries, schedules, rest days, and individual benefit coverage.</span></div></li><li><div><strong>Approve your company rules</strong><span>Review rates, contribution brackets, tax tables, and cutoff dates.</span></div></li><li><div><strong>Complete the attendance record</strong><span>Record work, approved leave, holidays, absences, and exceptions.</span></div></li><li><div><strong>Review, then post</strong><span>Inspect every calculation. Posting locks the record and updates loans.</span></div></li></ol></div></section><section class="panel"><div class="panel-head"><h2>Recent payrolls</h2><button class="small" data-nav="payroll">View all</button></div>${table(['Cutoff', 'Net pay', ''], runs.slice(-5).reverse().map(r => [`${esc(r.start)}<br><small>to ${esc(r.end)}</small>`, money(r.totals.net), `<button class="small" data-run="${r.id}">View</button>`]), 'Posted payrolls will appear here.')}<div class="panel-foot">Approved records preserve the rates and sources used.</div></section></div>`;
}
function employeesPage() {
  const people = state.employees.map(e => ({ ...e, profile: state.employeeProfiles?.find(p => p.employeeId === e.id && p.section === 'employment') || {}, attendanceStatus: state.attendance.filter(a => a.employeeId === e.id).map(a => a.status), leaveStatus: state.leaves.filter(l => l.employeeId === e.id).map(l => l.status) }));
  const statuses = ['All Employees', 'Active', 'Probationary', 'Regular', 'On Leave', 'Inactive', 'Resigned'];
  const list = filtered(people).filter(e => employeeStatusFilter === 'All Employees' || [e.profile.employmentStatus, e.profile.employeeStatus || (e.active ? 'Active' : 'Inactive')].includes(employeeStatusFilter));
  return heading('Your people', 'Open an employee to view their complete, connected profile.', addButton('employees', 'Add employee')) + `${state.employees.some(e => e.draft) ? '<div class="notice">Draft profiles are excluded from payroll until salary, joining date, department, schedule, and benefit coverage are completed.</div>' : ''}<section class="panel"><div class="panel-head"><h2>Employee directory</h2>${downloads('employees')}${badge(`${list.length} employees`, 'neutral')}</div>${searchToolbar(`<label class="field">Employee filter<select id="employee-status-filter">${statuses.map(s => `<option ${s === employeeStatusFilter ? 'selected' : ''}>${s}</option>`).join('')}</select></label>`)}${table(['Employee', 'Position', 'Monthly salary', 'Joined', 'Status', ''], list.map(e => [`<button class="employee-link" data-profile="${esc(e.id)}">${employee(e.id)}</button>`, esc(e.profile.position || 'Position required'), e.monthlySalary === null ? 'Not set' : money(e.monthlySalary), e.startDate || 'Not set', badge(e.draft ? 'Draft · needs details' : e.profile.employeeStatus || (e.active ? 'Active' : 'Inactive'), e.draft ? 'pending' : '') + `<small>${esc(e.profile.employmentStatus || '')}</small>`, `<button class="small" data-profile="${esc(e.id)}">Open profile</button>`]))}</section>`;
}
function attendancePage() {
  const views = `<div class="tabs"><button data-attendance-view="records" class="${attendanceView === 'records' ? 'active' : ''}">Daily records · all employees</button><button data-attendance-view="timecard" class="${attendanceView === 'timecard' ? 'active' : ''}">Employee timecard · check against pay</button></div>`;
  const top = heading('Attendance', 'Record actual work and approved exceptions. Night hours are calculated automatically.', (canEdit('attendance') ? '<button data-attendance-import>⇪ Upload from Excel</button>' : '') + addButton('attendance', 'Record attendance')) + views;
  if (attendanceView === 'timecard') return top + timecard.panel(state);
  const list = filtered(state.attendance).sort((a, b) => b.date.localeCompare(a.date));
  return top + `<section class="panel"><div class="panel-head"><h2>Daily records</h2>${downloads('attendance')}<span class="legend">Times use Asia/Manila · unpaid breaks are excluded</span></div>${searchToolbar()}${table(['Employee', 'Date', 'Scheduled', 'Clock in / out', 'Status', 'Offset', 'Approval', ''], list.map(a => [employee(a.employeeId), a.date, a.scheduledIn, a.status === 'present' ? `${a.timeIn} → ${a.timeOut}${a.endNextDay ? ' (+1 day)' : ''}` : '—', badge(a.status, 'neutral'), `${a.offsetMinutes} min${a.exception ? '<br><small>Approved exception</small>' : ''}`, badge(a.approved ? 'Approved' : 'Pending', a.approved ? '' : 'pending'), editButton('attendance', a.id)]))}</section>`;
}
// Proof (e.g. a medical certificate) uploaded by the employee: HR opens it, then confirms or asks for a new one.
const proofBadges = { required: ['Waiting for employee', 'pending'], submitted: ['Ready to review', 'pending'], verified: ['Confirmed', ''], rejected: ['New proof requested', 'rejected'] };
function proofReviewCell(l) {
  if (!l.proofStatus) return l.documentReference ? esc(l.documentReference) : '—';
  const [label, tone] = proofBadges[l.proofStatus] || [l.proofStatus, 'neutral'];
  const uploaded = /^[0-9a-f-]{36}$/.test(l.documentReference || '');
  const view = uploaded && l.proofStatus !== 'required' ? `<a class="small" href="/api/documents/${esc(l.documentReference)}/content" target="_blank" rel="noopener">View proof</a>` : '';
  const review = l.proofStatus === 'submitted' && canEdit('leaves') ? `<span class="proof-actions"><button class="small primary" data-proof-review="${esc(l.id)}" data-decision="verified">Confirm</button><button class="small danger" data-proof-review="${esc(l.id)}" data-decision="rejected">Reject</button></span>` : '';
  const by = l.proofReviewedBy && ['verified', 'rejected'].includes(l.proofStatus) ? `<small>by ${esc(l.proofReviewedBy)}${l.proofNote ? ` · ${esc(l.proofNote)}` : ''}</small>` : '';
  return `${badge(label, tone)} ${view}${by}${review}`;
}
function leavePage() {
  const pending = state.leaves.filter(l => l.status === 'pending').length;
  let content = heading('Time away, taken care of.', 'Manage requests and entitlements with a clear connection to payroll.', addButton('leaves', 'New leave request')) + `<div class="cards">${card('Pending requests', pending, 'Ready for HR review')}${card('Approved requests', state.leaves.filter(l => l.status === 'approved').length, 'Connected to payroll')}${card('Leave types', state.leaveTypes.length, 'Statutory and company benefits')}${card('Paid leave types', state.leaveTypes.filter(t => t.paid).length, 'Eligibility verified per employee', true)}</div><div class="tabs"><button data-tab="requests" class="${subtab === 'requests' ? 'active' : ''}">Leave requests</button><button data-tab="balances" class="${subtab === 'balances' ? 'active' : ''}">Balances</button><button data-tab="types" class="${subtab === 'types' ? 'active' : ''}">Leave policies</button></div>`;
  if (subtab === 'balances') content += `<section class="panel"><div class="panel-head"><h2>Annual balances</h2>${downloads('leave-balances')}<span class="legend">As of ${today()} · Approved requests reserve days</span></div>${searchToolbar()}${table(['Employee', 'Leave type', 'Entitled', 'Carry-over', 'Used / reserved', 'Available'], filtered(balances).filter(b => state.employees.find(e => e.id === b.employeeId)?.leaveEligibility.includes(b.typeId)).map(b => [employee(b.employeeId), esc(state.leaveTypes.find(t => t.id === b.typeId)?.name), b.entitled, b.carry, b.used, badge(`${b.available} days`)]))}</section>`;
  else if (subtab === 'types') content += `<section class="panel"><div class="panel-head"><div><h2>Leave type configuration</h2><p>Statutory classification alone does not establish an employee’s entitlement.</p></div>${addButton('leaveTypes', 'Add leave type')}</div>${table(['Leave type', 'Category', 'Pay', 'Entitlement', 'Accrual', ''], state.leaveTypes.map(t => [esc(t.name), badge(t.category, 'neutral'), t.paid ? 'Paid' : 'Unpaid', `${t.entitledDays} days`, esc(t.accrual), editButton('leaveTypes', t.id)]))}</section>`;
  else {
    const toReview = state.leaves.filter(l => l.proofStatus === 'submitted').length;
    content += `<section class="panel"><div class="panel-head"><h2>Leave requests</h2>${downloads('leaves')}<span class="legend">${toReview ? `${toReview} proof${toReview === 1 ? '' : 's'} waiting for review · ` : ''}Review documents and eligibility before approval</span></div>${searchToolbar()}${table(['Employee', 'Leave type', 'Dates', 'Days', 'Status', 'Proof', ''], filtered(state.leaves).sort((a, b) => b.startDate.localeCompare(a.startDate)).map(l => [employee(l.employeeId), esc(state.leaveTypes.find(t => t.id === l.typeId)?.name), `${l.startDate} → ${l.endDate}`, l.days, badge(l.status, l.status === 'approved' ? '' : l.status), proofReviewCell(l), editButton('leaves', l.id)]))}</section>`;
  }
  return content;
}
function cutoffDefaults() {
  const d = today(), r = state.rules.filter(r => r.approvedBy && r.effectiveDate <= d).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  const monthEnd = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).toISOString().slice(0, 10);
  return { start: `${d.slice(0, 7)}-01`, end: r?.cutoff === 'monthly' ? monthEnd : `${d.slice(0, 7)}-15` };
}
function payrollPage() {
  const run = currentRun, period = run || cutoffDefaults();
  let html = heading('Payroll', 'From hours worked to take-home pay. Every amount has a story.', `${addButton('adjustments', 'Additional pay / deduction')}<button data-copy ${!run ? 'disabled' : ''}>Copy table</button>${run?.id ? `<a class="export-link" href="/api/runs/${run.id}.xlsx" download>Download Excel ↗</a><a class="export-link" href="/api/runs/${run.id}.pdf" download>Download PDF ↗</a>` : ''}`);
  html += `<div class="cards">${card('Gross earnings', money(run?.totals.gross), 'Basic salary + approved earnings')}${card('Total deductions', money(run?.totals.deductions), 'Attendance, contributions & loans')}${card('Net payroll', money(run?.totals.net), run?.status === 'posted' ? 'Approved and posted' : 'Preview before posting', true)}${card('Employees', run?.rows.length || 0, 'In this payroll cutoff')}${card('Employer contributions', money(run?.totals.employer), 'SSS, EC, PhilHealth, Pag-IBIG · paid by GDS, not deducted')}</div><section class="panel"><div class="panel-head"><div><h2>Payroll computation</h2><p>Click a salary to inspect its calculation and source records.</p></div>${badge(run?.status === 'posted' ? 'Posted' : 'Draft preview', run?.status === 'posted' ? '' : 'pending')}</div><form class="toolbar" id="cutoff-form"><label>Cutoff start<input type="date" name="start" value="${period.start}" required></label><label>Cutoff end<input type="date" name="end" value="${period.end}" required></label><label>Employee<select name="employee"><option value="">All employees</option>${state.employees.filter(e => !e.draft).map(e => `<option value="${esc(e.id)}" ${e.id === (run?.employeeIds?.length === 1 ? run.employeeIds[0] : payrollEmployee) ? 'selected' : ''}>${esc(e.name)} (${esc(e.id)})</option>`).join('')}</select></label><label>13th month payout<select name="pay13th"><option value="false">Accrue only</option><option value="true" ${run?.pay13th ? 'selected' : ''}>Pay accrued balance</option></select></label><button class="primary" type="submit">Calculate payroll</button></form>`;
  if (run?.employeeIds?.length) html += `<div class="notice" role="status">Showing payroll for <strong>${run.employeeIds.map(id => esc(state.employees.find(e => e.id === id)?.name || id)).join(', ')}</strong> only. ${run.id ? 'This posting covers only this employee.' : 'Posting will cover only this employee; others can be posted separately for the same cutoff.'} Choose <em>All employees</em> to see everyone.</div>`;
  const headers = ['Employee', 'Monthly salary', 'Working days', 'Days credited', 'Leave / notes', 'Overtime', 'Adjustment', '13th month', 'Special holiday', 'Regular holiday', 'Gross', 'Deductions', 'Net salary', 'Loan balance', 'Loan date', 'Loan terms'];
  const cell = (row, amount, component = '') => `<button class="money-link" data-salary="${esc(row.employeeId)}" data-component="${esc(component)}">${money(amount)}</button>`;
  html += table(headers, (run?.rows || []).map(r => [`<button class="employee-link" data-payroll-employee="${esc(r.employeeId)}" title="Open payroll computation">${employee(r.employeeId)}</button>`, money(r.monthlySalary), r.workingDays, `${r.creditedDays ?? r.daysPresent}${r.lateDaysLost ? `<small>${r.daysPresent} present − ${r.lateDaysLost} late</small>` : ''}`, `<span class="wrap" title="${esc(r.leaveNotes.join('; '))}">${r.leaveDays} days${r.leaveNotes.length ? `<br><small>${esc(r.leaveNotes[0])}</small>` : ''}</span>`, cell(r, r.earnings.regularOT + r.earnings.restOT + r.earnings.specialOT + r.earnings.regularHolidayOT + r.earnings.otherOT), cell(r, r.earnings.additional + r.earnings.allowance), cell(r, r.earnings.thirteenth, 'thirteenth'), cell(r, r.earnings.specialHoliday, 'specialHoliday'), cell(r, r.earnings.regularHoliday, 'regularHoliday'), cell(r, r.gross), cell(r, r.totalDeductions), cell(r, r.net), money(r.loanBalance), r.loanDeductions.map(l => esc(l.startDate)).join('<br>') || '—', r.loanDeductions.map(l => `${l.remainingTerms}/${l.terms}`).join('<br>') || '—']), 'Choose a cutoff and calculate payroll to see the computation.') + `<div class="panel-foot"><span>PHP · Applicable Statutory / Company Payroll Rate</span><span>${run?.rows.length || 0} employees</span></div></section>`;
  if (run?.blockers.length) html += `<div class="notice"><strong>${run.blockers.length} item${run.blockers.length === 1 ? '' : 's'} to resolve before posting</strong><ul>${run.blockers.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
  if (run && !run.id && ['admin', 'payroll'].includes(auth.user.role)) html += `<div class="actions"><button class="primary" data-post ${run.blockers.length ? 'disabled' : ''}>Review & post payroll</button><span class="legend">Posting locks this cutoff and applies scheduled loan deductions.</span></div><br>`;
  html += `<section class="panel"><div class="panel-head"><h2>Posted payroll history</h2>${downloads('payroll-runs')}</div>${table(['Cutoff', 'Gross', 'Deductions', 'Net', 'Posted by', ''], state.runs.slice().reverse().map(r => [`${r.start} → ${r.end}`, money(r.totals.gross), money(r.totals.deductions), money(r.totals.net), esc(r.postedBy), `<button class="small" data-run="${r.id}">Open payroll</button>`]))}</section><section class="panel"><div class="panel-head"><h2>Additional pay & authorized deductions</h2>${downloads('adjustments')}</div>${table(['Employee', 'Date', 'Component', 'Amount', 'Approval', ''], state.adjustments.map(a => [employee(a.employeeId), a.date, esc(label(a.kind)), money(a.amount), badge(a.approved ? 'Approved' : 'Pending', a.approved ? '' : 'pending'), editButton('adjustments', a.id)]))}</section>`;
  return html;
}
function loansPage() { return heading('Employee loans', 'Scheduled deductions, clear balances, and a complete repayment history.', addButton('loans', 'Add loan')) + `<div class="cards">${card('Outstanding balance', money(state.loans.reduce((s, l) => s + l.balance, 0)), 'Across all loan types', true)}${card('Active loans', state.loans.filter(l => l.balance > 0).length, 'With an outstanding balance')}${card('Total original amount', money(state.loans.reduce((s, l) => s + l.original, 0)), 'Recorded loans')}${card('Repaid / opening credits', money(state.loans.reduce((s, l) => s + l.original - l.balance, 0)), 'Original amount less remaining balance')}</div><section class="panel"><div class="panel-head"><h2>Loan register</h2>${downloads('loans')}</div>${searchToolbar()}${table(['Employee', 'Type / reference', 'Original', 'Balance', 'Monthly amortization', 'Per payroll', 'Dates', 'Remaining terms', 'Authorization', ''], filtered(state.loans).map(l => [employee(l.employeeId), `${esc(l.type)}<br><small>${esc(l.reference)}</small>`, money(l.original), money(l.balance), money(l.monthlyAmortization), money(l.perPayroll), `${l.startDate}<br><small>to ${l.endDate}</small>`, `${l.remainingTerms} / ${l.terms}`, badge(l.authorized ? 'Authorized' : 'Pending', l.authorized ? '' : 'pending'), editButton('loans', l.id)]))}</section>`; }
const SCHEDULE_LABEL = Object.fromEntries([['every-cutoff', 'Every payroll cutoff'], ['second-cutoff', 'Once a month, 2nd cutoff (16th-end)'], ['first-cutoff', 'Once a month, 1st cutoff (1st-15th)'], ['once', 'One time only, in the cutoff of the start date']]);
// Company deductions: free-form, set by HR/Admin, applied automatically by payroll on their schedule.
function deductionsPage() {
  const list = filtered(state.deductions || []).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const active = (state.deductions || []).filter(d => d.active);
  return heading('Deductions', 'Company deductions you define: any name, any amount, deducted on the schedule you choose. They print on the payslip under their own name.', addButton('deductions', 'Add deduction')) +
    `<div class="cards">${card('Active deductions', active.length, 'Applied by payroll automatically', true)}${card('Employees with deductions', new Set(active.map(d => d.employeeId)).size, 'At least one active deduction')}${card('Per-cutoff total (every cutoff)', money(active.filter(d => d.schedule === 'every-cutoff').reduce((s, d) => s + d.amount, 0)), 'Recurring each payroll')}${card('Paused', (state.deductions || []).length - active.length, 'Kept but not deducted')}</div>` +
    `<section class="panel"><div class="panel-head"><h2>All deductions</h2>${downloads('deductions')}<span class="legend">SSS, PhilHealth and Pag-IBIG amounts are set per employee under Employee profile → Payroll. Loans with balances stay under Employee loans.</span></div>${searchToolbar()}${table(['Employee', 'Deduction', 'Amount', 'When', 'From', 'Until', 'Status', ''], list.map(d => [employee(d.employeeId), `${esc(d.name)}${d.notes ? `<small>${esc(d.notes)}</small>` : ''}`, money(d.amount), SCHEDULE_LABEL[d.schedule], d.startDate, d.endDate || '—', badge(d.active ? 'Active' : 'Paused', d.active ? '' : 'neutral'), editButton('deductions', d.id)]), 'No company deductions yet. Add one to deduct it automatically in payroll.')}</section>`;
}
function annualPage() {
  const year = annualYear, rows = state.employees.map(e => {
    const runs = state.runs.filter(r => r.start.startsWith(year)), items = runs.flatMap(r => r.rows.filter(row => row.employeeId === e.id));
    const basic = items.reduce((s, r) => s + r.applicableBasic, 0), paid = items.reduce((s, r) => s + r.earnings.thirteenth, 0), accrued = e.covered13th ? Math.round(basic / 12 * 100) / 100 : 0;
    return { e, basic, paid, accrued, items: items.length };
  });
  return heading('A year of work, accounted for.', '13th month pay is tracked from applicable basic salary in posted payrolls.', '<button data-nav="payroll">Open payroll →</button>') + `<div class="cards">${card('Calendar year', year, 'Posted payroll records only')}${card('Applicable basic earned', money(rows.reduce((s, r) => s + r.basic, 0)), 'Premiums excluded by policy')}${card('Accrued 13th month', money(rows.reduce((s, r) => s + r.accrued, 0)), 'Applicable annual basic ÷ 12', true)}${card('Already paid', money(rows.reduce((s, r) => s + r.paid, 0)), 'Deducted from the next payout')}</div><section class="panel"><div class="panel-head"><h2>Annual employee ledger</h2>${downloads('thirteenth')}<span class="legend">Choose “Pay accrued balance” in payroll to include a payout.</span></div>${table(['Employee', 'Posted cutoffs', 'Applicable basic', 'Accrued ÷ 12', 'Paid', 'Remaining', 'Coverage'], rows.map(r => [employee(r.e.id), r.items, money(r.basic), money(r.accrued), money(r.paid), money(Math.max(0, r.accrued - r.paid)), badge(r.e.covered13th ? 'Covered' : 'Excluded', r.e.covered13th ? '' : 'neutral')]))}</section><div class="notice success">This ledger uses the applicable basic salary saved in each posted payroll. Overtime, premiums, night differential, and allowances remain separate. Paid-leave inclusion and holiday base inclusion follow the approved policy.</div>`;
}
function holidaysPage() { return heading('Holiday calendar', 'Date-specific classifications, maintained from official proclamations each year.', addButton('holidays', 'Add holiday')) + `<section class="panel"><div class="panel-head"><h2>Configured dates</h2>${downloads('holidays')}<span class="legend">Rest-day combinations come from each employee’s schedule.</span></div>${searchToolbar()}${table(['Date', 'Holiday', 'Classification', 'Legal / policy basis', ''], filtered(state.holidays).sort((a, b) => a.date.localeCompare(b.date)).map(h => [h.date, esc(h.name), badge(h.kind, 'neutral'), `<span class="wrap">${esc(h.basis)}</span>`, editButton('holidays', h.id)]), 'No dates are assumed. Add the applicable official holidays for each payroll year.')}</section><div class="notice">Special non-working days without work default to no pay. Favorable company policy can provide payment. Regular-holiday pay requires the employee’s coverage and eligibility to be verified in attendance.</div>`; }
function rulesPage() {
  const r = state.rules.filter(r => r.approvedBy).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0] || state.rules[0];
  const rateRows = [['Regular overtime', `1 × ${r.ordinaryOT}`, r.ordinaryOT], ['Rest day', `${r.rest}`, r.rest], ['Rest day overtime', `${r.rest} × ${r.premiumOT}`, r.rest * r.premiumOT], ['Ordinary day + NSD', `1 × (1 + ${r.nsd})`, 1 + r.nsd], ['Rest day + NSD', `${r.rest} × (1 + ${r.nsd})`, r.rest * (1 + r.nsd)], ['Special holiday overtime', `${r.special} × ${r.premiumOT}`, r.special * r.premiumOT], ['Regular holiday overtime', `${r.regular} × ${r.premiumOT}`, r.regular * r.premiumOT], ['Regular holiday + NSD', `${r.regular} × (1 + ${r.nsd})`, r.regular * (1 + r.nsd)], ['Regular holiday + rest day + OT', `${r.regular} × ${r.rest} × ${r.premiumOT}`, r.regular * r.rest * r.premiumOT]];
  return heading('Payroll rules & rates', 'Versioned policies. Transparent formulas. An approval behind every change.', addButton('rules', 'New rules version')) + `<div class="notice ${r.approvedBy ? 'success' : ''}">${r.approvedBy ? `Reference version effective ${esc(r.effectiveDate)}, approved by ${esc(r.approvedBy)}. Payroll selects the version effective on its cutoff start.` : 'The starting rules are an unapproved template. Review employee coverage, contribution and tax tables, and your company policy before approving a version.'}</div><div class="grid2"><section class="panel"><div class="panel-head"><h2>Applicable Statutory / Company Payroll Rate</h2></div>${table(['Work category', 'Underlying formula', 'Combined rate'], rateRows.map(([name, formula, rate]) => [name, formula, badge(`${Math.round(rate * 10000) / 100}%`)]))}<div class="panel-foot">NSD earnings add only the differential; base pay is counted once.</div></section><section class="panel"><div class="panel-head"><h2>Rules history</h2></div>${table(['Effective', 'Approval', ''], state.rules.slice().sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate)).map(v => [v.effectiveDate, v.approvedBy ? esc(v.approvedBy) : badge('Draft', 'pending'), editButton('rules', v.id)]))}<div class="panel-body"><h3>Policy reference</h3><p class="legend">${esc(r.basis)}</p><a class="legend" href="https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf" target="_blank" rel="noreferrer">Read the DOLE/NWPC handbook ↗</a></div></section></div>${contributionsSection(latestRules(), { esc, table, badge })}`;
}
// The newest version by effective date, draft or approved, so pending tables can be reviewed before approval.
const latestRules = () => state.rules.slice().sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
async function signOut() {
  await api('/logout', {}); auth = { user: null }; state = null; currentRun = null;
  if (dialog.open) dialog.close();
  renderLogin();
}
// Excel / PDF download links for one report; the server checks the role again on download.
function downloads(key) {
  return `<span class="download-links" aria-label="Download"><a class="small download-link" href="/api/reports/${key}.xlsx" download>Excel</a><a class="small download-link" href="/api/reports/${key}.pdf" download>PDF</a></span>`;
}
async function reportsPage() {
  const reports = await api('/reports');
  const runs = state.runs.filter(r => r.status === 'posted').sort((a, b) => b.start.localeCompare(a.start));
  shell(heading('Reports & downloads', 'Download any list as an Excel workbook or a printable PDF. Files contain only what your role may see.') +
    `<section class="panel"><div class="panel-head"><h2>All reports</h2><span class="legend">${reports.length} reports available to your role</span></div><ul class="report-list">${reports.map(r => `<li><span>${esc(r.title)}</span>${downloads(r.key)}</li>`).join('')}</ul></section>` +
    `<section class="panel"><div class="panel-head"><h2>Payroll registers</h2><span class="legend">One file per posted cutoff</span></div>${table(['Cutoff', 'Employees', 'Net', ''], runs.map(r => [`${r.start} → ${r.end}`, r.rows.length, money(r.totals.net), `<span class="download-links"><a class="small download-link" href="/api/runs/${r.id}.xlsx" download>Excel</a><a class="small download-link" href="/api/runs/${r.id}.pdf" download>PDF</a></span>`]))}</section>`);
}
async function auditPage() {
  const entries = await api('/audit');
  shell(heading('Audit trail', 'Who changed what, when, and why. Payroll snapshots preserve their original records.') + `<section class="panel"><div class="panel-head"><h2>Recent activity</h2>${downloads('audit')}<span class="legend">Latest 1,000 events</span></div>${table(['Time', 'Actor', 'Action', 'Record', ''], entries.map((e, i) => [esc(new Date(e.at).toLocaleString()), esc(e.actor), badge(e.action, 'neutral'), `${esc(e.kind)}<br><small>${esc(e.recordId)}</small>`, `<button class="small" data-audit-index="${i}">Inspect change</button>`]))}</section>`);
  document.querySelectorAll('[data-audit-index]').forEach(b => b.onclick = () => showObject('Audit event', entries[Number(b.dataset.auditIndex)]));
}
function render() {
  if (!auth?.user) { renderLogin(); return; }
  offerInstall();
  startLive();
  if (auth.user.role === 'employee') { portal.draw(employeeData, auth); return; }
  if (page === 'live') { shell(heading('Live attendance', 'Employee clock events and HR reviews synchronize automatically.') + (liveData ? portal.live(liveData) : '<div class="notice">This view is restricted to HR and administrators.</div>')); return; }
  if (page === 'profile') { profiles.redraw().catch(e => toast(e.message)); return; }
  const views = { overview, employees: employeesPage, attendance: attendancePage, leave: leavePage, payroll: payrollPage, loans: loansPage, deductions: deductionsPage, annual: annualPage, holidays: holidaysPage, rules: rulesPage };
  if (page === 'audit') { auditPage().catch(e => toast(e.message)); return; }
  if (page === 'reports') { reportsPage().catch(e => toast(e.message)); return; }
  shell(views[page]());
  if (page === 'attendance' && attendanceView === 'timecard') {
    timecard.bind((employeeId, date) => edit('attendance', null, newAttendanceFor(employeeId, date)), async (employeeId, start, end) => {
      payrollEmployee = employeeId; currentRun = await api('/payroll/preview', { start, end, pay13th: false, employeeIds: [employeeId] }); page = 'payroll'; render();
    }, applyLateOffset);
    timecard.fill();
  }
  if (page === 'overview') {
    if (liveData) { const live = document.createElement('div'); live.innerHTML = portal.live(liveData); document.querySelector('.content').append(live); }
    const section = document.createElement('section'); section.className = 'panel';
    section.innerHTML = '<div class="panel-head"><h2>Upcoming work anniversaries</h2><span class="legend">Next 60 days</span></div>' + table(['Employee', 'Anniversary', ''], (state.anniversaries || []).map(e => [employee(e.employeeId), e.nextAnniversary, `<button class="small" data-profile="${esc(e.employeeId)}">Open profile</button>`]), 'No upcoming anniversaries. Add confirmed joining dates to employee records.');
    document.querySelector('.content').append(section);
  }
  if (page === 'annual') {
    const years = [...new Set([today().slice(0, 4), ...state.runs.map(r => r.start.slice(0, 4))])].sort().reverse();
    const picker = document.createElement('label'); picker.className = 'field'; picker.textContent = 'Calendar year';
    const select = document.createElement('select'); select.setAttribute('aria-label', 'Calendar year');
    years.forEach(y => { const option = new Option(y, y, false, y === annualYear); select.add(option); });
    select.onchange = () => { annualYear = select.value; render(); }; picker.append(select);
    document.querySelector('.page-heading .actions').prepend(picker);
  }
}
function openDialog(title, body, footer = '') { dialog.innerHTML = `<div class="dialog-head"><h2>${esc(title)}</h2><button class="small" data-close aria-label="Close dialog">✕</button></div>${body}${footer}`; if (!dialog.open) dialog.showModal(); }
function showObject(title, value) {
  const renderValue = v => typeof v === 'object' && v !== null ? `<dl class="details-grid">${Object.entries(v).map(([k, x]) => `<div><dt>${esc(names[k] || label(k))}</dt><dd>${renderValue(x)}</dd></div>`).join('')}</dl>` : esc(String(v ?? '—'));
  openDialog(title, `<div class="dialog-body">${renderValue(value)}</div>`);
}
// Manual adjustments for the cutoff plus the payslip, on the employee's computation screen.
function computationTools(r) {
  const run = currentRun, list = state.adjustments.filter(a => a.employeeId === r.employeeId && a.date >= run.start && a.date <= run.end);
  const kinds = { additional: 'Additional pay', allowance: 'Allowance', otherDeduction: 'Deduction' };
  const editable = !run.id && canEdit('adjustments');
  const slip = run.id
    ? `<a class="button primary" href="/api/runs/${esc(run.id)}/payslips/${esc(r.employeeId)}.pdf" target="_blank" rel="noopener">Open posted payslip (PDF)</a>`
    : `<button class="primary" data-payslip-preview="${esc(r.employeeId)}">Preview payslip (PDF)</button><span class="legend">Draft built from this computation. Changes below appear in the next preview.</span>`;
  return `<section class="computation-tools"><div class="computation-slip">${slip}</div>
    <h3>Manual adjustments this cutoff</h3>
    ${table(['Date', 'Type', 'Amount', 'Reason', 'Approved', ''], list.map(a => [a.date, kinds[a.kind] || esc(a.kind), `${a.kind === 'otherDeduction' ? '−' : '+'}${money(a.amount)}`, esc(a.reason), a.approved ? 'Yes' : badge('Needs approval', 'pending'), editable ? editButton('adjustments', a.id) : '']), 'No manual adjustments in this cutoff.')}
    <h3>Company deductions</h3>
    ${table(['Deduction', 'Amount', 'When', 'Status', ''], (state.deductions || []).filter(d => d.employeeId === r.employeeId).map(d => [esc(d.name), money(d.amount), SCHEDULE_LABEL[d.schedule], badge(d.active ? 'Active' : 'Paused', d.active ? '' : 'neutral'), !run.id ? editButton('deductions', d.id) : '']), 'No company deductions for this employee.')}
    ${!run.id && canEdit('deductions') ? `<button class="small" data-computation-deduction="${esc(r.employeeId)}">＋ Add company deduction</button>` : ''}
    <p class="computation-contrib">${['admin', 'hr', 'payroll'].includes(auth.user.role) ? `<button class="small" data-computation-contrib="${esc(r.employeeId)}">Review SSS / PhilHealth / Pag-IBIG basis</button>` : ''}${r.contributionChangeId ? ' <span class="legend">An approved contribution adjustment applies to this cutoff.</span>' : ''}</p>
    ${editable ? `<button class="small" data-computation-add="${esc(r.employeeId)}">＋ Add adjustment</button>` : run.id ? '<p class="legend">Posted payroll is locked; record corrections as an adjustment in an open cutoff.</p>' : ''}
  </section>`;
}
// Recompute the reviewed employee's payroll after an adjustment changes, then reopen their computation.
async function reopenComputation() {
  const c = computationContext; if (!c) return false;
  currentRun = await api('/payroll/preview', { start: c.start, end: c.end, pay13th: c.pay13th, ...(c.employeeIds ? { employeeIds: c.employeeIds } : {}) });
  page = 'payroll'; render(); await showSalary(c.employeeId); return true;
}
async function previewPayslip(employeeId) {
  const c = computationContext, tab = window.open('', '_blank');
  try {
    const response = await fetch('/api/payroll/payslip-preview', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrf }, body: JSON.stringify({ start: c.start, end: c.end, pay13th: c.pay13th, employeeIds: [employeeId] }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Payslip preview failed.');
    const url = URL.createObjectURL(await response.blob());
    if (tab) tab.location = url; else window.location.assign(url);
  } catch (error) { tab?.close(); toast(error.message); }
}
// e.g. " · ₱200.00 monthly, full amount this cutoff" so cutoff figures are never mistaken for the monthly rate.
function contributionNote(key, value, r) {
  if (!['SSS', 'SSS EC', 'PhilHealth', 'Pag-IBIG'].includes(key) || r.contributionFactor === undefined) return '';
  if (r.contributionFactor === 0) return ' · deducted on the other cutoff';
  if (r.contributionFactor === 1) return ' · full monthly amount';
  return ` · ${money(value / r.contributionFactor)} monthly × ${r.contributionFactor}`;
}
async function showSalary(id, component = '') {
  if (!currentRun) return;
  if (!currentRun.id) computationContext = { employeeId: id, start: currentRun.start, end: currentRun.end, pay13th: currentRun.pay13th, employeeIds: currentRun.employeeIds };
  const r = currentRun.rows.find(r => r.employeeId === id);
  const parts = Object.entries(r.earnings).map(([key, value]) => [names[key] || label(key), value, 'earnings']).concat(Object.entries(r.deductions).map(([key, value]) => [(names[key] || label(key)) + contributionNote(key, value, r), value, 'deductions'])).concat(Object.entries(r.employer || {}).map(([key, value]) => [key + contributionNote(key, value, r), value, 'employer · not deducted']));
  const traces = component ? r.trace.filter(t => t.component === component) : r.trace;
  const sourceRows = table(['Date', 'Work classification', 'Hours', 'Day × OT × night', 'Combined rate'], (r.workBreakdown || []).map(w => [w.date, `${esc(w.classification)}${w.overtime ? ' · OT' : ''}${w.night ? ' · NSD' : ''}`, w.hours, `${w.dayMultiplier} × ${w.otMultiplier} × ${w.nightMultiplier}`, `${Math.round(w.combinedMultiplier * 10000) / 100}%`])) + '<p class="legend">Combined rates describe total applicable hourly pay. Earnings add only amounts beyond the salary already credited, plus the night differential.</p><h3>Source calculations</h3>' + table(['Date', 'Component', 'Calculation', 'Amount', 'Source'], traces.map((t, i) => [t.date, esc(names[t.component] || label(t.component)) + (t.side === 'employer' ? ' <small>employer · not deducted</small>' : ''), `<span class="formula">${esc(t.formula)}</span>`, money(t.amount), `<button class="small" data-source-index="${i}">View record</button>`]));
  openDialog(`${r.employeeId} · ${r.employeeName}`, `<div class="dialog-body"><p class="sub">${currentRun.start} — ${currentRun.end} · Rules version ${esc(currentRun.ruleId)} · ${currentRun.id ? 'Posted' : 'Draft preview, not yet posted'}</p>${computationTools(r)}<br><div class="cards">${card('Gross earnings', money(r.gross), `${r.daysPresent} days present`)}${card('Deductions', money(r.totalDeductions), `${r.leaveDays} leave days`)}${card('Net salary', money(r.net), 'Earnings less deductions', true)}${card('13th month accrued', money(r.thirteenthAccrued), 'Running annual entitlement')}${card('Employer contributions', money(r.employerTotal ?? 0), 'Paid by GDS · not deducted')}</div><h3>Earnings & deductions</h3>${table(['Component', 'Amount', 'Type'], parts.filter(([, amount]) => amount !== 0).map(([name, amount, side]) => [esc(name), money(amount), badge(side, 'neutral')]))}<br><h3>${component ? esc(names[component] || label(component)) : 'Calculation'} audit</h3>${sourceRows}<br><h3>Lateness and offsets</h3><p class="legend">Late time covered by an approved offset or exception does not reduce pay. The rest lowers the days credited (${r.creditedDays ?? r.daysPresent} of ${r.daysPresent} days present); it is not a separate deduction.</p>${table(['Date', 'Scheduled', 'Actual', 'Late', 'Approved offset', 'Exception', 'Not offset', 'Days lost', 'Basic reduced by'], r.late.filter(l => l.lateMinutes > 0).map(l => [l.date, l.scheduledTime, l.actualTime, `${l.lateMinutes} min`, `${l.approvedOffset} min`, l.validExplanation ? esc(l.explanation) : 'No', `${l.deductibleMinutes} min`, l.dayFraction ?? '—', money(l.deduction)]), 'No late occurrences in this cutoff.')}</div>`);
  dialog.querySelectorAll('[data-source-index]').forEach(b => b.onclick = async () => {
    const t = traces[Number(b.dataset.sourceIndex)];
    let sources = state;
    if (currentRun.id) sources = (await api(`/runs/${currentRun.id}`)).sources;
    const source = sources[t.sourceKind]?.find(x => x.id === t.sourceId);
    showObject('Underlying record', source || t);
  });
}

const field = (key, title, type = 'text', options = null, hint = '') => ({ key, title, type, options, hint });
const section = title => ({ section: title });
function definitions(kind) {
  const employeeOptions = state.employees.filter(e => !e.draft).map(e => [e.id, `${e.id} · ${e.name}`]);
  const leaveOptions = state.leaveTypes.map(t => [t.id, t.name]);
  const commonEmployee = field('employeeId', 'Employee', 'select', employeeOptions);
  const approved = field('approved', 'Approved', 'checkbox');
  const fields = {
    employees: [field('id', 'Employee ID', 'text', null, 'A unique, permanent identifier included in payroll and exports.'), field('name', 'Employee name'), field('department', 'Department'), field('monthlySalary', 'Monthly salary (PHP)', 'number'), field('startDate', 'Employment start', 'date'), field('endDate', 'Employment end (optional)', 'optional-date'), field('scheduleStart', 'Normal scheduled start', 'time'), field('restDays', 'Rest days', 'numbers', [[0, 'Sunday'], [1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'], [5, 'Friday'], [6, 'Saturday']]), field('active', 'Active employee profile', 'checkbox', null, 'Use an employment end date to stop payroll after separation.'), section('Coverage & leave eligibility'), field('coveredOT', 'Covered by overtime policy', 'checkbox'), field('coveredNSD', 'Covered by night differential', 'checkbox'), field('coveredHoliday', 'Covered by regular holiday pay', 'checkbox'), field('covered13th', 'Covered by 13th month pay', 'checkbox'), field('leaveEligibility', 'Eligible leave types (HR verified)', 'multi', leaveOptions, 'Select only entitlements whose eligibility requirements have been verified. Hold Ctrl / Command to select multiple.')],
    attendance: [commonEmployee, field('date', 'Attendance date', 'date'), field('status', 'Day status', 'select', ['present', 'absent', 'off', 'official-business', 'rest-day-swap']), field('scheduledIn', 'Approved scheduled start', 'time'), field('timeIn', 'Actual time in (for present)', 'optional-time'), field('timeOut', 'Actual time out (for present)', 'optional-time'), field('endNextDay', 'Time out is on the following day', 'checkbox'), field('breaks', 'Unpaid breaks', 'breaks', null, 'Enter each break with its full local date and time. Breaks are excluded from work and night hours.'), section('Exceptions & approval'), field('offsetMinutes', 'Approved offset minutes', 'number'), field('exception', 'Approved explanation / attendance exception', 'checkbox', null, 'Exempts lateness and undertime deductions, such as authorized official business.'), field('explanation', 'Explanation / approval basis', 'optional-textarea'), field('holidayEligible', 'Regular holiday pay eligibility verified', 'checkbox'), approved],
    leaves: [commonEmployee, field('typeId', 'Leave type', 'select', leaveOptions), field('startDate', 'First day', 'date'), field('endDate', 'Last day', 'date'), field('days', 'Scheduled leave days', 'number', null, 'Full scheduled workdays only. Rest days do not consume leave.'), field('status', 'Request status', 'select', ['pending', 'approved', 'rejected']), field('reason', 'Reason / notes', 'textarea'), field('documentReference', 'Supporting document reference', 'optional-textarea', null, 'Reference a document in your controlled HR document store. Do not paste public document links.'), field('eligibilityVerified', 'Eligibility verified by HR', 'checkbox')],
    leaveTypes: [field('name', 'Leave type name'), field('category', 'Benefit classification', 'select', ['statutory', 'company']), field('paid', 'Paid leave', 'checkbox'), field('entitledDays', 'Days entitled per year', 'number'), field('minServiceMonths', 'Minimum service (months)', 'number'), field('eligibility', 'Eligibility requirements', 'textarea'), field('accrual', 'Accrual method', 'select', ['annual', 'monthly', 'none']), field('carryOverDays', 'Maximum carry-over days', 'number'), field('expirationMonths', 'Carry-over expires after month', 'number', null, '1 = January, 12 = December. Current-year entitlement expires at year end.'), field('balanceRequired', 'Require sufficient accrued balance', 'checkbox'), field('documentsRequired', 'Supporting documents required', 'checkbox'), field('approvalRequired', 'Approval required', 'checkbox'), field('affectsPayroll', 'Affects payroll', 'checkbox'), field('includedIn13th', 'Paid leave included in 13th-month basic', 'checkbox')],
    holidays: [field('date', 'Holiday date', 'date'), field('name', 'Holiday name'), field('kind', 'Classification', 'select', [['ordinary', 'Ordinary / special working day'], ['special', 'Special non-working holiday'], ['regular', 'Regular holiday'], ['double', 'Double regular holiday'], ['other', 'Other configured holiday']]), field('basis', 'Proclamation / legal or policy basis', 'textarea')],
    loans: [commonEmployee, field('type', 'Loan type', 'select', ['SSS Loan', 'Pag-IBIG Loan', 'Salary Loan', 'Other Company Loan']), field('reference', 'Loan reference'), field('original', 'Original amount (PHP)', 'number'), field('balance', 'Opening outstanding balance (PHP)', 'number'), field('monthlyAmortization', 'Monthly amortization (PHP)', 'number'), field('perPayroll', 'Deduction per payroll (PHP)', 'number'), field('startDate', 'First deduction date', 'date'), field('endDate', 'Last deduction date', 'date'), field('terms', 'Total payroll deduction terms', 'number'), field('remainingTerms', 'Remaining payroll deduction terms', 'number'), field('authorized', 'Employee deduction authorization verified', 'checkbox')],
    adjustments: [commonEmployee, field('date', 'Effective date', 'date'), field('kind', 'Component', 'select', [['additional', 'Other additional pay'], ['allowance', 'Allowance'], ['otherDeduction', 'Other authorized deduction']]), field('amount', 'Amount (PHP)', 'number'), field('reason', 'Reason / authorization basis', 'textarea'), approved, field('includedIn13th', 'Earnings form part of applicable basic salary', 'checkbox', null, 'Use only if this payment is integrated into basic salary under approved policy.')],
    deductions: [commonEmployee, field('name', 'Deduction name', 'text', null, 'Any name the company uses, e.g. Cash advance, Uniform, Company loan, Damages, Canteen. It prints on the payslip as written.'), field('amount', 'Amount per deduction (PHP)', 'number'), field('schedule', 'When to deduct', 'select', [['every-cutoff', 'Every payroll cutoff'], ['second-cutoff', 'Once a month, 2nd cutoff (16th-end)'], ['first-cutoff', 'Once a month, 1st cutoff (1st-15th)'], ['once', 'One time only, in the cutoff of the start date']]), field('startDate', 'Start date', 'date'), field('endDate', 'Stop after (optional)', 'optional-date', null, 'Leave blank to keep deducting until you switch it off or remove it.'), field('active', 'Active', 'checkbox', null, 'Untick to pause without deleting.'), field('notes', 'Notes (optional)', 'optional-textarea')],
    rules: [field('effectiveDate', 'Effective date', 'date'), field('approvedBy', 'Approval', 'select', [['', 'Save as draft'], ['approve', 'Approve as current administrator']]), field('basis', 'Legal / policy basis', 'textarea'), section('Wage multipliers'), ...[['ordinaryOT', 'Ordinary overtime'], ['rest', 'Rest day'], ['premiumOT', 'Rest / holiday overtime factor'], ['special', 'Special non-working holiday'], ['specialRest', 'Special holiday + rest day'], ['regular', 'Regular holiday'], ['double', 'Double holiday'], ['other', 'Other holiday'], ['nsd', 'Night differential (0.10 = 10%)']].map(([k, n]) => field(k, n, 'number')), section('Unworked holiday pay'), ...[['specialUnworked', 'Special holiday (0 = no pay, 1 = full day)'], ['regularUnworked', 'Eligible regular holiday'], ['doubleUnworked', 'Eligible double holiday'], ['otherUnworked', 'Other holiday']].map(([k, n]) => field(k, n, 'number')), section('Working time & payroll cutoff'), ...[['normalHours', 'Normal work hours per shift'], ['dailyDivisor', 'Monthly salary → daily divisor'], ['hourlyDivisor', 'Daily rate → hourly divisor'], ['workdaysPerMonth', 'Reference workdays per month'], ['graceMinutes', 'Late grace period (minutes)']].map(([k, n]) => field(k, n, 'number')), field('cutoff', 'Payroll cutoff', 'select', [['semi-monthly', 'Semi-monthly: 1–15 / 16–last day'], ['monthly', 'Monthly: 1–last day']]), field('contributionTiming', 'Government contribution deduction timing', 'select', [['split', 'Split across both cutoffs (half each)'], ['second', 'Full monthly amount on the 16th to end-of-month cutoff'], ['first', 'Full monthly amount on the 1st to 15th cutoff']]), field('deductLate', 'Deduct uncovered late time', 'checkbox'), field('deductUndertime', 'Deduct uncovered undertime', 'checkbox'), field('includeHolidayBaseIn13th', 'Include holiday salary credit in 13th-month basic', 'checkbox'), section('Contribution & withholding tables'), field('contributions.SSS', 'SSS monthly contribution brackets: employee and employer shares (employer share and EC are not deducted from pay)', 'brackets'), field('contributions.PhilHealth', 'PhilHealth monthly contribution brackets: employee and employer shares', 'brackets'), field('contributions.Pag-IBIG', 'Pag-IBIG monthly contribution brackets: employee and employer shares', 'brackets'), field('taxBrackets', 'Withholding brackets for this payroll cutoff', 'brackets', null, 'Tax basis: gross minus attendance deductions, employee contributions, and 13th-month payout. Review any taxable benefit excess as an authorized deduction.'), field('contributionsReviewed', 'Contribution and tax tables reviewed for this effective date', 'checkbox')],
  };
  fields.employees.unshift(field('draft', 'Draft profile — exclude from payroll', 'checkbox', null, 'Keep checked until employment and payroll details are verified.'));
  fields.leaveTypes.push(field('dayBasis', 'Leave entitlement day basis', 'select', [['working', 'Scheduled working days'], ['calendar', 'All calendar days']]));
  const leaveDaysField = fields.leaves.find(f => f.key === 'days');
  leaveDaysField.title = 'Leave days (policy basis)';
  leaveDaysField.hint = 'Count full working or calendar days according to the selected leave policy. Cross-year requests allocate days to each annual balance.';
  fields.rules.push(section('Calendar review & benefit taxation'), field('calendarReviewedYears', 'Holiday calendar years reviewed', 'yearlist', null, 'Comma-separated years, for example 2026, 2027. Add the applicable proclamations in the holiday calendar before confirming a year.'), field('thirteenthTaxExemption', 'Annual tax exemption allocated to 13th-month pay (PHP)', 'number', null, 'Configure the approved exemption after accounting for other benefits using the same exemption. Taxable excess is included automatically.'));
  return fields[kind];
}
// HR/Admin approve an offset for late time: covered minutes no longer reduce credited days or pay.
async function applyLateOffset(recordId, unoffsetMinutes) {
  const record = state.attendance.find(a => a.id === recordId); if (!record) return;
  const minutes = window.prompt(`Approve an offset for ${record.date}. Minutes to offset (late time not yet covered: ${unoffsetMinutes} min):`, String(unoffsetMinutes));
  if (minutes === null) return;
  const add = Number(minutes);
  if (!Number.isInteger(add) || add <= 0 || add > unoffsetMinutes) { toast(`Enter whole minutes from 1 to ${unoffsetMinutes}.`); return; }
  const reason = window.prompt('Reason for the offset (kept in the audit trail and sent to the employee):', 'Approved offset: ');
  if (!reason || reason.trim().length < 3) { toast('An offset needs a reason.'); return; }
  try {
    // An offset must carry an explanation on the record; the approval reason serves when none exists yet.
    await api('/records/attendance', { ...record, offsetMinutes: record.offsetMinutes + add, explanation: record.explanation?.trim() ? record.explanation : reason.trim(), correctionReason: reason.trim() });
    await refresh(); render(); toast(`${add} min offset approved for ${record.date}.`);
  } catch (error) { toast(error.message); }
}
// A new attendance record for a missing day, prefilled with the employee's schedule and a 1-hour lunch.
function newAttendanceFor(employeeId, date) {
  const e = state.employees.find(x => x.id === employeeId), start = e?.scheduleStart || '09:00';
  const [h, m] = start.split(':').map(Number), end = `${String(Math.min(23, h + 9)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return { employeeId, date, scheduledIn: start, timeIn: start, timeOut: end, breaks: [{ start: `${date}T12:00`, end: `${date}T13:00` }], approved: false, explanation: '' };
}
function defaults(kind) {
  const d = today(), id = uid(), employeeId = state.employees[0]?.id || '';
  const base = {
    employees: { id: `EMP-${String(state.employees.length + 1).padStart(3, '0')}`, name: '', department: '', monthlySalary: 0, startDate: d, endDate: '', restDays: [0, 6], scheduleStart: '08:00', active: true, coveredOT: false, coveredNSD: false, coveredHoliday: false, covered13th: false, leaveEligibility: [] },
    attendance: { id, employeeId, date: d, status: 'present', scheduledIn: state.employees[0]?.scheduleStart || '08:00', timeIn: '08:00', timeOut: '17:00', endNextDay: false, breaks: [{ start: `${d}T12:00`, end: `${d}T13:00` }], offsetMinutes: 0, exception: false, explanation: '', approved: false, holidayEligible: false },
    leaves: { id, employeeId, typeId: state.leaveTypes[0]?.id || '', startDate: d, endDate: d, days: 1, reason: '', documentReference: '', status: 'pending', eligibilityVerified: false },
    leaveTypes: { id, name: '', paid: false, category: 'company', entitledDays: 0, minServiceMonths: 0, eligibility: '', accrual: 'annual', carryOverDays: 0, expirationMonths: 12, documentsRequired: false, approvalRequired: true, affectsPayroll: true, includedIn13th: false, balanceRequired: true },
    holidays: { id, date: d, name: '', kind: 'regular', basis: '' },
    loans: { id, employeeId, type: 'Salary Loan', reference: '', original: 0, balance: 0, monthlyAmortization: 0, perPayroll: 0, startDate: d, endDate: d, terms: 1, remainingTerms: 1, authorized: false },
    adjustments: { id, employeeId, date: d, kind: 'additional', amount: 0, reason: '', approved: false, includedIn13th: false },
    deductions: { id, employeeId, name: '', amount: 0, schedule: 'every-cutoff', startDate: d, endDate: '', active: true, notes: '' },
    rules: { ...structuredClone(state.rules.at(-1)), id, effectiveDate: d, approvedBy: '', updatedAt: '' },
  };
  base.leaveTypes.dayBasis = 'working';
  Object.assign(base.employees, { draft: true, monthlySalary: null, startDate: '', scheduleStart: '', restDays: [], active: false });
  return base[kind];
}
function valueAt(object, key) { return key.split('.').reduce((o, k) => o?.[k], object); }
function assignAt(object, key, value) { const parts = key.split('.'); let ref = object; for (const k of parts.slice(0, -1)) ref = ref[k]; ref[parts.at(-1)] = value; }
// Contribution brackets add employer columns (employer fixed, employer rate, SSS EC); tax brackets keep the five employee columns.
const BRACKET_PARTS = ['from', 'to', 'fixed', 'rate', 'excessOver'], EMPLOYER_PARTS = ['employerFixed', 'employerRate', 'ec'];
function bracketRow(b = { from: 0, to: null, fixed: 0, rate: 0, excessOver: 0, employerFixed: 0, employerRate: 0, ec: 0 }, employer = false) {
  if (typeof employer !== 'boolean') employer = false; // also used directly as a map() callback
  return `<tr>${[...BRACKET_PARTS, ...(employer ? EMPLOYER_PARTS : [])].map(k => `<td><input aria-label="${label(k)}" data-part="${k}" type="number" min="0" step="any" value="${b[k] ?? ''}" ${k === 'to' ? 'placeholder="No ceiling"' : 'required'}></td>`).join('')}<td><button class="small" type="button" data-remove-row aria-label="Remove bracket">×</button></td></tr>`;
}
function breakRow(b = { start: `${today()}T12:00`, end: `${today()}T13:00` }) { return `<tr><td><input aria-label="Break start" data-part="start" type="datetime-local" value="${esc(b.start)}" required></td><td><input aria-label="Break end" data-part="end" type="datetime-local" value="${esc(b.end)}" required></td><td><button class="small" type="button" data-remove-row aria-label="Remove break">×</button></td></tr>`; }
function formField(f, values, existing) {
  if (f.section) return `<h3 class="form-section">${f.section}</h3>`;
  const value = valueAt(values, f.key), id = `f-${f.key}`, type = f.type;
  if (type === 'brackets' || type === 'breaks') {
    return `<div class="field full"><span>${f.title}</span><div class="scroll-table"><table class="brackets" data-collection="${f.key}" data-type="${type}" ${f.key.startsWith('contributions.') ? 'data-employer="1"' : ''}><thead><tr>${(type === 'brackets' ? [...['From (inclusive)', 'To (exclusive)'], ...(f.key.startsWith('contributions.') ? ['Employee fixed PHP', 'Employee rate (0–1)', 'Excess over', 'Employer fixed PHP', 'Employer rate (0–1)', 'SSS EC PHP (employer)'] : ['Fixed PHP', 'Rate (0–1)', 'Excess over']), ''] : ['Start', 'End', '']).map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${(value || []).map(row => type === 'brackets' ? bracketRow(row, f.key.startsWith('contributions.')) : breakRow(row)).join('')}</tbody></table></div><div class="bracket-controls"><button type="button" class="small" data-add-row="${id}">＋ Add ${type === 'brackets' ? 'bracket' : 'break'}</button></div><small>${f.hint || 'Amount = fixed + rate × max(0, basis − excess over). Leave the final ceiling blank. Contributions use monthly salary and are apportioned across cutoffs.'}</small></div>`;
  }
  if (type === 'checkbox') return `<label class="field check"><input id="${id}" name="${f.key}" type="checkbox" ${value ? 'checked' : ''}>${f.title}${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
  let control;
  if (['select', 'multi', 'numbers'].includes(type)) {
    const multiple = type !== 'select';
    control = `<select name="${f.key}" id="${id}" ${multiple ? 'multiple' : f.key === 'approvedBy' ? '' : 'required'}>${(f.options || []).map(option => {
      const [v, n] = Array.isArray(option) ? option : [option, label(option)];
      const selected = multiple ? (value || []).includes(v) : value === v || (f.key === 'approvedBy' && value && v === 'approve');
      return `<option value="${esc(v)}" ${selected ? 'selected' : ''}>${esc(n)}</option>`;
    }).join('')}</select>`;
  } else if (type === 'yearlist') control = `<input name="${f.key}" id="${id}" type="text" value="${esc((value || []).join(', '))}" placeholder="2026, 2027">`;
  else if (type.includes('textarea')) control = `<textarea name="${f.key}" id="${id}" ${type.startsWith('optional') ? '' : 'required'}>${esc(value)}</textarea>`;
  else control = `<input name="${f.key}" id="${id}" type="${type.replace('optional-', '')}" value="${esc(value)}" ${type === 'number' ? 'min="0" step="any"' : ''} ${type.startsWith('optional') ? '' : 'required'} ${existing && f.key === 'id' ? 'readonly' : ''}>`;
  return `<label class="field ${type.includes('textarea') || type === 'multi' ? 'full' : ''}" for="${id}">${f.title}${control}${f.hint ? `<small>${f.hint}</small>` : ''}</label>`;
}
function edit(kind, id, preset = {}) {
  const existing = state[kind].find(x => x.id === id), values = structuredClone(existing || { ...defaults(kind), ...preset });
  const fields = definitions(kind), locked = kind === 'rules' && existing?.approvedBy;
  if (kind === 'attendance' && existing) fields.push(field('correctionReason', 'Correction / approval reason', 'textarea', null, 'Required. Original attendance, your changes, reason and approver remain in the audit history.'));
  openDialog(`${existing ? 'Review' : 'New'} ${kind === 'leaveTypes' ? 'leave policy' : kind === 'rules' ? 'payroll rules version' : label(kind).replace(/s$/, '')}`, `<form id="record-form"><div class="dialog-body"><div id="form-error" class="form-error hidden" role="alert"></div>${locked ? '<div class="notice">Approved rules cannot be edited. Close this dialog and create a new rules version.</div>' : ''}<div class="form-grid">${fields.map(f => formField(f, values, !!existing)).join('')}</div></div><div class="dialog-foot">${existing && ['leaves', 'holidays', 'adjustments', 'deductions'].includes(kind) ? '<button type="button" class="danger" id="delete-record">Delete record</button>' : ''}<button type="button" data-close>Cancel</button><button type="submit" class="primary" ${locked ? 'disabled' : ''}>Save ${kind === 'rules' ? 'version' : 'record'}</button></div></form>`);
  const form = dialog.querySelector('form');
  if (kind === 'leaves' && /^[a-f0-9-]{36}$/.test(existing?.documentReference || '')) {
    const attachment = document.createElement('a'); attachment.href = `/api/documents/${existing.documentReference}/content`; attachment.textContent = 'Download supporting document'; attachment.className = 'button'; form.querySelector('.dialog-body').prepend(attachment);
  }
  if (kind === 'employees') {
    const updateDraft = () => {
      const draft = form.elements.draft.checked;
      for (const key of ['department', 'monthlySalary', 'startDate', 'scheduleStart']) form.elements[key].required = !draft;
      form.elements.active.disabled = draft;
      if (draft) form.elements.active.checked = false;
    };
    form.elements.draft.onchange = updateDraft;
    updateDraft();
  }
  form.querySelectorAll('[data-add-row]').forEach(b => b.onclick = () => {
    const t = b.closest('.field').querySelector('table'); t.querySelector('tbody').insertAdjacentHTML('beforeend', t.dataset.type === 'brackets' ? bracketRow(undefined, t.dataset.employer === '1') : breakRow());
  });
  form.addEventListener('click', event => { if (event.target.closest('[data-remove-row]')) event.target.closest('tr').remove(); });
  if (kind === 'attendance') {
    const d = form.elements.date;
    if (existing?.id.startsWith('clock-')) { form.elements.employeeId.disabled = true; d.readOnly = true; }
    let oldDate = d.value;
    d.onchange = () => { form.querySelectorAll('input[type=datetime-local]').forEach(i => { if (i.value.startsWith(oldDate)) i.value = d.value + i.value.slice(10); }); oldDate = d.value; };
    form.elements.employeeId.onchange = () => { form.elements.scheduledIn.value = state.employees.find(e => e.id === form.elements.employeeId.value)?.scheduleStart || '08:00'; };
    form.elements.status.onchange = () => {
      const present = form.elements.status.value === 'present';
      if (!present) { form.elements.timeIn.value = ''; form.elements.timeOut.value = ''; form.querySelector('[data-collection="breaks"] tbody').innerHTML = ''; }
    };
  }
  const reportError = error => { const node = dialog.querySelector('#form-error'); node.textContent = error.message; node.classList.remove('hidden'); node.scrollIntoView({ block: 'center' }); };
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button[type=submit]'); button.disabled = true;
    try {
      for (const f of fields.filter(f => f.key)) {
        const input = form.elements.namedItem(f.key); let value;
        if (['brackets', 'breaks'].includes(f.type)) {
          const collection = [...form.querySelectorAll('[data-collection]')].find(t => t.dataset.collection === f.key);
          value = [...collection.querySelectorAll('tbody tr')].map(row => Object.fromEntries([...row.querySelectorAll('[data-part]')].map(i => [i.dataset.part, f.type === 'brackets' ? (i.value === '' && i.dataset.part === 'to' ? null : Number(i.value)) : i.value])));
        } else if (f.type === 'yearlist') value = input.value.split(',').map(v => v.trim()).filter(Boolean).map(Number);
        else if (f.type === 'checkbox') value = input.checked;
        else if (['multi', 'numbers'].includes(f.type)) value = [...input.selectedOptions].map(o => f.type === 'numbers' ? Number(o.value) : o.value);
        else value = f.type === 'number' ? (kind === 'employees' && f.key === 'monthlySalary' && input.value === '' ? null : Number(input.value)) : input.value;
        assignAt(values, f.key, value);
      }
      await api(`/records/${kind}`, values); await refresh(); dialog.close();
      if (['adjustments', 'deductions'].includes(kind) && computationContext && await reopenComputation()) { toast(`${kind === 'deductions' ? 'Deduction' : 'Adjustment'} saved. Payroll recalculated.`); return; }
      currentRun = null; render(); toast('Record saved.');
    } catch (error) { reportError(error); button.disabled = false; }
  };
  const deleteButton = form.querySelector('#delete-record');
  if (deleteButton) deleteButton.onclick = async () => {
    if (deleteButton.dataset.confirm !== 'yes') { deleteButton.dataset.confirm = 'yes'; deleteButton.textContent = 'Confirm deletion'; return; }
    deleteButton.disabled = true;
    try { await api(`/records/${kind}?id=${encodeURIComponent(id)}`, null, 'DELETE'); await refresh(); if (['adjustments', 'deductions'].includes(kind) && computationContext) { dialog.close(); await reopenComputation(); toast(`${kind === 'deductions' ? 'Deduction' : 'Adjustment'} removed. Payroll recalculated.`); return; } currentRun = null; dialog.close(); render(); toast('Record removed; audit history retained.'); } catch (e) { reportError(e); deleteButton.disabled = false; }
  };
}
function renderLogin() {
  stopLive(); portal.reset(); document.querySelector('.install-banner')?.remove();
  app.innerHTML = `<div class="login welcome-login"><header class="welcome-head"><div class="brand"><img class="brand-logo" src="${brandLogo}" alt="GDS Capital Inc. logo" width="661" height="245"><span>GDS CAPITAL INC.</span></div><div class="eyebrow">Strength in stewardship</div><h1>Welcome to Our Human Resource Management System</h1><p>Your attendance, leave, payslips and HR requests, in one trusted place.</p></header><section class="login-form"><form id="login-form"><div class="auth-brand">GDS CAPITAL INC. / HR WORKSPACE</div><h2>${auth?.setup ? 'Set up your workspace' : 'Welcome back.'}</h2><p>${auth?.setup ? 'Create your administrator account using the one-time setup code shown in your server terminal.' : 'Sign in to your HR workspace or employee portal.'}</p><div id="login-error" class="form-error hidden" role="alert"></div>${auth?.setup ? '<label>One-time setup code<input name="token" type="password" autocomplete="off" required></label>' : ''}<label>Employee ID / username<input name="username" autocomplete="username" required minlength="3" maxlength="80"></label><label>Password<input name="password" type="password" autocomplete="${auth?.setup ? 'new-password' : 'current-password'}" required ${auth?.setup ? 'minlength="12"' : ''} maxlength="200"></label><label>Authenticator code (if enabled)<input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label><button class="primary" type="submit">${auth?.setup ? 'Create administrator account' : 'Sign in'} →</button><button type="button" data-recovery>Forgot password?</button><p class="footnote">${auth?.setup ? 'Use a unique password of at least 12 characters.' : 'Access is managed by your HR administrator.'}<br>Employee records are stored in your HR service.</p></form></section><section class="welcome-body" aria-label="Our culture">${welcomeScene()}${welcomeCulture()}</section></div>`;
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    try {
      if (auth?.setup) await api('/setup', data);
      auth = await api('/login', { username: data.username, password: data.password, otp: data.otp || '' }); await refresh(); render();
    } catch (e) { const error = document.querySelector('#login-error'); error.textContent = e.message; error.classList.remove('hidden'); button.disabled = false; }
  };
  const resetLink = /^#reset=([a-f0-9]{64})$/.exec(location.hash);
  if (resetLink) { history.replaceState(null, '', location.pathname); portal.recovery(resetLink[1]); }
}
async function account() {
  const users = auth.user.role === 'admin' ? await api('/users') : [];
  openDialog('Account & access', `<div class="dialog-body"><p class="sub">Signed in as ${esc(auth.user.username)} · ${esc(auth.user.role)}</p><br><button data-logout>Sign out</button><br><br><h3>Change your password</h3><form id="password-form" class="form-grid"><label class="field">Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label><label class="field">New password<input type="password" name="newPassword" autocomplete="new-password" minlength="12" maxlength="200" required></label><button class="primary" type="submit">Update password & sign out</button></form>${auth.user.role === 'admin' ? `<br><br><h3>Workspace access</h3>${table(['Username', 'Role'], users.map(u => [esc(u.username), badge(u.role, 'neutral')]))}<br><form id="user-form" class="form-grid"><label class="field">Username<input name="username" minlength="3" required autocomplete="off"></label><label class="field">Role<select name="role"><option value="employee">Employee — own records only</option><option value="hr">HR — people, attendance & leave</option><option value="payroll">Payroll — loans & posting</option><option value="viewer">Viewer — read-only reports</option><option value="admin">Admin — all settings</option></select></label><label class="field">Employee ID (Employee role only)<select name="employeeId"><option value="">Choose employee</option>${state.employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(e.id)}</option>`).join('')}</select></label><label class="field">Initial password<input type="password" name="password" minlength="12" maxlength="200" autocomplete="new-password" required></label><button class="primary" type="submit">Add user</button></form>` : ''}<p class="legend">${auth.user.role === 'employee' ? 'Your account can access only your own employee portal, attendance, leave and payslips.' : 'Staff report access follows your role. Employee accounts can access only their own records. Personal details, IDs, bank details and documents have additional restrictions.'}</p></div>`);
  dialog.querySelector('[data-logout]').onclick = signOut;
  dialog.querySelector('#password-form').onsubmit = async event => { event.preventDefault(); try { await api('/password', Object.fromEntries(new FormData(event.target))); dialog.close(); auth = { user: null }; renderLogin(); toast('Password updated. Please sign in again.'); } catch (e) { toast(e.message); } };
  const userForm = dialog.querySelector('#user-form');
  if (userForm) userForm.onsubmit = async event => { event.preventDefault(); try { const values = Object.fromEntries(new FormData(userForm)); if (values.role !== 'employee') delete values.employeeId; await api('/users', values); await account(); toast('User created.'); } catch (e) { toast(e.message); } };
  await portal.accountTools(auth.user, users);
}
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
    if (b.hasAttribute('data-recovery')) { portal.recovery(); return; }
    await portal.click(b, employeeData, liveData);
    if (b.hasAttribute('data-close')) { dialog.close(); return; }
    if (b.dataset.nav) { page = b.dataset.nav; filter = ''; render(); }
    if (b.dataset.profile) { page = 'profile'; await profiles.open(b.dataset.profile, 'personal'); }
    if (b.dataset.tab) { subtab = b.dataset.tab; filter = ''; render(); }
    if (b.hasAttribute('data-attendance-import')) { attendanceImport.open(); return; }
    if (b.dataset.attendanceView) { attendanceView = b.dataset.attendanceView; render(); }
    if (b.dataset.add) edit(b.dataset.add);
    if (b.dataset.edit) edit(b.dataset.edit, b.dataset.id);
    if (b.dataset.run) { currentRun = await api(`/runs/${b.dataset.run}`); page = 'payroll'; render(); }
    if (b.dataset.salary) await showSalary(b.dataset.salary, b.dataset.component);
    if (b.dataset.payrollEmployee) await showSalary(b.dataset.payrollEmployee);
    if (b.dataset.payslipPreview) await previewPayslip(b.dataset.payslipPreview);
    if (b.dataset.computationContrib) { const id = b.dataset.computationContrib; await contributionEditor.open(id, { onChanged: computationContext ? () => reopenComputation() : () => showSalary(id) }); return; }
    if (b.dataset.computationDeduction) { edit('deductions', null, { employeeId: b.dataset.computationDeduction, startDate: currentRun.start }); return; }
    if (b.dataset.computationAdd) edit('adjustments', null, { employeeId: b.dataset.computationAdd, date: currentRun.end, approved: true });
    if (b.hasAttribute('data-account')) await account();
    if (b.hasAttribute('data-signout')) await signOut();
    if (b.dataset.proofReview) {
      const decision = b.dataset.decision;
      const note = decision === 'rejected' ? window.prompt('Why is this proof not accepted? The employee will see this message.') : '';
      if (note === null) return;
      await api(`/leaves/${b.dataset.proofReview}/proof-review`, { decision, note: note || '' });
      await refresh(); render(); toast(decision === 'verified' ? 'Proof confirmed. You can now approve the leave.' : 'The employee was asked for a new proof.');
    }
    if (b.hasAttribute('data-copy') && currentRun) {
      const rows = [['Employee ID', 'Employee Name', 'Monthly Salary', 'Working Days', 'Days Present', 'Days Credited', 'Late Minutes Not Offset', 'Leave Days / Notes', 'Overtime', 'Adjustment', '13th Month Pay', 'Special Holiday', 'Regular Holiday', 'Gross', 'Deductions', 'Net Salary', 'Loan Balance', 'Loan Date', 'Loan Terms'], ...currentRun.rows.map(r => [r.employeeId, r.employeeName, r.monthlySalary, r.workingDays, r.daysPresent, r.creditedDays ?? r.daysPresent, r.lateMinutesUnoffset ?? 0, `${r.leaveDays}: ${r.leaveNotes.join('; ')}`, r.earnings.regularOT + r.earnings.restOT + r.earnings.specialOT + r.earnings.regularHolidayOT + r.earnings.otherOT, r.earnings.additional + r.earnings.allowance, r.earnings.thirteenth, r.earnings.specialHoliday, r.earnings.regularHoliday, r.gross, r.totalDeductions, r.net, r.loanBalance, r.loanDeductions.map(l => l.startDate).join('; '), r.loanDeductions.map(l => `${l.remainingTerms}/${l.terms}`).join('; ')])];
      // Prefix formula-like strings when copying into spreadsheet applications.
      const safe = v => typeof v === 'string' ? (/^[=+@\-\t\r]/.test(v) ? `'${v}` : v).replace(/[\t\r\n]/g, ' ') : v;
      await navigator.clipboard.writeText(rows.map(row => row.map(safe).join('\t')).join('\n')); toast('Payroll summary copied with employee IDs.');
    }
    if (b.hasAttribute('data-post')) {
      const run = currentRun;
      openDialog('Review payroll posting', `<div class="dialog-body"><p>Post payroll for <strong>${run.start} — ${run.end}</strong>?</p><p>${run.rows.length} employees · Net payroll <strong>${money(run.totals.net)}</strong></p><p class="sub">This saves the calculation and its sources, locks the cutoff, and applies authorized loan deductions. Corrections after posting must use an approved adjustment in a later cutoff.</p></div>`, '<div class="dialog-foot"><button data-close>Continue reviewing</button><button class="primary" id="confirm-post">Post payroll</button></div>');
      dialog.querySelector('#confirm-post').onclick = async event => {
        event.target.disabled = true;
        try { currentRun = await api('/payroll/post', { start: run.start, end: run.end, pay13th: run.pay13th, fingerprint: run.fingerprint, ...(run.employeeIds ? { employeeIds: run.employeeIds } : {}) }); await refresh(); dialog.close(); render(); toast('Payroll posted. Loan balances updated.'); }
        catch (e) { toast(e.message); event.target.disabled = false; }
      };
    }
  } catch (e) { toast(e.message); }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'cutoff-form') return;
  event.preventDefault(); const form = event.target, button = form.querySelector('button'); button.disabled = true;
  payrollEmployee = form.elements.employee.value; computationContext = null;
  try { currentRun = await api('/payroll/preview', { start: form.elements.start.value, end: form.elements.end.value, pay13th: form.elements.pay13th.value === 'true', ...(payrollEmployee ? { employeeIds: [payrollEmployee] } : {}) }); render(); }
  catch (e) { toast(e.message); button.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  const position = event.target.selectionStart; filter = event.target.value; render(); const node = document.querySelector('#search'); node.focus(); node.setSelectionRange(position, position);
});
try { auth = await api('/session'); if (auth.user) await refresh(); render(); }
catch (e) { app.innerHTML = `<div class="loading"><h1>Unable to connect</h1><p>${esc(e.message)}</p><p>Check that the HR service is running, then reload this page.</p></div>`; }
document.addEventListener('input', event => {
  if (!event.target.matches('[data-contribution-salary]')) return;
  const panel = event.target.closest('[data-contribution-rule]'), rule = state.rules.find(r => r.id === panel.dataset.contributionRule);
  panel.querySelector('[data-contribution-result]').innerHTML = event.target.value === '' ? '' : renderCalculation(rule, Number(event.target.value), { table });
});
document.addEventListener('change', event => { if (event.target.id === 'employee-status-filter') { employeeStatusFilter = event.target.value; render(); } });
setupInstall();
