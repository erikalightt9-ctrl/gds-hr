// A pay edit is a request until a different named approver accepts it (TH-DEV-02).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { saveProfile } from './profiles.mjs';
import { assertNamedActor, getPolicy, namedActorProblem } from './actors.mjs';
import { approvedSalary, componentOn, ensureSalary, isDate, listSalary, SALARY_FIELDS } from './salary-history.mjs';

const manilaToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
const dayBefore = date => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const money = z.number().positive().max(1e9);
const requestSchema = z.object({
  employeeId: z.string().trim().min(1).max(80),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(3, 'Give a reason for the salary change.').max(1000),
  approverUserId: z.string().trim().min(1).max(80),
  monthlySalary: money.nullable().optional(),
  dailyRate: money.nullable().optional(),
  hourlyRate: money.nullable().optional(),
  basis: z.enum(['monthly', 'daily', 'days-worked']).optional(),
}).strict();

const put = (store, value) => {
  ensureSalary(store);
  store.db.prepare('INSERT INTO salary_changes(id, employee_id, status, data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(value.id, value.employeeId, value.status, JSON.stringify(value));
};
const profileOf = (store, id) => JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='payroll'").get(id)?.data || 'null');

function proposed(input) {
  const changes = {};
  for (const field of SALARY_FIELDS) if (input[field] !== undefined && input[field] !== null) changes[field] = input[field];
  if (!Object.keys(changes).length) throw new AppError('Enter the new salary or pay component.');
  return changes;
}

export function requestSalaryChange(store, actor, input) {
  permit(actor, ['admin', 'hr']);
  const v = requestSchema.parse(input);
  if (!isDate(v.effectiveDate)) throw new AppError('Enter the date the new salary takes effect.');
  const next = proposed(v);
  return store.transaction(() => {
    const employee = store.read().employees.find(e => e.id === v.employeeId);
    if (!employee) throw new AppError('Employee not found.', 404);
    const approver = store.db.prepare('SELECT id, username, role, display_name, account_kind, disabled FROM users WHERE id=?').get(v.approverUserId);
    if (!approver || approver.disabled || approver.account_kind === 'service') throw new AppError('Choose a second approver.');
    if (approver.id === actor.id || approver.username === actor.username) throw new AppError('The second approver must be a different person from the requester.');
    if (namedActorProblem({ id: approver.id, username: approver.username, role: approver.role, displayName: approver.display_name || '' }, getPolicy(store), 'salary')) throw new AppError('That account is not allowed to approve a salary change.');
    const value = {
      id: randomUUID(), employeeId: v.employeeId, status: 'pending', effectiveDate: v.effectiveDate, reason: v.reason,
      proposed: next, changes: {}, requestedBy: actor.username, requestedById: actor.id || '', requestedByName: actor.displayName || actor.username, requestedAt: new Date().toISOString(),
      approverUserId: approver.id, approverUsername: approver.username, approverName: approver.display_name || approver.username,
      approvedBy: '', approvedById: '', approvedAt: '',
    };
    put(store, value);
    store.log(actor, 'request', 'salary-changes', value.id, null, value);
    return value;
  });
}

function applyCurrent(store, actor, employeeId) {
  const today = manilaToday(), history = approvedSalary(store);
  const employee = store.read().employees.find(e => e.id === employeeId);
  const monthly = componentOn(employeeId, today, history, 'monthlySalary', employee.monthlySalary);
  if (employee.monthlySalary != null && monthly !== employee.monthlySalary) saveRecord(store, actor, 'employees', { ...employee, monthlySalary: monthly }, { trusted: true, salaryApproval: true });
  const profile = profileOf(store, employeeId);
  if (!profile) return;
  const next = { ...profile };
  let changed = false;
  for (const field of ['dailyRate', 'hourlyRate', 'basis']) {
    if (!history.some(h => h.employeeId === employeeId && h.changes && Object.hasOwn(h.changes, field))) continue;
    const value = componentOn(employeeId, today, history, field, profile[field] ?? null);
    if (value !== (profile[field] ?? null)) { next[field] = value; changed = true; }
  }
  if (changed) saveProfile(store, actor, employeeId, 'payroll', next, { salaryApproval: true });
}

export function approveSalaryChange(store, actor, id) {
  return store.transaction(() => {
    ensureSalary(store);
    const current = listSalary(store).find(r => r.id === id);
    if (!current) throw new AppError('Salary change not found.', 404);
    if (current.status !== 'pending') throw new AppError('This salary change is no longer waiting for approval.');
    if (actor.id !== current.approverUserId && actor.username !== current.approverUsername) throw new AppError('Only the chosen second approver can approve this salary change.', 403);
    if (actor.username === current.requestedBy || (actor.id && actor.id === current.requestedById)) throw new AppError('The requester cannot approve their own salary change.', 403);
    assertNamedActor(actor, getPolicy(store), 'salary');
    const employee = store.read().employees.find(e => e.id === current.employeeId);
    const profile = profileOf(store, current.employeeId) || {};
    const history = approvedSalary(store);
    const beforeDate = dayBefore(current.effectiveDate);
    const changes = {};
    for (const [field, amount] of Object.entries(current.proposed)) {
      const fallback = field === 'monthlySalary' ? employee.monthlySalary : (profile[field] ?? null);
      changes[field] = { previous: componentOn(current.employeeId, beforeDate, history, field, fallback), next: amount };
    }
    const after = { ...current, status: 'approved', changes, approvedBy: actor.displayName || actor.username, approvedById: actor.id || '', approvedAt: new Date().toISOString() };
    put(store, after);
    applyCurrent(store, actor, current.employeeId);
    store.log(actor, 'approve', 'salary-changes', after.id, current, after);
    return listSalary(store).find(r => r.id === id);
  });
}

export { listSalary };
