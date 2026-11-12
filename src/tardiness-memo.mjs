// Monthly tardiness reminder: on (or after) the 5th of each month, Philippine Time, the previous calendar month is
// reviewed. Every employee with 3 or more workdays on which they timed in 15 minutes or more after that day's scheduled
// start receives a memo (on the GDS letterhead, acknowledgement required), with a bell notice; HR and admins are told
// and the memo stays in the employee's 201 file. Occurrences covered by an approved offset still count: the offset only
// protects pay. The memo imposes no deduction or penalty. One memo per employee per month; everything is audited.
import { scheduleOn, isRest, ruleOn } from './engine.mjs';
import { issueSystemMemo } from './memos.mjs';
import { remittanceOnlyIds } from './remittance-only.mjs';
import { renderMemoPdf } from './memo-pdf.mjs';
import { EXPLAIN_AFTER_MINUTES } from './late-explanations.mjs';

export const TARDY_MINUTES = EXPLAIN_AFTER_MINUTES, TARDY_OCCASIONS = 3, MEMO_DAY = 5;
const ISSUER = 'system (monthly tardiness memo)';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const manila = now => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock12 = t => { const h = Number(t.slice(0, 2)); return `${h % 12 || 12}:${t.slice(3, 5)} ${h < 12 ? 'AM' : 'PM'}`; };
const niceDate = d => { const [y, m, day] = d.split('-').map(Number); const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, day)).getUTCDay()]; return `${MONTHS[m - 1].slice(0, 3)} ${day}, ${y} (${wd})`; };
export const monthLabel = ym => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const previousMonth = day => { const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

// The qualifying late workdays of one employee in a month (corrected attendance; each date once).
export function tardiness(store, state, employee, month) {
  const profile = state.employeeProfiles?.find(p => p.employeeId === employee.id && p.section === 'attendance') || {};
  const days = new Map();
  for (const a of state.attendance.filter(x => x.employeeId === employee.id && x.date.startsWith(month) && x.status === 'present' && x.timeIn)) days.set(a.date, { timeIn: a.timeIn, scheduledIn: a.scheduledIn, offset: a.offsetMinutes || 0 });
  for (const c of (state.openClockIns || []).filter(x => x.employeeId === employee.id && x.workDate.startsWith(month) && !days.has(x.workDate))) days.set(c.workDate, { timeIn: c.time, scheduledIn: '', offset: 0 });
  const out = [];
  for (const [date, d] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
    if (isRest(employee, date)) continue;
    const s = scheduleOn(employee, profile, date, ruleOn(state, date));
    const start = d.scheduledIn || s.start;
    if (s.flexible || !start) continue;   // a flexible day has no start time to be late for
    const late = toMin(d.timeIn) - toMin(start);
    if (late >= TARDY_MINUTES) out.push({ date, scheduledIn: start, timeIn: d.timeIn, minutesLate: late, approvedOffset: d.offset });
  }
  return out;
}

const companyName = store => { try { return JSON.parse(store.db.prepare('SELECT data FROM hr_settings LIMIT 1').get()?.data || '{}').company?.name || 'GDS CAPITAL INC.'; } catch { return 'GDS CAPITAL INC.'; } };
const displayName = (store, e) => {
  const p = JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='personal'").get(e.id)?.data || '{}');
  const [last, first = ''] = e.name.split(',').map(x => x.trim());
  return [p.firstName || first, p.middleName ? `${p.middleName[0]}.` : '', p.lastName || last].filter(Boolean).join(' ');
};

// The memo text (the approved wording) and its PDF on the letterhead.
export function tardinessMemo(store, employee, month, occurrences, issueDate) {
  const label = monthLabel(month), company = companyName(store), name = displayName(store, employee), n = occurrences.length;
  const subject = `Monthly Tardiness Reminder — ${label}`;
  const [y, m] = month.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const period = `${MONTHS[m - 1]} 1–${last}, ${y}`;
  const intro = `Our attendance records show that you reported for work ${TARDY_MINUTES} minutes or more after your scheduled start time on ${n} occasions during ${label}. The relevant dates and attendance details are listed below.`;
  const after = [
    `Under our attendance policy, three or more qualifying tardiness occurrences within a calendar month trigger this reminder. These occurrences remain part of your attendance record even when the time lost is covered by an approved offset.`,
    `Please observe your assigned schedule and take the necessary steps to improve punctuality. If any listed attendance entry is incorrect, contact HR for review.`,
    `Please acknowledge receipt through your employee account. Acknowledgment confirms receipt of this memo and does not prevent you from requesting a correction.`,
    `This memo is an attendance reminder. It does not by itself impose a salary deduction or a disciplinary penalty.`,
  ];
  const rows = occurrences.map(o => [niceDate(o.date), clock12(o.scheduledIn), clock12(o.timeIn), `${o.minutesLate} min`, o.approvedOffset ? `${o.approvedOffset} min` : '—']);
  const body = [`Subject: ${subject}`, '', `Dear ${name},`, '', intro, '', `Attendance period: ${period}`,
    ...rows.map(r => `• ${r[0]} — scheduled ${r[1]}, time in ${r[2]}, ${r[3]} late${r[4] !== '—' ? ` (approved offset ${r[4]})` : ''}`),
    `Total qualifying occurrences: ${n}`, '', ...after.flatMap(t => [t, '']), 'Human Resources', company].join('\n');
  const pdf = (reference) => renderMemoPdf({
    reference, date: niceDate(issueDate).replace(/ \(.*\)$/, ''), to: `${name} (${employee.id})`, from: 'Human Resources', subject,
    paragraphs: [`Dear ${name},`, intro, `Attendance period: ${period}`],
    table: { headers: ['Date', 'Scheduled start', 'Time in', 'Minutes late', 'Approved offset'], widths: [32, 20, 16, 16, 18], rows: [...rows, ['Total qualifying occurrences', '', '', String(n), '']] },
    after, signature: ['Human Resources', company],
  });
  return { subject, body, pdf };
}

// Runs the monthly review when due; safe to call often (each employee and month is handled once).
export function runTardinessMemos(store, now = new Date()) {
  const today = manila(now);
  if (Number(today.slice(8, 10)) < MEMO_DAY) return [];
  const month = previousMonth(today), monthEnd = `${month}-31`, issued = [];
  const state = store.read();
  const remitOnly = remittanceOnlyIds(store);
  for (const e of state.employees.filter(x => !x.draft && !remitOnly.has(x.id) && !x.archived && x.startDate && x.startDate <= monthEnd && (!x.endDate || x.endDate >= today))) {
    const key = `tardiness-memo:${month}:${e.id}`;
    if (store.db.prepare('SELECT 1 FROM hr_counters WHERE key=?').get(key)) continue;
    const occurrences = tardiness(store, state, e, month);
    if (occurrences.length < TARDY_OCCASIONS) continue;
    store.transaction(() => {
      if (!store.db.prepare('INSERT OR IGNORE INTO hr_counters(key,value) VALUES(?,1)').run(key).changes) return;   // already issued
      const draft = tardinessMemo(store, e, month, occurrences, today);
      const memo = issueSystemMemo(store, { title: draft.subject, category: 'Advisory / Reminder', body: draft.body, employeeIds: [e.id], issueDate: today, issuedBy: ISSUER, kind: 'tardiness', pdf: draft.pdf, pdfName: `{ref} Tardiness reminder ${monthLabel(month)} ${e.id}.pdf` });
      store.notify(null, `Monthly tardiness memo ${memo.reference} sent to ${e.name} (${occurrences.length} occasions in ${monthLabel(month)}); acknowledgement pending.`);
      store.log({ username: ISSUER }, 'issue-tardiness-memo', 'memos', memo.id, null, { employeeId: e.id, month, occurrences: occurrences.map(o => o.date), reference: memo.reference });
      issued.push({ employeeId: e.id, month, reference: memo.reference, occurrences: occurrences.length });
    });
  }
  return issued;
}
