// Account scope (Nov 24, 2026; role / workflow spec, Phase 1): per login, which companies it may see and whether it
// may see salaries / compensation and sensitive files (medical certificates, government IDs, bank details).
//   companies: [] = every company; otherwise the company (department) names the account is limited to.
//   salary / sensitive: separate permissions, so a System Administrator or HR Maker does not see pay or sensitive
//   files only because of the role.
// Enforcement is added screen by screen (company separation and the two permissions); this module stores and reads.
import { z } from 'zod';
import { AppError, permit } from './service.mjs';

export const ensureScopeColumns = db => {
  const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map(c => c.name));
  if (!columns.has('companies')) db.exec('ALTER TABLE users ADD COLUMN companies TEXT');
  if (!columns.has('permissions')) db.exec('ALTER TABLE users ADD COLUMN permissions TEXT');
};
// Roles that saw pay and sensitive files before these permissions existed keep them until an administrator changes it.
const PAY_BEFORE = ['admin', 'hr', 'payroll', 'viewer', 'finance'], SENSITIVE_BEFORE = ['admin', 'hr', 'payroll', 'maker'];
export function scopeOf(row) {
  const companies = (() => { try { const v = JSON.parse(row?.companies || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; } catch { return []; } })();
  const saved = (() => { try { return JSON.parse(row?.permissions || 'null'); } catch { return null; } })();
  const permissions = saved && typeof saved === 'object'
    ? { salary: !!saved.salary, sensitive: !!saved.sensitive }
    : { salary: PAY_BEFORE.includes(row?.role), sensitive: SENSITIVE_BEFORE.includes(row?.role) };
  return { companies, permissions };
}
const schema = z.object({ companies: z.array(z.string().trim().min(1).max(120)).max(50), salary: z.boolean(), sensitive: z.boolean() }).strict();
export function setAccountScope(store, actor, userId, input, knownCompanies = []) {
  permit(actor, ['admin']);
  const v = schema.parse(input);
  const unknown = v.companies.filter(c => !knownCompanies.includes(c));
  if (unknown.length) throw new AppError(`Unknown company: ${unknown.join(', ')}.`);
  ensureScopeColumns(store.db);
  return store.transaction(() => {
    const row = store.db.prepare('SELECT * FROM users WHERE id=?').get(userId);
    if (!row) throw new AppError('User not found.', 404);
    if (row.role === 'employee' && (v.companies.length || v.salary || v.sensitive)) throw new AppError('Employee logins always see only their own records.');
    const before = scopeOf(row), companies = [...new Set(v.companies)].sort();
    store.db.prepare('UPDATE users SET companies=?, permissions=? WHERE id=?').run(JSON.stringify(companies), JSON.stringify({ salary: v.salary, sensitive: v.sensitive }), userId);
    store.log(actor, 'set-account-scope', 'users', userId, before, { companies, permissions: { salary: v.salary, sensitive: v.sensitive } });
    return { companies, permissions: { salary: v.salary, sensitive: v.sensitive } };
  });
}

// Enforcement of the two permissions. A login without them keeps its role, minus pay or sensitive files; a role that
// never saw pay (HR Maker) gains the 201 Compensation tab with the Salary permission. Actors without a permissions
// object (internal calls, tests) keep the role's previous access.
const PAY_ROLES_BEFORE = ['admin', 'hr', 'payroll', 'viewer'], SENSITIVE_ROLES_BEFORE = ['admin', 'hr', 'payroll', 'maker'];
export const canSeePay = actor => (PAY_ROLES_BEFORE.includes(actor?.role) ? actor.permissions?.salary !== false : !!actor?.permissions?.salary && actor?.role !== 'employee');
export const canSeeSensitive = actor => (SENSITIVE_ROLES_BEFORE.includes(actor?.role) ? actor.permissions?.sensitive !== false : !!actor?.permissions?.sensitive && actor?.role !== 'employee');
// Pay modules a login without the Salary permission cannot open (pages, lists, PDFs and downloads).
export const PAY_PATHS = /^\/api\/(benefits|runs|payroll|payroll-inputs|contributions|bir|thirteenth|final-pay|loans?|loan-applications|salary|salary-changes|adjustments|prior-earnings|records\/(loans|adjustments|deductions))(\/|$|\.)|^\/api\/employees\/[^/]+\/contributions|^\/api\/reports\/(payroll|payslips|loans|adjustments|thirteenth|contributions|bir|discipline-pay)/;
const PAY_KEYS = new Set(['monthlySalary', 'dailyRate', 'hourlyRate', 'compensation', 'salaryHistory', 'finalPay', 'runs', 'loans', 'adjustments', 'payrollInputs', 'priorEarnings', 'thirteenthOverrides', 'thirteenthAdjustments', 'thirteenthPayslips', 'contributionChanges']);
const SENSITIVE_KEYS = new Set(['bank', 'accountNumber', 'accountName']);
const ID_KEYS = new Set(['tin', 'sss', 'philHealth', 'pagIbig']);
// Strips pay values (no Salary permission) and bank details / full government numbers (no Sensitive permission).
export function stripForPermissions(value, { pay, sensitive }) {
  if (Array.isArray(value)) return value.filter(v => !(v && typeof v === 'object' && !pay && v.section && ['payroll', 'contributions'].includes(v.section))).map(v => stripForPermissions(v, { pay, sensitive }));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!pay && PAY_KEYS.has(k)) { out[k] = Array.isArray(v) ? [] : null; continue; }
    if (!sensitive && SENSITIVE_KEYS.has(k)) { out[k] = typeof v === 'string' && v ? `•••• ${v.slice(-3)}` : (v && typeof v === 'object' ? {} : v); continue; }
    if (!sensitive && ID_KEYS.has(k) && typeof v === 'string' && v.length > 4) { out[k] = `•••• ${v.slice(-3)}`; continue; }
    out[k] = stripForPermissions(v, { pay, sensitive });
  }
  return out;
}
