// Admin dashboard figures (Nov 25, 2026 design). Everything is read from existing records with the same rules the rest of
// the system uses: today's numbers from Live attendance, the monthly attendance rate from each timekeeping employee's
// day-by-day statuses (attendance-summary.mjs), workforce composition from the 201 employment classification, document
// compliance from the 201 checklists, recent activities from the audit trail, upcoming events from the holiday
// calendar, salary days and trainings.
import { permit } from './service.mjs';
import { DASHBOARD } from './roles.mjs';
import { workforce } from './workforce.mjs';
import { liveDashboard } from './portal.mjs';
import { attendanceSummary } from './attendance-summary.mjs';
import { documentSummary } from './documents201.mjs';
import { trainingSummary } from './trainings.mjs';
import { payDateFor } from './paydays.mjs';
import { fullNameOf, staffNames, displayName } from './staff-names.mjs';

const r1 = v => Math.round(v * 10) / 10;
const manilaToday = now => new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const monthsBack = (today, n) => { const out = []; const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); for (let i = 0; i < n; i += 1) { out.unshift(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); } return out; };
const table = (store, name) => !!store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
const cache = new WeakMap();   // monthly rates per store: recomputed at most once a minute

function monthlyRates(store, now) {
  const hit = cache.get(store), key = Math.floor(now.getTime() / 60000);
  if (hit && hit.key === key) return hit.value;
  const today = manilaToday(now), state = store.read(), wf = workforce(store, today, state), keep = new Set(wf.timekeepingIds);
  const value = monthsBack(today, 7).map(month => {
    let workdays = 0, present = 0;
    for (const e of state.employees.filter(x => keep.has(x.id) && (!x.startDate || x.startDate.slice(0, 7) <= month))) {
      try { const s = attendanceSummary(store, e.id, month, now); workdays += s.workdays; present += s.present; } catch { /* employee outside the month */ }
    }
    return { month, workdays, present, rate: workdays ? r1(present / workdays * 100) : null };
  });
  cache.set(store, { key, value });
  return value;
}

// A readable line for the dashboard from an audit row (names only, never amounts).
function activityText(row, nameOf) {
  const after = JSON.parse(row.after_json || 'null') || {}, before = JSON.parse(row.before_json || 'null') || {};
  const who = nameOf(after.employeeId || before.employeeId || (row.kind === 'employees' || row.kind.startsWith('document:') ? row.record_id : ''));
  if (row.kind === 'employees' && row.action === 'create') return `New employee record added: ${who || after.name || ''}`;
  if (row.kind === 'leaves' && row.action === 'apply') return `Leave request filed by ${who}`;
  if (row.kind === 'leaves' && ['approved', 'rejected'].includes(after.status) && after.status !== before.status) return `Leave request ${after.status} for ${who}`;
  if (row.kind === 'attendance' && who) return `Attendance updated for ${who}`;
  if (row.kind.startsWith('document:') && ['upload', 'replace'].includes(row.action) && who) return `201 document uploaded for ${who}`;
  if (row.kind.startsWith('document:') && row.action.startsWith('document-verified') && who) return `201 document verified for ${who}`;
  if (row.kind === 'memos' && ['publish', 'revise'].includes(row.action)) return `Memo issued: ${after.title || ''}`;
  if (row.kind === 'trainings' && row.action === 'create') return `Training scheduled: ${after.title || ''}`;
  if (row.kind === 'movements' && row.action === 'request-movement') return `${after.typeLabel || 'Movement'} requested for ${who}`;
  return null;
}

export function dashboardOverview(store, actor, now = new Date()) {
  permit(actor, DASHBOARD);
  const today = manilaToday(now), state = store.read(), wf = workforce(store, today, state);
  const empName = new Map(state.employees.map(e => [e.id, displayName(e.name)]));
  // Today (HR and the System Administrator see Live attendance).
  let todayBox = null;
  if (['admin', 'hr'].includes(actor.role)) {
    const live = liveDashboard(store, actor, now).employees || [], count = list => live.filter(e => list.includes(e.status)).length;
    const present = count(['Present', 'Late', 'Missing time out']), onLeave = count(['On leave']), late = count(['Late']), noTimeIn = count(['No time in']);
    const base = live.length || 1;
    todayBox = { timekeeping: live.length, present, onLeave, late, noTimeIn, presentRate: r1(present / base * 100), onLeaveRate: r1(onLeave / base * 100), lateRate: r1(late / base * 100), noTimeInRate: r1(noTimeIn / base * 100) };
  }
  // Workforce composition by employment classification (active employees).
  const job = id => (state.employeeProfiles || []).find(p => p.employeeId === id && p.section === 'employment') || {};
  const composition = Object.entries(wf.activeIds.reduce((m, id) => { const c = job(id).employmentStatus || 'Not set'; return { ...m, [c]: (m[c] || 0) + 1 }; }, {}))
    .map(([name, count]) => ({ name, count, share: r1(count / (wf.active || 1) * 100) })).sort((a, b) => b.count - a.count);
  // Document compliance (HR team only, like the 201 screens).
  let compliance = null;
  if (['admin', 'hr', 'hr_staff', 'maker'].includes(actor.role)) {
    const d = documentSummary(store, actor);
    compliance = { required: d.requiredItems, complied: d.compliedItems, percent: d.requiredItems ? Math.round(d.compliedItems / d.requiredItems * 100) : 100, employees: wf.active, employeesComplete: Math.max(0, wf.active - d.employeesMissing), pendingReview: d.pendingReview };
  }
  // Quick stats.
  const pendingLeaves = state.leaves.filter(l => l.status === 'pending').length;
  const openCases = table(store, 'attendance_cases') ? store.db.prepare("SELECT data FROM attendance_cases").all().map(r => JSON.parse(r.data)).filter(c => c.status === 'open').length : 0;
  let systemAlerts = 0;
  if (table(store, 'backup_log')) {
    const last = store.db.prepare("SELECT at, ok FROM backup_log WHERE kind='backup' ORDER BY id DESC LIMIT 1").get();
    if (!last || !last.ok || (Date.now() - Date.parse(last.at)) > 2 * 86400000) systemAlerts += 1;
  }
  const quick = { pendingLeaves, pendingDocs: compliance?.pendingReview ?? null, payrollAlerts: openCases, systemAlerts };
  // Recent activities.
  const names = staffNames(store), nameOf = id => (id ? empName.get(id) || '' : '');
  const rows = store.db.prepare("SELECT at, actor, action, kind, record_id, before_json, after_json FROM audit WHERE kind IN ('employees','leaves','attendance','memos','trainings','movements') OR kind LIKE 'document:%' ORDER BY at DESC, rowid DESC LIMIT 200").all();
  const activities = [];
  for (const r of rows) { const text = activityText(r, nameOf); if (text && !activities.some(a => a.text === text && a.at.slice(0, 13) === r.at.slice(0, 13))) activities.push({ at: r.at, text, by: fullNameOf(store, r.actor, names), kind: r.kind.startsWith('document:') ? 'documents' : r.kind }); if (activities.length >= 6) break; }
  // Upcoming events: holidays (60 days), the next salary days, trainings.
  const events = [];
  for (const h of state.holidays.filter(h => h.date >= today && h.date <= new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 86400000).toISOString().slice(0, 10) && h.kind !== 'ordinary')) events.push({ date: h.date, title: h.name, sub: h.kind === 'regular' || h.kind === 'double' ? 'Regular holiday' : 'Special non-working day', kind: 'holiday' });
  const [y, mo] = today.split('-').map(Number);
  for (let i = -1; i < 2; i += 1) {   // last month's second cutoff is paid this month
    const first = new Date(Date.UTC(y, mo - 1 + i, 1)), month = first.toISOString().slice(0, 7), last = new Date(Date.UTC(y, mo + i, 0)).toISOString().slice(0, 10);
    for (const [start, end] of [[`${month}-01`, `${month}-15`], [`${month}-16`, last]]) { const pay = payDateFor(start, end); if (pay >= today) events.push({ date: pay, title: 'Salary day', sub: `Payroll ${start.slice(5)} to ${end.slice(5)}`, kind: 'payroll' }); }
  }
  try { for (const t of trainingSummary(store, actor).next) events.push({ date: t.date, title: t.title, sub: `Training${t.startTime ? ` · ${t.startTime}` : ''}`, kind: 'training' }); } catch { /* trainings optional */ }
  const upcoming = events.sort((a, b) => a.date.localeCompare(b.date)).filter((e, i, list) => list.findIndex(x => x.date === e.date && x.title === e.title) === i).slice(0, 5);
  return { asOf: today, employees: { total: wf.records, active: wf.active, timekeeping: wf.timekeeping }, today: todayBox, monthly: monthlyRates(store, now), composition, compliance, quick, activities, upcoming };
}
