// Month-only edits on the Government Contributions page: HR / Admin can type any amount of one employee's row for one
// month (declared salaries, employee and employer shares per agency), e.g. when a posted payroll month must be
// remitted differently. Payroll and payslips are not changed; only the contributions report and its downloads.
import { z } from 'zod';
import { AppError, permit } from './service.mjs';

export const MONTH_FIELDS = ['sssBasis', 'phBasis', 'sssEE', 'sssER', 'phEE', 'phER', 'piEE', 'piER'];
const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const amount = z.union([z.null(), z.coerce.number().min(0, 'Amounts cannot be negative.').max(10000000)]);
const schema = z.object({
  employeeId: z.string().trim().min(1).max(40),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.'),
  values: z.object(Object.fromEntries(MONTH_FIELDS.map(k => [k, amount.optional()]))).strict().default({}),
  reason: z.string().trim().max(500).default(''),
}).strict();

function ensureTable(store) {
  store.db.exec('CREATE TABLE IF NOT EXISTS contribution_month_edits (employee_id TEXT NOT NULL, month TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(employee_id, month))');
}
export function monthEdits(store, month) {
  ensureTable(store);
  return new Map(store.db.prepare('SELECT employee_id, data FROM contribution_month_edits WHERE month=?').all(month).map(r => [r.employee_id, JSON.parse(r.data)]));
}
// Applies the month's edits to the report rows (typed amounts replace the computed ones; blank keeps the computed one).
export function applyMonthEdits(store, month, people) {
  const edits = monthEdits(store, month);
  if (!edits.size) return people;
  return people.map(p => {
    const e = edits.get(p.employeeId); if (!e) return p;
    const typed = Object.fromEntries(MONTH_FIELDS.filter(k => e.values?.[k] != null).map(k => [k, r2(e.values[k])]));
    const row = { ...p, ...typed, computed: Object.fromEntries(Object.keys(typed).map(k => [k, p[k]])), edited: { by: e.by, at: e.at, reason: e.reason || '' } };
    return { ...row, deductions: r2(row.sssEE + row.phEE + row.piEE + (row.sssLoan || 0) + (row.piLoan || 0) + (row.cashLoan || 0)) };
  });
}
// Save (or clear, when every box is blank) one employee's amounts for one month.
export function saveMonthEdit(store, actor, input) {
  permit(actor, ['admin', 'hr']);
  const v = schema.parse(input);
  const values = Object.fromEntries(MONTH_FIELDS.filter(k => v.values[k] != null).map(k => [k, r2(v.values[k])]));
  ensureTable(store);
  return store.transaction(() => {
    if (!store.read().employees.some(e => e.id === v.employeeId)) throw new AppError('Employee not found.', 404);
    const before = JSON.parse(store.db.prepare('SELECT data FROM contribution_month_edits WHERE employee_id=? AND month=?').get(v.employeeId, v.month)?.data ?? 'null');
    if (!Object.keys(values).length) {
      store.db.prepare('DELETE FROM contribution_month_edits WHERE employee_id=? AND month=?').run(v.employeeId, v.month);
      store.log(actor, 'clear-contribution-month', 'contributions', `${v.employeeId}:${v.month}`, before, null);
      return { cleared: true };
    }
    const after = { employeeId: v.employeeId, month: v.month, values, reason: v.reason, by: actor.username, at: new Date().toISOString() };
    store.db.prepare('INSERT INTO contribution_month_edits VALUES(?,?,?) ON CONFLICT(employee_id, month) DO UPDATE SET data=excluded.data').run(v.employeeId, v.month, JSON.stringify(after));
    store.log(actor, 'edit-contribution-month', 'contributions', `${v.employeeId}:${v.month}`, before, after);
    return after;
  });
}
