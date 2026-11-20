// Salary changes (Nov 20, 2026): an existing salary or rate is never edited directly. A change is requested with the
// new monthly salary and / or daily rate (and pay basis), an effective date and a reason; a second person approves it
// (never the requester); it applies on its effective date (at once when that date has come, otherwise by the hourly
// job) and stays in the employee's salary history with who requested, approved and applied it.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { saveProfile } from './profiles.mjs';

const REQUESTERS = ['admin', 'hr', 'payroll'], APPROVERS = ['admin', 'payroll'];
const manilaToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
export const ensureSalaryChanges = db => db.exec('CREATE TABLE IF NOT EXISTS salary_changes (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)');
const all = (store, employeeId = null) => { ensureSalaryChanges(store.db); return (employeeId ? store.db.prepare('SELECT data FROM salary_changes WHERE employee_id=? ORDER BY rowid DESC').all(employeeId) : store.db.prepare('SELECT data FROM salary_changes ORDER BY rowid DESC').all()).map(r => JSON.parse(r.data)); };
const save = (store, c) => store.db.prepare('INSERT INTO salary_changes(id,employee_id,status,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(c.id, c.employeeId, c.status, JSON.stringify(c));
const payrollProfile = (store, id) => JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='payroll'").get(id)?.data ?? '{}');
const money = z.union([z.number().positive().max(1e9), z.null()]).default(null);

const requestSchema = z.object({ employeeId: z.string().min(1).max(80), monthlySalary: money, dailyRate: money, basis: z.enum(['', 'monthly', 'daily', 'days-worked']).default(''), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the effective date.'), reason: z.string().trim().min(10, 'Give the reason for the salary change (at least 10 characters).').max(1000) }).strict();
export function requestSalaryChange(store, actor, input) {
  permit(actor, REQUESTERS);
  const v = requestSchema.parse(input);
  return store.transaction(() => {
    const state = store.read(), e = state.employees.find(x => x.id === v.employeeId);
    if (!e) throw new AppError('Employee not found.', 404);
    const pay = payrollProfile(store, e.id), before = { monthlySalary: e.monthlySalary ?? null, dailyRate: pay.dailyRate ?? null, basis: pay.basis || 'monthly' };
    const after = { monthlySalary: v.monthlySalary ?? before.monthlySalary, dailyRate: v.dailyRate ?? before.dailyRate, basis: v.basis || before.basis };
    if (JSON.stringify(after) === JSON.stringify(before)) throw new AppError('Nothing changes: enter the new monthly salary, daily rate or pay basis.');
    const posted = state.runs.filter(r => r.status === 'posted' && r.rows.some(row => row.employeeId === e.id)).map(r => r.end).sort().at(-1);
    if (posted && v.effectiveDate <= posted) throw new AppError(`Payroll is posted up to ${posted}. The effective date must be after it.`);
    if (all(store, e.id).some(c => c.status === 'pending')) throw new AppError('A salary change for this employee is already waiting for approval.');
    const change = { id: randomUUID(), employeeId: e.id, employeeName: e.name, before, after, effectiveDate: v.effectiveDate, reason: v.reason, status: 'pending', requestedBy: actor.username, requestedAt: new Date().toISOString() };
    save(store, change);
    store.log(actor, 'request-salary-change', 'salary', e.id, before, change);
    store.notify(null, `Salary change for ${e.name} (effective ${v.effectiveDate}) is waiting for a second approver (not ${actor.username}).`);
    return change;
  });
}

function apply(store, actor, change) {
  const state = store.read(), e = state.employees.find(x => x.id === change.employeeId);
  if (change.after.monthlySalary !== e.monthlySalary) saveRecord(store, actor, 'employees', { ...e, monthlySalary: change.after.monthlySalary }, { trusted: true, salaryChange: change.id });
  const pay = payrollProfile(store, e.id);
  if ((change.after.dailyRate ?? null) !== (pay.dailyRate ?? null) || change.after.basis !== (pay.basis || 'monthly')) saveProfile(store, actor, e.id, 'payroll', { ...pay, basis: change.after.basis, dailyRate: change.after.dailyRate }, { salaryChange: change.id });
  return { ...change, status: 'applied', appliedAt: new Date().toISOString() };
}
export function decideSalaryChange(store, actor, id, input) {
  permit(actor, APPROVERS);
  const v = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }).strict().parse(input);
  if (v.decision === 'reject' && v.note.length < 5) throw new AppError('Give the reason for rejecting (at least 5 characters).');
  return store.transaction(() => {
    const change = all(store).find(c => c.id === id);
    if (!change) throw new AppError('Salary change not found.', 404);
    if (change.status !== 'pending') throw new AppError('This salary change was already decided.');
    if (change.requestedBy === actor.username) throw new AppError('A second person must approve a salary change: you requested this one.');
    let next = { ...change, status: v.decision === 'approve' ? 'approved' : 'rejected', decidedBy: actor.username, decidedAt: new Date().toISOString(), decisionNote: v.note };
    if (v.decision === 'approve' && change.effectiveDate <= manilaToday()) next = apply(store, actor, next);
    save(store, next);
    store.log(actor, `${v.decision}-salary-change`, 'salary', change.employeeId, change, next);
    store.notify(null, `Salary change for ${change.employeeName} ${v.decision === 'approve' ? (next.status === 'applied' ? 'approved and applied' : `approved; applies on ${change.effectiveDate}`) : 'rejected'} by ${actor.username}.`);
    return next;
  });
}
// Hourly: approved changes whose effective date has come are applied.
export function applyDueSalaryChanges(store, now = new Date()) {
  const due = all(store).filter(c => c.status === 'approved' && c.effectiveDate <= manilaToday(now));
  for (const c of due) store.transaction(() => { const next = apply(store, { username: 'system', role: 'admin' }, c); save(store, next); store.log({ username: 'system' }, 'apply-salary-change', 'salary', c.employeeId, c, next); });
  return due.length;
}
export function salaryHistory(store, actor, employeeId) {
  permit(actor, [...REQUESTERS]);
  return all(store, employeeId).map(c => ({ ...c, canDecide: APPROVERS.includes(actor.role) && c.status === 'pending' && c.requestedBy !== actor.username }));
}
export const pendingSalaryChanges = (store, actor) => (APPROVERS.includes(actor.role) ? all(store).filter(c => c.status === 'pending' && c.requestedBy !== actor.username) : []);
