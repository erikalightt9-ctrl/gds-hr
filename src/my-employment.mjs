// My Profile → Employment (Nov 24, 2026): the employee's official employment information, read live from the HR
// records each time (201 file, employment and payroll profiles, work schedule, approved movements and salary changes,
// allowances), so whatever HR saves or approves shows at once and nothing is copied or kept twice. Read-only for the
// employee; the change log comes from the audit trail.
import { AppError } from './service.mjs';
import { activity } from './hr201.mjs';
import { scheduleOf } from './work-schedule.mjs';
import { allowancesOf } from './benefits.mjs';
import { fullNameOf, staffNames } from './staff-names.mjs';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const table = (store, name) => !!store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
const rowsOf = (store, name, id) => (table(store, name) ? store.db.prepare(`SELECT data FROM ${name} WHERE employee_id=? ORDER BY rowid`).all(id).map(r => JSON.parse(r.data)) : []);
const RATE = { monthly: 'Monthly', daily: 'Daily', 'days-worked': 'Daily (days worked)', hourly: 'Hourly' };

// Field changes worth showing to the employee, by audit kind.
const WATCH = {
  employees: { department: 'Department', startDate: 'Date hired', endDate: 'End date', monthlySalary: 'Basic salary', restDays: 'Rest days', scheduleStart: 'Time in' },
  'profile:employment': { position: 'Position', employmentStatus: 'Classification', employeeStatus: 'Employment status', employmentType: 'Employment type', regularizationDate: 'Regularization date', supervisor: 'Immediate supervisor', workLocation: 'Work location', contractStart: 'Contract start', contractEnd: 'Contract end', probationEnd: 'Probation end', resignationDate: 'Separation date', jobLevel: 'Job level' },
  'profile:payroll': { basis: 'Salary rate', dailyRate: 'Daily rate', hourlyRate: 'Hourly rate' },
  'profile:attendance': { scheduleEnd: 'Time out', hoursPerDay: 'Hours per day', mealBreakMinutes: 'Meal break (min)', arrangement: 'Work arrangement', flexibleTime: 'Flexible time' },
};
const show = (key, v) => (v === undefined || v === null || v === '' ? '—' : key === 'restDays' ? (v.length ? v.map(d => DAYS[d]).join(', ') : 'none') : key === 'basis' ? RATE[v] || v : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
function changeLog(store, id) {
  const names = staffNames(store), kinds = Object.keys(WATCH);
  const rows = store.db.prepare(`SELECT at, actor, action, kind, before_json, after_json FROM audit WHERE record_id=? AND kind IN (${kinds.map(() => '?').join(',')}) ORDER BY at DESC, rowid DESC LIMIT 200`).all(id, ...kinds);
  return rows.map(r => {
    const before = JSON.parse(r.before_json || 'null') || {}, after = JSON.parse(r.after_json || 'null') || {};
    const changes = Object.entries(WATCH[r.kind]).filter(([k]) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null) && !(before[k] == null && (after[k] === '' || after[k] == null)))
      .map(([k, label]) => ({ field: label, from: show(k, before[k]), to: show(k, after[k]) }));
    return { at: r.at, by: fullNameOf(store, r.actor, names), action: r.action, changes };
  }).filter(x => x.changes.length);
}

export function employmentOf(store, employeeId) {
  const e = store.read().employees.find(x => x.id === employeeId);
  if (!e) throw new AppError('Employee not found.', 404);
  const job = profileOf(store, employeeId, 'employment'), pay = profileOf(store, employeeId, 'payroll'), schedule = scheduleOf(store, e);
  // Monday-first order for display.
  const weekOrder = d => (d + 6) % 7, rest = [...(schedule.restDays || [])].sort((a, b) => weekOrder(a) - weekOrder(b));
  const workDays = [1, 2, 3, 4, 5, 6, 0].filter(i => !rest.includes(i)).map(i => DAYS[i]);
  // Approved changes only: pending movements and salary changes do not show until they are approved and take effect.
  const movements = rowsOf(store, 'employee_movements', employeeId).filter(m => m.status === 'applied').sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const salary = rowsOf(store, 'salary_changes', employeeId).filter(c => c.status === 'applied').sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const contractDocs = table(store, 'employee_documents') ? store.db.prepare('SELECT metadata FROM employee_documents WHERE employee_id=?').all(employeeId).map(r => JSON.parse(r.metadata)).filter(d => d.requirementId === 'contract').sort((a, b) => (b.version || 0) - (a.version || 0)) : [];
  const now = today(), allowances = allowancesOf(store, employeeId).filter(a => a.status === 'Active' && (!a.endDate || a.endDate >= now));
  const log = changeLog(store, employeeId);
  const status = job.employeeStatus || activity(e, job);
  return {
    employeeId, name: e.name, lastUpdated: log[0]?.at || null, lastUpdatedBy: log[0]?.by || '',
    status: { classification: job.employmentStatus || '', status, employmentType: job.employmentType || '', jobLevel: job.jobLevel || '', dateHired: e.startDate || '',
      regularizationDate: job.regularizationDate || '', probationEnd: job.probationEnd || '', endDate: e.endDate || job.resignationDate || '' },
    compensation: { basicSalary: e.monthlySalary ?? null, basis: pay.basis || 'monthly', rateLabel: RATE[pay.basis || 'monthly'] || pay.basis, dailyRate: pay.dailyRate ?? null, hourlyRate: pay.hourlyRate ?? null,
      effectiveDate: salary[0]?.effectiveDate || e.startDate || '', allowances: allowances.map(a => ({ type: a.type, amount: a.amount, frequency: a.frequency, effectiveDate: a.effectiveDate })) },
    work: { department: e.department || '', position: job.position || '', supervisor: job.supervisor || '', workLocation: job.workLocation || '', arrangement: schedule.arrangement || 'Office',
      flexible: !!schedule.flexible, start: schedule.start || '', end: schedule.end || '', hoursPerDay: schedule.hoursPerDay, mealBreakMinutes: schedule.mealBreakMinutes,
      workingDays: workDays, restDays: rest.map(d => DAYS[d]), schedule: schedule.text || '' },
    records: {
      contract: { start: job.contractStart || '', end: job.contractEnd || '', onFile: contractDocs.length > 0, fileStatus: contractDocs[0]?.status || '', uploadedAt: contractDocs[0]?.uploadedAt || '' },
      movements: movements.map(m => ({ date: m.effectiveDate, type: m.typeLabel, before: m.before, changes: m.changes })),
      salaryHistory: salary.map(c => ({ date: c.effectiveDate, before: c.before, after: c.after })),
      previousEmployment: (profileOf(store, employeeId, 'history').entries || []).map(h => ({ company: h.company, position: h.position || '', from: h.from || '', to: h.to || '' })),
    },
    changes: log,
  };
}
export function myEmployment(store, actor) {
  if (actor?.role !== 'employee' || !actor.employeeId) throw new AppError('Only employees have this page.', 403);
  return employmentOf(store, actor.employeeId);
}
