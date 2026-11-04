import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview } from '../src/service.mjs';
import { completeState } from './helpers.mjs';
import { monthSheet } from '../public/attendance-month.js';

const saturday = '2026-09-05';
// EMP-001 works Monday to Saturday (rest day Sunday); Saturday is work from home, present without time in / out.
function fixture(autoPresent = true, change = () => {}) {
  const store = new Store(':memory:'), s = completeState();
  s.loans = []; s.employees[0].restDays = [0]; change(s); store.write(s);
  const profile = { daySchedules: [{ day: 6, scheduleStart: '', scheduleEnd: '', hoursPerDay: null, mealBreakMinutes: null, arrangement: 'WFH', flexible: false, autoPresent }] };
  store.db.prepare("INSERT INTO employee_profiles(employee_id,section,data) VALUES('EMP-001','attendance',?)").run(JSON.stringify(profile));
  return store;
}
const run = store => preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);

test('a work-from-home Saturday counts as a regular day worked without time in / out', () => {
  const without = fixture(false), withWfh = fixture(true);
  try {
    assert.ok(run(without).blockers.some(b => b.includes(`Missing attendance / approved leave on ${saturday}`)), 'normally a Saturday without time in is missing');
    const r = run(withWfh), row = r.rows[0];
    assert.ok(!r.blockers.some(b => b.includes(saturday)), 'no blocker for the WFH Saturday');
    assert.equal(row.daysPresent, run(without).rows[0].daysPresent + 2, 'both Saturdays of the cutoff are counted present');
    assert.equal(row.earnings.regularOT || 0, 0, 'no overtime from a WFH day');
    assert.ok(!row.trace.some(t => t.date === saturday && t.component === 'absence'), 'not deducted as absent');
  } finally { without.close(); withWfh.close(); }
});

test('a real time in or an approved leave on that Saturday takes precedence', () => {
  const store = fixture(true, s => {
    s.attendance.push({ ...s.attendance[0], id: 'sat-real', date: saturday, timeIn: '10:00', timeOut: '12:00', scheduledIn: '08:00' });
    s.leaves.push({ id: 'sat-leave', employeeId: 'EMP-001', typeId: s.leaveTypes[0].id, startDate: '2026-09-12', endDate: '2026-09-12', days: 1, countedDates: ['2026-09-12'], partialDates: [], reason: 'Errand', documentReference: '', status: 'approved', eligibilityVerified: true });
  });
  try {
    const row = run(store).rows[0];
    assert.ok(row.late.some(l => l.date === saturday && l.lateMinutes === 120), 'the real 10:00 time in is used (late from 08:00)');
    assert.ok(row.leaveNotes.some(n => n.startsWith('2026-09-12')), 'the approved leave is used on the other Saturday');
  } finally { store.close(); }
});

test('the monthly sheet shows the WFH Saturday as present', () => {
  const s = completeState(); s.employees[0].restDays = [0];
  s.employeeProfiles = [{ employeeId: 'EMP-001', section: 'attendance', daySchedules: [{ day: 6, autoPresent: true }] }];
  const html = monthSheet({ state: s, esc: x => String(x), today: '2026-09-30', month: '2026-09' });
  assert.match(html, /am-mark am-wfh" title="Present · work from home/);
});

test('the one-time update turns on WFH Saturdays for the listed staff only, audited', async () => {
  const { runMigrations, WFH_SATURDAY_STAFF } = await import('../src/migrations.mjs');
  const store = new Store(':memory:'), s = completeState();
  s.employees.push({ ...s.employees[0], id: WFH_SATURDAY_STAFF[0], name: 'Listed, Staff' });
  store.write(s);
  try {
    for (const id of [WFH_SATURDAY_STAFF[0], 'EMP-001']) store.db.prepare("INSERT INTO employee_profiles(employee_id,section,data) VALUES(?,'attendance',?)").run(id, JSON.stringify({ hoursPerDay: 8, daySchedules: [{ day: 6, scheduleStart: '', scheduleEnd: '', hoursPerDay: null, mealBreakMinutes: null, arrangement: 'WFH' }] }));
    assert.equal(runMigrations(store).wfhSaturday, 1);
    const sat = id => JSON.parse(store.db.prepare("SELECT data FROM employee_profiles WHERE employee_id=? AND section='attendance'").get(id).data).daySchedules.find(d => d.day === 6);
    assert.equal(sat(WFH_SATURDAY_STAFF[0]).autoPresent, true);
    assert.equal(sat('EMP-001').autoPresent, undefined, 'others are not changed');
    assert.ok(store.db.prepare("SELECT 1 FROM audit WHERE action='set-wfh-saturday'").get(), 'audited');
    assert.equal(runMigrations(store).wfhSaturday, 0, 'runs once');
  } finally { store.close(); }
});
