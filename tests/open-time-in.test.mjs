import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll } from '../src/engine.mjs';
import { completeState } from './helpers.mjs';

test('a time in after the scheduled end with no time out does not stop the payroll; the day is flagged', () => {
  const s = completeState(); s.loans = [];
  const day = s.attendance[0].date;
  s.attendance = s.attendance.filter(a => a.date !== day);
  s.openClockIns = [{ id: 'evening', employeeId: 'EMP-001', workDate: day, time: '18:12' }];
  const run = calculatePayroll(s, '2026-09-01', '2026-09-15', false, ['EMP-001']);
  assert.equal(run.rows.length, 1, 'payroll is computed');
  assert.ok(run.blockers.some(b => b.includes(`timed in at 18:12 on ${day} with no time out`)), 'and the day is flagged for HR');
});
