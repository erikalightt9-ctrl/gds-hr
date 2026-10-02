import { randomUUID } from 'node:crypto';
import { schemas } from './schema.mjs';
import { calculatePayroll, attendanceMinutes, leaveDates, isRest, leaveBalance } from './engine.mjs';

export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function permit(actor, roles) { if (!actor || !roles.includes(actor.role)) throw new AppError('You do not have permission for this action.', 403); }
export const entityRoles = { employees: ['admin', 'hr'], attendance: ['admin', 'hr'], leaves: ['admin', 'hr'], leaveTypes: ['admin'], holidays: ['admin', 'hr'], loans: ['admin', 'payroll'], adjustments: ['admin', 'payroll'], rules: ['admin'] };
function overlaps(a, b, c, d) { return a <= d && b >= c; }
function affectedPeriod(kind, value) {
  if (['attendance', 'holidays', 'adjustments'].includes(kind)) return [value.date, value.date];
  if (kind === 'leaves') return [value.startDate, value.endDate];
  if (kind === 'rules') return [value.effectiveDate, '9999-12-31'];
  return null;
}
function assertUnlocked(state, kind, value) {
  const period = affectedPeriod(kind, value);
  if (period && state.runs.some(r => r.status === 'posted' && overlaps(...period, r.start, r.end) && (!value.employeeId || r.rows.some(row => row.employeeId === value.employeeId)))) throw new AppError('This record affects posted payroll and is locked. Use an approved adjustment in an open cutoff.');
}
function validateBrackets(brackets, name) {
  const sorted = [...brackets].sort((a, b) => a.from - b.from);
  sorted.forEach((b, i) => {
    if ((b.to !== null && b.to <= b.from) || (i && (sorted[i - 1].to === null || b.from < sorted[i - 1].to))) throw new AppError(`${name} brackets overlap or have invalid boundaries.`);
  });
}
export function saveRecord(store, actor, kind, input) {
  if (!schemas[kind]) throw new AppError('Unknown record type.', 404);
  permit(actor, entityRoles[kind]);
  const recordInput = { ...input };
  const correctionReason = kind === 'attendance' ? recordInput.correctionReason : undefined;
  if (kind === 'attendance') delete recordInput.correctionReason;
  const value = schemas[kind].parse(recordInput);
  return store.transaction(() => {
    const state = store.read(), previous = state[kind].find(x => x.id === value.id);
    if (kind === 'employees' && previous) {
      const personal = store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='personal'").get(value.id);
      if (personal && value.name !== previous.name) throw new AppError('Update the name in Personal Information so all name fields stay synchronized.');
      const employment = store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='employment'").get(value.id);
      if (employment && value.active !== previous.active) {
        const before = JSON.parse(employment.data), after = { ...before, employeeStatus: value.active ? 'Active' : 'Inactive' };
        store.db.prepare("UPDATE employee_profiles SET data=? WHERE employee_id=? AND section='employment'").run(JSON.stringify(after), value.id);
        store.log(actor, 'update', 'profile:employment', value.id, before, after);
      }
    }
    assertUnlocked(state, kind, value); if (previous) assertUnlocked(state, kind, previous);
    if (kind === 'attendance' && previous && value.id.startsWith('clock-') && (value.employeeId !== previous.employeeId || value.date !== previous.date)) throw new AppError('Clock-linked attendance must retain its original employee and work date.');
    const employee = value.employeeId ? state.employees.find(e => e.id === value.employeeId) : null;
    if (value.employeeId && !employee) throw new AppError('Employee ID does not exist.');
    if (employee?.draft) throw new AppError('Complete this draft employee profile before adding attendance, leave, loans or payroll adjustments.');
    if (kind === 'employees' && value.draft && state.runs.some(r => r.rows.some(row => row.employeeId === value.id))) throw new AppError('An employee with posted payroll cannot be changed back to a draft.');
    if (kind === 'employees' && value.leaveEligibility.some(id => !state.leaveTypes.some(t => t.id === id))) throw new AppError('Unknown leave eligibility type.');
    if (kind === 'employees' && previous && state.runs.some(r => r.rows.some(row => row.employeeId === value.id)) && (value.startDate !== previous.startDate || (value.endDate && state.runs.some(r => r.end > value.endDate && r.rows.some(row => row.employeeId === value.id)))) ) throw new AppError('Employment dates cannot rewrite posted payroll.');
    if (kind === 'attendance') {
      if (value.status === 'present') attendanceMinutes(value);
      if (value.date < employee.startDate || (employee.endDate && value.date > employee.endDate)) throw new AppError('Attendance is outside employment dates.');
      if (state.attendance.some(a => a.id !== value.id && a.employeeId === value.employeeId && a.date === value.date)) throw new AppError('Attendance already exists for this employee and date.');
      if (value.status === 'present' && state.leaves.some(l => l.employeeId === value.employeeId && l.status === 'approved' && value.date >= l.startDate && value.date <= l.endDate && !isRest(employee, value.date))) throw new AppError('Attendance conflicts with approved leave.');
      if (value.status === 'present') {
        const mins = attendanceMinutes(value);
        for (const a of state.attendance.filter(a => a.employeeId === value.employeeId && a.id !== value.id && a.status === 'present')) {
          if (Math.abs(Date.parse(a.date) - Date.parse(value.date)) > 86400000) continue;
          const old = attendanceMinutes(a);
          if (mins.length && old.length && mins[0] <= old.at(-1) && mins.at(-1) >= old[0]) throw new AppError('This shift overlaps another attendance record.');
        }
      }
    }
    if (kind === 'leaves') {
      const type = state.leaveTypes.find(t => t.id === value.typeId);
      if (!type) throw new AppError('Leave type does not exist.');
      if (!type.approvalRequired && value.status === 'pending') value.status = 'approved';
      const prior = state.leaves.find(l => l.id === value.id);
      value.proofStatus = prior?.proofStatus ?? (type.documentsRequired && !value.documentReference.trim() ? 'required' : '');
      for (const key of ['proofNote', 'proofReviewedBy', 'proofReviewedAt']) value[key] = prior?.[key] ?? '';
      // HR typing a new reference (e.g. a paper certificate received in person) counts as HR confirming it.
      if (prior && ['required', 'rejected'].includes(prior.proofStatus) && value.documentReference.trim() && value.documentReference !== prior.documentReference) {
        Object.assign(value, { proofStatus: 'verified', proofNote: 'Recorded by HR', proofReviewedBy: actor.username, proofReviewedAt: new Date().toISOString() });
      }
      if (value.startDate < employee.startDate || (employee.endDate && value.endDate > employee.endDate)) throw new AppError('Leave is outside employment dates.');
      const scheduled = leaveDates(employee, type, value.startDate, value.endDate);
      if (scheduled.length !== value.days) throw new AppError(`Leave covers ${scheduled.length} scheduled days under its ${type.dayBasis}-day policy. Enter that number; partial-day leave is not supported.`);
      value.countedDates = scheduled; // Server-derived; callers cannot rewrite the counted dates.
      if (!['rejected', 'cancelled'].includes(value.status) && state.leaves.some(l => l.id !== value.id && l.employeeId === value.employeeId && !['rejected', 'cancelled'].includes(l.status) && overlaps(value.startDate, value.endDate, l.startDate, l.endDate))) throw new AppError('Leave dates overlap an existing request.');
      if (value.status === 'approved') {
        if (!value.eligibilityVerified || !employee.leaveEligibility.includes(type.id)) throw new AppError('HR must verify eligibility and enable this leave type in the employee profile.');
        const eligibleOn = new Date(`${employee.startDate}T00:00:00Z`);
        eligibleOn.setUTCMonth(eligibleOn.getUTCMonth() + type.minServiceMonths);
        if (value.startDate < eligibleOn.toISOString().slice(0, 10)) throw new AppError('The minimum service requirement for this leave type has not been met.');
        if (['required', 'rejected'].includes(value.proofStatus)) throw new AppError('Proof (a supporting document such as a medical certificate) is still needed. Ask the employee to upload it, then confirm it before approving.');
        if (type.documentsRequired && !value.documentReference.trim()) throw new AppError('Supporting document reference is required.');
        const without = { ...state, leaves: state.leaves.filter(l => l.id !== value.id) };
        if (type.balanceRequired) {
          const reservation = { ...value, countedDates: [] };
          without.leaves.push(reservation);
          for (const day of scheduled) {
            const bal = leaveBalance(without, employee, type, day);
            if (bal.available < 1) throw new AppError(`Insufficient leave balance on ${day}: ${bal.available} days available.`);
            reservation.countedDates.push(day);
          }
        }
        if (state.attendance.some(a => a.employeeId === value.employeeId && a.status === 'present' && a.date >= value.startDate && a.date <= value.endDate && !isRest(employee, a.date))) throw new AppError('Leave conflicts with recorded work.');
      }
    }
    if (kind === 'holidays' && state.holidays.some(h => h.id !== value.id && h.date === value.date)) throw new AppError('A holiday classification already exists for that date. Edit the existing record.');
    if (kind === 'loans' && previous && state.runs.some(r => r.rows.some(row => row.loanDeductions.some(l => l.loanId === value.id)))) throw new AppError('A loan used in posted payroll is immutable. Record a separately authorized adjustment or new loan.');
    if (kind === 'loans' && state.loans.some(l => l.id !== value.id && l.employeeId === value.employeeId && l.reference === value.reference)) throw new AppError('Duplicate employee loan reference.');
    if (kind === 'rules') {
      if (previous?.approvedBy) throw new AppError('Approved rules are immutable. Create a new version with a future effective date.');
      if (state.rules.some(r => r.id !== value.id && r.approvedBy && r.effectiveDate === value.effectiveDate)) throw new AppError('An approved rules version already uses that effective date.');
      Object.entries(value.contributions).forEach(([name, brackets]) => validateBrackets(brackets, name));
      validateBrackets(value.taxBrackets, 'Tax');
      value.approvedBy = value.approvedBy ? actor.username : ''; value.updatedAt = new Date().toISOString();
    }
    if (kind === 'attendance' && (previous || correctionReason !== undefined) && (typeof correctionReason !== 'string' || correctionReason.trim().length < 3 || correctionReason.length > 2000)) throw new AppError('Enter a reason for the attendance correction or approval (3–2,000 characters).');
    state[kind] = [...state[kind].filter(x => x.id !== value.id), value];
    state.version++; store.write(state); store.log(actor, previous ? 'update' : 'create', kind, value.id, previous, value);
    if (kind === 'attendance' && (previous || correctionReason)) {
      const correction = { reason: correctionReason.trim(), correctedBy: actor.username, approver: actor.username, at: new Date().toISOString(), before: previous || null, after: value };
      store.db.prepare('INSERT INTO attendance_corrections VALUES(?,?,?,?)').run(randomUUID(), value.employeeId, value.id, JSON.stringify(correction));
      store.log(actor, 'correction', 'attendance-correction', value.id, previous, { ...value, correction });
      store.notify(value.employeeId, `HR updated attendance for ${value.date}: ${correction.reason}`);
    }
    return value;
  });
}
// Only a profile with no work, pay, document or login history may be removed; others keep their audit trail.
function assertNoEmployeeHistory(store, state, id) {
  const linked = ['attendance', 'leaves', 'loans', 'adjustments'].some(k => state[k].some(x => x.employeeId === id))
    || state.runs.some(r => r.rows.some(row => row.employeeId === id))
    || ['employee_documents', 'clock_events', 'attendance_explanations', 'attendance_corrections'].some(t => store.db.prepare(`SELECT 1 FROM ${t} WHERE employee_id=?`).get(id));
  if (linked) throw new AppError('This employee has attendance, leave, payroll or document history and cannot be deleted. Set Employee status to Resigned or Inactive instead.');
  if (store.db.prepare('SELECT 1 FROM users WHERE employee_id=?').get(id)) throw new AppError('This employee has a portal login and cannot be deleted. Disable the login in Account & access and set Employee status to Inactive instead.');
}
export function deleteRecord(store, actor, kind, id) {
  if (!schemas[kind]) throw new AppError('Unknown record type.', 404);
  permit(actor, entityRoles[kind]);
  return store.transaction(() => {
    const state = store.read(), value = state[kind].find(x => x.id === id);
    if (!value) throw new AppError('Record not found.', 404);
    assertUnlocked(state, kind, value);
    if (kind === 'employees') { assertNoEmployeeHistory(store, state, id); store.db.prepare('DELETE FROM employee_profiles WHERE employee_id=?').run(id); }
    else if (['leaveTypes', 'loans', 'rules', 'attendance'].includes(kind)) throw new AppError('This record type cannot be deleted. Preserve its history and use a documented correction.');
    state[kind] = state[kind].filter(x => x.id !== id); state.version++;
    store.write(state); store.log(actor, 'delete', kind, id, value, null);
  });
}
export const preview = (store, start, end, pay13th = false) => calculatePayroll(store.read(), start, end, pay13th);
export function postPayroll(store, actor, request) {
  permit(actor, ['admin', 'payroll']);
  return store.transaction(() => {
    const state = store.read();
    const existing = state.runs.find(run => run.fingerprint === request.fingerprint);
    if (existing) return existing; // Idempotent retry after a successful commit.
    const computed = calculatePayroll(state, request.start, request.end, request.pay13th);
    if (computed.fingerprint !== request.fingerprint) throw new AppError('Records changed after preview. Recalculate and review payroll.', 409);
    if (computed.blockers.length) throw new AppError(`Resolve payroll blockers before posting: ${computed.blockers.slice(0, 5).join(' ')}`);
    const run = { ...computed, id: randomUUID(), status: 'posted', postedBy: actor.username, postedAt: new Date().toISOString(), sources: { employeeProfiles: state.employeeProfiles || [], employees: state.employees, attendance: state.attendance.filter(a => a.date >= request.start && a.date <= request.end), leaves: state.leaves.filter(l => overlaps(l.startDate, l.endDate, request.start, request.end)), rules: state.rules, holidays: state.holidays, loans: structuredClone(state.loans), adjustments: state.adjustments.filter(a => a.date >= request.start && a.date <= request.end), leaveTypes: state.leaveTypes } };
    for (const row of run.rows) for (const deduction of row.loanDeductions) {
      const loan = state.loans.find(l => l.id === deduction.loanId), before = structuredClone(loan);
      loan.balance = deduction.remainingBalance; loan.remainingTerms = deduction.remainingTerms;
      store.log(actor, 'payroll-deduction', 'loans', loan.id, before, loan);
    }
    state.runs.push(run); state.version++; store.write(state);
    for (const row of run.rows) store.notify(row.employeeId, `Your payslip for ${run.start} to ${run.end} is available.`);
    store.log(actor, 'post', 'runs', run.id, null, { start: run.start, end: run.end, totals: run.totals, fingerprint: run.fingerprint });
    return run;
  });
}
