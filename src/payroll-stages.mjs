// Payroll preview stays unsaved. Approved, Included and Paid are separate marks on a run (TH-DEV-04).
// Setting a status does not recalculate rows. A finalized (posted) run keeps the figures it already has.
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';
import { calculatePayroll } from './engine.mjs';
import { assertNamedActor, getPolicy } from './actors.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const manilaToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
const STAGES = { approved: 'payroll-approved', included: 'payroll-included', paid: 'payroll-paid' };

export function rulesSnapshot(state, ruleId) {
  const rule = state.rules.find(r => r.id === ruleId) || state.rules.find(r => r.approvedBy) || state.rules[0];
  if (!rule) return null;
  return {
    id: rule.id, effectiveDate: rule.effectiveDate, approvedBy: rule.approvedBy || '', approvedAt: rule.approvedAt || '',
    dailyDivisor: rule.dailyDivisor, hourlyDivisor: rule.hourlyDivisor,
    rates: { ordinaryOT: rule.ordinaryOT, rest: rule.rest, premiumOT: rule.premiumOT, special: rule.special, specialRest: rule.specialRest, regular: rule.regular, double: rule.double, other: rule.other, nsd: rule.nsd, specialUnworked: rule.specialUnworked, regularUnworked: rule.regularUnworked, doubleUnworked: rule.doubleUnworked },
  };
}

export function payrollCutoffs(year) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2200) throw new AppError('Choose a year.');
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0'), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push({ id: `${y}-${mm}-1`, label: `1–15 ${MONTHS[m - 1]} ${y}`, start: `${y}-${mm}-01`, end: `${y}-${mm}-15` });
    out.push({ id: `${y}-${mm}-2`, label: `16–${last} ${MONTHS[m - 1]} ${y}`, start: `${y}-${mm}-16`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` });
  }
  return out;
}

const draftKey = request => `${request.start}:${request.end}:${[...(request.employeeIds || [])].sort().join(',')}`;

export function savePayrollDraft(store, actor, request) {
  if (!actor || !['admin', 'payroll', 'hr'].includes(actor.role)) throw new AppError('You do not have permission for this action.', 403);
  return store.transaction(() => {
    const state = store.read();
    const computed = calculatePayroll({ ...state, asOf: manilaToday() }, request.start, request.end, !!request.pay13th, request.employeeIds || null);
    const key = draftKey(request);
    const existing = state.runs.find(r => r.status === 'draft' && r.draftKey === key);
    if (existing?.stages?.approved) throw new AppError('This draft is already approved. A preview does not change it.');
    const run = { ...computed, rulesVersion: rulesSnapshot(state, computed.ruleId), id: existing?.id || randomUUID(), status: 'draft', draftKey: key, stages: existing?.stages || {}, createdBy: existing?.createdBy || actor.username, createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.runs = [...state.runs.filter(r => r.id !== run.id), run];
    state.version++; store.write(state);
    store.log(actor, existing ? 'update-draft' : 'create-draft', 'runs', run.id, null, { start: run.start, end: run.end, rulesVersion: run.rulesVersion, fingerprint: run.fingerprint });
    return run;
  });
}

export function setPayrollStage(store, actor, runId, stage) {
  const action = STAGES[stage];
  if (!action) throw new AppError('Unknown payroll status.');
  return store.transaction(() => {
    assertNamedActor(actor, getPolicy(store), action);
    const state = store.read();
    const run = state.runs.find(r => r.id === runId);
    if (!run) throw new AppError('Payroll not found.', 404);
    if (run.status === 'reversed') throw new AppError('A reversed payroll cannot change status.');
    const stages = { ...(run.stages || {}) };
    if (stage === 'included' && !stages.approved) throw new AppError('Approve the payroll before including it.');
    if (stage === 'paid' && !stages.included) throw new AppError('Include the payroll before marking it paid.');
    if (stages[stage]) return run;
    const before = structuredClone(stages);
    const gross = run.totals?.gross;
    stages[stage] = { by: actor.username, byName: actor.displayName || actor.username, userId: actor.id || '', at: new Date().toISOString() };
    run.stages = stages;
    if (run.totals?.gross !== gross) throw new AppError('Payroll totals must not change when a status is set.');
    state.version++; store.write(state);
    store.log(actor, stage, 'runs', run.id, { stages: before }, { stages, start: run.start, end: run.end });
    return run;
  });
}
