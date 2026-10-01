import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { saveRecord, preview } from '../src/service.mjs';
import { leaveBalance } from '../src/engine.mjs';
import { admin } from './helpers.mjs';

test('name-only drafts persist without invented payroll details and cannot enter payroll', () => {
  const store = new Store(':memory:');
  try {
    const employee = { id: 'GDS-001', name: 'Test Employee', draft: true, department: '', monthlySalary: null, startDate: '', endDate: '', active: false, restDays: [], scheduleStart: '', coveredOT: false, coveredNSD: false, coveredHoliday: false, covered13th: false, leaveEligibility: [] };
    saveRecord(store, admin, 'employees', employee);
    assert.equal(store.read().employees[0].monthlySalary, null);
    assert.equal(preview(store, '2026-09-01', '2026-09-15').rows.length, 0);
    assert.equal(leaveBalance(store.read(), employee, store.read().leaveTypes[0], '2026-09-01').entitled, 0);
    assert.throws(() => saveRecord(store, admin, 'employees', { ...employee, draft: false }));
    assert.throws(() => saveRecord(store, admin, 'attendance', { id: 'a', employeeId: employee.id, date: '2026-09-01', status: 'absent', scheduledIn: '08:00', timeIn: '', timeOut: '', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: false }), /Complete/);
    saveRecord(store, admin, 'employees', { ...employee, draft: false, monthlySalary: 30000, department: 'Operations', startDate: '2026-09-01', scheduleStart: '08:00', active: true });
    assert.equal(preview(store, '2026-09-01', '2026-09-15').rows.length, 1);
  } finally { store.close(); }
});
