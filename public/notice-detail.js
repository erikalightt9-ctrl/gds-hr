// Employee notification bell: what a notice is about, the record behind it (from the employee's own dashboard data)
// and the portal section that holds it. Notices are stored as text, so each kind is recognised from its wording.
const DATE = /(\d{4}-\d{2}-\d{2})/;
const manilaDate = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(iso));
const STATUS = { pending: 'Waiting for HR', approved: 'Approved', rejected: 'Not approved', returned: 'Sent back to you', cancelled: 'Cancelled' };
const statusText = status => STATUS[status] || status || '';

// [pattern, title, icon, portal tab, details(match, data, notice) → [label, value][]]
const KINDS = [
  [/^Time (in|out) recorded at (\d{2}:\d{2})/, 'Time in / out', '🕒', 'attendance', (m, data, n) => clockRows(data, manilaDate(n.at), m[1], m[2])],
  [/out-of-office time (in|out) on (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}) was (\w+)/i, 'Out of office time in / out', '📍', 'attendance', (m, data) => [...clockRows(data, m[2], m[1], m[3]), ['HR decision', m[4][0].toUpperCase() + m[4].slice(1)]]],
  [/HR updated attendance for (\d{4}-\d{2}-\d{2})/, 'Attendance updated by HR', '🕒', 'attendance', (m, data) => attendanceRows(data, m[1])],
  [/explanation|late on \d{4}/i, 'Attendance explanation', '📝', 'explanations', (m, data, n) => explanationRows(data, n.message.match(DATE)?.[1])],
  [/leave/i, 'Leave', '🌴', 'leave', (m, data, n) => leaveRows(data, n.message.match(DATE)?.[1])],
  [/payslip|payroll for/i, 'Payslip', '💰', 'payslips', (m, data, n) => payslipRows(data, n.message.match(DATE)?.[1])],
  [/overtime/i, 'Overtime', '⏱️', 'overtime201', () => []],
  [/loan/i, 'Loan', '💳', 'loans201', () => []],
  [/data sheet/i, 'Data sheet', '🗂️', 'datasheet', () => []],
  [/201 document/i, '201 document', '📁', 'files201', () => []],
  [/supporting document/i, 'Supporting document', '📎', 'documents', () => []],
  [/memo/i, 'Memo', '📝', 'memos', () => []],
  [/training/i, 'Training', '🎓', 'trainings', () => []],
];
const TAB_LABEL = { attendance: 'Attendance', explanations: 'Attendance explanations', leave: 'My leave', payslips: 'My payslips', overtime201: 'My overtime', loans201: 'My loans', datasheet: 'My data sheet', files201: 'My 201 file', documents: 'Supporting documents', memos: 'Memos', trainings: 'Trainings' };

function clockRows(data, date, kind, time) {
  const event = (data.history || []).find(e => e.workDate === date && e.kind === kind && e.time === time) || (data.history || []).find(e => e.kind === kind && e.time === time);
  if (!event) return [['Date', date], [kind === 'out' ? 'Time out' : 'Time in', time]];
  return [['Date', event.workDate], [kind === 'out' ? 'Time out' : 'Time in', event.time], ['Where', event.outOfOffice ? 'Out of office' : event.atOffice ? 'Office' : 'Recorded'],
    ...(event.place ? [['Location', event.place]] : []), ...(event.reason ? [['Reason', event.reason]] : [])];
}
function attendanceRows(data, date) {
  const a = (data.attendance || []).find(x => x.date === date);
  if (!a) return [['Date', date]];
  return [['Date', date], ['Status', a.status], ...(a.status === 'present' ? [['Time in', a.timeIn], ['Time out', `${a.timeOut}${a.endNextDay ? ' (next day)' : ''}`]] : [])];
}
function explanationRows(data, date) {
  const e = (data.explanations || []).find(x => x.date === date);
  if (!e) return date ? [['Date', date]] : [];
  const hr = (e.comments || []).filter(c => c.side === 'hr').at(-1);
  return [['Date', e.date], ['Status', statusText(e.status)], ['Reason', e.reason], ['Your explanation', e.explanation], ...(hr ? [['HR comment', hr.text]] : [])];
}
function leaveRows(data, date) {
  const l = (data.leaves || []).find(x => x.startDate === date) || (data.leaves || []).find(x => (x.countedDates || []).includes(date));
  if (!l) return date ? [['Date', date]] : [];
  const type = (data.balances || []).find(b => b.typeId === l.typeId)?.name || l.typeId;
  return [['Leave type', type], ['Dates', l.endDate && l.endDate !== l.startDate ? `${l.startDate} to ${l.endDate}` : l.startDate], ['Days', String(l.days ?? '')], ['Status', statusText(l.status)], ...(l.hrRemarks ? [['HR remarks', l.hrRemarks]] : [])];
}
function payslipRows(data, start) {
  const p = (data.payslips || []).find(x => x.start === start), upcoming = (data.upcomingPayslips || []).find(x => x.start === start);
  if (p) return [['Cutoff', `${p.start} to ${p.end}`], ['Salary day', p.payDate], ['Net pay', `₱${Number(p.net).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]];
  if (upcoming) return [['Cutoff', `${upcoming.start} to ${upcoming.end}`], ['Salary day', upcoming.payDate], ['Status', 'Available on salary day']];
  return [];
}

export function noticeDetail(notice, data) {
  const kind = KINDS.find(([re]) => re.test(notice.message));
  if (!kind) return { title: 'Notification', icon: '🔔', rows: [], tab: null, tabLabel: '' };
  const [re, title, icon, tab, details] = kind;
  const rows = (() => {
    try { return details(notice.message.match(re), data, notice).filter(([, v]) => v !== undefined && v !== null && v !== ''); } catch { return []; /* details are a convenience; the notice itself still shows */ }
  })();
  return { title, icon, rows, tab, tabLabel: TAB_LABEL[tab] || '' };
}
