// Approval chains (Nov 24, 2026; role / workflow spec, Phase 2). A request passes its steps in order, each by the role
// that owns it, and every step is recorded on the request (approvals: step, decision, by, at, note):
//   leave     Supervisor (staffing) → HR (eligibility and balance) → approver (Company Admin / System Administrator)
//   overtime  Supervisor (the work) → HR / approver (hours against attendance)
// A step with nobody to take it (no Supervisor account for the employee's team) is recorded as skipped. One person
// holding several roles completes the steps they own in one action. A Company Admin / System Administrator may decide
// before a waiting Supervisor only with a written reason (recorded as an override). Anyone who owns the current or a
// later step may reject, with a reason. Approved requests are final, as before.
import { AppError } from './service.mjs';

export const STEP_LABELS = { supervisor: 'Supervisor', verify: 'HR verification', approve: 'Approval' };
const STEP_ROLES = {
  supervisor: ['dept_manager'],
  verify: ['hr_staff', 'maker', 'hr', 'admin'],
  approve: ['hr', 'admin'],
};
export const CHAINS = { leave: ['supervisor', 'verify', 'approve'], overtime: ['supervisor', 'approve'] };
const OVERRIDERS = ['hr', 'admin'];

// Supervisor logins of an employee's team: enabled Supervisor / Approver accounts linked to someone in the same
// department (company), never the employee themselves.
export function supervisorsFor(store, employeeId) {
  const state = store.read(), employee = state.employees.find(e => e.id === employeeId);
  if (!employee) return [];
  return store.db.prepare("SELECT username, employee_id FROM users WHERE role='dept_manager' AND (disabled IS NULL OR disabled=0) AND employee_id IS NOT NULL").all()
    .filter(u => u.employee_id !== employeeId && state.employees.find(e => e.id === u.employee_id)?.department === employee.department)
    .map(u => u.username);
}
// The next step still open, or null when every step is done.
export function stageOf(kind, record) {
  const done = new Set((record.approvals || []).map(a => a.step));
  return CHAINS[kind].find(s => !done.has(s)) || null;
}
const canTake = (actor, step, record, store) => STEP_ROLES[step].includes(actor.role)
  && (step !== 'supervisor' || supervisorsFor(store, record.employeeId).includes(actor.username));

// Applies a decision; returns { approvals, final: 'approved' | 'rejected' | null, stage }.
export function decide(store, actor, kind, record, { decision, note = '' }) {
  const now = new Date().toISOString(), approvals = [...(record.approvals || [])];
  const steps = CHAINS[kind], open = steps.filter(s => !approvals.some(a => a.step === s));
  if (!open.length) throw new AppError('This request has already passed every approval step.');
  const mine = open.filter(s => canTake(actor, s, record, store));
  if (decision === 'reject') {
    if (!mine.length) throw new AppError(`Waiting for ${STEP_LABELS[open[0]]}: you have no step to decide on this request.`, 403);
    if (note.trim().length < 3) throw new AppError('Give the reason for the rejection.');
    approvals.push({ step: mine[0], decision: 'rejected', by: actor.username, at: now, note: note.trim() });
    return { approvals, final: 'rejected', stage: null };
  }
  for (const step of open) {
    if (canTake(actor, step, record, store)) { approvals.push({ step, decision: step === 'supervisor' ? 'endorsed' : step === 'verify' ? 'verified' : 'approved', by: actor.username, at: now, note: note.trim() }); continue; }
    if (step === 'supervisor') {
      const supervisors = supervisorsFor(store, record.employeeId);
      if (!supervisors.length) { approvals.push({ step, decision: 'skipped', by: 'system', at: now, note: 'No Supervisor account for this team' }); continue; }
      if (OVERRIDERS.includes(actor.role) && mine.some(s => s !== 'supervisor')) {
        if (note.trim().length < 5) throw new AppError(`Waiting for the Supervisor's check (${supervisors.join(', ')}). To decide without it, write the reason in the remarks.`);
        approvals.push({ step, decision: 'overridden', by: actor.username, at: now, note: note.trim() }); continue;
      }
    }
    break;   // the next step belongs to someone else
  }
  if (approvals.length === (record.approvals || []).length) throw new AppError(`Waiting for ${STEP_LABELS[open[0]]}: you have no step to decide on this request.`, 403);
  const stage = stageOf(kind, { approvals });
  return { approvals, final: stage ? null : 'approved', stage };
}
export const stageLabel = (kind, record) => { const s = record.status === 'pending' ? stageOf(kind, record) : null; return s ? `Waiting for ${STEP_LABELS[s]}` : ''; };

// My approvals: pending requests whose current step this person owns (or, for a Company Admin / System
// Administrator, later steps they may complete), newest first.
export function inbox(store, actor) {
  const state = store.read(), types = new Map(state.leaveTypes.map(t => [t.id, t.name])), names = new Map(state.employees.map(e => [e.id, e.name]));
  const items = [];
  for (const l of state.leaves.filter(x => x.status === 'pending')) {
    const stage = stageOf('leave', l); if (!stage) continue;
    const mine = canTake(actor, stage, l, store) || (stage === 'supervisor' && OVERRIDERS.includes(actor.role));
    if (!mine || l.employeeId === actor.employeeId) continue;
    items.push({ kind: 'leave', id: l.id, reference: l.reference || '', employeeId: l.employeeId, employeeName: names.get(l.employeeId) || l.employeeId, what: `${types.get(l.typeId) || l.typeId} · ${l.days} day${l.days === 1 ? '' : 's'}`, dates: l.startDate === l.endDate ? l.startDate : `${l.startDate} to ${l.endDate}`, reason: l.reason || '', stage, stageLabel: STEP_LABELS[stage], ownStep: canTake(actor, stage, l, store), history: l.approvals || [] });
  }
  return items.sort((a, b) => b.dates.localeCompare(a.dates));
}
