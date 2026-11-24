// Company separation (Nov 24, 2026; role / workflow spec, Phase 1). A staff login limited to some companies
// (users.companies, set in Account & access → Access) must not see, download, open or change another company's
// employees. Enforced centrally for every request of such a login:
//   1. reads: while the request is a GET, store.read() returns only the allowed employees and their records, and the
//      whole-state write is refused (a filtered state must never be saved over the full one);
//   2. JSON replies: arrays lose items that belong to another company's employee (employeeId / employee_id fields),
//      notices naming another company's employee are dropped, and a single record of another company is refused;
//   3. requests: an employeeId / employeeIds in the query or body, or a record id in the path that belongs to another
//      company's employee, is refused (direct links, actions, PDFs and downloads by id).
// Logins without a company limit (and employee logins, already limited to their own records) are not affected.
import { AsyncLocalStorage } from 'node:async_hooks';

export const scopeContext = new AsyncLocalStorage();
// Salary / sensitive-file permissions of the current request (src/account-scope.mjs stripForPermissions).
export const permissionContext = new AsyncLocalStorage();
export const REFUSED = 'This record belongs to a company outside your access.';

// The scope of a login: null = every company; otherwise the allowed employee ids and the other employees' names / ids.
export function companyScope(state, actor) {
  if (!actor || actor.role === 'employee' || !actor.companies?.length) return null;
  const allowed = new Set(actor.companies), ids = new Set(), blocked = [];
  for (const e of state.employees) {
    if (allowed.has(e.department)) ids.add(e.id);
    else blocked.push(e.id, e.name, ...nameVariants(e.name));
  }
  return { ids, blocked: blocked.filter(v => v && v.length >= 4), companies: [...allowed] };
}
// "Last, First Middle" is also written "First Middle Last" / "First Last" in notices.
function nameVariants(name = '') {
  const [last, rest = ''] = name.split(',').map(s => s.trim()), parts = rest.split(/\s+/).filter(Boolean);
  return rest ? [`${rest} ${last}`, parts[0] ? `${parts[0]} ${last}` : ''] : [];
}
const ownerOf = item => (item && typeof item === 'object' ? item.employeeId ?? item.employee_id ?? null : null);
const mentionsBlocked = (text, scope) => typeof text === 'string' && scope.blocked.some(v => text.includes(v));

// Every array in the state whose items carry an employee id keeps the allowed ones; payroll runs keep allowed rows.
export function filterState(state, scope) {
  const out = { ...state };
  for (const [key, value] of Object.entries(state)) {
    if (!Array.isArray(value)) continue;
    if (key === 'employees') out.employees = value.filter(e => scope.ids.has(e.id));
    else if (key === 'runs') out.runs = value.map(run => ({ ...run, rows: (run.rows || []).filter(r => scope.ids.has(r.employeeId)) })).filter(run => run.rows.length || !(state.runs.find(r => r.id === run.id)?.rows || []).length);
    else if (value.some(v => ownerOf(v) !== null)) out[key] = value.filter(v => ownerOf(v) === null || scope.ids.has(ownerOf(v)));
  }
  if (state.validation && typeof state.validation === 'object') out.validation = filterPayload(state.validation, scope);
  return out;
}
// Deep filter of a JSON reply.
export function filterPayload(value, scope) {
  if (Array.isArray(value)) return value.filter(v => !(ownerOf(v) !== null && !scope.ids.has(ownerOf(v))) && !(v && typeof v === 'object' && isNotice(v) && mentionsBlocked(v.message ?? v.text, scope))).map(v => filterPayload(v, scope));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = filterPayload(v, scope);
    return out;
  }
  return value;
}
const isNotice = v => typeof (v.message ?? v.text) === 'string' && ('at' in v || 'createdAt' in v || 'created_at' in v || 'message' in v);
export const refusedSingle = (data, scope) => ownerOf(data) !== null && !scope.ids.has(ownerOf(data));

// The employee a record id belongs to: state arrays first, then every table with id + employee_id columns.
export function recordOwner(store, state, id) {
  for (const value of Object.values(state)) if (Array.isArray(value)) { const hit = value.find(v => v && typeof v === 'object' && v.id === id); if (hit && ownerOf(hit) !== null) return ownerOf(hit); }
  for (const { name } of store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
    const cols = store.db.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name);
    if (cols.includes('id') && cols.includes('employee_id')) { const row = store.db.prepare(`SELECT employee_id FROM "${name}" WHERE id=?`).get(id); if (row?.employee_id) return row.employee_id; }
  }
  return null;
}
// Ids a request names: employeeId / employeeIds in the query or body, and path segments that look like record ids.
export function namedEmployees(url, body) {
  const out = [];
  for (const k of ['employeeId', 'employee']) if (url.searchParams.get(k)) out.push(url.searchParams.get(k));
  if (body && typeof body === 'object') {
    if (typeof body.employeeId === 'string' && body.employeeId) out.push(body.employeeId);
    if (Array.isArray(body.employeeIds)) out.push(...body.employeeIds.filter(x => typeof x === 'string'));
  }
  return out;
}
