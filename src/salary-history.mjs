// Effective-dated salary. Approved changes are added; the previous amount stays readable.
// Payroll for a day uses the amount in effect that day. Finalized runs keep the snapshot they posted.
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const SALARY_FIELDS = ['monthlySalary', 'dailyRate', 'hourlyRate', 'basis'];

export function ensureSalary(store) {
  store.db.exec('CREATE TABLE IF NOT EXISTS salary_changes (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)');
}
const rows = store => { ensureSalary(store); return store.db.prepare('SELECT data FROM salary_changes ORDER BY rowid').all().map(r => JSON.parse(r.data)); };
export const listSalary = (store, employeeId) => rows(store).filter(r => !employeeId || r.employeeId === employeeId);
export const approvedSalary = store => rows(store).filter(r => r.status === 'approved');

// The amount of one pay component in effect on a date. With no approved change, the current record stands.
export function componentOn(employeeId, date, history, field, fallback) {
  const relevant = (history || []).filter(h => h.employeeId === employeeId && h.status === 'approved' && h.changes && Object.hasOwn(h.changes, field))
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || String(a.approvedAt || '').localeCompare(String(b.approvedAt || '')));
  if (!relevant.length) return fallback;
  const past = relevant.filter(h => h.effectiveDate <= date);
  return past.length ? past.at(-1).changes[field].next : relevant[0].changes[field].previous;
}
export const monthlySalaryOn = (employee, date, history) => componentOn(employee.id, date, history, 'monthlySalary', employee.monthlySalary);
export const isDate = value => DATE.test(value || '');
