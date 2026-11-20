// Named approvers and the scoped AI service account (TH-DEV-03).
// No passwords or service tokens are stored in source. A token is returned once, to the admin who creates the account, and only its hash is kept.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

export const PHASE0_ACTIONS = ['overtime', 'salary', 'payroll-approved', 'payroll-included', 'payroll-paid', 'rules'];
// Defaults until management confirms the approval matrix. Usernames are optional named delegates.
export const DEFAULT_MATRIX = {
  overtime: { roles: ['admin', 'hr'], usernames: [] },
  salary: { roles: ['admin', 'hr', 'payroll'], usernames: [] },
  'payroll-approved': { roles: ['admin', 'payroll'], usernames: [] },
  'payroll-included': { roles: ['admin', 'payroll'], usernames: [] },
  'payroll-paid': { roles: ['admin'], usernames: [] },
  rules: { roles: ['admin', 'hr'], usernames: [] },
};
const SHARED_DEFAULT = ['GDS Capital Inc'];
export const OPEN_DECISIONS = [
  'Management has not confirmed who may approve attendance corrections, overtime, leave, memos, salary or benefit changes, payroll Approved / Included / Paid, rules versions, discipline decisions, or access changes, or which of those may be delegated.',
  'The role lists in the approval policy are configurable defaults so Phase 0 approvals are traceable. They are not a signed approval matrix.',
  'Holiday multipliers stay on the approved rules version. DOLE rates (regular holiday worked 200%, overtime on a regular holiday 260%, special days per DOLE) are not applied by this change.',
  'Declared monthly compensation and voluntary contribution amounts stay per employee. This change does not force the Pag-IBIG ₱200 cap or replace a declared basis with actual pay.',
];

export function ensureActors(store) {
  store.db.exec('CREATE TABLE IF NOT EXISTS approval_policy (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
}

export function getPolicy(store) {
  ensureActors(store);
  const saved = JSON.parse(store.db.prepare('SELECT data FROM approval_policy WHERE id=1').get()?.data || '{}');
  const matrix = {};
  for (const action of PHASE0_ACTIONS) {
    const row = saved.matrix?.[action] || {};
    matrix[action] = {
      roles: Array.isArray(row.roles) && row.roles.length ? row.roles.map(String) : DEFAULT_MATRIX[action].roles,
      usernames: Array.isArray(row.usernames) ? row.usernames.map(String) : [],
    };
  }
  return {
    matrix,
    sharedAdminNames: Array.isArray(saved.sharedAdminNames) && saved.sharedAdminNames.length ? saved.sharedAdminNames.map(String) : SHARED_DEFAULT,
    openDecisions: OPEN_DECISIONS,
  };
}

export function savePolicy(store, actor, input) {
  if (!actor || actor.role !== 'admin' || actor.service) throw new AppError('Only a named system administrator can edit the approval policy.', 403);
  const matrix = {};
  for (const action of PHASE0_ACTIONS) {
    const row = input?.matrix?.[action] || {};
    const roles = (Array.isArray(row.roles) ? row.roles : DEFAULT_MATRIX[action].roles).map(r => String(r).trim()).filter(Boolean);
    const usernames = (Array.isArray(row.usernames) ? row.usernames : []).map(r => String(r).trim()).filter(Boolean);
    if (!roles.length && !usernames.length) throw new AppError(`Choose at least one role or named account for ${action}.`);
    matrix[action] = { roles, usernames };
  }
  const sharedAdminNames = (Array.isArray(input?.sharedAdminNames) ? input.sharedAdminNames : SHARED_DEFAULT).map(n => String(n).trim()).filter(Boolean);
  if (!sharedAdminNames.length) throw new AppError('Keep at least one shared-admin name so that login cannot approve routine payroll actions.');
  const value = { matrix, sharedAdminNames };
  return store.transaction(() => {
    const before = getPolicy(store);
    store.db.prepare('INSERT INTO approval_policy(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(value));
    store.log(actor, 'update', 'approval-policy', 'policy', { matrix: before.matrix, sharedAdminNames: before.sharedAdminNames }, value);
    return getPolicy(store);
  });
}

const slugName = name => /^[a-z0-9]+(-[a-z0-9]+)+$/.test(name || '');
export function isSharedAdmin(actor, policy = { sharedAdminNames: SHARED_DEFAULT }) {
  if (!actor || actor.service) return false;
  if (actor.sharedAdmin) return true;
  const names = new Set((policy.sharedAdminNames || SHARED_DEFAULT).map(n => n.toLowerCase()));
  return names.has(String(actor.username || '').toLowerCase()) || names.has(String(actor.displayName || '').toLowerCase());
}

// Empty string when the actor may take this Phase 0 action. Otherwise the refusal, for the caller to throw.
export function namedActorProblem(actor, policy, action) {
  if (!actor) return 'Sign in with a named account.';
  if (!PHASE0_ACTIONS.includes(action)) return 'Unknown approval action.';
  if (actor.service) {
    const allowed = actor.permissions || [];
    if (!allowed.includes(action)) return 'This service account is not allowed to do that. Its permissions are limited to what management authorized.';
    return '';
  }
  if (isSharedAdmin(actor, policy)) return 'The shared admin login cannot be used for this approval. Sign in with a named approver account.';
  if (!actor.displayName && !actor.employeeId && slugName(actor.username)) return 'Approval must be recorded against a named person, not a system slug.';
  const rule = policy.matrix?.[action] || DEFAULT_MATRIX[action];
  const allowed = rule.roles.includes(actor.role) || rule.usernames.includes(actor.username);
  if (!allowed) return 'You are not on the approval list for this action. Management can change the list in the approval policy.';
  return '';
}

export function assertNamedActor(actor, policy, action) {
  const problem = namedActorProblem(actor, policy, action);
  if (problem) throw new AppError(problem, 403);
}

export function actorLabel(actor) {
  const name = actor?.displayName || actor?.username || 'unknown';
  return actor?.via ? `${name} (via ${actor.via})` : name;
}

export function approverChoices(store, action) {
  const policy = getPolicy(store);
  if (!PHASE0_ACTIONS.includes(action)) throw new AppError('Unknown approval action.');
  const rule = policy.matrix[action];
  return store.db.prepare("SELECT id, username, role, display_name FROM users WHERE disabled=0 AND COALESCE(account_kind,'human')!='service'").all()
    .filter(u => rule.roles.includes(u.role) || rule.usernames.includes(u.username))
    .map(u => ({ id: u.id, username: u.username, role: u.role, name: u.display_name || u.username }));
}

// Creates the mechanism only. The token is returned to the caller once and is not written to the repository or the audit trail.
export async function createServiceAccount(store, actor, input, passwordHash) {
  if (!actor || actor.role !== 'admin' || actor.service) throw new AppError('Only a system administrator can create a service account.', 403);
  const displayName = String(input?.name || '').trim();
  const integration = String(input?.integration || '').trim();
  const permissions = Array.isArray(input?.permissions) ? [...new Set(input.permissions.map(String))] : [];
  if (displayName.length < 3 || displayName.length > 80) throw new AppError('Name the service account (3–80 characters).');
  if (integration.length < 2 || integration.length > 40) throw new AppError('Name the integration this account acts for.');
  if (!permissions.length || permissions.some(p => !PHASE0_ACTIONS.includes(p))) throw new AppError(`Permissions must be chosen from: ${PHASE0_ACTIONS.join(', ')}.`);
  if (input?.role === 'admin' || permissions.includes('admin')) throw new AppError('A service account cannot be a System Administrator.');
  const id = randomUUID();
  const username = `svc.${id.slice(0, 8)}`;
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const password = await passwordHash(randomBytes(32).toString('hex'));
  return store.transaction(() => {
    store.db.prepare('INSERT INTO users(id, username, password_hash, role, display_name, account_kind, service_permissions, service_token_hash, service_integration) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, username, password, 'service', displayName, 'service', JSON.stringify(permissions), tokenHash, integration);
    store.log(actor, 'create', 'service-account', id, null, { username, displayName, integration, permissions, role: 'service' });
    return { id, username, displayName, integration, permissions, role: 'service', token };
  });
}

export function authenticateService(store, token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = store.db.prepare("SELECT * FROM users WHERE service_token_hash=? AND account_kind='service'").get(tokenHash);
  if (!row || row.disabled) return null;
  let permissions;
  try { permissions = JSON.parse(row.service_permissions || '[]'); } catch { permissions = []; }
  return {
    id: row.id, username: row.username, role: 'service', displayName: row.display_name || row.username,
    via: row.service_integration || '', service: true, permissions, employeeId: null,
  };
}
