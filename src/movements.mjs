// Employee movements, offboarding and clearance (Nov 20, 2026).
// A movement (promotion, transfer, regularization, change of employment type or classification, separation) is
// requested by HR with an effective date and a reason, approved by a second person, and applied on its effective date
// to the 201 record (position, department, classification, employment type, status). Pay changes go through a
// salary change (salary-changes.mjs). A separation starts the offboarding clearance: a checklist each responsible
// person clears with a note; the clearance is complete when every item is cleared or not applicable.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit, saveRecord } from './service.mjs';
import { saveProfile, localToday } from './profiles.mjs';
import { disableLoginsFor } from './offboarding.mjs';

const MANAGE = ['admin', 'hr'], VIEW = ['admin', 'hr', 'hr_staff', 'payroll', 'viewer'];
export const MOVEMENT_TYPES = { promotion: 'Promotion', transfer: 'Transfer', regularization: 'Regularization', 'type-change': 'Change of employment type / classification', separation: 'Separation' };
export const SEPARATION_KINDS = ['Resignation', 'End of contract', 'Termination (just cause)', 'Termination (authorized cause)', 'Retirement'];
export const CLEARANCE_ITEMS = [
  ['work', 'Work turnover and documents', 'Immediate supervisor'], ['assets', 'Company ID, keys, laptop and equipment returned', 'Admin / IT'],
  ['accounts', 'TimeHub login, email, Feishu and other accounts disabled', 'Admin / IT'], ['finance', 'Cash advances, loans and accountabilities settled', 'Payroll / Finance'],
  ['finalpay', 'Final pay computed and released', 'Payroll'], ['coe', 'Certificate of employment issued', 'HR'], ['exit', 'Exit interview / quitclaim', 'HR'],
];
const ensure = db => db.exec('CREATE TABLE IF NOT EXISTS employee_movements (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL)');
const all = (store, employeeId = null) => { ensure(store.db); return (employeeId ? store.db.prepare('SELECT data FROM employee_movements WHERE employee_id=? ORDER BY rowid DESC').all(employeeId) : store.db.prepare('SELECT data FROM employee_movements ORDER BY rowid DESC').all()).map(r => JSON.parse(r.data)); };
const save = (store, m) => store.db.prepare('INSERT INTO employee_movements(id,employee_id,status,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(m.id, m.employeeId, m.status, JSON.stringify(m));
const employment = (store, id) => JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='employment'").get(id)?.data ?? '{}');

const text = (max = 200) => z.string().trim().max(max).default('');
const requestSchema = z.object({ employeeId: z.string().min(1).max(80), type: z.enum(Object.keys(MOVEMENT_TYPES)), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the effective date.'), reason: z.string().trim().min(10, 'Give the reason (at least 10 characters).').max(2000), position: text(), department: text(), classification: text(60), employmentType: z.enum(['', 'Full-Time', 'Part-Time', 'Other']).default(''), separationKind: z.union([z.literal(''), z.enum(SEPARATION_KINDS)]).default('') }).strict();
export function requestMovement(store, actor, input) {
  permit(actor, MANAGE);
  const v = requestSchema.parse(input);
  return store.transaction(() => {
    const e = store.read().employees.find(x => x.id === v.employeeId);
    if (!e) throw new AppError('Employee not found.', 404);
    if (v.type === 'separation' && !v.separationKind) throw new AppError('Choose the kind of separation.');
    if (v.type !== 'separation' && !v.position && !v.department && !v.classification && !v.employmentType) throw new AppError('Enter what changes: position, department, classification or employment type.');
    if (all(store, e.id).some(m => m.status === 'pending')) throw new AppError('A movement for this employee is already waiting for approval.');
    const job = employment(store, e.id);
    const before = { position: job.position || '', department: e.department || '', classification: job.employmentStatus || '', employmentType: job.employmentType || '', status: job.employeeStatus || 'Active' };
    const m = { id: randomUUID(), employeeId: e.id, employeeName: e.name, type: v.type, typeLabel: MOVEMENT_TYPES[v.type], effectiveDate: v.effectiveDate, reason: v.reason, before, changes: { position: v.position, department: v.department, classification: v.classification, employmentType: v.employmentType, separationKind: v.separationKind }, status: 'pending', requestedBy: actor.username, requestedAt: new Date().toISOString() };
    save(store, m);
    store.log(actor, 'request-movement', 'movements', e.id, null, m);
    store.notify(null, `${m.typeLabel} for ${e.name} (effective ${v.effectiveDate}) is waiting for approval by a second HR Manager / Admin.`);
    return m;
  });
}
function apply(store, actor, m) {
  const state = store.read(), e = state.employees.find(x => x.id === m.employeeId), job = employment(store, e.id), c = m.changes;
  if (m.type === 'separation') {
    const status = /Resignation|Retirement|End of contract/.test(c.separationKind) ? 'Resigned' : 'Terminated';
    saveProfile(store, actor, e.id, 'employment', { ...job, employeeStatus: status, resignationDate: m.effectiveDate });
    const fresh = store.read().employees.find(x => x.id === e.id);
    saveRecord(store, actor, 'employees', { ...fresh, endDate: m.effectiveDate, active: m.effectiveDate >= localToday() ? fresh.active : false }, { trusted: true });
    disableLoginsFor(store, actor, e.id, `${c.separationKind || 'separation'} effective ${m.effectiveDate}`);
    return { ...m, status: 'applied', appliedAt: new Date().toISOString(), clearance: CLEARANCE_ITEMS.map(([key, label, owner]) => ({ key, label, owner, status: 'pending' })) };
  }
  if (c.department && c.department !== e.department) { const fresh = store.read().employees.find(x => x.id === e.id); saveRecord(store, actor, 'employees', { ...fresh, department: c.department }, { trusted: true }); }
  const next = { ...job, ...(c.position ? { position: c.position } : {}), ...(c.classification ? { employmentStatus: c.classification } : {}), ...(c.employmentType ? { employmentType: c.employmentType } : {}), ...(m.type === 'regularization' ? { regularizationDate: m.effectiveDate } : {}) };
  if (JSON.stringify(next) !== JSON.stringify(job)) saveProfile(store, actor, e.id, 'employment', next);
  return { ...m, status: 'applied', appliedAt: new Date().toISOString() };
}
export function decideMovement(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }).strict().parse(input);
  if (v.decision === 'reject' && v.note.length < 5) throw new AppError('Give the reason for rejecting (at least 5 characters).');
  return store.transaction(() => {
    const m = all(store).find(x => x.id === id);
    if (!m) throw new AppError('Movement not found.', 404);
    if (m.status !== 'pending') throw new AppError('This movement was already decided.');
    if (m.requestedBy === actor.username) throw new AppError('A second HR Manager or Administrator must approve this movement: you requested it.');
    let next = { ...m, status: v.decision === 'approve' ? 'approved' : 'rejected', decidedBy: actor.username, decidedAt: new Date().toISOString(), decisionNote: v.note };
    if (v.decision === 'approve' && m.effectiveDate <= localToday()) next = apply(store, actor, next);
    save(store, next);
    store.log(actor, `${v.decision}-movement`, 'movements', m.employeeId, m, next);
    return next;
  });
}
export function applyDueMovements(store, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
  const due = all(store).filter(m => m.status === 'approved' && m.effectiveDate <= today);
  for (const m of due) store.transaction(() => { const next = apply(store, { username: 'system', role: 'admin' }, m); save(store, next); store.log({ username: 'system' }, 'apply-movement', 'movements', m.employeeId, m, next); });
  return due.length;
}
export function clearItem(store, actor, id, input) {
  permit(actor, ['admin', 'hr', 'payroll']);
  const v = z.object({ key: z.string().max(40), status: z.enum(['cleared', 'not-applicable', 'pending']), note: z.string().trim().max(1000).default('') }).strict().parse(input);
  if (v.status !== 'pending' && v.note.length < 3) throw new AppError('Add a note (what was returned, settled or checked).');
  return store.transaction(() => {
    const m = all(store).find(x => x.id === id);
    if (!m?.clearance) throw new AppError('Clearance not found.', 404);
    if (!m.clearance.some(i => i.key === v.key)) throw new AppError('Clearance item not found.', 404);
    const clearance = m.clearance.map(i => (i.key === v.key ? { ...i, status: v.status, note: v.note, by: actor.username, at: new Date().toISOString() } : i));
    const complete = clearance.every(i => i.status !== 'pending');
    const next = { ...m, clearance, clearanceCompleteAt: complete ? (m.clearanceCompleteAt || new Date().toISOString()) : null };
    save(store, next);
    store.log(actor, 'clearance', 'movements', m.employeeId, null, { item: v.key, status: v.status, note: v.note });
    if (complete && !m.clearanceCompleteAt) store.notify(null, `Clearance of ${m.employeeName} is complete.`);
    return next;
  });
}
export function listMovements(store, actor, employeeId = '') {
  permit(actor, VIEW);
  return all(store, employeeId || null).map(m => ({ ...m, canDecide: MANAGE.includes(actor.role) && m.status === 'pending' && m.requestedBy !== actor.username, canClear: ['admin', 'hr', 'payroll'].includes(actor.role) }));
}
