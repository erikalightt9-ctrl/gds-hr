import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll } from '../src/service.mjs';
import { completeState, admin } from './helpers.mjs';
import { recordPayrollDecision } from '../src/attendance-validation.mjs';

// September 2026, EMP-001 (Mon-Fri 08:00-16:00) and EMP-002. Sep 1 = original punches; Sep 2 = record differs from the
// punch; Sep 3 = manual entry not approved; Sep 4 = pending time correction; Sep 7 = time in, no time out; others approved.
const evt = (store, id, emp, kind, date, time, extra = {}) => store.db.prepare('INSERT INTO clock_events VALUES(?,?,?,?,?)').run(id, emp, kind, date, JSON.stringify({ id, employeeId: emp, kind, workDate: date, time, recordedAt: `${date}T00:00:00Z`, ...extra }));
function fixture() {
  const store = new Store(':memory:'), s = completeState(); s.loans = [];
  s.employees.push({ ...s.employees[0], id: 'EMP-002', name: 'Second, Employee' });
  s.attendance = [...s.attendance, ...s.attendance.map(a => ({ ...a, id: `b-${a.date}`, employeeId: 'EMP-002' }))];
  const at = d => s.attendance.find(a => a.employeeId === 'EMP-001' && a.date === d);
  Object.assign(at('2026-09-01'), { id: 'clock-in1', approved: false, timeIn: '08:00', timeOut: '16:00', explanation: 'Employee clock events: HR must review exact unpaid breaks and approve.' });
  Object.assign(at('2026-09-02'), { id: 'clock-in2', approved: false, timeIn: '08:00', timeOut: '16:00' });
  Object.assign(at('2026-09-03'), { id: 'manual-sep3', approved: false });
  s.attendance = s.attendance.filter(a => !(a.employeeId === 'EMP-001' && a.date === '2026-09-07'));
  store.write(s);
  evt(store, 'in1', 'EMP-001', 'in', '2026-09-01', '08:00'); evt(store, 'out1', 'EMP-001', 'out', '2026-09-01', '16:00');
  evt(store, 'in2', 'EMP-001', 'in', '2026-09-02', '08:40'); evt(store, 'out2', 'EMP-001', 'out', '2026-09-02', '16:00');
  evt(store, 'in7', 'EMP-001', 'in', '2026-09-07', '08:05');
  store.db.exec('CREATE TABLE IF NOT EXISTS attendance_requests (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, status TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL)');
  store.db.prepare('INSERT INTO attendance_requests VALUES(?,?,?,?,?)').run('r4', 'EMP-001', 'pending', '2026-09-04', JSON.stringify({ id: 'r4', reference: 'AR-2026-0009', employeeId: 'EMP-001', date: '2026-09-04', status: 'pending' }));
  return store;
}

test('validation: original punches are System Validated, approved records HR Approved, everything else a specific review item', () => {
  const store = fixture();
  try {
    const p = preview(store, '2026-09-01', '2026-09-15'), row = p.rows.find(r => r.employeeId === 'EMP-001');
    const status = d => row.attendanceValidation.find(v => v.date === d);
    assert.equal(status('2026-09-01').status, 'system-validated', 'complete, consistent original punches need no approval');
    assert.equal(status('2026-09-08').status, 'hr-approved');
    const item = d => p.reviewItems.find(i => i.employeeId === 'EMP-001' && i.date === d);
    assert.deepEqual([item('2026-09-02').issue, item('2026-09-02').detail], ['conflict', 'time in 08:00 differs from the punch 08:40']);
    assert.equal(item('2026-09-03').issue, 'manual-entry');
    assert.equal(item('2026-09-04').issue, 'pending-correction');
    assert.deepEqual([item('2026-09-07').issue, item('2026-09-07').detail], ['missing-punch', 'Time in 08:05 with no time out']);
    assert.ok(!p.blockers.some(b => /not approved/.test(b)), 'no generic "attendance is not approved" message');
    assert.deepEqual(p.held, ['EMP-001'], 'only the affected employee is held');
    assert.equal(row.deductions.absence, 0, 'nothing is turned into an absence automatically');
  } finally { store.close(); }
});

test('posting: unaffected employees are processed, the held one waits for documented decisions, and the run keeps the validation trail', () => {
  const store = fixture();
  try {
    let p = preview(store, '2026-09-01', '2026-09-15');
    const first = postPayroll(store, admin, { start: '2026-09-01', end: '2026-09-15', pay13th: false, fingerprint: p.fingerprint });
    assert.deepEqual(first.rows.map(r => r.employeeId), ['EMP-002']);
    assert.deepEqual(first.heldEmployees.map(h => h.employeeId), ['EMP-001']);
    assert.equal(first.heldEmployees[0].items.length, 4);
    assert.throws(() => recordPayrollDecision(store, admin, { employeeId: 'EMP-001', date: '2026-09-02', mode: 'pay-recorded', note: '' }), /reason/);
    recordPayrollDecision(store, admin, { employeeId: 'EMP-001', date: '2026-09-02', mode: 'pay-recorded', note: 'Supervisor confirms 08:00 start; punch was delayed' });
    recordPayrollDecision(store, admin, { employeeId: 'EMP-001', date: '2026-09-03', mode: 'pay-recorded', note: 'Timesheet signed by the supervisor' });
    recordPayrollDecision(store, admin, { employeeId: 'EMP-001', date: '2026-09-04', mode: 'credit', note: 'Correction still under review; worked per CCTV' });
    recordPayrollDecision(store, admin, { employeeId: 'EMP-001', date: '2026-09-07', mode: 'hold', note: 'Time out unknown; pay once corrected' });
    p = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
    const row = p.rows[0];
    assert.equal(row.held, false);
    assert.ok(row.trace.some(t => t.date === '2026-09-07' && /not credited/.test(t.formula) && /hold/i.test(t.formula)), 'hold: the day is not paid, by HR decision');
    const second = postPayroll(store, admin, { start: '2026-09-01', end: '2026-09-15', pay13th: false, employeeIds: ['EMP-001'], fingerprint: p.fingerprint });
    const trail = second.rows[0].attendanceValidation;
    assert.equal(trail.find(v => v.date === '2026-09-01').status, 'system-validated');
    assert.deepEqual([trail.find(v => v.date === '2026-09-02').status, trail.find(v => v.date === '2026-09-02').by], ['decided', 'admin']);
    assert.throws(() => recordPayrollDecision(store, admin, { employeeId: 'EMP-001', date: '2026-09-07', mode: 'credit', note: 'Changed my mind later' }), /posted payroll/);
  } finally { store.close(); }
});
