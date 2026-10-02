// Per-employee SSS / PhilHealth / Pag-IBIG basis and share amounts, kept apart from the actual salary record.
// Internal company tool: HR and Admin set whatever the company decides. Every change needs a reason, keeps the
// previous amounts, the user and the date, applies from the chosen cutoff once saved, and can be removed later.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { ruleOn, contributionShares, activeContributionSetting } from './engine.mjs';

export const AGENCIES = ['SSS', 'PhilHealth', 'Pag-IBIG'];
const SHARE_KEYS = { SSS: ['sssEmployee', 'sssEmployer', 'sssEc'], PhilHealth: ['philHealthEmployee', 'philHealthEmployer'], 'Pag-IBIG': ['pagIbigEmployee', 'pagIbigEmployer'] };
const money = z.number().min(0).max(1e7).nullable().default(null);
const agencySchema = z.object({ basis: money, employee: money, employer: money, ec: money }).strict();
const changeSchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-(01|16)$/, 'Choose a cutoff start date (the 1st or the 16th).'),
  agencies: z.object(Object.fromEntries(AGENCIES.map(a => [a, agencySchema.default({})]))).strict(),
  reason: z.string().trim().min(10, 'Explain the change and its supporting record (at least 10 characters).').max(2000),
}).strict();
const reviewSchema = z.object({ decision: z.enum(['approve', 'reject', 'remove']), note: z.string().trim().max(1000).default('') }).strict();

const STAFF = ['admin', 'hr', 'payroll'], EDITORS = ['admin', 'hr'];
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

// A basis equal to the salary is stored as "use the salary".
function normalise(salary, input = {}) {
  const agency = agencySchema.parse(input);
  return agency.basis === salary ? { ...agency, basis: null } : agency;
}

export function contributionReview(store, actor, employeeId) {
  permit(actor, STAFF);
  const state = store.read(), employee = findEmployee(state, employeeId), today = new Date().toISOString().slice(0, 10);
  const rule = ruleOn(state, today) || state.rules[0], changes = rows(store, employeeId), active = activeSetting(changes, employeeId, today);
  return {
    employee: { id: employee.id, name: employee.name, monthlySalary: employee.monthlySalary },
    ruleId: rule?.id || null, asOf: today, standard: sharesFor(rule, employee, null), current: sharesFor(rule, employee, active), active,
    changes, canSubmit: EDITORS.includes(actor.role), canApprove: EDITORS.includes(actor.role),
  };
}

export function submitContributionChange(store, actor, employeeId, input) {
  permit(actor, EDITORS);
  const value = changeSchema.parse(input);
  return store.transaction(() => {
    const state = store.read(), employee = findEmployee(state, employeeId), salary = employee.monthlySalary || 0;
    if (employee.draft) throw new AppError('Complete this draft employee profile first.');
    const agencies = Object.fromEntries(AGENCIES.map(name => [name, normalise(salary, value.agencies[name])]));
    const rule = ruleOn(state, value.effectiveDate) || state.rules[0];
    const before = sharesFor(rule, employee, activeSetting(state.contributionChanges, employeeId, value.effectiveDate));
    const after = sharesFor(rule, employee, { agencies });
    const now = new Date().toISOString();
    const change = {
      id: randomUUID(), employeeId, effectiveDate: value.effectiveDate, agencies, reason: value.reason, monthlySalary: salary, ruleId: rule?.id || null, before, after,
      requestedBy: actor.username, requestedAt: now,
      // HR and Admin changes apply as soon as they are saved; payroll still has its own review before posting.
      status: 'approved', reviewedBy: actor.username, reviewedAt: now, reviewNote: 'Applied on save.',
    };
    store.db.prepare('INSERT INTO contribution_changes(id,employee_id,effective_date,status,data) VALUES(?,?,?,?,?)').run(change.id, employeeId, change.effectiveDate, change.status, JSON.stringify(change));
    store.log(actor, 'submit-contribution-change', 'contributions', change.id, before, change);
    return change;
  });
}

export function reviewContributionChange(store, actor, changeId, input) {
  permit(actor, EDITORS);
  const { decision, note } = reviewSchema.parse(input);
  return store.transaction(() => {
    const row = store.db.prepare('SELECT data FROM contribution_changes WHERE id=?').get(changeId);
    if (!row) throw new AppError('Contribution change not found.', 404);
    const change = JSON.parse(row.data);
    if (decision === 'remove' ? change.status !== 'approved' : change.status !== 'pending') throw new AppError(decision === 'remove' ? 'Only an applied change can be removed.' : 'This change has already been reviewed.');
    if (decision !== 'approve' && note.length < 3) throw new AppError(`Give a reason for ${decision === 'remove' ? 'removing' : 'rejecting'} the change.`);
    const updated = { ...change, status: { approve: 'approved', reject: 'rejected', remove: 'removed' }[decision], reviewedBy: actor.username, reviewedAt: new Date().toISOString(), reviewNote: note };
    store.db.prepare('UPDATE contribution_changes SET status=?, data=? WHERE id=?').run(updated.status, JSON.stringify(updated), changeId);
    store.log(actor, `${decision}-contribution-change`, 'contributions', changeId, change, updated);
    return updated;
  });
}
