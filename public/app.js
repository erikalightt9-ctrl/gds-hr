const brandLogo = '/gds-logo.png'; // 菲龍集團 GDS Capital logo (white background)
import { createProfileView } from './profiles.js';
import { createPortal } from './portal.js';
import { contributionsSection, renderCalculation } from './contributions.js';
import { setupInstall, offerInstall } from './install.js';
import { welcomeScene, welcomeCulture } from './welcome.js';
import { createTimecard } from './timecard.js';
import { createAttendanceImport } from './attendance-import.js';
import { createContributionEditor } from './contribution-basis.js';
import { createFiles } from './hr-files.js';
import { createDashboard } from './hr-dashboard.js';
import { createMemos } from './hr-memos.js';
import { createTrainings } from './hr-trainings.js';
import { createAdmin } from './hr-admin.js';
import { createPortalHr } from './portal-hr.js';
import { createBreakdown } from './payroll-breakdown.js';
import { createLoansPage } from './loans-ui.js';
import { createThirteenthPage } from './thirteenth-ui.js';
const app = document.querySelector('#app'), dialog = document.querySelector('#dialog');
// Salary day of a cutoff: 1st-15th → the 22nd; 16th-end → the 8th of the next month (same rule as src/paydays.mjs).
const payDateFor = (start, end) => { const y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)); if (start.slice(8, 10) === '01' && Number(end.slice(8, 10)) <= 15) return `${start.slice(0, 7)}-22`; return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-08`; };
// Names are capitalized word by word as soon as a name box is left (the server applies the same rule on save).
const NAME_INPUT = /^(personal\.(firstName|middleName|lastName|suffix|preferredName)|emergency\.name|spouseName|fatherName|motherName|childName.*)$/;
const titleCase = value => value.trim().split(/\s+/).filter(Boolean).map(w => (/^(i{1,3}|iv|v|vi{0,3}|ix|x)\.?$/i.test(w) ? w.toUpperCase() : w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, s, c) => s + c.toUpperCase()))).join(' ');
document.addEventListener('focusout', event => {
  const input = event.target;
  if (input instanceof HTMLInputElement && NAME_INPUT.test(input.name) && input.value.trim()) { const v = titleCase(input.value); if (v !== input.value) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); } }
});
const money = n => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 }).format(n || 0);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const label = key => key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
const uid = () => crypto.randomUUID();
let auth, state, balances = [], page = 'dashboard', hrContext = null, currentRun = null, filter = '', subtab = 'requests';
let employeeStatusFilter = 'All Employees';
let attendanceView = 'records'; // 'records' (all employees) or 'timecard' (one employee beside pay)
let payrollEmployee = '';
let computationContext = null; // the payroll computation being reviewed, reopened after an adjustment is saved // '' = all employees; otherwise the one Employee ID being calculated
let employeeData = null, liveData = null, eventStream = null, liveTimer = null, liveUser = null, refreshTimer = null;
const portal = createPortal({ api, esc, money, table, toast, openDialog, dialog, refresh, render, app, today, brandLogo, portalHr: createPortalHr({ api, esc, table: (h, r, empty = 'Nothing to show yet.') => table(h, r, empty), toast, confirm: (title, message) => openDialog(title, `<div class="dialog-body confirm-box"><p class="confirm-icon" aria-hidden="true">✅</p><p>${message}</p></div>`, '<div class="dialog-foot"><button class="primary" data-close>OK</button></div>') }), onSecurityReset: () => { auth = { user: null }; dialog.close(); renderLogin(); }, reloadAccount: account });
const contributionEditor = createContributionEditor({ api, esc, money, table, badge, toast, openDialog, dialog });
const attendanceImport = createAttendanceImport({ api, esc, table, badge, toast, openDialog, dialog, refresh, render: () => render(), getState: () => state });
const timecard = createTimecard({ api, esc, money, badge, table, getState: () => state, canEdit: kind => canEdit(kind), editButton, cutoffDefaults }); // canEdit is defined below; look it up when used
const profiles = createProfileView({ api, esc, money, table, shell, heading, toast, refresh, today, openContributions: id => contributionEditor.open(id), isActive: () => page === 'profile', canEditMaster: () => canEdit('employees'), editMaster: id => edit('employees', id), openTimecard: id => { timecard.setEmployee(id); attendanceView = 'timecard'; page = 'attendance'; render(); }, openPayroll: async id => { payrollEmployee = id; const p = cutoffDefaults(); currentRun = await api('/payroll/preview', { start: p.start, end: p.end, pay13th: false, employeeIds: [id] }); page = 'payroll'; render(); }, openDirectory: () => { page = 'employees'; render(); }, openRun: async id => { currentRun = await api(`/runs/${id}`); page = 'payroll'; render(); } });
const names = { basic: 'Basic salary', regularOT: 'Regular OT', restDay: 'Rest day pay', restOT: 'Rest day OT', nsd: 'Night shift differential', specialHoliday: 'Special holiday pay', specialOT: 'Special holiday OT', regularHoliday: 'Regular / double holiday pay', regularHolidayOT: 'Regular / double holiday OT', otherHoliday: 'Other holiday pay', otherOT: 'Other holiday OT', thirteenth: '13th month paid', absence: 'Unpaid leave / absence', loans: 'Loan deductions', sssLoan: 'SSS loan', pagibigLoan: 'Pag-IBIG loan', salaryDeduction: 'Salary deduction', tax: 'Withholding tax', other: 'Other authorized deductions' };
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
  const user = auth?.user; if (!user || user.mustChangePassword) return;   // nothing loads until a default password is replaced
  if (user.role === 'employee') { api('/branding').then(b => applyTheme(b.theme)).catch(() => {}); const data = await api('/me/dashboard'); if (auth?.user?.id === user.id) employeeData = data; return; }
  hrContext = await api('/hr/context'); applyTheme(hrContext.company.theme);
  if (!LEGACY.includes(user.role)) { state = { employees: [], runs: [], leaves: [], loans: [], attendance: [], rules: [], leaveTypes: [], holidays: [], adjustments: [], deductions: [] }; return; }
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
function heading(title, subtitle, actions = '') { const parent = auth?.user && groupOf(page); return `<div class="page-heading"><div><div class="eyebrow">${parent ? `<nav aria-label="Breadcrumb" class="breadcrumb">${esc(parent.label)} › <span aria-current="page">${esc(navGroups().flatMap(g => g[1]).find(n => n[0] === page)?.[1] || '')}</span></nav>` : 'People operations'}</div><h1>${title}</h1><p class="sub">${subtitle}</p></div><div class="actions">${actions}</div></div>`; }
function editButton(kind, id) { return canEdit(kind) ? `<button class="small" data-edit="${kind}" data-id="${esc(id)}">Review / edit</button>` : ''; }
function addButton(kind, text = 'Add record') { return canEdit(kind) ? `<button class="primary" data-add="${kind}">＋ ${text}</button>` : ''; }
function searchToolbar(extra = '') { return `<div class="toolbar">${extra}<label class="search">Search records<input type="search" id="search" value="${esc(filter)}" placeholder="Employee name, ID, or keyword…"></label></div>`; }
function filtered(list) { return list.filter(x => JSON.stringify({ ...x, employeeName: state.employees.find(e => e.id === x.employeeId)?.name }).toLowerCase().includes(filter.toLowerCase())); }
const navigationIcons = {"overview":"<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"1\"/>","employees":"<circle cx=\"9\" cy=\"8\" r=\"3\"/><path d=\"M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5\"/>","live":"<path d=\"M2 12h4l3-8 6 16 3-8h4\"/>","attendance":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 6v6l4 2\"/>","leave":"<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M8 3v4M16 3v4M3 11h18m-13 5 3 3 5-5\"/>","payroll":"<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M3 10h18M7 15h4M7 18h7\"/>","loans":"<path d=\"M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4\"/>","annual":"<path d=\"M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5\"/>","holidays":"<rect x=\"3\" y=\"5\" width=\"18\" height=\"16\" rx=\"2\"/><path d=\"M8 3v4M16 3v4M3 11h18M8 15h2M14 15h2M8 18h2\"/>","rules":"<path d=\"M4 6h16M4 12h16M4 18h16\"/><circle cx=\"8\" cy=\"6\" r=\"2\"/><circle cx=\"16\" cy=\"12\" r=\"2\"/><circle cx=\"10\" cy=\"18\" r=\"2\"/>","audit":"<path d=\"M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2\"/>"};
navigationIcons.deductions = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 12h8"/>';
navigationIcons.reports = '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v3h16v-3"/>';
const LEGACY = ['admin', 'hr', 'payroll', 'viewer'], HR_TEAM = ['admin', 'hr', 'hr_staff', 'maker'];
Object.assign(navigationIcons, {
  dashboard: navigationIcons.overview,
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  datasheets: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  memos: '<path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
  trainings: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
});
// Sidebar sections. A section with `group` is one expandable parent menu; its pages keep their own screens and routes.
const PAY_GROUP = { id: 'payroll-attendance', label: 'Payroll & Attendance', icon: 'payroll' };
function navGroups() {
  const role = auth.user.role, legacy = LEGACY.includes(role);
  const payItems = legacy ? [...(['admin', 'hr'].includes(role) ? [['live', 'Live Attendance']] : []), ['attendance', 'Attendance'], ['leave', 'Leave Management'], ['payroll', 'Payroll'], ['loans', 'Employee Loans'], ['deductions', 'Deductions'], ['annual', '13th Month Pay'], ['holidays', 'Holiday Calendar'], ['rules', 'Rules & Rates']] : [];
  return [
    ['', [['dashboard', 'Dashboard']]],
    ['HR Management', [['files', 'Employee 201 Files'], ...(HR_TEAM.includes(role) ? [['datasheets', 'Data Sheet Submissions']] : []), ['memos', 'Memos'], ['trainings', 'Trainings']]],
    ...(payItems.length ? [['', payItems, PAY_GROUP]] : []),   // hidden entirely when the role may open none of them
    ['Administration', [['reports', 'Reports'], ...(legacy || role === 'maker' ? [['audit', 'Audit trail']] : []), ...(role === 'admin' ? [['settings', 'Settings']] : [])]],
  ];
}
const groupOf = id => navGroups().find(g => g[2] && g[1].some(([key]) => key === id))?.[2] || null;
let payGroupOpen = (() => { try { return localStorage.getItem('hr-nav-pay') === 'open'; } catch { return false; } })();
let mobileDrawer = false;
let sidebarCollapsed = (() => { try { return localStorage.getItem('hr-sidebar') === 'collapsed'; } catch { return false; } })();
function applyTheme(theme) { document.documentElement.dataset.theme = theme === 'forest' ? 'forest' : 'gds'; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'forest' ? '#0f3a26' : '#161616'); }
function shell(content) {
  if (auth.demo) content = '<div class="notice">Preview workspace · Payroll settings and figures are sample data. Changes here do not update the live HR database.</div>' + content;
  const groups = navGroups(), parent = groupOf(page);
  if (parent) payGroupOpen = true;   // a module opened by link, refresh or back/forward shows its menu
  const company = hrContext?.company || { name: 'GDS CAPITAL INC.', systemTitle: 'HR 201 File & Employee Management System' };
  const icon = id => `<span class="symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${navigationIcons[id] || ''}</svg></span>`;
  app.innerHTML = `<div class="shell ${sidebarCollapsed ? 'collapsed' : ''} ${mobileDrawer ? 'drawer-open' : ''}"><div class="drawer-backdrop" data-close-drawer aria-hidden="true"></div><aside class="sidebar" id="main-menu" aria-label="Main menu"><div class="brand"><img class="brand-logo" src="${brandLogo}" alt="${esc(company.name)} logo" width="661" height="245"><span>${esc(company.name)}</span></div>
    <nav class="nav" aria-label="HR navigation">${groups.map(([label, items, group]) => {
      const item = ([id, name], sub = false) => `<button data-nav="${id}" class="${sub ? 'nav-child ' : ''}${page === id || (id === 'files' && page === 'employee201') ? 'active' : ''}" ${page === id ? 'aria-current="page"' : ''} title="${esc(name)}">${icon(id)}<span class="nav-text">${esc(name)}</span></button>`;
      if (!group) return `${label ? `<div class="nav-label">${esc(label)}</div>` : ''}${items.map(i => item(i)).join('')}`;
      const childActive = items.some(([id]) => id === page);
      return `<div class="nav-group ${payGroupOpen ? 'open' : ''}"><button class="nav-parent ${childActive ? 'has-active' : ''}" data-nav-group="${group.id}" aria-expanded="${payGroupOpen}" aria-controls="nav-${group.id}" title="${esc(group.label)}">${icon(group.icon)}<span class="nav-text">${esc(group.label)}</span><span class="nav-chevron" aria-hidden="true"></span></button><div class="nav-sub" id="nav-${group.id}" role="group" aria-label="${esc(group.label)}"><div class="nav-sub-inner">${items.map(i => item(i, true)).join('')}</div></div></div>`;
    }).join('')}</nav>
    <div class="sidebar-bottom"><button class="small" data-account>Account &amp; access</button><button class="signout-button sidebar-signout" data-signout>Sign out</button></div></aside>
    <main class="main"><header class="topbar"><span class="topbar-title"><button class="small icon-button" data-toggle-sidebar aria-controls="main-menu" aria-label="${sidebarCollapsed ? 'Expand' : 'Collapse'} menu" aria-expanded="${!sidebarCollapsed}">☰</button><button class="small icon-button drawer-toggle" data-open-drawer aria-controls="main-menu" aria-label="Open menu" aria-expanded="${mobileDrawer}">☰</button><span><strong>${esc(company.systemTitle)}</strong></span></span>
      <span class="topbar-user"><span class="optional">${esc(today())} · Asia/Manila</span><span class="bell-wrap"><button class="small icon-button" data-bell aria-label="Notifications" aria-haspopup="true">🔔<span class="bell-count hidden" data-bell-count></span></button><div class="bell-menu hidden" data-bell-menu role="menu"></div></span>
      <span class="topbar-divider" aria-hidden="true"></span><span class="user-meta"><strong>${esc(auth.user.username)}</strong><small>${esc(hrContext?.roleLabel || auth.user.role)}</small></span></span></header>
    <div class="content">${content}</div></main></div>`;
  loadBell();
  syncRoute();
}
let bellItems = [];
const bellKey = () => `gds-hr-bell-seen:${auth?.user?.id || ''}`;
function bellSeen() { try { return JSON.parse(localStorage.getItem(bellKey()) || '[]'); } catch { return []; } }
function markBellSeen() { try { localStorage.setItem(bellKey(), JSON.stringify(bellItems.map(item => item.text))); } catch { /* storage unavailable: the number stays */ } document.querySelector('[data-bell-count]')?.classList.add('hidden'); }
async function loadBell() {
  if (!hrContext) return;
  try {
    const n = await api('/hr/notifications'); bellItems = n.items;
    const badgeNode = document.querySelector('[data-bell-count]'); if (!badgeNode) return;
    // The number counts items not yet seen: opening the bell clears it until something new arrives.
    const seen = bellSeen(), unread = bellItems.filter(item => !seen.includes(item.text)).length;
    badgeNode.textContent = unread; badgeNode.classList.toggle('hidden', !unread);
  } catch { /* the bell is optional; pages still work */ }
}
const hrCtx = {
  api, esc, money, table, badge, toast, openDialog, dialog, heading, today,
  shell: html => shell(html),
  context: () => hrContext, legacy: () => LEGACY.includes(auth.user.role),
  legacyGlance: () => ({ leave: state.leaves.filter(l => l.status === 'pending').length, net: state.runs.at(-1)?.totals?.net || 0, loans: state.loans.reduce((s, l) => s + l.balance, 0) }),
  setPage: p => { page = p; }, refresh: () => refresh(), daysAgo: n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10),
  go: nav => goTo(nav), quick: kind => (kind === 'employee' ? files.addEmployee() : kind === 'memo' ? memos.create() : trainings.create()),
  openLegacyProfile: async id => { page = 'profile'; await profiles.open(id, 'personal'); },
  editPay: id => edit('employees', id),
  reloadContext: async () => { hrContext = await api('/hr/context'); applyTheme(hrContext.company.theme); },
  openAccounts: () => account(),
};
// New interface versions reach every account: the tab notices, then refreshes at the next safe moment
// (page change) or when the user chooses, never while a dialog or unsaved form is open.
let loadedVersion = null, updateReady = false;
async function checkVersion() {
  try {
    const { version } = await fetch('/api/version', { cache: 'no-store' }).then(r => r.json());
    if (!loadedVersion) { loadedVersion = version; return; }
    if (version !== loadedVersion && !updateReady) {
      updateReady = true;
      const bar = document.createElement('div'); bar.className = 'update-bar'; bar.setAttribute('role', 'status');
      bar.innerHTML = '<span>A new version of the HR system is ready. It loads when you change page.</span><button class="small primary" data-update-now>Update now</button>';
      document.body.append(bar);
    }
  } catch { /* offline: try again later */ }
}
function safeToReload() { return !dialog.open && !portal.isEditing() && !document.activeElement?.matches('input,textarea,select'); }
checkVersion(); setInterval(checkVersion, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
let routing = false;
function routeFor() { return page === 'employee201' && files.currentId() ? `#/employee201/${encodeURIComponent(files.currentId())}` : `#/${page}`; }
function syncRoute() {
  if (routing || !auth?.user || auth.user.role === 'employee') return;
  const target = routeFor();
  if (location.hash !== target) history[location.hash.startsWith('#/') ? 'pushState' : 'replaceState'](null, '', target);
}
function readRoute() {
  const m = /^#\/([a-z0-9-]+)(?:\/(.+))?$/.exec(location.hash);
  return m ? { page: m[1], id: m[2] ? decodeURIComponent(m[2]) : null } : null;
}
async function applyRoute() {
  const route = readRoute(); if (!route || !auth?.user || auth.user.role === 'employee') return;
  routing = true;
  try {
    dialog.open && dialog.close(); mobileDrawer = false;
    if (route.page === 'employee201' && route.id) await files.openProfile(route.id);
    else { page = route.page === 'profile' ? 'files' : route.page; render(); }
  } finally { routing = false; }
}
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.querySelector('.shell.drawer-open')) { mobileDrawer = false; document.querySelector('.shell').classList.remove('drawer-open'); document.querySelector('[data-open-drawer]')?.focus(); } });
document.addEventListener('click', event => { if (event.target.closest('[data-close-drawer]')) { mobileDrawer = false; document.querySelector('.shell')?.classList.remove('drawer-open'); } });
window.addEventListener('popstate', () => { applyRoute().catch(e => toast(e.message)); });
// Focused amount breakdowns in the payroll table. Edits are offered only on draft payroll and only for roles
// that may already make that change; posted payroll stays read-only.
const breakdown = createBreakdown({ esc, money, table, openDialog, dialog, actions: {
  can: key => !currentRun?.id && ({ manual: canEdit('adjustments'), adjustment: canEdit('adjustments'), deductions: canEdit('deductions'), contribution: ['admin', 'hr'].includes(auth.user.role), loans: canEdit('loans'), tax: canEdit('adjustments') })[key],
  edit: (key, row) => {
    if (key === 'manual') { computationContext = { employeeId: row.employeeId, start: currentRun.start, end: currentRun.end, pay13th: currentRun.pay13th, employeeIds: currentRun.employeeIds }; manualEntryDialog(row.employeeId); }
    if (key === 'adjustment') { computationContext = { employeeId: row.employeeId, start: currentRun.start, end: currentRun.end, pay13th: currentRun.pay13th, employeeIds: currentRun.employeeIds }; edit('adjustments', null, { employeeId: row.employeeId, date: currentRun.end, approved: true }); }
    if (key === 'contribution') contributionEditor.open(row.employeeId);
    if (key === 'tax') { computationContext = { employeeId: row.employeeId, start: currentRun.start, end: currentRun.end, pay13th: currentRun.pay13th, employeeIds: currentRun.employeeIds }; taxDialog(row); }
    if (key === 'deductions') { dialog.close(); goTo({ page: 'deductions' }); }
    if (key === 'loans') { dialog.close(); goTo({ page: 'loans' }); }
  },
} });
const loansUi = createLoansPage({ ...hrCtx, canEdit: kind => canEdit(kind), editButton: (k, id) => editButton(k, id), addButton: (k, label) => addButton(k, label), downloads: k => downloads(k) });
const thirteenthUi = createThirteenthPage({ ...hrCtx, downloads: k => downloads(k) });
const files = createFiles(hrCtx), hrDashboard = createDashboard(hrCtx), memos = createMemos(hrCtx), trainings = createTrainings(hrCtx), hrAdmin = createAdmin(hrCtx);
async function goTo(nav) {
  page = nav.page;
  if (page === 'files') return files.directory({ status: nav.status || '', docs: nav.docs || '' });
  if (page === 'employee201') return files.openProfile(nav.id, nav.tab || 'overview');
  if (page === 'memos') return memos.render(nav.id);
  if (page === 'trainings') return trainings.render(nav.id);
  render();
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
  let content = heading('Time away, taken care of.', 'Employees apply from their own accounts. Review requests here; approved leave updates their credits and payroll automatically.') + `<div class="cards">${card('Pending requests', pending, 'Ready for HR review')}${card('Approved requests', state.leaves.filter(l => l.status === 'approved').length, 'Connected to payroll')}${card('Leave types', state.leaveTypes.length, 'Statutory and company benefits')}${card('Paid leave types', state.leaveTypes.filter(t => t.paid).length, 'Eligibility verified per employee', true)}</div><div class="tabs"><button data-tab="requests" class="${subtab === 'requests' ? 'active' : ''}">Leave requests</button><button data-tab="balances" class="${subtab === 'balances' ? 'active' : ''}">Balances</button><button data-tab="types" class="${subtab === 'types' ? 'active' : ''}">Leave policies</button></div>`;
  if (subtab === 'balances') content += `<section class="panel"><div class="panel-head"><h2>Annual balances</h2>${downloads('leave-balances')}<span class="legend">As of ${today()} · Approved requests reserve days</span></div>${searchToolbar()}${table(['Employee', 'Leave type', 'Entitled', 'Carry-over', 'Used / reserved', 'Available'], filtered(balances).filter(b => state.employees.find(e => e.id === b.employeeId)?.leaveEligibility.includes(b.typeId)).map(b => [employee(b.employeeId), esc(state.leaveTypes.find(t => t.id === b.typeId)?.name), b.entitled, b.carry, b.used, badge(`${b.available} days`)]))}</section>`;
  else if (subtab === 'types') content += `<section class="panel"><div class="panel-head"><div><h2>Leave type configuration</h2><p>Statutory classification alone does not establish an employee’s entitlement.</p></div>${addButton('leaveTypes', 'Add leave type')}</div>${table(['Leave type', 'Category', 'Pay', 'Entitlement', 'Accrual', ''], state.leaveTypes.map(t => [esc(t.name), badge(t.category, 'neutral'), t.paid ? 'Paid' : 'Unpaid', `${t.entitledDays} days`, esc(t.accrual), editButton('leaveTypes', t.id)]))}</section>`;
  else {
    const toReview = state.leaves.filter(l => l.proofStatus === 'submitted').length;
    content += `<section class="panel"><div class="panel-head"><h2>Leave requests</h2>${downloads('leaves')}<span class="legend">${toReview ? `${toReview} proof${toReview === 1 ? '' : 's'} waiting for review · ` : ''}Review documents and eligibility before approval</span></div>${searchToolbar()}${table(['Employee', 'Leave type', 'Dates', 'Days', 'Reason', 'Available credits', 'Status', 'Proof', 'Decision'], filtered(state.leaves).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.startDate.localeCompare(a.startDate)).map(l => { const bal = balances.find(b => b.employeeId === l.employeeId && b.typeId === l.typeId); const canDecide = ['admin', 'hr'].includes(auth.user.role); return [employee(l.employeeId), esc(state.leaveTypes.find(t => t.id === l.typeId)?.name), `${l.startDate} → ${l.endDate}`, l.days, `<span class="wrap">${esc(l.reason || '—')}</span>`, bal ? (bal.perOccasion ? 'Per occasion' : `${bal.available} day${bal.available === 1 ? '' : 's'}`) : '—', badge(l.status, l.status === 'approved' ? '' : l.status), proofReviewCell(l), canDecide && l.status === 'pending' ? `<span class="row-actions"><button class="small primary" data-leave-decision="approve" data-id="${esc(l.id)}">Approve</button><button class="small" data-leave-decision="reject" data-id="${esc(l.id)}">Reject</button></span>` : canDecide && l.status === 'approved' ? `<button class="small" data-leave-decision="cancel" data-id="${esc(l.id)}">Cancel leave</button>` : '—']; }))}</section>`;
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
  html += `<div class="cards">${card('Gross earnings', money(run?.totals.gross), 'Basic salary + approved earnings')}${card('Total deductions', money(run?.totals.deductions), 'Attendance, contributions & loans')}${card('Net payroll', money(run?.totals.net), run?.status === 'posted' ? 'Approved and posted' : 'Preview before posting', true)}${card('Employees', run?.rows.length || 0, 'In this payroll cutoff')}${card('Employer contributions', money(run?.totals.employer), 'SSS, EC, PhilHealth, Pag-IBIG · paid by GDS, not deducted')}</div><section class="panel payroll-computation"><div class="panel-head"><div><h2>Payroll computation</h2><p>Click a salary to inspect its calculation and source records.</p></div>${badge(run?.status === 'posted' ? 'Posted' : 'Draft preview', run?.status === 'posted' ? '' : 'pending')}</div><form class="toolbar" id="cutoff-form"><label>Cutoff start<input type="date" name="start" value="${period.start}" required></label><label>Cutoff end<input type="date" name="end" value="${period.end}" required></label><label>Employee<select name="employee"><option value="">All employees</option>${state.employees.filter(e => !e.draft).map(e => `<option value="${esc(e.id)}" ${e.id === (run?.employeeIds?.length === 1 ? run.employeeIds[0] : payrollEmployee) ? 'selected' : ''}>${esc(e.name)} (${esc(e.id)})</option>`).join('')}</select></label><label>13th month payout<select name="pay13th"><option value="false">Accrue only</option><option value="true" ${run?.pay13th ? 'selected' : ''}>Pay accrued balance</option></select></label><button class="primary" type="submit">Generate payroll</button></form>`;
  if (run?.employeeIds?.length) html += `<div class="notice" role="status">Showing payroll for <strong>${run.employeeIds.map(id => esc(state.employees.find(e => e.id === id)?.name || id)).join(', ')}</strong> only. ${run.id ? 'This posting covers only this employee.' : 'Posting will cover only this employee; others can be posted separately for the same cutoff.'} Choose <em>All employees</em> to see everyone.</div>`;
  // Simple view: what was earned, what was deducted, what is paid. Click any amount for the full computation.
  // Working days in the payroll month: every day except the employee's rest day (Sunday), holidays included.
  const monthWorkDays = (r, month) => { const [y, m] = month.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate(), rest = state.employees.find(e => e.id === r.employeeId)?.restDays || [0]; let n = 0; for (let d = 1; d <= last; d++) if (!rest.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay())) n++; return n; };
  const headers = ['Employee', `Working days<small class="th-sub">${run ? new Date(`${run.start}T00:00:00`).toLocaleDateString('en-PH', { month: 'long' }) : 'Month'}</small>`, 'Days worked', 'Basic pay', 'Overtime, night & holiday pay', 'Other additions', 'Gross pay', 'Deductions', 'Net pay'];
  const sum = (r, keys) => keys.reduce((s, k) => s + (r.earnings[k] || 0), 0);
  const cell = (row, amount, component = '') => `<button class="money-link" data-salary="${esc(row.employeeId)}" data-component="${esc(component)}" title="Show how this amount was calculated">${money(amount)}</button>`;
  html += table(headers, (run?.rows || []).slice().sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'en', { sensitivity: 'base' })).map(r => [`<button class="employee-link" data-payroll-employee="${esc(r.employeeId)}" title="Open payroll computation">${employee(r.employeeId)}</button>`, monthWorkDays(r, run.start.slice(0, 7)), `${r.creditedDays ?? r.daysPresent}`, cell(r, r.earnings.basic, 'basic'), money(sum(r, ['regularOT', 'restOT', 'specialOT', 'regularHolidayOT', 'otherOT', 'nsd', 'restDay', 'specialHoliday', 'regularHoliday', 'otherHoliday'])), money(sum(r, ['additional', 'allowance', 'thirteenth'])), cell(r, r.gross, 'gross'), money(r.totalDeductions), `<strong>${cell(r, r.net, 'net')}</strong>`]), 'Choose a cutoff and generate payroll to see the computation.') + `<div class="panel-foot"><span>PHP · Applicable Statutory / Company Payroll Rate</span><span class="payroll-total">${run?.rows.length || 0} employees · Total gross ${money(run?.totals.gross)} · Total deductions ${money(run?.totals.deductions)} · <strong>Total net pay ${money(run?.totals.net)}</strong>${run ? ` · <a class="employer-share-link" href="/api/reports/gov-contributions.pdf?month=${run.start.slice(0, 7)}&view=1" target="_blank" rel="noopener" title="Employee and employer SSS, PhilHealth and Pag-IBIG for ${run.start.slice(0, 7)}">Employer share ${money(run.totals.employer)} · Government contributions ↗</a>` : ''}</span></div></section>`;
  if (run?.blockers.length) html += `<div class="notice"><strong>${run.blockers.length} item${run.blockers.length === 1 ? '' : 's'} to resolve before posting</strong><ul>${run.blockers.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>`;
  if (run?.id && run.status === 'posted') html += `<div class="final-banner"><strong>FINAL</strong><span>Finalized on ${esc(new Date(run.postedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }))} by ${esc(run.postedBy || '—')} · This payroll can no longer be edited · Payslips appear in employee accounts on salary day, ${esc(payDateFor(run.start, run.end))}.</span></div>`;
  if (run?.id && run.status === 'posted' && auth.user.role === 'admin') html += `<div class="actions"><button data-reverse-run="${esc(run.id)}">Reverse this posting</button><span class="legend">Withdraws these payslips, restores loan balances and lets you correct and post the cutoff again. The posting stays in the audit trail.</span></div><br>`;
  if (run?.status === 'reversed') html += `<div class="notice">This payroll was reversed by ${esc(run.reversedBy)} on ${esc((run.reversedAt || '').slice(0, 10))}: ${esc(run.reversalReason || '')}</div>`;
  if (run && !run.id && ['admin', 'payroll'].includes(auth.user.role)) html += `<div class="actions"><button class="primary" data-post ${run.blockers.length ? 'disabled' : ''}>Finalize payroll</button><span class="legend">Once final, this payroll can no longer be edited. The date and who finalized it are kept in the payroll history.</span></div><br>`;
  html += `<section class="panel"><div class="panel-head"><h2>Payroll history</h2></div>${table(['Cutoff', 'Salary day', 'Finalized on', 'Finalized by', 'Employees', 'Gross', 'Deductions', 'Net', 'Status', ''], state.runs.slice().reverse().map(r => [`${r.start} → ${r.end}`, esc(payDateFor(r.start, r.end)), esc(r.postedAt ? new Date(r.postedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—'), esc(r.postedBy || '—'), r.rows.length, money(r.totals.gross), money(r.totals.deductions), money(r.totals.net), r.status === 'reversed' ? `${badge('Reversed', 'neutral')}<small>by ${esc(r.reversedBy || '')}</small>` : badge('Final'), `<span class="download-links"><a class="small download-link" href="/api/reports/gov-contributions.pdf?month=${r.start.slice(0, 7)}&view=1" target="_blank" rel="noopener" title="Employee and employer shares for the month">Gov't contributions</a><a class="small download-link" href="/api/runs/${r.id}.pdf?view=1" target="_blank" rel="noopener" title="Opens the payroll register PDF in a new tab for printing">Print PDF</a></span>`]), 'No payroll has been finalized yet.')}</section>`;
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
// Holiday calendar: one card per date, grouped by month, with an icon for each holiday.
const HOLIDAY_ICONS = [[/chinese new year/i, '🧧'], [/new year'?s eve|last day of the year/i, '🎉'], [/new year/i, '🎆'], [/edsa|people power/i, '✊'], [/eid.*fitr|eidul fitr/i, '🌙'], [/eid.*adha|eidul adha/i, '🕌'], [/maundy|holy thursday/i, '🍞'], [/good friday/i, '✝️'], [/black saturday|holy saturday/i, '🕯️'], [/kagitingan|valor/i, '🎖️'], [/labou?r/i, '🛠️'], [/independence/i, '🇵🇭'], [/ninoy|aquino/i, '🕊️'], [/heroes/i, '🦸'], [/all saints/i, '🕯️'], [/all souls/i, '🌼'], [/bonifacio/i, '⚔️'], [/immaculate/i, '🙏'], [/christmas eve/i, '🌟'], [/christmas/i, '🎄'], [/rizal/i, '📜'], [/election|barangay|sk /i, '🗳️'], [/typhoon|calamity|weather/i, '🌧️'], [/anniversary|foundation|founding/i, '🎂']];
const holidayIcon = name => HOLIDAY_ICONS.find(([re]) => re.test(name))?.[1] || '📅';
const KIND_LABEL = { regular: 'Regular holiday', special: 'Special non-working', double: 'Double holiday', ordinary: 'Working day', other: 'Company holiday' };
function holidayCards(list) {
  if (!list.length) return '<div class="panel-body"><p class="muted">No dates are assumed. Add the applicable official holidays for each payroll year.</p></div>';
  const sorted = list.slice().sort((a, b) => a.date.localeCompare(b.date)), next = sorted.find(h => h.date >= today() && h.kind !== 'ordinary');
  const months = [...new Set(sorted.map(h => h.date.slice(0, 7)))];
  const fmt = (d, opts) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', opts);
  return `<div class="holiday-calendar">${months.map(m => `<section class="holiday-month"><h3>${fmt(`${m}-01`, { month: 'long', year: 'numeric' })}</h3><div class="holiday-grid">${sorted.filter(h => h.date.startsWith(m)).map(h => `
    <article class="holiday-card kind-${esc(h.kind)}${h === next ? ' next' : ''}${h.date < today() ? ' past' : ''}">
      <div class="holiday-date"><strong>${fmt(h.date, { day: 'numeric' })}</strong><span>${fmt(h.date, { weekday: 'short' })}</span></div>
      <div class="holiday-icon" aria-hidden="true">${holidayIcon(h.name)}</div>
      <div class="holiday-info"><h4>${esc(h.name)}</h4><span class="holiday-kind">${esc(KIND_LABEL[h.kind] || h.kind)}</span>${h === next ? '<span class="holiday-next">Next holiday</span>' : ''}<small>${esc(h.basis)}</small></div>
      <div class="holiday-actions">${editButton('holidays', h.id)}</div>
    </article>`).join('')}</div></section>`).join('')}</div>`;
}
function holidaysPage() { return heading('Holiday calendar', 'Date-specific classifications, maintained from official proclamations each year.', addButton('holidays', 'Add holiday')) + `<section class="panel"><div class="panel-head"><h2>Configured dates</h2>${downloads('holidays')}<span class="legend">Rest-day combinations come from each employee’s schedule.</span></div>${searchToolbar()}${holidayCards(filtered(state.holidays))}</section><div class="notice">Special non-working days without work default to no pay. Favorable company policy can provide payment. Regular-holiday pay requires the employee’s coverage and eligibility to be verified in attendance.</div>`; }
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
  const hr = reports.filter(r => r.hr201), other = reports.filter(r => !r.hr201), depts = hrContext?.departments || [];
  const filterForm = r => r.filters.length ? `<form class="report-filters" data-report="${esc(r.key)}">${r.filters.includes('department') ? `<select name="department" aria-label="Department"><option value="">All departments</option>${depts.map(d => `<option>${esc(d)}</option>`).join('')}</select>` : ''}${r.filters.includes('status') ? '<select name="status" aria-label="Status"><option value="">Active and inactive</option><option>Active</option><option>Inactive</option><option>Archived</option></select>' : ''}${r.filters.includes('from') ? '<input type="date" name="from" aria-label="From date">' : ''}${r.filters.includes('to') ? '<input type="date" name="to" aria-label="To date">' : ''}${r.filters.includes('month') ? `<input type="month" name="month" aria-label="Month" value="${today().slice(0, 7)}">` : ''}</form>` : '';
  shell(heading('Reports & downloads', 'Download any list as an Excel workbook or a printable PDF. Files contain only what your role may see, and each export is recorded in the audit trail.') +
    (hr.length ? `<section class="panel"><div class="panel-head"><h2>HR 201 reports</h2><span class="legend">Choose filters, then download</span></div><ul class="report-list wide">${hr.map(r => `<li><span>${esc(r.title)}</span>${filterForm(r)}<span class="download-links"><a class="small download-link" data-report-link="${esc(r.key)}" data-format="xlsx" href="/api/reports/${esc(r.key)}.xlsx" download>Excel</a><a class="small download-link" data-report-link="${esc(r.key)}" data-format="pdf" href="/api/reports/${esc(r.key)}.pdf" download>PDF</a></span></li>`).join('')}</ul></section>` : '') +
    (other.length ? `<section class="panel"><div class="panel-head"><h2>Attendance, leave &amp; payroll reports</h2><span class="legend">${other.length} reports available to your role</span></div><ul class="report-list">${other.map(r => r.filters.length ? `<li><span>${esc(r.title)}</span>${filterForm(r)}<span class="download-links"><a class="small download-link" data-report-link="${esc(r.key)}" data-format="xlsx" href="/api/reports/${esc(r.key)}.xlsx?month=${today().slice(0, 7)}" download>Excel</a><a class="small download-link" data-report-link="${esc(r.key)}" data-format="pdf" href="/api/reports/${esc(r.key)}.pdf?month=${today().slice(0, 7)}" download>PDF</a></span></li>` : `<li><span>${esc(r.title)}</span>${downloads(r.key)}</li>`).join('')}</ul></section>` : '') +
    (LEGACY.includes(auth.user.role) ? `<section class="panel"><div class="panel-head"><h2>Payroll registers</h2><span class="legend">One file per posted cutoff</span></div>${table(['Cutoff', 'Employees', 'Net', ''], runs.map(r => [`${r.start} → ${r.end}`, r.rows.length, money(r.totals.net), `<span class="download-links"><a class="small download-link" href="/api/runs/${r.id}.xlsx" download>Excel</a><a class="small download-link" href="/api/runs/${r.id}.pdf" download>PDF</a></span>`]))}</section>` : ''));
  // Keep each download link in step with its filters.
  document.querySelector('.content').addEventListener('change', event => {
    const form = event.target.closest('[data-report]'); if (!form) return;
    const params = new URLSearchParams([...new FormData(form)].filter(([, v]) => v)).toString();
    form.closest('li').querySelectorAll('[data-report-link]').forEach(a => { a.href = `/api/reports/${a.dataset.reportLink}.${a.dataset.format}${params ? `?${params}` : ''}`; });
  });
}
async function auditPage() {
  const entries = await api('/audit');
  shell(heading('Audit trail', 'Who changed what, when, and why. Payroll snapshots preserve their original records.') + `<section class="panel"><div class="panel-head"><h2>Recent activity</h2>${downloads('audit')}<span class="legend">Latest 1,000 events</span></div>${table(['Time', 'Actor', 'Action', 'Record', ''], entries.map((e, i) => [esc(new Date(e.at).toLocaleString()), esc(e.actor), badge(e.action, 'neutral'), `${esc(e.kind)}<br><small>${esc(e.recordId)}</small>`, `<button class="small" data-audit-index="${i}">Inspect change</button>`]))}</section>`);
  document.querySelectorAll('[data-audit-index]').forEach(b => b.onclick = () => showObject('Audit event', entries[Number(b.dataset.auditIndex)]));
}
function renderForcedPassword() {
  app.innerHTML = `<main class="login-shell forced-password"><section class="panel login-card"><div class="panel-body"><h1>Choose your own password</h1><p class="sub">Signed in as ${esc(auth.user.username)}. Your account was created with a default password; set your own before continuing.</p>
    <form id="forced-password" class="form-grid one"><label class="field">Default / current password<input type="password" name="currentPassword" required autocomplete="current-password"></label>
    <label class="field">New password (at least 12 characters)<input type="password" name="newPassword" required minlength="12" maxlength="200" autocomplete="new-password"></label>
    <label class="field">Confirm new password<input type="password" name="confirm" required minlength="12" maxlength="200" autocomplete="new-password"></label>
    <div class="actions"><button class="primary">Save password</button><button type="button" data-signout>Sign out</button></div></form></div></section></main>`;
  app.querySelector('#forced-password').onsubmit = async event => {
    event.preventDefault(); const f = new FormData(event.target);
    if (f.get('newPassword') !== f.get('confirm')) { toast('The new passwords do not match.'); return; }
    if (f.get('newPassword') === f.get('currentPassword')) { toast('Choose a password different from the default.'); return; }
    try { await api('/password', { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') }); auth = { user: null }; renderLogin(); toast('Password saved. Sign in with your new password.'); } catch (error) { toast(error.message); }
  };
}
function render() {
  if (!auth?.user) { renderLogin(); return; }
  if (auth.user.mustChangePassword) { renderForcedPassword(); return; }
  offerInstall();
  startLive();
  if (auth.user.role === 'employee') { portal.draw(employeeData, auth); return; }
  if (page === 'overview') page = 'dashboard';
  if (page === 'employees') page = 'files';
  if (!LEGACY.includes(auth.user.role) && !['dashboard', 'files', 'employee201', 'datasheets', 'memos', 'trainings', 'reports', ...(auth.user.role === 'maker' ? ['audit'] : [])].includes(page)) page = 'dashboard';
  const hrPages = { annual: () => thirteenthUi.render(), loans: () => loansUi.render(), dashboard: () => hrDashboard.render(), files: () => files.directory(), employee201: () => files.drawProfile(), datasheets: () => hrAdmin.datasheets(), memos: () => memos.render(), trainings: () => trainings.render(), settings: () => hrAdmin.settingsPage() };
  if (hrPages[page]) { hrPages[page]().catch(e => { shell(`<div class="notice">${esc(e.message)}</div>`); }); return; }
  if (page === 'live') { shell(heading('Live attendance', 'Employee clock events and HR reviews synchronize automatically.') + (liveData ? portal.live(liveData) : '<div class="notice">This view is restricted to HR and administrators.</div>')); return; }
  if (page === 'profile') { profiles.redraw().catch(e => toast(e.message)); return; }
  const views = { overview, employees: employeesPage, attendance: attendancePage, leave: leavePage, payroll: payrollPage, loans: loansPage, deductions: deductionsPage, holidays: holidaysPage, rules: rulesPage };
  if (page === 'audit') { auditPage().catch(e => toast(e.message)); return; }
  if (page === 'reports') { reportsPage().catch(e => toast(e.message)); return; }
  shell(views[page]());
  if (page === 'attendance' && attendanceView === 'timecard') {
    timecard.bind((employeeId, date) => edit('attendance', null, newAttendanceFor(employeeId, date)), async (employeeId, start, end) => {
      payrollEmployee = employeeId; currentRun = await api('/payroll/preview', { start, end, pay13th: false, employeeIds: [employeeId] }); page = 'payroll'; render();
    }, applyLateOffset);
    timecard.fill();
  }
  if (page === 'attendance' && ['admin', 'hr', 'payroll'].includes(auth.user.role)) {
    api('/overtime-requests').then(list => {
      const content = document.querySelector('.content'); if (page !== 'attendance' || !content) return;
      const section = document.createElement('section'); section.className = 'panel';
      const can = ['admin', 'hr'].includes(auth.user.role), STATUS = { pending: ['Pending', 'pending'], approved: ['Approved', ''], rejected: ['Not approved', 'rejected'] };
      const people = state.employees.filter(e => e.coveredOT && !e.archived).map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');
      section.innerHTML = `<div class="panel-head"><h2>Overtime filings</h2><span class="legend">Employees may clock out late; only overtime they file and HR approves is paid, up to the hours actually worked beyond the schedule.</span></div>`
        + (() => { const ok = list.filter(o => o.status === 'approved'); const nh = ok.reduce((s, o) => s + (o.approvedNightHours || 0), 0), np = ok.reduce((s, o) => s + (o.nightPay || 0), 0); return `<div class="panel-body cards"><div class="card"><div class="card-label">Awaiting approval</div><div class="card-value">${list.filter(o => o.status === 'pending').length}</div><div class="card-foot">Filings</div></div><div class="card"><div class="card-label">Approved overtime</div><div class="card-value">${Math.round(ok.reduce((s, o) => s + o.approvedHours, 0) * 100) / 100} h</div><div class="card-foot">All approved filings</div></div><div class="card featured"><div class="card-label">Approved night differential</div><div class="card-value">${Math.round(nh * 100) / 100} h</div><div class="card-foot">≈ ${money(np)} · 10 PM – 6 AM, +10%</div></div></div>`; })() + table(['Employee', 'Date', 'Filed', 'Night diff', 'Worked beyond schedule', 'Reason', 'Status', ''], list.map(o => [employee(o.employeeId), o.date, `${o.hours} h${o.startTime ? `<small>${esc(o.startTime)} – ${esc(o.endTime)}</small>` : ''}<small>${esc(o.filedBy)}</small>`, o.nightHours ? `${o.status === 'approved' ? o.approvedNightHours : o.nightHours} h${o.nightPay ? `<small>≈ ${money(o.nightPay)}</small>` : ''}` : '—', o.worked === null ? '<small>No attendance yet</small>' : `${o.worked} h${o.worked < o.hours ? '<small>less than filed</small>' : ''}`, `<span class="wrap">${esc(o.reason)}</span>`, badge(...STATUS[o.status]) + (o.status === 'approved' ? `<small>${o.approvedHours} h approved</small>` : '') + (o.remarks ? `<small>${esc(o.remarks)}</small>` : '') + (o.decidedBy ? `<small>by ${esc(o.decidedBy)}</small>` : ''), can && !o.locked ? `<span class="row-actions">${o.status !== 'approved' ? `<button class="small primary" data-ot-decision="approve" data-id="${esc(o.id)}" data-hours="${o.worked === null ? o.hours : Math.min(o.hours, o.worked)}" data-filed="${o.hours}">Approve</button>` : ''}${o.status !== 'rejected' ? `<button class="small" data-ot-decision="reject" data-id="${esc(o.id)}">Reject</button>` : ''}</span>` : o.locked ? '<small>Posted</small>' : '']), 'No overtime filed yet.')
        + (can ? `<form id="ot-record" class="panel-body form-grid"><label class="field">Record overtime for<select name="employeeId" required><option value="">Choose…</option>${people}</select></label><label class="field">Date<input type="date" name="date" required></label><label class="field">Hours<input type="number" name="hours" min="0.25" max="16" step="0.25" required></label><label class="field">Reason<input name="reason" required minlength="3" maxlength="1000"></label><div><button class="primary">Record approved overtime</button></div></form>` : '');
      content.prepend(section);
      section.querySelector('#ot-record')?.addEventListener('submit', async event => {
        event.preventDefault(); const f = new FormData(event.target);
        try { await api('/overtime-requests', { employeeId: f.get('employeeId'), date: f.get('date'), hours: Number(f.get('hours')), reason: f.get('reason') }); await refresh(); render(); toast('Approved overtime recorded.'); } catch (error) { toast(error.message); }
      });
    }).catch(error => toast(error.message));
  }
  if (page === 'overview') {
    if (liveData) { const live = document.createElement('div'); live.innerHTML = portal.live(liveData); document.querySelector('.content').append(live); }
    const section = document.createElement('section'); section.className = 'panel';
    section.innerHTML = '<div class="panel-head"><h2>Upcoming work anniversaries</h2><span class="legend">Next 60 days</span></div>' + table(['Employee', 'Anniversary', ''], (state.anniversaries || []).map(e => [employee(e.employeeId), e.nextAnniversary, `<button class="small" data-profile="${esc(e.employeeId)}">Open profile</button>`]), 'No upcoming anniversaries. Add confirmed joining dates to employee records.');
    document.querySelector('.content').append(section);
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
    <h3>Manual time &amp; pay entry</h3>
    ${r.manualEntry ? `<div class="notice compact manual-summary"><strong>${r.manualEntry.mode === 'replace' ? 'Manual figures replace attendance for this cutoff' : 'Manual hours added on top of attendance'}</strong><br>${manualSummary(r.manualEntry, r.payBasis)}<br><small>By ${esc(r.manualEntry.updatedBy)} · ${esc(r.manualEntry.reason)}</small></div>` : '<p class="legend">None. Pay comes from attendance records.</p>'}
    ${editable ? `<button class="small" data-manual-entry="${esc(r.employeeId)}">${r.manualEntry ? 'Edit manual entry' : '✎ Enter figures manually'}</button>` : ''}
    <h3>Company deductions</h3>
    ${table(['Deduction', 'Amount', 'When', 'Status', ''], (state.deductions || []).filter(d => d.employeeId === r.employeeId).map(d => [esc(d.name), money(d.amount), SCHEDULE_LABEL[d.schedule], badge(d.active ? 'Active' : 'Paused', d.active ? '' : 'neutral'), !run.id ? editButton('deductions', d.id) : '']), 'No company deductions for this employee.')}
    ${!run.id && canEdit('deductions') ? `<button class="small" data-computation-deduction="${esc(r.employeeId)}">＋ Add company deduction</button>` : ''}
    <p class="computation-contrib">${['admin', 'hr', 'payroll'].includes(auth.user.role) ? `<button class="small" data-computation-contrib="${esc(r.employeeId)}">Review SSS / PhilHealth / Pag-IBIG basis</button>` : ''}${r.contributionChangeId ? ' <span class="legend">An approved contribution adjustment applies to this cutoff.</span>' : ''}</p>
    ${editable ? `<button class="small" data-computation-add="${esc(r.employeeId)}">＋ Add adjustment</button>` : run.id ? '<p class="legend">Posted payroll is locked; record corrections as an adjustment in an open cutoff.</p>' : ''}
  </section>`;
}
// Manual time & pay entry: HR types days, absences, late / undertime and hours for one cutoff.
const MANUAL_HOURS = [['regularOT', 'Overtime (regular day)'], ['restDay', 'Rest day hours'], ['restOT', 'Rest day overtime'], ['specialHoliday', 'Special holiday hours worked'], ['specialOT', 'Special holiday overtime'], ['regularHoliday', 'Regular holiday hours worked'], ['regularHolidayOT', 'Regular holiday overtime'], ['nightDiff', 'Night differential hours (10 PM–6 AM)']];
function manualSummary(m, basis) {
  const parts = [];
  if (m.mode === 'replace') { if (basis === 'daily') parts.push(`${m.daysWorked} days worked`); if (m.absenceDays) parts.push(`${m.absenceDays} absent day(s)`); if (m.lateMinutes) parts.push(`late ${m.lateMinutes} min`); if (m.undertimeMinutes) parts.push(`undertime ${m.undertimeMinutes} min`); }
  for (const [k, label] of MANUAL_HOURS) if (m.hours?.[k]) parts.push(`${label.toLowerCase()}: ${m.hours[k]} h`);
  return esc(parts.join(' · ') || 'No figures');
}
const OVERRIDABLE = [['basic', 'Basic salary', 'earnings'], ['regularOT', 'Regular overtime', 'earnings'], ['restDay', 'Rest day pay', 'earnings'], ['restOT', 'Rest day OT', 'earnings'], ['nsd', 'Night differential', 'earnings'], ['specialHoliday', 'Special holiday pay', 'earnings'], ['specialOT', 'Special holiday OT', 'earnings'], ['regularHoliday', 'Regular holiday pay', 'earnings'], ['regularHolidayOT', 'Regular holiday OT', 'earnings'], ['otherHoliday', 'Other holiday pay', 'earnings'], ['otherOT', 'Other holiday OT', 'earnings'], ['additional', 'Adjustment', 'earnings'], ['allowance', 'Allowance', 'earnings'], ['absence', 'Absence / unpaid leave', 'deductions'], ['undertime', 'Undertime', 'deductions'], ['other', 'Other deductions', 'deductions'], ['tax', 'Withholding tax', 'deductions']];
// Net pay as a form: every earning and deduction in its own box. Editable boxes save as manual overrides (with a
// reason); government contributions and loans keep their own approval / balance flows and are shown read-only.
const NET_EARNINGS = [['basic', 'Basic pay (days credited)'], ['regularOT', 'Overtime'], ['nsd', 'Night differential'], ['restDay', 'Rest day pay'], ['restOT', 'Rest day overtime'], ['regularHoliday', 'Regular holiday pay'], ['regularHolidayOT', 'Regular holiday overtime'], ['specialHoliday', 'Special holiday pay'], ['specialOT', 'Special holiday overtime'], ['otherHoliday', 'Other holiday pay'], ['otherOT', 'Other holiday overtime'], ['allowance', 'Allowance'], ['additional', 'Adjustment'], ['thirteenth', '13th month pay', true]];
const NET_DEDUCTIONS = [['SSS', 'SSS'], ['PhilHealth', 'PhilHealth'], ['Pag-IBIG', 'Pag-IBIG'], ['tax', 'Withholding tax'], ['sssLoan', 'SSS loan'], ['pagibigLoan', 'Pag-IBIG loan'], ['salaryDeduction', 'Salary deduction'], ['loans', 'Other loans', true], ['undertime', 'Undertime'], ['other', 'Other deductions']];
function netPayDialog(employeeId, focus = 'net') {
  const row = currentRun.rows.find(r => r.employeeId === employeeId), m = row.manualEntry, editable = canEdit('adjustments') && !currentRun.id;
  computationContext = { employeeId, start: currentRun.start, end: currentRun.end, pay13th: currentRun.pay13th, employeeIds: currentRun.employeeIds };
  const original = key => (row.overrides || []).find(o => o.component === key)?.original;
  const box = (side, [key, label, locked]) => {
    const value = row[side][key] || 0, always = ['basic', 'tax', 'SSS', 'PhilHealth', 'Pag-IBIG', 'sssLoan', 'pagibigLoan', 'salaryDeduction'].includes(key);
    const computed = key === 'basic' && original(key) !== undefined ? original(key) - (row.absenceAmount || 0) : original(key);
    if (!value && computed === undefined && !always && (locked || !['allowance', 'additional', 'regularOT', 'nsd', 'absence', 'undertime', 'other'].includes(key))) return '';
    return `<label class="net-box${computed !== undefined ? ' overridden' : ''}${locked || !editable ? ' locked' : ''}"><span>${esc(label)}</span>
      <input type="number" step="0.01" min="0" name="${esc(key)}" data-side="${side}" data-computed="${computed ?? value}" value="${value}" ${locked || !editable ? 'readonly tabindex="-1"' : ''} aria-label="${esc(label)}">
      ${computed !== undefined ? `<small>Manual · computed ${money(computed)}</small>` : ''}</label>`;
  };
  openDialog(`Pay computation · ${row.employeeName}`, `<form id="net-form"><div class="dialog-body"><p class="sub">${esc(currentRun.start)} — ${esc(currentRun.end)} · ${currentRun.id ? 'Posted (read-only)' : 'Draft (not yet posted)'}</p>
    <div class="net-columns"><fieldset class="net-side"><legend>Earnings</legend>${NET_EARNINGS.map(f => box('earnings', f)).join('')}<div class="net-total"><span>Gross pay</span><strong data-net-gross>${money(row.gross)}</strong></div></fieldset>
    <fieldset class="net-side"><legend>Deductions</legend>${NET_DEDUCTIONS.map(f => box('deductions', f)).join('')}<div class="net-total"><span>Total deductions</span><strong data-net-deductions>${money(row.totalDeductions)}</strong></div></fieldset></div>
    <div class="net-pay"><span>Net pay</span><strong data-net-pay>${money(row.net)}</strong></div>
    ${editable ? `<p class="legend">Type over an amount to change it. Changed boxes are labelled Manual and keep the computed amount for reference. Withholding tax is recomputed after earnings change unless you set it here. Contribution changes here apply to this cutoff only (the employee’s contribution basis stays the same). Loans are changed in Employee Loans.</p>` : ''}</div>
    <div class="dialog-foot pay-foot"><button type="button" data-net-breakdown>View computation</button><button type="button" data-close>Close</button>${editable ? '<button class="primary">Save and recalculate</button>' : ''}</div></form>`);
  dialog.classList.add('wide-dialog');
  const form = dialog.querySelector('#net-form');
  // Opened from Basic pay: put the cursor in the basic pay box; from Gross / Net: highlight that total.
  if (focus === 'basic' && editable) form.elements.basic?.focus();
  else form.querySelector(focus === 'gross' ? '[data-net-gross]' : '[data-net-pay]')?.closest('div')?.classList.add('net-focus');
  const totals = () => {
    const sum = side => [...form.querySelectorAll(`input[data-side="${side}"]`)].reduce((s, i) => s + Number(i.value || 0), 0);
    const restE = Object.entries(row.earnings).filter(([k]) => !form.elements[k]).reduce((s, [, v]) => s + v, 0), restD = Object.entries(row.deductions).filter(([k]) => !form.elements[k]).reduce((s, [, v]) => s + v, 0);
    const gross = sum('earnings') + restE, ded = sum('deductions') + restD;
    form.querySelector('[data-net-gross]').textContent = money(gross); form.querySelector('[data-net-deductions]').textContent = money(ded); form.querySelector('[data-net-pay]').textContent = money(gross - ded);
    form.querySelectorAll('input[data-side]').forEach(i => i.closest('.net-box').classList.toggle('changed', Math.abs(Number(i.value || 0) - Number(i.dataset.computed)) > 0.004));
  };
  form.addEventListener('input', totals);
  form.querySelector('[data-net-breakdown]').onclick = () => { dialog.classList.remove('wide-dialog'); breakdown.open(currentRun, row, 'net'); };
  form.onsubmit = async event => {
    event.preventDefault();
    const allowed = new Set(['basic', 'regularOT', 'restDay', 'restOT', 'nsd', 'specialHoliday', 'specialOT', 'regularHoliday', 'regularHolidayOT', 'otherHoliday', 'otherOT', 'additional', 'allowance', 'absence', 'undertime', 'other', 'tax', 'SSS', 'PhilHealth', 'Pag-IBIG', 'sssLoan', 'pagibigLoan', 'salaryDeduction']);
    const reason = '';
    const overrides = [...form.querySelectorAll('input[data-side]')].filter(i => allowed.has(i.name) && !i.readOnly && Math.abs(Number(i.value || 0) - Number(i.dataset.computed)) > 0.004).map(i => ({ component: i.name, amount: Math.round((Number(i.value || 0) + (i.name === 'basic' ? row.absenceAmount || 0 : 0)) * 100) / 100, reason }));
    const base = m || { mode: 'add', daysWorked: 0, absenceDays: 0, lateMinutes: 0, undertimeMinutes: 0, hours: {}, reason: 'Net pay adjustment' };
    // Keep every saved amount this form does not show (e.g. a locked absence); only the boxes shown are replaced.
    const kept = (base.overrides || []).filter(o => !allowed.has(o.component) || !form.elements[o.component] || form.elements[o.component].readOnly);
    const all = [...kept, ...overrides];
    try {
      const plain = !m || (m.mode === 'add' && !Object.values(m.hours || {}).some(Boolean) && ['Net pay adjustment', 'Withholding tax adjustment'].includes(m.reason));
      if (!all.length && plain && m) await api(`/payroll/inputs/${encodeURIComponent(employeeId)}?start=${currentRun.start}&end=${currentRun.end}`, null, 'DELETE');
      else if (all.length || m) await api(`/payroll/inputs/${encodeURIComponent(employeeId)}`, { start: currentRun.start, end: currentRun.end, mode: base.mode, daysWorked: base.daysWorked || 0, absenceDays: base.absenceDays || 0, lateMinutes: base.lateMinutes || 0, undertimeMinutes: base.undertimeMinutes || 0, hours: base.hours || {}, reason: base.reason, overrides: all });
      dialog.close(); dialog.classList.remove('wide-dialog');
      if (await reopenComputation()) savedPopup(overrides.length ? 'Net pay updated. Changes are labelled Manual.' : 'Saved.');
    } catch (error) { toast(error.message); }
  };
}
// Saves the overrides for the components a form shows (others already saved are kept).
async function saveOverrides(row, shown, changed, defaultReason) {
  const m = row.manualEntry, base = m || { mode: 'add', daysWorked: 0, absenceDays: 0, lateMinutes: 0, undertimeMinutes: 0, hours: {}, reason: defaultReason };
  const all = [...(base.overrides || []).filter(o => !shown.includes(o.component)), ...changed];
  const plain = !m || (m.mode === 'add' && !Object.values(m.hours || {}).some(Boolean) && ['Net pay adjustment', 'Withholding tax adjustment', 'Basic pay adjustment'].includes(m.reason));
  if (!all.length && plain) { if (m) await api(`/payroll/inputs/${encodeURIComponent(row.employeeId)}?start=${currentRun.start}&end=${currentRun.end}`, null, 'DELETE'); return; }
  await api(`/payroll/inputs/${encodeURIComponent(row.employeeId)}`, { start: currentRun.start, end: currentRun.end, mode: base.mode, daysWorked: base.daysWorked || 0, absenceDays: base.absenceDays || 0, lateMinutes: base.lateMinutes || 0, undertimeMinutes: base.undertimeMinutes || 0, hours: base.hours || {}, reason: base.reason, overrides: all });
}
// Basic pay: how it was computed (rate, days, absences, late, undertime) with Basic pay, Absence and Undertime editable.
function basicPayDialog(employeeId) {
  const row = currentRun.rows.find(r => r.employeeId === employeeId), editable = canEdit('adjustments') && !currentRun.id;
  computationContext = { employeeId, start: currentRun.start, end: currentRun.end, pay13th: currentRun.pay13th, employeeIds: currentRun.employeeIds };
  const original = key => (row.overrides || []).find(o => o.component === key)?.original;
  const fact = (label, value, note = '') => `<div class="net-box locked"><span>${esc(label)}</span><strong class="fact-value">${value}</strong>${note ? `<small>${note}</small>` : ''}</div>`;
  const input = (side, key, label) => { const value = row[side][key] || 0, computed = key === 'basic' && original(key) !== undefined ? original(key) - (row.absenceAmount || 0) : original(key); return `<label class="net-box${computed !== undefined ? ' overridden' : ''}${editable ? '' : ' locked'}"><span>${esc(label)}</span><input type="number" step="0.01" min="0" name="${key}" data-side="${side}" data-computed="${computed ?? value}" value="${value}" ${editable ? '' : 'readonly'}>${computed !== undefined ? `<small>Manual · computed ${money(computed)}</small>` : ''}</label>`; };
  const daily = row.payBasis === 'daily', base = daily ? row.dailyRate * row.workingDays : row.monthlySalary * (currentRun.start.endsWith('-01') || currentRun.start.endsWith('-16') ? 0.5 : 1);
  openDialog(`Basic pay · ${row.employeeName}`, `<form id="basic-form"><div class="dialog-body"><p class="sub">${esc(currentRun.start)} — ${esc(currentRun.end)} · ${currentRun.id ? 'Posted (read-only)' : 'Draft (not yet posted)'}</p>
    <fieldset class="net-side"><legend>How basic pay is computed</legend>
      ${fact(daily ? 'Daily rate' : 'Monthly salary', money(daily ? row.dailyRate : row.monthlySalary), daily ? 'Daily-paid' : 'Monthly-paid')}
      ${fact('Daily rate used', money(row.dailyRate))}${fact('Hourly rate used', money(row.hourlyRate))}
      ${fact('Scheduled workdays', row.workingDays)}${fact('Days present', row.daysPresent)}${fact('Days credited', row.creditedDays ?? row.daysPresent, row.lateDaysLost ? `${row.lateDaysLost} day lost to late` : '')}
      ${fact('Leave days', row.leaveDays)}${fact('Late (not offset)', `${row.lateMinutesUnoffset || 0} min`)}${fact('Cutoff salary base', money(base), daily ? 'Daily rate × scheduled days' : 'Half of the monthly salary')}
    </fieldset>
    <fieldset class="net-side"><legend>Amounts</legend>${fact('Absences', money(row.absenceAmount || 0), 'Already taken off the days credited')}${input('earnings', 'basic', 'Basic pay (days credited)')}${input('deductions', 'undertime', 'Undertime')}
      <div class="net-total"><span>Basic pay less undertime</span><strong data-basic-net>${money((row.earnings.basic || 0) - (row.deductions.undertime || 0))}</strong></div></fieldset>
</div>
    <div class="dialog-foot pay-foot"><button type="button" data-basic-full>Full pay computation</button><button type="button" data-close>Close</button>${editable ? '<button class="primary">Save and recalculate</button>' : ''}</div></form>`);
  dialog.classList.add('wide-dialog');
  const form = dialog.querySelector('#basic-form'), shown = ['basic', 'undertime'];
  form.addEventListener('input', () => {
    const v = k => Number(form.elements[k].value || 0);
    form.querySelector('[data-basic-net]').textContent = money(v('basic') - v('undertime'));
    form.querySelectorAll('input[data-side]').forEach(i => i.closest('.net-box').classList.toggle('changed', Math.abs(Number(i.value || 0) - Number(i.dataset.computed)) > 0.004));
  });
  form.querySelector('[data-basic-full]').onclick = () => { dialog.classList.remove('wide-dialog'); netPayDialog(employeeId, 'net'); };
  form.onsubmit = async event => {
    event.preventDefault();
    const reason = '';
    const changed = shown.filter(k => Math.abs(Number(form.elements[k].value || 0) - Number(form.elements[k].dataset.computed)) > 0.004).map(k => ({ component: k, amount: Math.round((Number(form.elements[k].value || 0) + (k === 'basic' ? row.absenceAmount || 0 : 0)) * 100) / 100, reason }));
    try { await saveOverrides(row, shown, changed, 'Basic pay adjustment'); dialog.close(); dialog.classList.remove('wide-dialog'); if (await reopenComputation()) savedPopup(changed.length ? 'Basic pay updated. Changes are labelled Manual.' : 'Saved.'); } catch (error) { toast(error.message); }
  };
}
// Withholding tax typed by Payroll/HR for one employee and cutoff (a manual override; the computed tax is kept).
function taxDialog(row) {
  const m = row.manualEntry, current = (m?.overrides || []).find(o => o.component === 'tax');
  const computed = (row.overrides || []).find(o => o.component === 'tax')?.original ?? row.deductions.tax;
  openDialog(`Adjust withholding tax · ${row.employeeName}`, `<form id="tax-form"><div class="dialog-body"><p class="sub">Cutoff ${currentRun.start} — ${currentRun.end}</p>
    <div class="cards">${card('Computed from the tax table', money(computed), 'System-generated')}${card('Tax used in this payroll', money(row.deductions.tax), current ? 'Manual override' : 'Computed')}</div>
    <div class="form-grid"><label class="field">Withholding tax for this cutoff (PHP)<input type="number" name="amount" min="0" step="0.01" required value="${current ? current.amount : computed}"></label></div>
    <p class="legend">The payslip shows this amount. The computed figure and your reason stay in the computation history.</p></div>
    <div class="dialog-foot">${current ? '<button type="button" data-tax-reset>Reset to computed</button>' : ''}<button type="button" data-close>Cancel</button><button class="primary">Save and recalculate</button></div></form>`);
  const save = async overrides => {
    const base = m || { mode: 'add', daysWorked: 0, absenceDays: 0, lateMinutes: 0, undertimeMinutes: 0, hours: {}, reason: 'Withholding tax adjustment' };
    const others = (base.overrides || []).filter(o => o.component !== 'tax'), all = [...others, ...overrides];
    const empty = !m || (m.mode === 'add' && !Object.values(m.hours || {}).some(Boolean) && !others.length && m.reason === 'Withholding tax adjustment');
    if (!all.length && empty) await api(`/payroll/inputs/${encodeURIComponent(row.employeeId)}?start=${currentRun.start}&end=${currentRun.end}`, null, 'DELETE');
    else await api(`/payroll/inputs/${encodeURIComponent(row.employeeId)}`, { start: currentRun.start, end: currentRun.end, mode: base.mode, daysWorked: base.daysWorked || 0, absenceDays: base.absenceDays || 0, lateMinutes: base.lateMinutes || 0, undertimeMinutes: base.undertimeMinutes || 0, hours: base.hours || {}, reason: base.reason, overrides: all });
  };
  const form = dialog.querySelector('#tax-form');
  form.onsubmit = async event => {
    event.preventDefault();
    try { await save([{ component: 'tax', amount: Number(form.elements.amount.value), reason: '' }]); dialog.close(); if (await reopenComputation()) savedPopup('Withholding tax adjusted. Payroll recalculated.'); } catch (error) { toast(error.message); }
  };
  form.querySelector('[data-tax-reset]')?.addEventListener('click', async () => {
    try { await save([]); dialog.close(); if (await reopenComputation()) savedPopup('Withholding tax reset to the computed amount.'); } catch (error) { toast(error.message); }
  });
}
function manualEntryDialog(employeeId) {
  const row = currentRun.rows.find(x => x.employeeId === employeeId), m = row.manualEntry || { mode: 'add', daysWorked: row.workingDays, absenceDays: 0, lateMinutes: 0, undertimeMinutes: 0, hours: {}, reason: '' };
  const daily = row.payBasis === 'daily';
  const num = (name, label, value, step = '0.25', hint = '') => `<label class="field">${label}<input type="number" name="${name}" min="0" step="${step}" value="${value ?? 0}">${hint ? `<small>${hint}</small>` : ''}</label>`;
  openDialog(`Manual entry · ${row.employeeName}`, `<form id="manual-form"><div class="dialog-body">
    <p class="sub">Cutoff ${currentRun.start} — ${currentRun.end} · ${daily ? 'daily-paid' : 'monthly-paid'} · hourly rate ${money(row.hourlyRate)}</p>
    <fieldset class="form-section-box"><legend>How to use these figures</legend>
      <label class="inline-check"><input type="radio" name="mode" value="add" ${m.mode === 'add' ? 'checked' : ''}> Add these hours on top of attendance records</label>
      <label class="inline-check"><input type="radio" name="mode" value="replace" ${m.mode === 'replace' ? 'checked' : ''}> Use these figures instead of attendance for this cutoff (no attendance needed)</label></fieldset>
    <fieldset class="form-section-box" data-replace-only><legend>Days and time (replaces attendance)</legend><div class="form-grid">
      ${daily ? num('daysWorked', 'Days worked (include paid holidays)', m.daysWorked, '0.5', `${row.workingDays} scheduled days this cutoff`) : num('absenceDays', 'Absent days (unpaid)', m.absenceDays, '0.5', `${row.workingDays} scheduled days this cutoff`)}
      ${num('lateMinutes', 'Late minutes (not offset)', m.lateMinutes, '1')}${num('undertimeMinutes', 'Undertime minutes', m.undertimeMinutes, '1')}</div></fieldset>
    <fieldset class="form-section-box"><legend>Hours worked</legend><div class="form-grid">${MANUAL_HOURS.map(([k, label]) => num(`h.${k}`, label, m.hours?.[k])).join('')}</div>
      <p class="legend">Pay is calculated with the approved Rules &amp; rates: overtime ×1.25, rest day ×1.3, holiday premiums and 10% night differential. Holiday hours are for holidays falling on a scheduled workday.</p></fieldset>
    <details class="form-section-box"${(m.overrides || []).length ? ' open' : ''}><summary>Manual overrides of calculated amounts</summary>
      <p class="legend">Replace a calculated amount for this cutoff. Leave blank to keep the system amount. Each override needs a reason; the original and revised values are kept in the audit trail.</p>
      ${table(['Item', 'Calculated', 'Override amount', 'Reason'], OVERRIDABLE.map(([k, label, side]) => { const o = (m.overrides || []).find(x => x.component === k), calc = (row.overrides || []).find(x => x.component === k)?.original ?? row[side][k] ?? 0; return [esc(label), money(calc), `<input type="number" min="0" step="0.01" name="ov.${k}" value="${o ? o.amount : ''}" aria-label="Override ${esc(label)}">`, `<input name="ovr.${k}" maxlength="500" value="${esc(o?.reason || '')}" aria-label="Reason for ${esc(label)} override">`]; }))}</details>
    <label class="field full">Note (optional)<input name="reason" maxlength="500" value="${esc(m.reason)}" placeholder="e.g. Manual DTR signed by supervisor; biometric was offline"></label>
  </div><div class="dialog-foot">${row.manualEntry ? '<button type="button" class="danger" data-manual-remove>Remove manual entry</button>' : ''}<button type="button" data-close>Cancel</button><button class="primary">Save and recalculate</button></div></form>`);
  const form = dialog.querySelector('#manual-form');
  const toggle = () => form.querySelector('[data-replace-only]').classList.toggle('hidden', form.elements.mode.value !== 'replace');
  form.addEventListener('change', toggle); toggle();
  form.onsubmit = async event => {
    event.preventDefault();
    const v = n => Number(form.elements[n]?.value || 0);
    const body = { start: currentRun.start, end: currentRun.end, mode: form.elements.mode.value, daysWorked: v('daysWorked'), absenceDays: v('absenceDays'), lateMinutes: Math.round(v('lateMinutes')), undertimeMinutes: Math.round(v('undertimeMinutes')), hours: Object.fromEntries(MANUAL_HOURS.map(([k]) => [k, v(`h.${k}`)])), reason: form.elements.reason.value, overrides: OVERRIDABLE.filter(([k]) => form.elements[`ov.${k}`].value !== '').map(([k]) => ({ component: k, amount: Number(form.elements[`ov.${k}`].value), reason: form.elements[`ovr.${k}`].value })) };
    try { await api(`/payroll/inputs/${encodeURIComponent(employeeId)}`, body); dialog.close(); if (await reopenComputation()) savedPopup('Manual entry saved. Payroll recalculated.'); } catch (error) { toast(error.message); }
  };
  form.querySelector('[data-manual-remove]')?.addEventListener('click', async () => {
    if (!window.confirm('Remove the manual entry? Pay will come from attendance again.')) return;
    try { await api(`/payroll/inputs/${encodeURIComponent(employeeId)}?start=${currentRun.start}&end=${currentRun.end}`, null, 'DELETE'); dialog.close(); if (await reopenComputation()) savedPopup('Manual entry removed. Payroll recalculated.'); } catch (error) { toast(error.message); }
  });
}
// Recompute the reviewed employee's payroll after an adjustment changes, then reopen their computation.
// Pop-up after a payroll save: the message and the employee's recalculated gross, deductions and net pay.
function savedPopup(message) {
  const id = computationContext?.employeeId, row = currentRun?.rows.find(r => r.employeeId === id);
  openDialog('Saved and recalculated', `<div class="dialog-body confirm-box"><p class="confirm-icon" aria-hidden="true">✅</p><p>${esc(message)}</p>${row ? `<div class="cards">${card('Gross pay', money(row.gross), esc(row.employeeName))}${card('Total deductions', money(row.totalDeductions), 'This cutoff')}${card('Net pay', money(row.net), 'Recalculated', true)}</div>` : ''}</div>`, '<div class="dialog-foot"><button class="primary" data-close>OK</button></div>');
}
async function reopenComputation() {
  const c = computationContext; if (!c) return false;
  currentRun = await api('/payroll/preview', { start: c.start, end: c.end, pay13th: c.pay13th, ...(c.employeeIds ? { employeeIds: c.employeeIds } : {}) });
  // After saving, return to the payroll table (recalculated) instead of reopening the computation window.
  if (dialog.open) dialog.close();
  page = 'payroll'; render(); return true;
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
    rules: [field('effectiveDate', 'Effective date', 'date'), field('approvedBy', 'Approval', 'select', [['', 'Save as draft'], ['approve', 'Approve as current administrator']]), field('basis', 'Legal / policy basis', 'textarea'), section('Wage multipliers'), ...[['ordinaryOT', 'Ordinary overtime'], ['rest', 'Rest day'], ['premiumOT', 'Rest / holiday overtime factor'], ['special', 'Special non-working holiday'], ['specialRest', 'Special holiday + rest day'], ['regular', 'Regular holiday'], ['double', 'Double holiday'], ['other', 'Other holiday'], ['nsd', 'Night differential (0.10 = 10%)']].map(([k, n]) => field(k, n, 'number')), section('Unworked holiday pay'), ...[['specialUnworked', 'Special holiday (0 = no pay, 1 = full day)'], ['regularUnworked', 'Eligible regular holiday'], ['doubleUnworked', 'Eligible double holiday'], ['otherUnworked', 'Other holiday']].map(([k, n]) => field(k, n, 'number')), section('Working time & payroll cutoff'), ...[['normalHours', 'Normal work hours per shift'], ['dailyDivisor', 'Monthly salary → daily divisor'], ['hourlyDivisor', 'Daily rate → hourly divisor'], ['workdaysPerMonth', 'Reference workdays per month'], ['graceMinutes', 'Late grace period (minutes)'], ['lateThresholdMinutes', 'Late is deductible from (minutes late)']].map(([k, n]) => field(k, n, 'number')), field('cutoff', 'Payroll cutoff', 'select', [['semi-monthly', 'Semi-monthly: 1–15 / 16–last day'], ['monthly', 'Monthly: 1–last day']]), field('contributionTiming', 'Government contribution deduction timing', 'select', [['split', 'Split across both cutoffs (half each)'], ['second', 'Full monthly amount on the 16th to end-of-month cutoff'], ['first', 'Full monthly amount on the 1st to 15th cutoff']]), field('deductLate', 'Deduct uncovered late time', 'checkbox'), field('deductUndertime', 'Deduct uncovered undertime', 'checkbox'), field('includeHolidayBaseIn13th', 'Include holiday salary credit in 13th-month basic', 'checkbox'), section('Contribution & withholding tables'), field('contributions.SSS', 'SSS monthly contribution brackets: employee and employer shares (employer share and EC are not deducted from pay)', 'brackets'), field('contributions.PhilHealth', 'PhilHealth monthly contribution brackets: employee and employer shares', 'brackets'), field('contributions.Pag-IBIG', 'Pag-IBIG monthly contribution brackets: employee and employer shares', 'brackets'), field('taxBrackets', 'Withholding brackets for this payroll cutoff', 'brackets', null, 'Tax basis: gross minus attendance deductions, employee contributions, and 13th-month payout. Review any taxable benefit excess as an authorized deduction.'), field('contributionsReviewed', 'Contribution and tax tables reviewed for this effective date', 'checkbox')],
  };
  fields.employees.unshift(field('draft', 'Draft profile — exclude from payroll', 'checkbox', null, 'Keep checked until employment and payroll details are verified.'));
  fields.leaveTypes.push(field('dayBasis', 'Leave entitlement day basis', 'select', [['working', 'Scheduled working days'], ['calendar', 'All calendar days']]));
  const leaveDaysField = fields.leaves.find(f => f.key === 'days');
  leaveDaysField.title = 'Leave days (policy basis)';
  leaveDaysField.hint = 'Count full working or calendar days according to the selected leave policy. Cross-year requests allocate days to each annual balance.';
  fields.rules.push(section('Overtime approval'), field('overtimeApproval', 'Overtime is paid when', 'select', [['separate', 'the employee files it and HR approves it (late clock-out alone is not overtime)'], ['attendance', 'any approved attendance beyond the schedule']]), section('Calendar review & benefit taxation'), field('calendarReviewedYears', 'Holiday calendar years reviewed', 'yearlist', null, 'Comma-separated years, for example 2026, 2027. Add the applicable proclamations in the holiday calendar before confirming a year.'), field('thirteenthTaxExemption', 'Annual tax exemption allocated to 13th-month pay (PHP)', 'number', null, 'Configure the approved exemption after accounting for other benefits using the same exemption. Taxable excess is included automatically.'));
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
  document.documentElement.dataset.theme = 'gds';   // the sign-in screen keeps its approved red-and-gold design
  page = 'dashboard'; currentRun = null;
  stopLive(); portal.reset(); document.querySelector('.install-banner')?.remove();
  app.innerHTML = `<div class="login welcome-login"><header class="welcome-head"><div class="brand"><img class="brand-logo" src="${brandLogo}" alt="GDS Capital Inc. logo" width="661" height="245"></div><div class="eyebrow">Strength in stewardship</div><h1>Welcome to Our Human Resource Management System</h1><p>Your attendance, leave, payslips and HR requests, in one trusted place.</p></header><section class="login-form"><form id="login-form"><div class="auth-brand">GDS CAPITAL INC. / HR WORKSPACE</div><h2>${auth?.setup ? 'Set up your workspace' : 'Welcome back.'}</h2><p>${auth?.setup ? 'Create your administrator account using the one-time setup code shown in your server terminal.' : 'Sign in to your HR workspace or employee portal.'}</p><div id="login-error" class="form-error hidden" role="alert"></div>${auth?.setup ? '<label>One-time setup code<input name="token" type="password" autocomplete="off" required></label>' : ''}<label>Employee ID / username<input name="username" autocomplete="username" required minlength="3" maxlength="80"></label><label>Password<input name="password" type="password" autocomplete="${auth?.setup ? 'new-password' : 'current-password'}" required ${auth?.setup ? 'minlength="12"' : ''} maxlength="200"></label><label>Authenticator code (if enabled)<input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label><button class="primary" type="submit">${auth?.setup ? 'Create administrator account' : 'Sign in'} →</button><button type="button" data-recovery>Forgot password?</button><p class="footnote">${auth?.setup ? 'Use a unique password of at least 12 characters.' : 'Access is managed by your HR administrator.'}<br>Employee records are stored in your HR service.</p></form></section><section class="welcome-body" aria-label="Our culture">${welcomeScene()}${welcomeCulture()}</section></div>`;
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
  openDialog(auth.user.role === 'employee' ? 'Account & security' : 'Account & access', `<div class="dialog-body"><p class="sub">Signed in as ${esc(auth.user.username)}</p><h3>Change your password</h3><form id="password-form" class="form-grid"><label class="field">Current password<input type="password" name="currentPassword" autocomplete="current-password" required></label><label class="field">New password<input type="password" name="newPassword" autocomplete="new-password" minlength="12" maxlength="200" required></label><button class="primary" type="submit">Save new password</button></form>${auth.user.role === 'admin' ? `<br><br><h3>Workspace access</h3><div class="actions"><button data-employee-accounts>Create accounts for all employees</button><span class="legend">Adds a login for every registered employee without one (username = Employee ID). Existing accounts are not changed. Everyone must choose their own password at first sign-in.</span></div>${table(['Username', 'Role'], users.map(u => [esc(u.username), badge({ admin: 'System Administrator', hr: 'HR Manager', hr_staff: 'HR Staff', dept_manager: 'Department Manager', viewer: 'Management', payroll: 'Payroll', employee: 'Employee' }[u.role] || u.role, 'neutral')]))}<br><form id="user-form" class="form-grid"><label class="field">Username<input name="username" minlength="3" required autocomplete="off"></label><label class="field">Role<select name="role"><option value="employee">Employee — own records only</option><option value="hr_staff">HR Staff — day-to-day 201 work</option><option value="maker">Maker — all non-salary employee records</option><option value="hr">HR Manager — people, approvals, attendance &amp; leave</option><option value="dept_manager">Department Manager — own department, view only</option><option value="payroll">Payroll — loans &amp; posting</option><option value="viewer">Management — dashboards &amp; reports</option><option value="admin">System Administrator — all settings</option></select></label><label class="field">Linked employee (Employee and Department Manager)<select name="employeeId"><option value="">Choose employee</option>${state.employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(e.id)}</option>`).join('')}</select></label><label class="field">Initial password<input type="password" name="password" minlength="12" maxlength="200" autocomplete="new-password" required></label><button class="primary" type="submit">Add user</button></form>` : ''}<p class="legend">${auth.user.role === 'employee' ? 'Your account can access only your own employee portal, attendance, leave and payslips.' : 'Staff report access follows your role. Employee accounts can access only their own records. Personal details, IDs, bank details and documents have additional restrictions.'}</p></div>`);
  dialog.querySelector('[data-logout]')?.addEventListener('click', signOut);
  dialog.querySelector('#password-form').onsubmit = async event => { event.preventDefault(); try { await api('/password', Object.fromEntries(new FormData(event.target))); dialog.close(); auth = { user: null }; renderLogin(); toast('Password updated. Please sign in again.'); } catch (e) { toast(e.message); } };
  dialog.querySelector('[data-employee-accounts]')?.addEventListener('click', async () => {
    const password = window.prompt('Default password for the new employee accounts (at least 12 characters). Employees must change it at first sign-in:');
    if (password === null) return;
    try {
      const r = await api('/users/employee-accounts', { password });
      toast(`${r.created.length} account${r.created.length === 1 ? '' : 's'} created · ${r.alreadyHadAccount} already had one${r.skipped.length ? ` · ${r.skipped.length} skipped (username taken: ${r.skipped.map(s => s.name).join(', ')})` : ''}.`);
      await account();
    } catch (error) { toast(error.message); }
  });
  const userForm = dialog.querySelector('#user-form');
  if (userForm) userForm.onsubmit = async event => { event.preventDefault(); try { const values = Object.fromEntries(new FormData(userForm)); if (!['employee', 'dept_manager'].includes(values.role)) delete values.employeeId; await api('/users', values); await account(); toast('User created.'); } catch (e) { toast(e.message); } };
  await portal.accountTools(auth.user, users);
}
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b) return;
  try {
    if (b.hasAttribute('data-recovery')) { portal.recovery(); return; }
    if (b.hasAttribute('data-update-now')) { if (!dialog.open || window.confirm('Close the open form and load the new version? Unsaved changes in it will be lost.')) location.reload(); return; }
    if (b.dataset.portalTab && updateReady && safeToReload()) { location.reload(); return; }
    if (b.dataset.navGroup) {
      payGroupOpen = !payGroupOpen; try { localStorage.setItem('hr-nav-pay', payGroupOpen ? 'open' : 'closed'); } catch { /* preference only */ }
      b.closest('.nav-group').classList.toggle('open', payGroupOpen); b.setAttribute('aria-expanded', String(payGroupOpen)); return;
    }
    if (b.hasAttribute('data-open-drawer')) { mobileDrawer = !document.querySelector('.shell').classList.contains('drawer-open'); document.querySelector('.shell').classList.toggle('drawer-open', mobileDrawer); b.setAttribute('aria-expanded', String(mobileDrawer)); if (mobileDrawer) document.querySelector('.sidebar .nav button')?.focus(); return; }
    if (b.hasAttribute('data-toggle-sidebar')) { sidebarCollapsed = !sidebarCollapsed; try { localStorage.setItem('hr-sidebar', sidebarCollapsed ? 'collapsed' : 'open'); } catch { /* preference only */ } document.querySelector('.shell')?.classList.toggle('collapsed', sidebarCollapsed); b.setAttribute('aria-expanded', String(!sidebarCollapsed)); return; }
    if (b.hasAttribute('data-bell')) {
      const menu = document.querySelector('[data-bell-menu]');
      menu.innerHTML = bellItems.length ? bellItems.map((item, i) => `<button role="menuitem" data-bell-item="${i}">${esc(item.text)}</button>`).join('') : '<p class="muted">Nothing needs your attention.</p>';
      menu.classList.toggle('hidden'); if (!menu.classList.contains('hidden')) markBellSeen(); return;
    }
    if (b.dataset.bellItem) { const item = bellItems[Number(b.dataset.bellItem)]; await goTo({ page: item.nav, docs: item.filter }); return; }
    await portal.click(b, employeeData, liveData);
    if (b.hasAttribute('data-close')) { dialog.close(); return; }
    if (b.dataset.nav && updateReady && safeToReload()) { location.hash = `#/${b.dataset.nav}`; location.reload(); return; }
    if (b.dataset.nav) { page = b.dataset.nav; filter = ''; mobileDrawer = false; render(); }
    if (b.dataset.profile) { page = 'profile'; await profiles.open(b.dataset.profile, 'personal'); }
    if (b.dataset.tab) { subtab = b.dataset.tab; filter = ''; render(); }
    if (b.hasAttribute('data-attendance-import')) { attendanceImport.open(); return; }
    if (b.dataset.attendanceView) { attendanceView = b.dataset.attendanceView; render(); }
    if (b.dataset.add) edit(b.dataset.add);
    if (b.dataset.edit) edit(b.dataset.edit, b.dataset.id);
    if (b.dataset.run) { currentRun = await api(`/runs/${b.dataset.run}`); page = 'payroll'; render(); }
    if (b.dataset.salary && b.dataset.component === 'basic' && currentRun && b.closest('.payroll-computation')) { basicPayDialog(b.dataset.salary); return; }
    if (b.dataset.salary && ['gross', 'net'].includes(b.dataset.component) && currentRun && b.closest('.payroll-computation')) { netPayDialog(b.dataset.salary, b.dataset.component); return; }
    if (b.dataset.salary && b.dataset.component && currentRun) { breakdown.open(currentRun, currentRun.rows.find(x => x.employeeId === b.dataset.salary), b.dataset.component); return; }
    if (b.dataset.salary) await showSalary(b.dataset.salary, b.dataset.component);
    if (b.dataset.payrollEmployee) await showSalary(b.dataset.payrollEmployee);
    if (b.dataset.payslipPreview) await previewPayslip(b.dataset.payslipPreview);
    if (b.dataset.computationContrib) { const id = b.dataset.computationContrib; await contributionEditor.open(id, { onChanged: computationContext ? () => reopenComputation() : () => showSalary(id) }); return; }
    if (b.dataset.manualEntry) { manualEntryDialog(b.dataset.manualEntry); return; }
    if (b.dataset.computationDeduction) { edit('deductions', null, { employeeId: b.dataset.computationDeduction, startDate: currentRun.start }); return; }
    if (b.dataset.computationAdd) edit('adjustments', null, { employeeId: b.dataset.computationAdd, date: currentRun.end, approved: true });
    if (b.hasAttribute('data-account')) await account();
    if (b.hasAttribute('data-signout')) await signOut();
    if (b.dataset.reverseRun) {
      const reason = window.prompt('Reason for reversing this posted payroll (kept in the audit trail):'); if (!reason) return;
      currentRun = await api(`/runs/${b.dataset.reverseRun}/reverse`, { reason }); await refresh(); render(); toast('Payroll reversed. Loan balances restored; the cutoff can be corrected and posted again.'); return;
    }
    if (b.dataset.otDecision) {
      const decision = b.dataset.otDecision;
      let hours;
      if (decision === 'approve') {
        const answer = window.prompt(`Hours to approve (filed ${b.dataset.filed} h; payroll never pays more than the hours worked beyond the schedule):`, b.dataset.hours); if (answer === null) return;
        hours = Number(answer); if (!(hours > 0)) { toast('Enter the hours to approve.'); return; }
      }
      const remarks = window.prompt(decision === 'approve' ? 'Remarks for the employee (optional):' : 'Reason for not approving (the employee will see this):', '');
      if (remarks === null) return;
      await api(`/overtime-requests/${b.dataset.id}/decision`, { decision, remarks, ...(hours ? { hours } : {}) });
      await refresh(); render(); toast(decision === 'approve' ? 'Overtime approved. Payroll will include it.' : 'Overtime rejected. The employee has been notified.'); return;
    }
    if (b.dataset.leaveDecision) {
      const decision = b.dataset.leaveDecision;
      const remarks = decision === 'approve' ? window.prompt('Approve this leave. Remarks for the employee (optional):', '') : window.prompt(decision === 'reject' ? 'Reason for rejecting (the employee will see this):' : 'Reason for cancelling this approved leave (credits will be restored):', '');
      if (remarks === null) return;
      await api(`/leaves/${b.dataset.id}/decision`, { decision, remarks });
      await refresh(); render(); toast({ approve: 'Leave approved. Credits and payroll are updated.', reject: 'Leave rejected. The employee has been notified.', cancel: 'Leave cancelled and credits restored.' }[decision]); return;
    }
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
      openDialog('Finalize payroll', `<div class="dialog-body"><p>Finalize payroll for <strong>${run.start} — ${run.end}</strong>?</p><p>${run.rows.length} employees · Net payroll <strong>${money(run.totals.net)}</strong></p><p>Payslips will appear in employee accounts on salary day, <strong>${esc(payDateFor(run.start, run.end))}</strong>.</p><p class="sub">Once final, this payroll can no longer be edited: amounts, attendance and adjustments for this cutoff are locked, loan balances are updated, and payslips are released. The date, time and your name are recorded in the payroll history. Corrections afterwards go through an adjustment in a later cutoff.</p></div>`, '<div class="dialog-foot"><button data-close>Continue reviewing</button><button class="primary" id="confirm-post">Post payroll</button></div>');
      dialog.querySelector('#confirm-post').onclick = async event => {
        event.target.disabled = true;
        try { currentRun = await api('/payroll/post', { start: run.start, end: run.end, pay13th: run.pay13th, fingerprint: run.fingerprint, ...(run.employeeIds ? { employeeIds: run.employeeIds } : {}) }); await refresh(); dialog.close(); render(); openDialog('Payroll finalized', `<div class="dialog-body confirm-box"><p class="confirm-icon" aria-hidden="true">🔒</p><p>Payroll for <strong>${esc(currentRun.start)} — ${esc(currentRun.end)}</strong> is final.<br>Finalized on ${esc(new Date(currentRun.postedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }))} by ${esc(currentRun.postedBy)}. It can no longer be edited.</p></div>`, '<div class="dialog-foot"><button class="primary" data-close>OK</button></div>'); }
        catch (e) { toast(e.message); event.target.disabled = false; }
      };
    }
  } catch (e) { toast(e.message); }
});
// Semi-monthly cutoffs: choosing a start date fills the matching end (1st → 15th, 16th → last day of the month),
// so a payroll is never run over a whole month by mistake (manual entries are saved per cutoff).
document.addEventListener('change', event => {
  const input = event.target; if (input.name !== 'start' || !input.closest('#cutoff-form') || !input.value) return;
  const [y, m, d] = input.value.split('-').map(Number), end = input.closest('form').elements.end;
  const startDay = d <= 15 ? 1 : 16, last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  input.value = `${y}-${String(m).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  end.value = `${y}-${String(m).padStart(2, '0')}-${String(startDay === 1 ? 15 : last).padStart(2, '0')}`;
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
try { auth = await api('/session'); if (auth.user) await refresh(); if (auth.user && readRoute()) await applyRoute(); else render(); }
catch (e) { app.innerHTML = `<div class="loading"><h1>Unable to connect</h1><p>${esc(e.message)}</p><p>Check that the HR service is running, then reload this page.</p></div>`; }
document.addEventListener('input', event => {
  if (!event.target.matches('[data-contribution-salary]')) return;
  const panel = event.target.closest('[data-contribution-rule]'), rule = state.rules.find(r => r.id === panel.dataset.contributionRule);
  panel.querySelector('[data-contribution-result]').innerHTML = event.target.value === '' ? '' : renderCalculation(rule, Number(event.target.value), { table });
});
document.addEventListener('change', event => { if (event.target.id === 'employee-status-filter') { employeeStatusFilter = event.target.value; render(); } });
setupInstall();
