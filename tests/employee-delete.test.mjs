import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { deleteRecord, saveRecord } from '../src/service.mjs';
import { saveProfile } from '../src/profiles.mjs';

const admin = { username: 'admin', role: 'admin' }, viewer = { username: 'viewer', role: 'viewer' };
const employee = id => ({ id, name: `Test, ${id}`, draft: true, active: false, department: '', monthlySalary: null, startDate: '', endDate: '', restDays: [0], scheduleStart: '', coveredOT: false, coveredNSD: false, coveredHoliday: false, covered13th: false, leaveEligibility: [] });
function fixture() {
  const store = new Store(':memory:');
  for (const id of ['E1', 'E2']) saveRecord(store, admin, 'employees', employee(id));
  saveProfile(store, admin, 'E1', 'personal', { lastName: 'Test', firstName: 'E1' });
  return store;
}

test('an employee without history can be deleted with their profile sections, leaving an audit entry', () => {
  const store = fixture();
  try {
    deleteRecord(store, admin, 'employees', 'E1');
    assert.deepEqual(store.read().employees.map(e => e.id), ['E2']);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM employee_profiles WHERE employee_id=?').get('E1').n, 0);
    assert.ok(store.audit().some(a => a.action === 'delete' && a.kind === 'employees' && a.recordId === 'E1' && a.before.id === 'E1'));
  } finally { store.close(); }
});

test('employees with records or a login cannot be deleted, and viewers cannot delete', () => {
  const store = fixture();
  try {
    assert.throws(() => deleteRecord(store, viewer, 'employees', 'E2'));
    const state = store.read();
    state.attendance.push({ id: 'a1', employeeId: 'E1', date: '2026-09-01', status: 'absent', scheduledIn: '', timeIn: '', timeOut: '', endNextDay: false, breaks: [], approved: false, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: false });
    store.write(state);
    assert.throws(() => deleteRecord(store, admin, 'employees', 'E1'), /history.*Resigned or Inactive/);
    store.db.prepare("INSERT INTO users (id, username, password_hash, role, employee_id) VALUES ('u1', 'e2', 'x', 'employee', 'E2')").run();
    assert.throws(() => deleteRecord(store, admin, 'employees', 'E2'), /login/);
    assert.equal(store.read().employees.length, 2, 'nothing removed');
  } finally { store.close(); }
});
