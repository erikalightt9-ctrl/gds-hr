// Recorded remittances: months whose SSS / PhilHealth / Pag-IBIG were remitted outside the system (before payroll
// moved here). They are kept exactly as the remittance sheet shows them, including people who are no longer
// employees, and the Government Contributions report shows these figures instead of computing them.
import { z } from 'zod';
import { permit } from './service.mjs';

const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS contribution_records(month TEXT PRIMARY KEY, data TEXT NOT NULL)');
const amount = z.coerce.number().min(0).max(10000000).default(0);
const rowSchema = z.object({
  name: z.string().trim().min(1).max(200), employeeId: z.string().max(40).nullable().default(null),
  compensation: amount, sssER: amount, sssEE: amount, phBasis: amount, phER: amount, phEE: amount, piER: amount, piEE: amount,
  sssLoan: amount, piLoan: amount, cashLoan: amount, adjustment: amount, deductions: amount, note: z.string().max(200).default(''),
}).strict();
const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), fee: amount, rows: z.array(rowSchema).min(1).max(500) }).strict();

export function recordedMonth(store, month) {
  ensure(store);
  const row = store.db.prepare('SELECT data FROM contribution_records WHERE month=?').get(month);
  return row ? JSON.parse(row.data) : null;
}
export function saveRecordedMonth(store, actor, input) {
  permit(actor, ['admin', 'hr', 'payroll']);
  const v = monthSchema.parse(input);
  ensure(store);
  const before = recordedMonth(store, v.month);
  const value = { ...v, recordedBy: actor.username, recordedAt: new Date().toISOString() };
  store.db.prepare('INSERT INTO contribution_records(month,data) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET data=excluded.data').run(v.month, JSON.stringify(value));
  store.log(actor, before ? 'update' : 'create', 'contribution-records', v.month, before, value);
  return value;
}
