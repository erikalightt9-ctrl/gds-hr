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
const PAY_BEFORE = ['admin', 'hr', 'payroll', 'viewer'], SENSITIVE_BEFORE = ['admin', 'hr', 'payroll', 'maker'];
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
