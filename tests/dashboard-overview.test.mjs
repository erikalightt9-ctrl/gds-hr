import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { dashboardOverview } from '../src/dashboard-overview.mjs';

const rec = (date, timeIn, timeOut) => ({ id: `d-${date}`, employeeId: 'EMP-001', date, status: 'present', scheduledIn: '08:00', timeIn, timeOut, endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true });
function fixture() {
  const store = new Store(':memory:'), state = completeState();
  state.attendance = [rec('2026-10-01', '08:00', '16:00'), rec('2026-10-02', '08:00', '16:00')];
  state.leaves = [{ id: 'p1', employeeId: 'EMP-001', typeId: 'vacation', startDate: '2026-11-03', endDate: '2026-11-03', days: 1, countedDates: ['2026-11-03'], partialDates: [], reason: 'Trip', status: 'pending' }];
  store.write(state);
  return store;
}
const now = new Date('2026-11-02T02:00:00Z');   // Nov 2, 2026 10:00 AM Manila (a Monday)

test('dashboard overview: monthly attendance rate from the day-by-day records, quick stats, upcoming salary days', () => {
  const store = fixture();
  try {
    const o = dashboardOverview(store, admin, now);
    const oct = o.monthly.find(m => m.month === '2026-10');
    assert.equal(o.monthly.length, 7); assert.equal(o.monthly.at(-1).month, '2026-11');
    assert.equal(oct.present, 2); assert.equal(oct.workdays, 22, 'October 2026 has 22 weekdays');
    assert.equal(oct.rate, Math.round(2 / 22 * 1000) / 10);
    assert.equal(o.quick.pendingLeaves, 1);
    assert.ok(o.upcoming.some(e => e.title === 'Salary day' && e.date === '2026-11-08'), 'Oct 16-31 is paid on Nov 8');
    assert.ok(o.today && typeof o.today.present === 'number', 'HR / Admin see today from Live attendance');
    assert.ok(o.compliance && o.compliance.percent >= 0 && o.compliance.percent <= 100);
    assert.equal(o.employees.total, store.read().employees.filter(e => !e.archived).length);
  } finally { store.close(); }
});

test('dashboard overview: roles without Live attendance or 201 access get no figures for them; employees refused', () => {
  const store = fixture();
  try {
    const o = dashboardOverview(store, { username: 'p', role: 'payroll' }, now);
    assert.equal(o.today, null); assert.equal(o.compliance, null);
    assert.throws(() => dashboardOverview(store, { username: 'e', role: 'employee', employeeId: 'EMP-001' }, now), /permission/);
  } finally { store.close(); }
});
