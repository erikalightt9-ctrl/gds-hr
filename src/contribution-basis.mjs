// Per-employee government contribution basis and share adjustments, kept apart from the actual salary record.
// The salary never changes here. A basis below the salary is accepted only on a ground the agency's rules allow,
// every change needs a reason, keeps the previous amounts, and applies to payroll only once approved.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { ruleOn, contributionShares, activeContributionSetting } from './engine.mjs';

export const AGENCIES = ['SSS', 'PhilHealth', 'Pag-IBIG'];
// Grounds on which a basis may differ from the recorded monthly salary. "A lower salary was declared" is never one.
export const GROUNDS = {
  SSS: {
    lower: { 'actual-compensation': 'Actual compensation paid for the month is lower than the salary record (unpaid absences or leave, joined or separated mid-month, paid by days worked)' },
    higher: { 'other-compensation': 'Compensation includes regular allowances, commissions or other pay on top of the salary record' },
    rule: 'SSS contributions follow the Monthly Salary Credit for the compensation actually earned in the month.',
  },
  PhilHealth: {
    lower: { 'basic-salary': 'The salary record includes allowances or other pay that are not part of monthly basic salary' },
    higher: {},
    rule: 'PhilHealth premiums are computed on monthly basic salary, within the floor and ceiling in the approved table.',
  },
  'Pag-IBIG': {
    lower: { 'basic-cola': 'The salary record includes pay other than basic salary and COLA' },
    higher: {},
    rule: 'Pag-IBIG contributions are computed on monthly compensation (basic salary and COLA), up to the maximum fund salary in the approved table.',
  },
};
const SHARE_KEYS = { SSS: ['sssEmployee', 'sssEmployer', 'sssEc'], PhilHealth: ['philHealthEmployee', 'philHealthEmployer'], 'Pag-IBIG': ['pagIbigEmployee', 'pagIbigEmployer'] };
const money = z.number().min(0).max(1e7).nullable().default(null);
const agencySchema = z.object({ basis: money, ground: z.string().max(40).default(''), employee: money, employer: money, ec: money }).strict();
const changeSchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-(01|16)$/, 'Choose a cutoff start date (the 1st or the 16th).'),
  agencies: z.object(Object.fromEntries(AGENCIES.map(a => [a, agencySchema.default({})]))).strict(),
  reason: z.string().trim().min(10, 'Explain the change and its supporting record (at least 10 characters).').max(2000),
}).strict();
const reviewSchema = z.object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') }).strict();

const STAFF = ['admin', 'hr', 'payroll'];
const findEmployee = (state, id) => { const e = state.employees.find(x => x.id === id); if (!e) throw new AppError('Employee not found.', 404); return e; };
const rows = (store, employeeId) => store.db.prepare('SELECT data FROM contribution_changes WHERE employee_id=? ORDER BY effective_date DESC, rowid DESC').all(employeeId).map(r => JSON.parse(r.data));

const activeSetting = activeContributionSetting;
// Monthly basis and shares for each agency under a setting (null = the salary and the rules table).
export function sharesFor(rule, employee, setting) {
  const salary = employee.monthlySalary || 0;
  return Object.fromEntries(AGENCIES.map(name => {
    const a = setting?.agencies?.[name] || {}, basis = a.basis ?? salary, [ee, er, ec] = SHARE_KEYS[name];
    const override = { [ee]: a.employee, [er]: a.employer, ...(ec ? { [ec]: a.ec } : {}) };
    const s = rule ? contributionShares(name, rule.contributions[name], basis, `${employee.id} ${name}`, [], override) : { employee: 0, employer: 0, ec: 0 };
    return [name, { basis, employee: s.employee, employer: s.employer, ec: name === 'SSS' ? s.ec : 0, basisAdjusted: a.basis !== null && a.basis !== undefined, sharesAdjusted: s.overridden, ground: a.ground || '' }];
  }));
}

function checkBasis(name, salary, input = {}) {
  const agency = agencySchema.parse(input);
  if (agency.basis === null) return { ...agency, ground: '' };
  if (agency.basis === salary) return { ...agency, basis: null, ground: '' };
  const direction = agency.basis < salary ? 'lower' : 'higher', allowed = GROUNDS[name][direction];
  if (!Object.keys(allowed).length) throw new AppError(`${name}: a basis ${direction} than the actual salary is not permitted. ${GROUNDS[name].rule}`);
  if (!allowed[agency.ground]) throw new AppError(`${name}: a basis ${direction} than the actual monthly salary (${salary.toLocaleString('en-PH')}) needs a permitted ground.${direction === 'lower' ? ' Declaring a lower salary is not a ground.' : ''} ${GROUNDS[name].rule}`);
  return agency;
}

export function contributionReview(store, actor, employeeId) {
  permit(actor, STAFF);
  const state = store.read(), employee = findEmployee(state, employeeId), today = new Date().toISOString().slice(0, 10);
  const rule = ruleOn(state, today) || state.rules[0], changes = rows(store, employeeId), active = activeSetting(changes, employeeId, today);
  return {
    employee: { id: employee.id, name: employee.name, monthlySalary: employee.monthlySalary },
    ruleId: rule?.id || null, asOf: today, standard: sharesFor(rule, employee, null), current: sharesFor(rule, employee, active), active,
    changes, grounds: GROUNDS, canSubmit: STAFF.includes(actor.role), canApprove: actor.role === 'admin',
  };
}

export function submitContributionChange(store, actor, employeeId, input) {
  permit(actor, STAFF);
  const value = changeSchema.parse(input);
  return store.transaction(() => {
    const state = store.read(), employee = findEmployee(state, employeeId), salary = employee.monthlySalary || 0;
    if (employee.draft) throw new AppError('Complete this draft employee profile first.');
    const agencies = Object.fromEntries(AGENCIES.map(name => [name, checkBasis(name, salary, value.agencies[name])]));
    const rule = ruleOn(state, value.effectiveDate) || state.rules[0];
    const before = sharesFor(rule, employee, activeSetting(state.contributionChanges, employeeId, value.effectiveDate));
    const after = sharesFor(rule, employee, { agencies });
    const now = new Date().toISOString(), admin = actor.role === 'admin';
    const change = {
      id: randomUUID(), employeeId, effectiveDate: value.effectiveDate, agencies, reason: value.reason, monthlySalary: salary, ruleId: rule?.id || null, before, after,
      requestedBy: actor.username, requestedAt: now,
      // An administrator's own change takes effect at once and is recorded as such; others wait for an administrator.
      status: admin ? 'approved' : 'pending', reviewedBy: admin ? actor.username : '', reviewedAt: admin ? now : '', reviewNote: admin ? 'Entered and approved by an administrator.' : '',
    };
    store.db.prepare('INSERT INTO contribution_changes(id,employee_id,effective_date,status,data) VALUES(?,?,?,?,?)').run(change.id, employeeId, change.effectiveDate, change.status, JSON.stringify(change));
    store.log(actor, 'submit-contribution-change', 'contributions', change.id, before, change);
    if (admin) store.log(actor, 'approve-contribution-change', 'contributions', change.id, null, { employeeId, effectiveDate: change.effectiveDate });
    return change;
  });
}

export function reviewContributionChange(store, actor, changeId, input) {
  permit(actor, ['admin']);
  const { decision, note } = reviewSchema.parse(input);
  return store.transaction(() => {
    const row = store.db.prepare('SELECT data FROM contribution_changes WHERE id=?').get(changeId);
    if (!row) throw new AppError('Contribution change not found.', 404);
    const change = JSON.parse(row.data);
    if (change.status !== 'pending') throw new AppError('This change has already been reviewed.');
    if (decision === 'reject' && note.length < 3) throw new AppError('Give a reason for rejecting the change.');
    const updated = { ...change, status: decision === 'approve' ? 'approved' : 'rejected', reviewedBy: actor.username, reviewedAt: new Date().toISOString(), reviewNote: note };
    store.db.prepare('UPDATE contribution_changes SET status=?, data=? WHERE id=?').run(updated.status, JSON.stringify(updated), changeId);
    store.log(actor, `${decision}-contribution-change`, 'contributions', changeId, change, updated);
    return updated;
  });
}
