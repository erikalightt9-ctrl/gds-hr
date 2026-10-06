// Manual payroll entries: HR / Payroll type the figures for one employee and one cutoff themselves.
//   mode "add"     — the hours below are paid on top of what attendance produces
//   mode "replace" — attendance is not used for this cutoff; days worked / absences / late / undertime come from here
// Amounts are still calculated with the approved Rules & rates multipliers, and every entry keeps who and why.
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { OVERRIDE_EARNINGS, OVERRIDE_DEDUCTIONS } from './engine.mjs';

const ROLES = ['admin', 'hr', 'payroll'];
const hours = z.number().min(0).max(744).default(0);
export const HOUR_FIELDS = ['regularOT', 'restDay', 'restOT', 'specialHoliday', 'specialOT', 'regularHoliday', 'regularHolidayOT', 'nightDiff'];
const inputSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['add', 'replace']),
  daysWorked: z.number().min(0).max(31).default(0), absenceDays: z.number().min(0).max(31).default(0),
  lateMinutes: z.number().int().min(0).max(20000).default(0), undertimeMinutes: z.number().int().min(0).max(20000).default(0),
  hours: z.object(Object.fromEntries(HOUR_FIELDS.map(k => [k, hours]))).strict(),
  reason: z.string().trim().max(500).default('Manual entry'),
  overrides: z.array(z.object({ component: z.enum([...OVERRIDE_EARNINGS, ...OVERRIDE_DEDUCTIONS]), amount: z.number().min(0).max(1e8), reason: z.string().trim().max(500).default('') }).strict()).max(20).default([]),
}).strict().refine(v => new Set(v.overrides.map(o => o.component)).size === v.overrides.length, 'Override each item only once.').refine(v => v.end >= v.start && v.start.slice(0, 7) === v.end.slice(0, 7), 'Choose a cutoff within one month.');

const lockedBy = (state, employeeId, start, end) => state.runs.some(r => r.status === 'posted' && r.start <= end && r.end >= start && r.rows.some(row => row.employeeId === employeeId));
export function savePayrollInput(store, actor, employeeId, input) {
  permit(actor, ROLES);
  const v = inputSchema.parse(input);
  return store.transaction(() => {
    const state = store.read();
    if (!state.employees.some(e => e.id === employeeId)) throw new AppError('Employee not found.', 404);
    if (lockedBy(state, employeeId, v.start, v.end)) throw new AppError('This cutoff is already posted for the employee and is locked.');
    const before = store.db.prepare('SELECT data FROM payroll_inputs WHERE employee_id=? AND start=? AND end=?').get(employeeId, v.start, v.end);
    const value = { ...v, employeeId, updatedBy: actor.username, updatedAt: new Date().toISOString() };
    store.db.prepare('INSERT INTO payroll_inputs(employee_id,start,end,data) VALUES(?,?,?,?) ON CONFLICT(employee_id,start,end) DO UPDATE SET data=excluded.data').run(employeeId, v.start, v.end, JSON.stringify(value));
    store.log(actor, before ? 'update' : 'create', 'payroll-inputs', `${employeeId}:${v.start}`, before ? JSON.parse(before.data) : null, value);
    return value;
  });
}
export function deletePayrollInput(store, actor, employeeId, start, end) {
  permit(actor, ROLES);
  return store.transaction(() => {
    if (lockedBy(store.read(), employeeId, start, end)) throw new AppError('This cutoff is already posted for the employee and is locked.');
    const before = store.db.prepare('SELECT data FROM payroll_inputs WHERE employee_id=? AND start=? AND end=?').get(employeeId, start, end);
    if (!before) throw new AppError('No manual entry for this cutoff.', 404);
    store.db.prepare('DELETE FROM payroll_inputs WHERE employee_id=? AND start=? AND end=?').run(employeeId, start, end);
    store.log(actor, 'delete', 'payroll-inputs', `${employeeId}:${start}`, JSON.parse(before.data), null);
    return { ok: true };
  });
}
