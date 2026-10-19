import { messagesButton } from './messages.js';
const componentNames = { basic: 'Basic salary', regularOT: 'Regular overtime', restDay: 'Rest day pay', restOT: 'Rest day overtime', nsd: 'Night shift differential', specialHoliday: 'Special holiday pay', specialOT: 'Special holiday overtime', regularHoliday: 'Regular / double holiday pay', regularHolidayOT: 'Holiday overtime', otherHoliday: 'Other holiday pay', otherOT: 'Other holiday overtime', allowance: 'Allowances', additional: 'Additional pay', thirteenth: '13th month pay', late: 'Late deduction', undertime: 'Undertime', absence: 'Unpaid leave / absence', tax: 'Withholding tax', loans: 'Loan deductions', other: 'Other authorized deductions', SSS: 'SSS', PhilHealth: 'PhilHealth', 'Pag-IBIG': 'Pag-IBIG' };
// Common reasons for an attendance explanation (late, undertime, missed clock-in/out). "Other" lets the employee type one.
const EXPLANATION_REASONS = ['Traffic / transportation delay', 'Medical / health reason', 'Family emergency', 'Official business / client meeting', 'Work from home / field work', 'Forgot to time in or time out', 'System or device problem (GPS / app / internet)', 'Weather / natural calamity', 'Approved schedule change'];
// Employee menu order: me first, then time, pay and company items.
// Employee menu icons (outline).
const MENU_ICON = {
  dashboard: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1Z"/>',
  profile201: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  files201: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  attendance: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  overtime201: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.5 1.5M10 3h4M12 3v3.5"/>',
  leave: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>',
  payslips: '<path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21Z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  loans201: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h4"/>',
  memos: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  trainings: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5"/>',
  account: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z"/>',
  signout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
};
const menuIcon = id => `<svg class="em-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${MENU_ICON[id] || MENU_ICON.memos}</svg>`;
const MENU_GROUPS = [['', ['dashboard', 'profile201', 'files201']], ['Time &amp; attendance', ['attendance', 'overtime201', 'leave']], ['Pay', ['payslips', 'loans201']], ['Company', ['memos', 'trainings']]];
export function createPortal(ctx) {
  const { api, esc, money, toast, openDialog, dialog, refresh, render, app, today } = ctx;
  const table = (headers, rows, empty = 'Nothing to show yet.') => ctx.table(headers, rows, empty);
  let attendanceView = 'history';
  let tab = 'dashboard', currentPayslip = null, dirty = false, liveFilter = 'All', pendingClock = null, historyOverride = null, historyEnd = false;
  let clockTimer;
  const clockTime = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const clockDate = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  function updateClock() {
    const clock = app.querySelector('[data-ph-clock]');
    if (!clock) { clearInterval(clockTimer); clockTimer = null; return; }
    const now = new Date();
    clock.dateTime = now.toISOString(); clock.textContent = clockTime.format(now);
    app.querySelector('[data-ph-date]').textContent = clockDate.format(now);
  }
  const stamp = date => date ? new Date(date).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—';
  const field = (key, label, type = 'text', value = '', extra = '') => `<label class="field">${label}<input name="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const card = (label, value) => `<div class="card"><div class="card-label">${label}</div><div class="card-value">${esc(value)}</div></div>`;
  // Notification bell: the count shows updates since the employee last opened it (remembered on this device only).
  const SEEN_KEY = id => `gds-hr-notifications-seen:${id}`;
  const lastSeen = id => { try { return localStorage.getItem(SEEN_KEY(id)) || ''; } catch { return ''; } };
  const markSeen = (id, at) => { try { localStorage.setItem(SEEN_KEY(id), at); } catch { /* storage unavailable: the count simply stays */ } };
  const bell = (data) => {
    const list = data.notifications || [], seen = lastSeen(data.employee.id), unread = list.filter(n => n.at > seen).length;
    return `<span class="bell-wrap employee-bell"><button class="icon-button portal-bell tb-btn tb-bell" data-portal-bell aria-label="Notifications${unread ? ` (${unread} new)` : ''}" aria-haspopup="true" aria-expanded="false"><svg class="tb-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/><path d="M12 3v2"/></svg>${unread ? `<span class="bell-count">${unread > 9 ? '9+' : unread}</span>` : ''}</button><div class="bell-menu hidden" data-portal-bell-menu role="menu"><strong class="bell-title">Notifications</strong><ul class="portal-notifications">${list.slice(0, 20).map(n => `<li class="${n.at > seen ? 'unread' : ''}">${esc(n.message)}<small>${stamp(n.at)}</small></li>`).join('') || '<li>No notifications yet.</li>'}</ul></div></span>`;
  };
  // A confirmation that stays until the employee taps OK (toasts are easy to miss on a phone).
  const confirmBox = (title, message) => openDialog(title, `<div class="dialog-body confirm-box"><p class="confirm-icon" aria-hidden="true">✅</p><p>${message}</p></div>`, '<div class="dialog-foot"><button class="primary" data-close>OK</button></div>');
  const attachmentSelect = data => `<label class="field">Supporting document<select name="documentId"><option value="">None</option>${data.documents.filter(d => d.status === 'Active').map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></label>`;
  function gpsCell(event) { return event && event.latitude !== null ? `<button class="small" data-location="${esc(event.id)}">${event.latitude.toFixed(6)}, ${event.longitude.toFixed(6)}</button>${[event.geofence.status && event.geofence.status !== 'Not configured' ? esc(event.geofence.status) : ''].filter(Boolean).length ? `<small>${[event.geofence.status && event.geofence.status !== 'Not configured' ? esc(event.geofence.status) : ''].filter(Boolean).join(' · ')}</small>` : ''}` : 'No device location'; }
  function history(data) {
    const events = historyOverride || data.history;
    return `<section class="panel"><div class="panel-head"><h2>My attendance locations</h2>${downloads('my-attendance')}<span class="legend">Original events · Asia/Manila</span></div>${table(['Date / time', 'Event', 'Location & accuracy', 'Synchronized'], events.map(e => [`${e.workDate}<br>${e.time}`, e.correctedBy ? `HR correction by ${esc(e.correctedBy)}` : e.kind === 'in' ? 'Time in' : 'Time out', gpsCell(e), stamp(e.synchronizedAt)]))}${events.length >= 200 && !historyEnd ? '<div class="panel-foot"><button data-earlier-history>Load earlier events</button></div>' : ''}</section><section class="panel"><div class="panel-head"><h2>Attendance corrections</h2></div>${table(['Date', 'Reason', 'Corrected by / approver', 'Changes'], data.corrections.map(c => [stamp(c.at), esc(c.reason), `${esc(c.correctedBy)} / ${esc(c.approver)}`, `<details><summary>Original → correction</summary><pre>${esc(JSON.stringify({ original: c.before, correction: c.after }, null, 2))}</pre></details>`]))}</section>`;
  }
  // Line icons for the time card buttons (white on red).
  const svg = d => `<svg class="btn-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    in: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M3 4l3 3"/>'),
    out: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l-3 2"/><path d="M21 4l-3 3"/>'),
    away: svg('<circle cx="13" cy="4" r="2"/><path d="M8 21l3-6 3 2v4"/><path d="M6 12l3-4 4 1 3 4h3"/><path d="M11 15l-2-4"/>'),
    leave: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="M9 15l2 2 4-4"/>'),
  };
  function payslipContent(data) {
    const p = currentPayslip;
    return `${(data.upcomingPayslips || []).map(u => `<div class="notice">📅 Your payslip for <strong>${esc(u.start)} → ${esc(u.end)}</strong> will be available on salary day, <strong>${esc(u.payDate)}</strong>.</div>`).join('')}<section class="panel"><div class="panel-head"><h2>My payslips</h2><span class="legend">Released on salary day: the 8th and the 22nd</span></div>${table(['Payroll period', 'Salary day', 'Net salary'], data.payslips.map(p => [`<a class="cutoff-link" href="/api/me/payslips/${esc(p.id)}.pdf?view=1" target="_blank" rel="noopener" title="Open your payslip PDF">${esc(p.start)} → ${esc(p.end)}</a>`, esc(p.payDate || ''), money(p.net)]), 'Your payslips appear here on salary day.')}</section>` + (p ? `<section class="panel"><div class="panel-head"><div><h2>${esc(p.employeeName)}</h2><p>${esc(p.employeeId)} · ${p.start} — ${p.end}</p></div><a class="button" download href="/api/me/payslips/${esc(p.id)}.pdf">Download PDF</a></div>${p.employer ? `<div class="panel-body"><div class="notice"><strong>Employer contributions paid for you by GDS CAPITAL INC.</strong> (not deducted from your pay): SSS ${money(p.employer.SSS)} · SSS EC ${money(p.employer['SSS EC'])} · PhilHealth ${money(p.employer.PhilHealth)} · Pag-IBIG ${money(p.employer['Pag-IBIG'])} · <strong>Total ${money(p.employerTotal)}</strong></div></div>` : ''}<div class="grid2"><div>${table(['Earnings', 'Amount'], Object.entries(p.earnings).map(([key, value]) => [esc(componentNames[key] || key), money(value)]))}</div><div>${table(['Deductions', 'Amount'], p.deductionItems.map(item => [esc(componentNames[item.label] || item.label), money(item.amount)]))}${table(['Loan (included above)', 'Previous balance', 'Deduction', 'Remaining balance'], p.loans.map(l => [esc(`${l.type}${l.reference ? ` (${l.reference})` : ''}`), l.previousBalance == null ? 'Unavailable' : money(l.previousBalance), money(l.amount), l.remainingBalance == null ? 'Unavailable' : money(l.remainingBalance)]), 'No loan deductions for this period.')}</div></div><div class="cards">${card('Gross salary', money(p.gross))}${card('Total deductions', money(p.totalDeductions))}${card('Net salary', money(p.net))}</div><p>Net salary = ${money(p.gross)} gross − ${money(p.totalDeductions)} deductions = ${money(p.net)}</p><h3>Salary computation</h3><p>Monthly salary: ${money(p.monthlySalary)} · Daily rate: ${money(p.dailyRate)} · Hourly rate: ${money(p.hourlyRate)}</p><p>Scheduled days: ${esc(p.workingDays ?? 'Unavailable')} · Days present: ${esc(p.daysPresent ?? 'Unavailable')} · Leave days: ${esc(p.leaveDays ?? 'Unavailable')}</p>${table(['Date', 'Type', 'Component', 'Calculation / reason', 'Amount'], p.computation.map(t => [esc(t.date || ''), esc(t.side), esc(componentNames[t.component] || t.component), esc(t.formula), money(t.amount)]), 'Calculation detail is unavailable for this historical payslip.')}</section>` : '');
  }
  // Own-records downloads; the server only ever returns the signed-in employee's rows.
  const downloads = key => `<span class="download-links" aria-label="Download"><a class="small download-link" href="/api/reports/${key}.xlsx" download>Excel</a><a class="small download-link" href="/api/reports/${key}.pdf" download>PDF</a></span>`;
  const proofLabels = { required: 'Proof needed', submitted: 'Submitted · awaiting HR', verified: '✓ Confirmed by HR', rejected: 'New proof needed' };
  const needsProof = l => ['required', 'rejected'].includes(l.proofStatus) && !['cancelled', 'rejected'].includes(l.status);
  function proofCell(l) {
    if (!l.proofStatus) return '—';
    const view = l.documentReference && l.proofStatus !== 'required' ? ` <a href="/api/me/documents/${esc(l.documentReference)}/content">View</a>` : '';
    const note = l.proofStatus === 'rejected' && l.proofNote ? `<small class="proof-note">HR: ${esc(l.proofNote)}</small>` : '';
    const upload = needsProof(l) ? `<form data-leave-proof="${esc(l.id)}" class="proof-form"><input type="file" name="proofFile" accept="application/pdf,image/png,image/jpeg" required aria-label="Proof file for leave ${esc(l.startDate)}"><button class="small primary">Upload proof</button></form>` : '';
    return `<span class="proof-status proof-${esc(l.proofStatus)}">${proofLabels[l.proofStatus] || esc(l.proofStatus)}</span>${view}${note}${upload}`;
  }
  // Uploads a private Leave Supporting document; only the employee and HR can open it.
  async function uploadProof(file) {
    if (!file || !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a PDF, PNG or JPEG up to 5 MB.');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read the file.')); reader.readAsDataURL(file); });
    return api('/me/documents', { type: 'Leave Supporting', name: file.name, mime: file.type, data, expiry: '', remarks: 'Leave proof' });
  }
  function leaveContent(data) {
    return `<section class="panel"><div class="panel-head"><h2>My leave credits</h2></div>${table(['Leave type', 'Entitled', 'Used / reserved', 'Pending', 'Remaining after pending'], data.balances.map(b => b.perOccasion ? [esc(b.name), b.maxDays ? `Per occasion · up to ${b.maxDays} days` : 'As needed', b.used, b.pending, b.maxDays ? 'Filed per event' : 'No limit'] : [esc(b.name), b.entitled, b.used, b.pending, b.remaining]))}<p class="panel-foot">Pending requests are shown separately. Approval determines the official balance; future approved leave already reserves days.</p></section><section class="panel"><div class="panel-head"><h2>Apply for leave</h2></div><form data-employee-leave><div class="panel-body form-grid"><label class="field">Leave type<select name="typeId" required>${data.balances.map(b => `<option value="${esc(b.typeId)}">${esc(b.name)}${b.documentsRequired ? ' — proof needed (now or on return)' : ''}</option>`).join('')}</select></label>${field('startDate', 'Start date', 'date', today(), 'required')}${field('startTime', 'Start time', 'time', data.today?.scheduledIn || '09:00', 'required')}${field('endDate', 'End date', 'date', today(), 'required')}${field('endTime', 'End time', 'time', data.today?.scheduledOut || '18:00', 'required')}<p class="field-hint full">For a half day, set the times (e.g. 14:00 to 18:00). About half a workday or less counts as 0.5 day.</p>${field('reason', 'Reason', 'text', '', 'required minlength="3" maxlength="2000"')}<label class="field">Proof / supporting document<input type="file" name="proofFile" accept="application/pdf,image/png,image/jpeg"><small class="field-hint">Optional now. For sick leave you can upload your medical certificate when you return to work.</small></label></div><div class="panel-foot"><button class="primary" ${data.employee.draft || !data.balances.length ? 'disabled' : ''}>Submit leave request</button></div></form></section><section class="panel"><div class="panel-head"><h2>My applications</h2>${downloads('my-leaves')}</div>${table(['Dates', 'Leave', 'Days', 'Status', 'HR remarks', 'Proof', ''], data.leaves.map(l => [`${l.startDate}${l.startTime ? ` ${l.startTime}` : ''} → ${l.endDate}${l.endTime ? ` ${l.endTime}` : ''}`, esc(data.balances.find(b => b.typeId === l.typeId)?.name || l.typeId), l.days, esc(l.status), l.hrRemarks ? `<span class="wrap">${esc(l.hrRemarks)}</span>` : '—', proofCell(l), l.status === 'pending' ? `<button class="small" data-cancel-leave="${esc(l.id)}">Cancel request</button>` : '']))}</section>`;
  }
  // History, explanations and supporting documents all concern attendance, so they share one tab.
  function attendanceContent(data) {
    const views = [['history', 'My attendance records', '🕒'], ['explanations', 'Explanations', '📝'], ['documents', 'Supporting documents', '📁']];
    const body = attendanceView === 'explanations' ? explanationContent(data) : attendanceView === 'documents' ? documentContent(data) : history(data);
    return `<nav class="portal-subtabs" aria-label="Attendance">${views.map(([id, label, icon]) => `<button data-attendance-view="${id}" class="${id === attendanceView ? 'active' : ''}" ${id === attendanceView ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span> ${label}</button>`).join('')}</nav><div id="attendance-${attendanceView}" class="attendance-section">${body}</div>`;
  }
  // One explanation with its comments; the employee gets a reply box when HR sent it back.
  function explanationCard(e, view) {
    const STATUS = { pending: ['Waiting for HR review', 'pending'], returned: ['Sent back by HR · reply needed', 'rejected'], approved: ['Approved', ''], rejected: ['Rejected', 'rejected'] };
    const [label, kind] = STATUS[e.status] || [e.status, 'neutral'];
    const thread = (e.comments || []).map(c => `<div class="expl-comment ${c.side}"><strong>${c.side === 'hr' ? 'HR' : view === 'employee' ? 'You' : 'Employee'}</strong> · <small>${esc(stamp(c.at))}</small><p>${esc(c.text)}</p></div>`).join('');
    const reply = view === 'employee' && e.status === 'returned' ? `<form class="expl-reply" data-explanation-reply="${esc(e.id)}"><textarea name="comment" required minlength="3" maxlength="2000" placeholder="Reply to HR"></textarea><button class="primary">Send reply</button></form>` : '';
    const decided = ['approved', 'rejected'].includes(e.status) ? `<p class="legend">HR decision: ${esc(e.note || '—')}${e.status === 'approved' ? ` · offset ${e.approvedOffset} min` : ''}</p>` : '';
    return `<article class="expl-card"><header><strong>${esc(e.date)}</strong> · ${esc(e.reason)} <span class="badge ${kind}">${esc(label)}</span></header><p>${esc(e.explanation)}</p>${thread}${decided}${reply}</article>`;
  }
  function explanationContent(data) {
    return `<section class="panel"><div class="panel-head"><h2>Submit attendance explanation</h2><span class="legend">Offsets apply only after HR approval</span></div><form data-employee-explanation><div class="panel-body form-grid">${field('date', 'Attendance date', 'date', data.today.date, 'required')}<label class="field">Reason<select name="reason" required data-reason-select><option value="">Choose a reason…</option>${EXPLANATION_REASONS.map(r => `<option>${esc(r)}</option>`).join('')}<option value="Other">Other (please specify)</option></select></label><label class="field hidden" data-reason-other>Other reason<input name="reasonOther" maxlength="200"></label><label class="field">Explanation<textarea name="explanation" required minlength="3" maxlength="2000"></textarea></label>${field('requestedOffset', 'Requested offset (minutes)', 'number', '0', 'required min="0" max="1440"')}${attachmentSelect(data)}</div><div class="panel-foot"><button class="primary" ${data.employee.draft ? 'disabled' : ''}>Submit explanation</button></div></form></section><section class="panel"><div class="panel-head"><h2>My explanations</h2></div>${data.explanations.length ? `<div class="panel-body expl-list">${data.explanations.map(e => explanationCard(e, 'employee')).join('')}</div>` : '<p class="muted panel-body">Nothing to show yet.</p>'}</section>`;
  }
  function documentContent(data) {
    return `<section class="panel"><div class="panel-head"><h2>Supporting documents</h2><span class="legend">For leave and attendance explanations</span></div><form data-employee-upload><div class="panel-body form-grid"><label class="field">File<input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required></label>${field('remarks', 'Remarks', 'text', '', 'maxlength="1000"')}</div><div class="panel-foot"><button class="primary">Upload supporting document</button><span class="legend">PDF, PNG or JPEG · Maximum 5 MB · Visible to you and HR</span></div></form>${table(['File', 'Uploaded', ''], data.documents.map(d => [esc(d.name), stamp(d.uploadedAt), `<a href="/api/me/documents/${esc(d.id)}/content">Download</a>`]))}</section>`;
  }
  function dashboardContent(data) {
    const t = data.today;
    const owed = data.leaves.filter(needsProof);
    const proofReminder = owed.length ? `<div class="notice proof-reminder" role="status"><strong>Proof needed for ${owed.length === 1 ? 'your leave' : `${owed.length} leave requests`}</strong> — ${owed.map(l => `${esc(data.balances.find(b => b.typeId === l.typeId)?.name || l.typeId)} ${esc(l.startDate)}${l.proofStatus === 'rejected' ? ' (HR asked for a new one)' : ''}`).join(', ')}. Upload your medical certificate or other proof. <button class="small" data-portal-tab="leave">Upload proof</button></div>` : '';
    return `${proofReminder}${data.employee.draft ? '<div class="notice">Your employee profile needs HR setup. You can view your portal, but attendance and leave submission will be available after HR completes your employment details.</div>' : ''}${t.exceptions.length ? `<div class="notice">Attendance exception: ${t.exceptions.map(esc).join(' · ')}</div>` : ''}<section class="pm-card pm-loc"><h2>Today’s location records</h2>${[t.clockIn, t.clockOut].filter(Boolean).map(e => `<div class="pm-loc-row"><svg class="pm-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg><div><span>${e.kind === 'in' ? 'Time in' : 'Time out'}</span><small>GPS coordinates</small></div><div class="pm-loc-right"><strong>${esc(e.time)}</strong><code>${e.latitude !== null && e.latitude !== undefined ? `${Number(e.latitude).toFixed(6)}, ${Number(e.longitude).toFixed(6)}` : 'No device location'}</code></div></div>`).join('') || '<p class="muted">No time in yet today.</p>'}</section><p class="pm-foot">GDS Capital · Employee workspace</p>`;
  }
  // Time in / Time out comes first, right after sign-in.
  function clockSection(data) {
    const t = data.today;
    const todays = (data.explanations || []).filter(e => e.date === t.date), returned = todays.find(e => e.status === 'returned'), explained = todays.some(e => ['pending', 'approved'].includes(e.status));
    const kind = t.open ? 'out' : 'in', done = data.employee.draft || (t.actualOut && t.date === today()), net = data.network || {}, away = net.configured && !net.office;
    const chip = { Late: 'late', Present: 'ok', 'Missing time out': 'late', Absent: 'late', 'On leave': 'leave' }[t.status] || 'idle';
    const alertIcon = '<svg class="pm-ico pm-alert-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>';
    const lateBox = returned ? `<div class="pm-alert">${alertIcon}<div><strong>HR sent back your explanation</strong><small>${esc((returned.comments || []).at(-1)?.text || '')}</small></div><button class="pm-link" data-portal-tab="explanations">Reply to HR →</button></div>`
      : t.late && !explained ? `<div class="pm-alert">${alertIcon}<div><strong>${t.late} minute${t.late === 1 ? '' : 's'} late</strong><small>Scheduled ${esc(t.scheduledIn)} · Recorded ${esc(t.actualIn)}</small><small>For HR review.</small></div><button class="pm-link" data-portal-tab="explanations">Submit explanation →</button></div>` : '';
    const graceBox = !lateBox && t.graceLate && !t.actualOut ? `<div class="pm-alert pm-grace">${alertIcon}<div><strong>${t.graceLate} minute${t.graceLate === 1 ? '' : 's'} late · within the grace period</strong><small>Stay until ${esc(t.offsetUntil)} to offset it. Minutes not offset are deducted from your salary.</small></div></div>` : '';
    const tile = (label, value) => `<div class="pm-tile"><span>${label}</span><strong>${value}</strong></div>`;
    const netLine = net.configured ? `<p class="net-status ${net.office ? 'ok' : 'away'}">${net.office ? '📶 Connected to the office Wi-Fi' : '⚠ Not connected to the office Wi-Fi'}</p>` : '';
    return `<section class="pm-card pm-attend"><div class="pm-attend-head"><div><h2>Today’s attendance</h2><p>Work schedule ${esc(t.scheduledIn || '—')} – ${esc(t.scheduledOut || '—')}${t.arrangement === 'WFH' ? ' · Work from home' : t.arrangement === 'Hybrid' ? ' · Hybrid' : ''}</p></div><span class="pm-chip pm-${chip}">${esc(t.status)}</span></div>
      ${lateBox}${graceBox}${t.lateLetter ? `<div class="pm-alert">${alertIcon}<div><strong>Explanation letter required</strong><small>${esc(t.lateLetter.message)}</small><small>Late 15+ minutes on: ${t.lateLetter.dates.map(d => esc(d.slice(5))).join(', ')}</small></div><button class="pm-link" data-portal-tab="explanations">Submit explanation →</button></div>` : ''}
      <div class="pm-tiles">${tile('Actual time in', esc(t.actualIn || '—'))}${tile('Actual time out', esc(t.actualOut || '—'))}${tile('Working hours', `${t.hours} h`)}${tile('Undertime', `${t.undertime} min`)}</div>
      <div class="clock-actions pm-actions">${netLine}<button class="primary clock-btn" data-clock="${kind}" ${done || away ? 'disabled' : ''}>${t.open ? ICON.out : ICON.in}<span>${t.open ? 'Time out' : 'Time in'}</span></button>${done ? '' : `<button class="clock-btn clock-outside pm-outline" data-clock-outside="${kind}">${ICON.away}<span>Out of office time ${kind}</span></button>`}<small>${away ? `Connect to the office Wi-Fi to time ${kind}, or use Out of office (needs HR approval).` : 'Uses your current device location. Allow location access when prompted.'}</small></div>
      ${data.employee.draft ? '' : `<button class="pm-row" data-file-unpaid>${ICON.leave}<span>File leave / absence</span><svg class="pm-ico pm-chev" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m9 6 6 6-6 6"/></svg></button>`}</section>`;
  }
  function draw(data, auth) {
    if (!data) return;
    const hrTabs = ctx.portalHr?.tabs || [], isHr = hrTabs.some(([key]) => key === tab);
    const tabs = [['dashboard', 'My dashboard', '🏠'], ['attendance', 'Attendance', '🕒'], ['leave', 'My leave', '🌴'], ['payslips', 'My payslips', '💰'], ...hrTabs];
    const content = isHr ? '<div id="portal-hr"><div class="loading">Loading…</div></div>' : tab === 'attendance' ? attendanceContent(data) : tab === 'leave' ? leaveContent(data) : tab === 'payslips' ? payslipContent(data) : dashboardContent(data);
    app.innerHTML = `<div class="employee-shell"><header class="employee-top"><button class="employee-menu-button" data-portal-menu aria-controls="employee-sidebar" aria-expanded="false" aria-label="Open menu">☰</button><img class="portal-logo" src="${ctx.brandLogo}" alt="GDS Capital Inc. logo"><span class="employee-top-spacer" aria-hidden="true"></span><div class="employee-top-actions">${messagesButton()}${bell(data)}</div></header><div class="employee-body"><div class="employee-scrim" data-portal-menu-close hidden></div><aside class="employee-sidebar em-side" id="employee-sidebar" aria-label="Employee menu"><div class="em-user"><span class="em-avatar"><span class="em-ini">${esc(String(data.employee.greetingName || data.employee.name).split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 1).concat(String(data.employee.greetingName || '').split(/\s+/).filter(Boolean).slice(-1).map(s => s[0])).join('').toUpperCase())}</span><img src="/api/hr/me/photo" alt="" data-own-photo></span><span class="em-who"><strong>${esc(data.employee.greetingName || data.employee.name)}</strong><small>Employee account</small></span></div><nav>${MENU_GROUPS.map(([heading, ids]) => { const items = ids.map(id => tabs.find(x => x[0] === id)).filter(Boolean); return items.length ? `<div class="em-group">${heading ? `<span class="employee-menu-heading">${heading}</span>` : ''}${items.map(([id, label]) => `<button data-portal-tab="${id}" class="${id === tab ? 'active' : ''}" ${id === tab ? 'aria-current="page"' : ''}>${menuIcon(id)}<span>${label}</span></button>`).join('')}</div>` : ''; }).join('')}</nav><div class="employee-sidebar-foot"><button data-account>${menuIcon('account')}<span>Account &amp; security</span></button><button class="sidebar-signout em-signout" data-signout>${menuIcon('signout')}<span>Sign out</span></button></div></aside><main class="employee-main">${auth.demo ? '<div class="notice">Preview workspace · Sample payroll data · Changes do not update live records.</div>' : ''}${tab === 'dashboard' ? `<section class="employee-welcome pm-welcome"><div class="employee-welcome-copy"><span class="eyebrow">Employee workspace</span><div class="pm-hello"><span class="pm-me"><img src="/api/hr/me/photo" alt="" data-own-photo></span><h1>Welcome, ${esc(String(data.employee.greetingName || data.employee.name).split(' ')[0])}!</h1></div><p class="pm-fullname">${esc(data.employee.greetingName || data.employee.name)}</p></div><img class="welcome-mascot" src="/welcome-mascot.png" width="180" height="196" alt="Red-and-gold company mascot welcoming you with an outstretched hand"></section><div class="philippine-clock pm-clock" aria-label="Philippine time clock"><span class="clock-zone">🇵🇭 Philippine Time · <b>UTC+8</b></span><time data-ph-clock aria-live="off"></time><span data-ph-date class="clock-date"></span></div>` : !['profile201', 'attendance'].includes(tab) ? '' : `<div class="portal-page-head"><span aria-hidden="true">${(tabs.find(x => x[0] === tab) || [])[2] || ''}</span><h1>${(tabs.find(x => x[0] === tab) || [])[1] || ''}</h1></div>`}${tab === 'dashboard' ? `<div class="clock-block">${clockSection(data)}</div>` : ''}<div id="portal-content">${content}</div></main></div></div>`;
    clearInterval(clockTimer); updateClock(); clockTimer = setInterval(updateClock, 1000);
    // Own photo: hidden when there is none (the initials stay).
    app.querySelectorAll('[data-own-photo]').forEach(img => { img.addEventListener('error', () => img.parentElement.classList.add('no-photo')); img.addEventListener('load', () => img.parentElement.classList.add('has-photo')); });
    const sidebar = app.querySelector('#employee-sidebar'), scrim = app.querySelector('.employee-scrim'), menuButton = app.querySelector('[data-portal-menu]');
    const setMenu = open => { sidebar.classList.toggle('open', open); scrim.hidden = !open; menuButton.setAttribute('aria-expanded', String(open)); };
    menuButton.onclick = () => setMenu(!sidebar.classList.contains('open'));
    scrim.onclick = () => setMenu(false);
    sidebar.addEventListener('click', event => { if (event.target.closest('[data-portal-tab]')) setMenu(false); });
    // Phones: swipe the menu left to close it; swipe right from the left edge of the screen to open it.
    let touch = null;
    const swipeStart = event => { const p = event.touches[0]; touch = { x: p.clientX, y: p.clientY, open: sidebar.classList.contains('open') }; };
    const swipeEnd = event => {
      if (!touch) return; const p = event.changedTouches[0], dx = p.clientX - touch.x, dy = Math.abs(p.clientY - touch.y);
      if (dy < 60 && touch.open && dx < -50) setMenu(false);
      else if (dy < 60 && !touch.open && touch.x < 30 && dx > 50) setMenu(true);
      touch = null;
    };
    app.addEventListener('touchstart', swipeStart, { passive: true });
    app.addEventListener('touchend', swipeEnd, { passive: true });
    const bellButton = app.querySelector('[data-portal-bell]'), bellMenu = app.querySelector('[data-portal-bell-menu]');
    if (bellButton) {
      const setOpen = open => { bellMenu.classList.toggle('hidden', !open); bellButton.setAttribute('aria-expanded', String(open)); };
      bellButton.onclick = event => {
        event.stopPropagation(); const opening = bellMenu.classList.contains('hidden'); setOpen(opening);
        if (opening && data.notifications?.length) { markSeen(data.employee.id, data.notifications[0].at); bellButton.querySelector('.bell-count')?.remove(); }
      };
      bellMenu.onclick = event => event.stopPropagation();
      app.querySelector('.employee-main').addEventListener('click', () => setOpen(false));
    }
    if (isHr) ctx.portalHr.fill(tab, app.querySelector('#portal-hr'));
    if (tab === 'dashboard') ctx.portalHr?.celebrations(app.querySelector('.employee-main'));
    ctx.portalHr?.compliance(app, tab === 'dashboard');
    app.querySelectorAll('form').forEach(form => { form.oninput = () => { dirty = true; }; form.onchange = () => { dirty = true; }; form.onsubmit = submitForm; });
    app.querySelector('[data-reason-select]')?.addEventListener('change', event => { const other = app.querySelector('[data-reason-other]'); const show = event.target.value === 'Other'; other.classList.toggle('hidden', !show); other.querySelector('input').required = show; });
    async function submitForm(event) {
      event.preventDefault(); const form = event.target, b = form.querySelector('button'); b.disabled = true;
      let confirmation = null;
      try {
        const values = Object.fromEntries(new FormData(form));
        if (form.hasAttribute('data-employee-leave')) {
          const file = form.elements.proofFile?.files[0]; delete values.proofFile;
          if (file) values.documentId = (await uploadProof(file)).id;
          await api('/me/leaves', values);
          const typeName = data.balances?.find(x => x.typeId === values.typeId)?.name || 'Leave';
          confirmation = ['Leave request submitted', `Your <strong>${esc(typeName)}</strong> request for <strong>${esc(values.startDate)}${values.endDate && values.endDate !== values.startDate ? ` to ${esc(values.endDate)}` : ''}</strong> was sent to HR.<br>Status: <strong>Pending HR approval</strong>. You will be notified here when HR decides.`];
        }
        if (form.dataset.leaveProof) {
          const uploaded = await uploadProof(form.elements.proofFile.files[0]);
          await api(`/me/leaves/${form.dataset.leaveProof}/proof`, { documentId: uploaded.id });
          confirmation = ['Leave proof uploaded', 'Your proof was attached to the leave request.<br>Status: <strong>Waiting for HR review</strong>.'];
        }
        if (form.dataset.explanationReply) { await api(`/me/explanations/${form.dataset.explanationReply}/reply`, { comment: values.comment }); confirmation = ['Reply sent', 'Your reply was sent to HR. The explanation is back in HR\'s review list.']; }
        if (form.hasAttribute('data-employee-explanation')) {
          if (values.reason === 'Other') { values.reason = String(values.reasonOther || '').trim(); if (values.reason.length < 3) throw new Error('Type the other reason (at least 3 characters).'); }
          delete values.reasonOther; await api('/me/explanations', { ...values, requestedOffset: Number(values.requestedOffset) }); confirmation = ['Explanation submitted', 'Your explanation was sent to HR for review. You will be notified here when HR decides.']; }
        if (form.hasAttribute('data-employee-upload')) {
          const file = form.elements.file.files[0]; if (!file || file.size > 5 * 1024 * 1024) throw new Error('Select a PDF, PNG or JPEG up to 5 MB.');
          const encoded = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read file.')); reader.readAsDataURL(file); });
          await api('/me/documents', { type: 'Leave Supporting', name: file.name, mime: file.type, data: encoded, expiry: '', remarks: values.remarks });
          confirmation = ['Document uploaded', `<strong>${esc(file.name)}</strong> was uploaded and is available to HR.`];
        }
        dirty = false; await refresh(); render();
        if (confirmation) confirmBox(...confirmation); else toast('Submitted successfully. HR receives the update automatically.');
      } catch (error) { toast(error.message); b.disabled = false; }
    }
  }
  // Reads a fresh device position. A precise fix is tried first; if the device times out
  // (common indoors), one standard-accuracy attempt follows. Each failure says what to fix.
  function capturePosition() {
    const read = options => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const reasons = {
      1: ios ? 'Location permission is blocked for Safari. On your iPhone open Settings → Privacy & Security → Location Services → Safari Websites, choose "While Using the App", then reload this page and tap Allow.'
             : 'Location permission is blocked for this site. Click the icon left of the address bar, set Location to Allow, then reload this page.',
      2: 'Your device could not determine its location. Turn on Wi-Fi and location services, move near a window, and try again.',
      3: 'Finding your location took too long. Move near a window or turn on Wi-Fi, then try again.',
    };
    const fail = error => new Error(`${reasons[error?.code] || 'Location could not be captured.'} No attendance was recorded.`);
    return read({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
      .catch(error => error?.code === 3 ? read({ enableHighAccuracy: false, maximumAge: 0, timeout: 15000 }) : Promise.reject(error))
      .catch(error => Promise.reject(fail(error)));
  }
  async function clock(kind, button, extra = { mode: 'office', reason: '' }) {
    button.disabled = true; button.textContent = 'Getting your location…'; dirty = true;
    try {
      if (!navigator.geolocation) throw new Error('This browser does not support location capture. Contact HR.');
      if (!pendingClock || pendingClock.kind !== kind || pendingClock.mode !== extra.mode) {
        const location = await capturePosition();
        pendingClock = { kind, ...extra, requestId: crypto.randomUUID(), latitude: location.coords.latitude, longitude: location.coords.longitude, accuracy: location.coords.accuracy, capturedAt: new Date(location.timestamp).toISOString() };
      }
      const recordedAt = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date());
      await api('/me/clock', pendingClock); pendingClock = null; dirty = false; await refresh(); render();
      confirmBox(`Time ${kind} submitted`, `Your <strong>${extra.mode === 'outside' ? 'out-of-office ' : ''}time ${kind}</strong> at <strong>${recordedAt}</strong> was recorded with your location and sent to HR${extra.mode === 'outside' ? ' for approval' : ''}.${kind === 'in' ? '<br>Remember to time out at the end of your shift.' : '<br>Thank you, have a good rest!'}`);
    } catch (error) { if (!/fetch|network|connect/i.test(error.message)) pendingClock = null; dirty = false; toast(error.message); button.disabled = false; button.textContent = `Retry time ${kind}`; }
  }
  function map(event) {
    if (event.latitude === null) { toast('This HR correction has no device GPS reading. The original time-in remains in history.'); return; }
    openDialog('Attendance location', `<div class="dialog-body"><h3>${esc(event.employeeId)} · ${event.workDate} ${event.time}</h3><p>GPS: ${event.latitude}, ${event.longitude}<br>Device accuracy: ±${event.accuracy} meters${event.geofence.status !== 'Not configured' ? `<br>Geofence: ${esc(event.geofence.status)}${event.geofence.distance !== null ? ` · ${event.geofence.distance} m from workplace` : ''}` : ''}<br>Captured: ${stamp(event.capturedAt)}<br>Server recorded: ${stamp(event.recordedAt)}<br>Synchronized: ${stamp(event.synchronizedAt)}</p><p>Approved workplace: ${esc(event.approvedLocation || 'Not configured')}<br>Reverse-geocoded address: <span id="location-address">${esc(event.address || 'Not available')}</span></p><p class="legend">GPS is device-reported and may be inaccurate. Loading the map sends these coordinates to OpenStreetMap.</p><button id="load-location-map">Load interactive map</button><div id="location-map"></div></div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
    dialog.querySelector('#load-location-map').onclick = () => {
      const x = event.longitude, y = event.latitude, bounds = [Math.max(-180, x - .004), Math.max(-90, y - .004), Math.min(180, x + .004), Math.min(90, y + .004)].join(',');
      dialog.querySelector('#location-map').innerHTML = `<iframe class="attendance-map" title="Recorded attendance location" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bounds)}&amp;layer=mapnik&amp;marker=${encodeURIComponent(`${y},${x}`)}"></iframe>`;
    };
    const lookup = document.createElement('button'); lookup.textContent = 'Look up address using configured HR provider'; lookup.className = 'small';
    dialog.querySelector('#location-address').after(lookup);
    lookup.onclick = async () => { lookup.disabled = true; try { const result = await api(`/location-address/${event.id}`, {}); dialog.querySelector('#location-address').textContent = result.address || result.message; } catch (error) { toast(error.message); } finally { lookup.disabled = false; } };
  }
  // countsOnly: just the heading and today's counts (HR dashboard); each count opens the Live Attendance page.
  // Live attendance: count cards (click to filter), search + status / location filters, and one row per employee
  // with an initials badge, a status pill, time in / out, a location link, Details and a ⋮ menu of actions.
  const SVG = {
    all: '<path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.7 0-6 1.3-6 3.5V19h12v-2.5C14 14.3 10.7 13 8 13Zm8 0c-.3 0-.7 0-1.1.1A4.4 4.4 0 0 1 16 16.5V19h6v-2.5c0-2.2-3.3-3.5-6-3.5Z"/>',
    present: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 4.5V21h10.3a6 6 0 0 1-.3-2 6 6 0 0 1 .6-2.6A13 13 0 0 0 12 14Zm8.3 1.3-3.6 3.6-1.6-1.6-1.1 1.1 2.7 2.7 4.7-4.7Z"/>',
    late: '<path d="M12 3a9 9 0 1 0 9 9 9 9 0 0 0-9-9Zm0 16.2A7.2 7.2 0 1 1 19.2 12 7.2 7.2 0 0 1 12 19.2Zm.9-11.7h-1.8v5.1l4.4 2.6.9-1.5-3.5-2.1Z"/>',
    absent: '<path d="M10 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 4.5V21h16v-2.5c0-2.8-4.7-4.5-8-4.5Zm12.3-5.9-1.4-1.4-1.9 1.9-1.9-1.9-1.4 1.4 1.9 1.9-1.9 1.9 1.4 1.4 1.9-1.9 1.9 1.9 1.4-1.4-1.9-1.9Z"/>',
    leave: '<path d="M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-10-2h4v2h-4Zm10 14H4v-5h6v2h4v-2h6Zm0-7H4V9h16Z"/>',
    missing: '<path d="M12 2 1 21h22Zm0 4.2L19.5 19h-15Zm-1 4.8v4h2v-4Zm0 5v2h2v-2Z"/>',
    check: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1.4 14.6-4.2-4.2 1.4-1.4 2.8 2.8 5.8-5.8 1.4 1.4Z"/>',
    pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 2.4L17.6 8H14ZM8 12h8v1.6H8Zm0 3.4h8V17H8Z"/>',
    search: '<path d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1-5 5 5 5 0 0 1 5-5Z"/>',
    export: '<path d="M12 3 7 8l1.4 1.4L11 6.8V15h2V6.8l2.6 2.6L17 8Zm-7 13v4h14v-4h-2v2H7v-2Z"/>',
    dots: '<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>',
  };
  const icon = (name, cls = '') => `<svg class="lv-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${SVG[name]}</svg>`;
  const STATUS_LOOK = { Present: ['present', 'check'], Late: ['late', 'late'], Absent: ['absent', 'absent'], 'On leave': ['leave', 'leave'], 'Missing time out': ['missing', 'missing'] };
  const initialsOf = name => { const [last, first] = String(name).split(',').map(x => x.trim()); return `${(first || '').charAt(0)}${(last || '').charAt(0)}`.toUpperCase() || '?'; };
  // Search, status and location filters hide rows in place (no redraw, so typing is not interrupted).
  const filterLive = panel => {
    const q = panel.querySelector('[data-lv-search]').value.trim().toLowerCase(), st = panel.querySelector('[data-lv-status]').value, loc = panel.querySelector('[data-lv-loc]').value;
    let shown = 0;
    for (const r of panel.querySelectorAll('[data-lv-row]')) { const ok = (!q || r.dataset.name.includes(q)) && (!st || r.dataset.status === st) && (!loc || r.dataset.loc === loc); r.hidden = !ok; if (ok) shown++; }
    panel.querySelector('[data-lv-count]').textContent = `${shown} employee${shown === 1 ? '' : 's'} total`;
  };
  for (const type of ['input', 'change']) document.addEventListener(type, e => { const panel = e.target.closest?.('.lv'); if (panel && e.target.matches('[data-lv-search], [data-lv-status], [data-lv-loc]')) filterLive(panel); });
  function live(data, { countsOnly = false } = {}) {
    const statuses = ['All', 'Present', 'Late', 'Absent', 'On leave', 'Missing time out'];
    const count = s => (s === 'All' ? data.employees.length : data.employees.filter(e => e.status === s).length);
    const CARD = { All: ['all', 'All employees'], Present: ['present', 'Present'], Late: ['late', 'Late'], Absent: ['absent', 'Absent'], 'On leave': ['leave', 'On leave'], 'Missing time out': ['missing', 'Missing time out'] };
    const filtered = data.employees.filter(e => liveFilter === 'All' || e.status === liveFilter);
    const located = e => !!(e.clockOut || e.clockIn) && (e.clockOut || e.clockIn).latitude !== null;
    const row = e => {
      const [look, pill] = STATUS_LOOK[e.status] || ['idle', 'late'], ev = e.clockOut || e.clockIn;
      // Request: what this person is waiting on HR for (explanations, out of office; overtime is added by the Attendance page).
      const expl = (data.explanations || []).filter(x => x.employeeId === e.employeeId && ['pending', 'returned'].includes(x.status));
      const away = (data.outOfOffice || []).filter(x => x.employeeId === e.employeeId);
      const requests = [
        ...expl.map(x => x.status === 'returned' ? `<span class="lv-req lv-req-wait">Explanation ${esc(x.date.slice(5))} · sent back</span>` : `<button class="lv-req" data-review-explanation="${esc(x.id)}">Explanation ${esc(x.date.slice(5))} · Review</button>`),
        ...away.map(x => `<span class="lv-req-group"><span class="lv-req-label">Out of office · time ${esc(x.kind)} ${esc(x.time)}</span><button class="lv-req ok" data-oof-review="approve" data-id="${esc(x.id)}">Approve</button><button class="lv-req" data-oof-review="reject" data-id="${esc(x.id)}">Reject</button></span>`),
        ...(e.status === 'Missing time out' && e.open ? [`<button class="lv-req" data-correct-clock="${esc(e.employeeId)}" data-date="${e.date}">Correct missing time out</button>`] : []),
      ];
      return `<tr data-lv-row data-name="${esc(`${e.name} ${e.employeeId}`.toLowerCase())}" data-status="${esc(e.status)}" data-loc="${located(e) ? 'yes' : 'no'}">
        <td><button class="lv-emp" data-profile="${esc(e.employeeId)}" title="Open 201 profile"><span class="lv-avatar lv-${look}">${esc(initialsOf(e.name))}</span><span><strong>${esc(e.name)}</strong><small>${esc(e.employeeId)}</small></span></button></td>
        <td><span class="lv-pill lv-${look}">${icon(pill)}${esc(e.status)}</span></td>
        <td class="lv-time">${esc(e.actualIn || '—')}</td><td class="lv-time">${esc(e.actualOut || '—')}</td>
        <td>${located(e) ? `<button class="lv-loc" data-location="${esc(ev.id)}">${icon('pin')}<span>View location</span></button>` : '<span class="lv-muted">No location</span>'}</td>
        <td class="lv-requests" data-lv-req="${esc(e.employeeId)}">${requests.join('') || '<span class="lv-muted">—</span>'}</td></tr>`;
    };
    const html = `<section class="panel live-panel lv">
      <div class="lv-head"><div><h2>Live attendance</h2><p>Today's employee attendance</p></div><div class="lv-head-tools"><span class="lv-live"><i></i>Live</span><a class="lv-btn" href="/api/reports/daily-attendance.pdf?date=${esc(data.employees[0]?.date || '')}&view=1" target="_blank" rel="noopener">${icon('export')}Export</a></div></div>
      <div class="lv-cards">${statuses.map(s => `<button data-live-filter="${s}" class="lv-card${s === liveFilter ? ' active' : ''}"><span class="lv-card-ico lv-${CARD[s][0]}">${icon(CARD[s][0])}</span><span><strong>${count(s)}</strong><small>${CARD[s][1]}</small></span></button>`).join('')}</div>
      <div class="lv-filters"><label class="lv-search">${icon('search')}<input type="search" data-lv-search placeholder="Search name or employee ID" aria-label="Search name or employee ID"></label>
        <select data-lv-status aria-label="Status"><option value="">Status</option>${[...new Set(data.employees.map(e => e.status))].sort().map(s => `<option>${esc(s)}</option>`).join('')}</select>
        <select data-lv-loc aria-label="Location"><option value="">Location</option><option value="yes">With location</option><option value="no">No location</option></select></div>
      <div class="lv-table-wrap"><table class="lv-table"><thead><tr><th>Employee</th><th>Status</th><th>Time in</th><th>Time out</th><th>Location</th><th>Request</th></tr></thead><tbody>${filtered.map(row).join('') || '<tr><td colspan="6" class="empty">Nothing to show.</td></tr>'}</tbody></table></div>
      <p class="lv-foot" data-lv-count>${filtered.length} employee${filtered.length === 1 ? '' : 's'} total</p></section>`;
    if (!countsOnly) return html;
    // Dashboard: today's attendance at a glance.
    const glance = { All: ['all', 'All'], Present: ['dot-green', 'Present'], Late: ['dot-amber', 'Late'], Absent: ['late', 'Absent'], 'On leave': ['leave', 'On leave'], 'Missing time out': ['missing', 'Missing time out'] };
    const when = new Date().toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric' });
    return `<section class="panel db-live"><div class="db-live-head"><div><h2>Today's attendance <span class="lv-live"><i></i>Live</span></h2><p>Live attendance at a glance · ${esc(when)}</p></div><button class="db-open" data-nav="live">Open live attendance ↗</button></div><div class="db-live-stats">${statuses.map(s => { const [k, label] = glance[s]; return `<button data-nav="live" title="Open live attendance"><span class="db-live-label">${k.startsWith('dot') ? `<i class="db-dot ${k}"></i>` : icon(k)}${label}</span><strong>${count(s)}</strong></button>`; }).join('')}</div></section>`;
  }
  // Opens the leave form with a type chosen, e.g. the dashboard's unpaid leave / absence shortcut.
  function preselectLeave(typeId, attempts = 20) {
    const select = document.querySelector('[data-employee-leave] [name="typeId"]');
    if (!select) { if (attempts) setTimeout(() => preselectLeave(typeId, attempts - 1), 100); return; }
    if ([...select.options].some(o => o.value === typeId)) { select.value = typeId; select.dispatchEvent(new Event('change', { bubbles: true })); }
    select.closest('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
    select.closest('form').querySelector('[name="startDate"]')?.focus({ preventScroll: true });
  }
  async function click(button, employeeData, liveData) {
    if (button.dataset.portalTab) {
      // Older links point at the merged sections; open the Attendance tab at that section.
      const section = ['explanations', 'documents'].includes(button.dataset.portalTab) ? button.dataset.portalTab : null;
      if (section) attendanceView = section; else if (button.dataset.portalTab === 'attendance') attendanceView = 'history';
      // My 201 file opens on Documents; "Enter number" / data sheet links open its Data sheet sub-tab.
      let target = button.dataset.portalTab;
      if (target === 'datasheet') { ctx.portalHr?.showDatasheet?.(); target = 'files201'; } else if (target === 'files201') ctx.portalHr?.showDocuments?.();
      tab = section ? 'attendance' : target; dirty = false; render(); window.scrollTo({ top: 0 });
    }
    if (button.dataset.attendanceView) { attendanceView = button.dataset.attendanceView; dirty = false; render(); }
    if (button.dataset.attendanceJump) { attendanceView = button.dataset.attendanceJump; dirty = false; render(); }
    if (button.hasAttribute('data-file-unpaid')) { tab = 'leave'; dirty = false; render(); preselectLeave(''); /* opens the leave form; the employee picks the leave type */ }
    if (button.dataset.clock) await clock(button.dataset.clock, button);
    if (button.dataset.oofReview) {
      const decision = button.dataset.oofReview, note = decision === 'reject' ? window.prompt('Reason for rejecting this out-of-office time record:', '') : '';
      if (note === null) return;
      try { await api(`/clock/${button.dataset.id}/review`, { decision, note }); toast(decision === 'approve' ? 'Approved. The employee was notified.' : 'Rejected. The employee was notified.'); await refresh(); render(); } catch (error) { toast(error.message); }
      return;
    }
    if (button.dataset.clockOutside) {
      // Out of office: the reason goes to HR / Admin for approval with the time and location.
      const kind = button.dataset.clockOutside;
      const PURPOSES = ['Client meeting', 'Field work / site visit', 'Bank or government errand', 'Delivery or pick-up', 'Training or seminar', 'Work from home (approved)', 'Company event', 'Other'];
      openDialog(`Out of office time ${kind}`, `<form class="dialog-body form-grid" id="oof-form"><p class="full">You are timing ${kind} outside the office. HR or Admin will review it.</p><label class="field full">Purpose<select name="purpose" required><option value="">Choose the purpose…</option>${PURPOSES.map(x => `<option>${x}</option>`).join('')}</select></label><label class="field full">Reason / details<textarea name="details" required minlength="3" maxlength="450" placeholder="e.g. Meeting with ABC Corp. in Makati until 3 PM"></textarea></label><button class="primary full" type="submit">Submit time ${kind}</button></form>`);
      dialog.querySelector('#oof-form').onsubmit = async event => {
        event.preventDefault();
        const f = new FormData(event.target), reason = `${String(f.get('purpose') || '').trim()} — ${String(f.get('details') || '').trim()}`;   // e.g. "Client meeting — ABC Corp. in Makati"
        const submit = event.target.querySelector('button[type="submit"]');
        dialog.close();
        await clock(kind, document.querySelector(`[data-clock-outside="${kind}"]`) || submit, { mode: 'outside', reason });
      };
    }
    if (button.dataset.cancelLeave) { await api(`/me/leaves/${button.dataset.cancelLeave}/cancel`, {}); await refresh(); render(); confirmBox('Leave request cancelled', 'Your pending leave request was cancelled. No leave credits were used.'); }
    if (button.dataset.ownPayslip) { currentPayslip = await api(`/me/payslips/${button.dataset.ownPayslip}`); render(); }
    if (button.dataset.location) { const event = [...(historyOverride || employeeData?.history || []), ...(liveData?.history || [])].find(e => e.id === button.dataset.location); if (event) map(event); }
    if (button.hasAttribute('data-earlier-history')) { const current = historyOverride || employeeData.history; const earlier = await api(`/me/history?before=${encodeURIComponent(current.at(-1).id)}`); historyOverride = [...current, ...earlier]; historyEnd = earlier.length < 200; render(); }
    if (button.dataset.liveFilter) { liveFilter = button.dataset.liveFilter; render(); }
    if (button.dataset.reviewExplanation) {
      const explanation = liveData.explanations.find(e => e.id === button.dataset.reviewExplanation);
      openDialog('Review attendance explanation', `<form id="explanation-review"><div class="dialog-body form-grid"><div class="full">${explanationCard(explanation, 'hr')}</div><label class="field">Decision<select name="status" data-expl-decision><option value="approved">Approve</option><option value="rejected">Reject</option><option value="returned">Send back to the employee with a comment</option></select></label>${field('approvedOffset', 'Approved offset (minutes)', 'number', explanation.requestedOffset, `min="0" max="${explanation.requestedOffset}" required`)}${field('note', 'Review reason', 'text', '', 'required minlength="3" maxlength="2000"')}</div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save decision</button></div></form>`, '');
      dialog.querySelector('form').onsubmit = async event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); try { if (values.status === 'returned') await api(`/explanations/${explanation.id}/return`, { comment: values.note }); else await api(`/explanations/${explanation.id}/review`, { ...values, approvedOffset: Number(values.approvedOffset) }); dialog.close(); toast(values.status === 'returned' ? 'Sent back to the employee with your comment.' : 'Decision saved.'); await refresh(); render(); } catch (error) { toast(error.message); } };
      const decision = dialog.querySelector('[data-expl-decision]'), noteBox = dialog.querySelector('[name=note]'), offsetBox = dialog.querySelector('[name=approvedOffset]');
      decision.onchange = () => { const back = decision.value === 'returned'; offsetBox.closest('label').classList.toggle('hidden', back); offsetBox.required = !back; noteBox.closest('label').firstChild.textContent = back ? 'Comment to the employee' : 'Review reason'; };
    }
    if (button.dataset.correctClock) {
      const employeeId = button.dataset.correctClock, date = button.dataset.date;
      openDialog('Correct missing time out', `<form id="clock-correction"><div class="dialog-body form-grid"><p>${esc(employeeId)} · ${date}<br>The original GPS time-in remains unchanged. Review unpaid breaks before payroll approval.</p>${field('timeOut', 'Corrected time out', 'time', '', 'required')}<label class="field"><input type="checkbox" name="endNextDay">Time out is the following day</label>${field('reason', 'Correction reason', 'text', '', 'required minlength="3" maxlength="2000"')}</div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save correction</button></div></form>`, '');
      dialog.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = event.target; try { await api('/live/correct', { employeeId, date, timeOut: form.elements.timeOut.value, endNextDay: form.elements.endNextDay.checked, reason: form.elements.reason.value }); dialog.close(); await refresh(); render(); } catch (error) { toast(error.message); } };
    }
  }
  // Forgot password. With `token` (from an emailed link) only the new-password step is shown.
  function recovery(token = '') {
    const requestStep = `<p>Enter your username, Employee ID or registered email. We will email a one-time reset link to the email registered on your account.</p><form id="request-recovery" autocomplete="off">${field('identifier', 'Username, Employee ID or email', 'text', '', 'required maxlength="80" autocomplete="username" autocapitalize="none" spellcheck="false"')}<button class="primary">Email me a reset link</button></form><p class="legend">No email on file, or it did not arrive? HR will verify your identity and give you a one-time reset code.</p><hr><h3>Have a reset code from HR?</h3>`;
    const resetStep = `<form id="redeem-recovery" autocomplete="off">${token ? `<p>Choose a new password for your account. The link works once.</p><input type="hidden" name="token" value="${esc(token)}">` : field('token', 'One-time reset code', 'text', '', 'required maxlength="64" autocomplete="one-time-code" autocapitalize="none" spellcheck="false"')}${field('password', 'New password (at least 9 characters)', 'password', '', 'required minlength="9" maxlength="200" autocomplete="new-password"')}${field('confirm', 'Confirm new password', 'password', '', 'required minlength="9" maxlength="200" autocomplete="new-password"')}<button class="primary">Reset password</button></form>`;
    openDialog(token ? 'Set a new password' : 'Forgot password', `<div class="dialog-body">${token ? '' : requestStep}${resetStep}</div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
    dialog.querySelector('#request-recovery')?.addEventListener('submit', async event => { event.preventDefault(); try { const result = await api('/recovery/request', Object.fromEntries(new FormData(event.target))); toast(result.message); } catch (e) { toast(e.message); } });
    dialog.querySelector('#redeem-recovery').onsubmit = async event => {
      event.preventDefault();
      const { token: code, password, confirm } = Object.fromEntries(new FormData(event.target));
      if (password !== confirm) { toast('The two passwords do not match.'); return; }
      try { await api('/recovery/reset', { token: code.trim(), password }); dialog.close(); toast('Password reset. Sign in with your new password.'); } catch (e) { toast(e.message); }
    };
  }
  async function accountTools(user, users) {
    const container = document.createElement('section'); container.className = 'portal-account-tools';
    const requests = user.role === 'admin' ? await api('/recovery/requests') : [];
    container.innerHTML = `<div class="acc-boxes"><details class="acc-box"><summary><span class="acc-icon">🔐</span><span><strong>Two-factor authentication</strong><small>${user.mfaEnabled ? 'On' : 'Off'} · authenticator app</small></span></summary><form id="mfa-form" class="form-grid">${field('password', 'Current password', 'password', '', 'required autocomplete="current-password"')}<label class="field">Action<select name="action">${user.mfaEnabled ? '<option value="disable">Disable two-factor authentication</option>' : '<option value="begin">Generate setup key</option><option value="confirm">Confirm setup key</option>'}</select></label>${field('code', 'Authenticator code', 'text', '', 'inputmode="numeric" maxlength="6" autocomplete="one-time-code"')}<button class="primary">Update two-factor settings</button></form><div id="mfa-result" class="secret-result"></div></details>${user.role === 'admin' ? `<details class="acc-box"><summary><span class="acc-icon">🔑</span><span><strong>Employee access &amp; recovery</strong><small>${users.length} accounts · reset password, delete</small></span></summary>${requests.length ? `<div class="notice">Recovery requested: ${requests.map(r => esc(r.username)).join(', ')}</div>` : ''}<label class="inline-check reset-mfa"><input id="reset-mfa" type="checkbox"> Also reset the authenticator (only after verifying a lost device)</label><div class="account-table">${table(['Complete name', 'Reset email', 'Access', 'Actions'], users.map(u => [`<strong>${esc(u.name || u.username)}</strong>`, u.resetEmail ? esc(u.resetEmail) : '<small>None — recovery goes to HR</small>', (u.disabled ? '<span class="badge neutral">Disabled</span>' : '<span class="badge">Enabled</span>') + (u.signedIn ? '<small class="signed-in">● Signed in on a device</small>' : ''), `<span class="account-actions"><button class="small" data-user-reset="${esc(u.id)}" title="Issues a one-time code (15 minutes) the person uses to set a new password">Reset password</button>${u.id !== user.id ? `<button class="small danger" data-user-delete="${esc(u.id)}" data-username="${esc(u.username)}">Delete account</button>` : ''}</span>`]))}</div><div id="reset-result" class="secret-result" role="status"></div></details>` : ''}</div>`;
    dialog.querySelector('.dialog-body').append(container);
    container.querySelector('#mfa-form').onsubmit = async event => {
      event.preventDefault(); const form = event.target;
      try {
        const result = await api('/mfa', Object.fromEntries(new FormData(form)));
        if (result.secret) { container.querySelector('#mfa-result').innerHTML = `<p>Add this key to your authenticator app. Issuer: GDS CAPITAL INC. Account: ${esc(user.username)}. Use six digits, a 30-second period and SHA-1.</p><code>${esc(result.secret)}</code><p>Choose “Confirm setup key” and enter its current code to finish.</p>`; form.elements.action.value = 'confirm'; }
        else { ctx.onSecurityReset(); toast('Security settings updated. Sign in again.'); }
      } catch (error) { toast(error.message); }
    };
    container.onclick = async event => {
      const button = event.target.closest('button'); if (!button) return;
      try {
        if (button.dataset.userSignout) {
          if (!window.confirm('Sign this account out of its device? The person can then sign in on another device.')) return;
          await api(`/users/${button.dataset.userSignout}/sign-out`, {});
          button.textContent = 'Signed out ✓'; button.disabled = true; button.closest('tr')?.querySelector('.signed-in')?.remove();
          return;
        }
        if (button.dataset.userReset) {
          const result = await api(`/users/${button.dataset.userReset}/reset`, { resetMfa: container.querySelector('#reset-mfa').checked });
          container.querySelector('#reset-result').innerHTML = `<p>${esc(result.message)}</p><code>${esc(result.token)}</code><p>Expires: ${stamp(result.expires)}</p>`;
        }
        if (button.dataset.userEmail) {
          const email = window.prompt('Email for password reset links (leave blank to use the employee profile email):', button.dataset.current);
          if (email === null) return;
          await api(`/users/${button.dataset.userEmail}/email`, { email: email.trim() }); toast(email.trim() ? 'Reset email saved.' : 'Account email cleared.'); await ctx.reloadAccount();
        }
        if (button.dataset.userDelete) {
          const typed = window.prompt(`Delete the login account "${button.dataset.username}"? This cannot be undone. Employee records and the audit trail are kept.\n\nType the username to confirm:`);
          if (typed === null) return;
          await api(`/users/${button.dataset.userDelete}/delete`, { confirm: typed }); toast('Account deleted.'); await ctx.reloadAccount(); return;
        }
        if (button.dataset.userAccess) { await api(`/users/${button.dataset.userAccess}/access`, { disabled: button.dataset.disabled === 'true' }); await ctx.reloadAccount(); }
      } catch (error) { toast(error.message); }
    };
  }
  return { draw, live, click, recovery, accountTools, isEditing: () => dirty, reset: () => { clearInterval(clockTimer); clockTimer = null; dirty = false; tab = 'dashboard'; currentPayslip = null; pendingClock = null; historyOverride = null; historyEnd = false; } };
}
