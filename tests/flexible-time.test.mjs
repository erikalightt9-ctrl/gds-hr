import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, dates, isRest, scheduleOn } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';

// Flexible time (Nov 24, 2026): event staff with no fixed time in / out. 8 h a day, 60-min meal break, Sunday rest.
// Monthly 26,000; Nov 16-30 has 13 workdays (25 in November -> daily 1,040, hourly 130).
function state(flexibleTime = true) {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, dailyDivisor: 26 }];
  s.employees = [{ id: 'E1', name: 'Flex, Test', department: 'Admin', monthlySalary: 26000, startDate: '2025-01-01', endDate: '', active: true, restDays: [0], scheduleStart: '09:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: [] }];
  s.employeeProfiles = [{ employeeId: 'E1', section: 'attendance', scheduleEnd: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, flexibleTime }];
  s.attendance = dates('2026-11-16', '2026-11-30').filter(d => !isRest(s.employees[0], d)).map(d => ({ id: d, employeeId: 'E1', date: d, status: 'present', scheduledIn: '09:00', timeIn: '09:00', timeOut: '18:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  s.overtimeRequests = [];
  return s;
}
const on = (s, date, timeIn, timeOut) => { Object.assign(s.attendance.find(a => a.date === date), { timeIn, timeOut }); return s; };
const pay = s => calculatePayroll({ ...s, asOf: '2026-11-30' }, '2026-11-16', '2026-11-30').rows[0];

test('flexible time: any start, never late; 8 hours after a mid-shift meal break is a full day', () => {
  assert.equal(scheduleOn(state().employees[0], { flexibleTime: true }, '2026-11-17').flexible, true);
  const row = pay(on(state(), '2026-11-17', '13:00', '22:00'));
  assert.equal(row.late.find(l => l.date === '2026-11-17')?.deductibleMinutes || 0, 0, 'a 1 PM start is not late');
  assert.equal(row.undertimeMinutes, 0, '9 h span less the 1-hour meal break = 8 h');
  assert.equal(row.earnings.regularOT || 0, 0);
  const fixed = pay(on(state(false), '2026-11-17', '13:00', '22:00'));
  assert.ok(fixed.late.find(l => l.date === '2026-11-17').deductibleMinutes > 0, 'the same day on a fixed schedule is late');
});

test('flexible time: fewer hours is undertime; overtime counts after the regular hours with an approved filing', () => {
  assert.equal(pay(on(state(), '2026-11-18', '14:00', '20:00')).undertimeMinutes, 120, '6 hours worked, no meal break taken off a short day');
  const s = on(state(), '2026-11-19', '10:00', '21:00');   // 11 h span - 1 h meal = 10 h: 2 h after the regular 8
  assert.equal(pay(s).earnings.regularOT || 0, 0, 'no filing, no overtime pay');
  s.overtimeRequests = [{ id: 'o1', employeeId: 'E1', date: '2026-11-19', startTime: '19:00', endTime: '21:00', breakMinutes: 0, hours: 2, approvedHours: 2, status: 'approved', reason: 'Event', history: [] }];
  assert.equal(pay(s).earnings.regularOT, 325, '2 h x 130 x 1.25');
});

test('saving the attendance profile without the Flexible time field keeps it on', async () => {
  const { Store } = await import('../src/store.mjs');
  const { saveProfile } = await import('../src/profiles.mjs');
  const { saveSchedule } = await import('../src/work-schedule.mjs');
  const store = new Store(':memory:'), s = state(false); s.employeeProfiles = []; store.write(s);
  const admin = { username: 'admin', role: 'admin' };
  try {
    assert.equal(saveSchedule(store, admin, 'E1', { start: '09:00', end: '18:00', hoursPerDay: 8, mealBreakMinutes: 60, restDays: [0], arrangement: 'Office', flexible: true }).text, 'Flexible time · 8 h · Sun off');
    saveProfile(store, admin, 'E1', 'attendance', { scheduleEnd: '18:00', hoursPerDay: 8, mealBreakMinutes: 60 });
    const saved = JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id='E1' AND section='attendance'").get().data);
    assert.equal(saved.flexibleTime, true);
  } finally { store.close(); }
});

test('flexible time also applies on weekdays that have their own day schedule (hours and meal break from that day)', () => {
  const profile = { flexibleTime: true, hoursPerDay: 8, mealBreakMinutes: 60, daySchedules: [{ day: 2, scheduleStart: '09:00', scheduleEnd: '18:00', hoursPerDay: 8, mealBreakMinutes: 1 }] };
  const sched = scheduleOn(state().employees[0], profile, '2026-11-17');   // Tuesday
  assert.deepEqual([sched.flexible, sched.flexibleOT, sched.mealBreakMinutes], [true, true, 1]);
});
