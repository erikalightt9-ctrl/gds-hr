// What store.read() adds for payroll attendance validation (see attendance-validation.mjs). No imports: the store
// loads it, so it must not depend on the service layer.
export const VALIDATION_LABELS = { 'system-validated': 'System Validated', 'hr-approved': 'HR Approved', decided: 'HR payroll decision', review: 'For HR review' };
export const ISSUE_LABELS = { 'missing-punch': 'Missing punch', conflict: 'Conflicting records', 'manual-entry': 'Manual entry not approved', 'pending-correction': 'Time correction pending' };
export const DECISIONS = { 'pay-recorded': 'Pay as recorded', credit: 'Credit as a worked day pending verification', hold: 'Hold: not paid until resolved', absent: 'Absent (verified by HR)' };
const OPEN_REQUEST = ['pending', 'review', 'info'];
const has = (db, table) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
export const ensureDecisions = db => db.exec('CREATE TABLE IF NOT EXISTS payroll_day_decisions (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(employee_id, date))');

// What store.read() adds for the engine: which records match their original punches, why the others do not, the
// pending and approved time corrections, and HR's payroll decisions.
export function validationInputs(db, attendance) {
  const events = new Map(), outs = new Map();
  for (const r of db.prepare('SELECT id, employee_id, kind, work_date, data FROM clock_events').all()) {
    const e = { id: r.id, kind: r.kind, employeeId: r.employee_id, workDate: r.work_date, ...JSON.parse(r.data) };
    if (e.kind === 'in') events.set(e.id, e);
    else { const key = `${e.employeeId}|${e.workDate}`; outs.set(key, [...(outs.get(key) || []), e]); }
  }
  const approvedCorrections = {}, pendingCorrections = [];
  if (has(db, 'attendance_requests')) for (const r of db.prepare('SELECT data FROM attendance_requests').all().map(x => JSON.parse(x.data))) {
    const key = `${r.employeeId}|${r.date}`;
    if (OPEN_REQUEST.includes(r.status)) pendingCorrections.push(key);
    if (r.status === 'approved' && r.decision?.approved) approvedCorrections[key] = { ...r.decision.approved, reference: r.reference, by: r.decision.by, at: r.decision.at };
  }
  const systemValidated = [], correctionValidated = [], punchIssues = {};
  for (const a of attendance.filter(x => String(x.id).startsWith('clock-'))) {
    const inEvent = events.get(String(a.id).slice(6)), dayOuts = (outs.get(`${a.employeeId}|${a.date}`) || []).filter(o => !inEvent || !o.clockInId || o.clockInId === inEvent.id);
    const lastOut = dayOuts.at(-1), correction = approvedCorrections[`${a.employeeId}|${a.date}`];
    const problems = [];
    if (!inEvent) problems.push('the original time in punch is missing');
    else if (a.timeIn !== inEvent.time && a.timeIn !== correction?.timeIn) problems.push(`time in ${a.timeIn || '—'} differs from the punch ${inEvent.time}`);
    if (!lastOut) problems.push('no time out punch');
    else if (a.timeOut !== lastOut.time && a.timeOut !== correction?.timeOut) problems.push(`time out ${a.timeOut || '—'} differs from the punch ${lastOut.time}`);
    if (lastOut?.geofence?.status === 'HR correction') problems.push('time out entered by HR');
    if ((a.breaks || []).length || /Additional off-site session/.test(a.explanation || '')) problems.push('an additional session after the time out (hours to review)');
    if ([inEvent, ...dayOuts].some(e => (e?.flags || []).some(f => /impossible travel/i.test(f)))) problems.push('impossible travel between punches');
    if (problems.length) punchIssues[a.id] = problems.join('; ');
    else if ((inEvent && a.timeIn !== inEvent.time) || (lastOut && a.timeOut !== lastOut.time)) correctionValidated.push(a.id);
    else systemValidated.push(a.id);
  }
  const payrollDecisions = has(db, 'payroll_day_decisions') ? db.prepare('SELECT data FROM payroll_day_decisions').all().map(r => JSON.parse(r.data)) : [];
  return { systemValidated, correctionValidated, punchIssues, pendingCorrections, approvedCorrections, payrollDecisions };
}

