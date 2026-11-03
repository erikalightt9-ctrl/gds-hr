import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { punch, submitExplanation, reviewExplanation, explanationsOverview, employeeDashboard, todayAttendance } from '../src/portal.mjs';
import { explanationsDue } from '../src/late-explanations.mjs';
import { runMigrations } from '../src/migrations.mjs';
import { preview } from '../src/service.mjs';

const worker = { id: 'worker', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
const reading = (kind, id, now, extra = {}) => ({ kind, requestId: id, latitude: 14.55, longitude: 121.02, accuracy: 15, capturedAt: now.toISOString(), ...extra });
const explain = date => ({ date, reason: 'Traffic', explanation: 'Heavy traffic on EDSA.', requestedOffset: 0 });
function fixture(edit = () => {}) {
  const store = new Store(':memory:'), s = completeState();
  // Sep 1-3: 20, 10 and 15 minutes late; Sep 4: 30 minutes late but an approved exception (official business).
  for (const [d, t] of [['2026-09-01', '08:20'], ['2026-09-02', '08:10'], ['2026-09-03', '08:15']]) s.attendance.find(a => a.date === d).timeIn = t;
  Object.assign(s.attendance.find(a => a.date === '2026-09-04'), { timeIn: '08:30', exception: true });
  edit(s); store.write(s);
  return store;
}
const dates = list => list.map(d => d.date).sort();

test('earlier records: 15 minutes or more late needs an explanation; under 15, exceptions and explained days do not', () => {
  const store = fixture();
  try {
    assert.deepEqual(dates(explanationsDue(store)), ['2026-09-01', '2026-09-03']);
    const first = explanationsDue(store).find(d => d.date === '2026-09-01');
    assert.equal(first.lateMinutes, 20); assert.equal(first.scheduledIn, '08:00');
    // An explanation (whatever HR decides) settles the day; it is never asked again.
    const e = submitExplanation(store, worker, explain('2026-09-01'));
    assert.deepEqual(dates(explanationsDue(store)), ['2026-09-03']);
    reviewExplanation(store, admin, e.id, { status: 'rejected', approvedOffset: 0, note: 'Not a valid reason' });
    assert.deepEqual(dates(explanationsDue(store)), ['2026-09-03'], 'a rejected explanation is a decision, not a new request');
    assert.deepEqual(dates(explanationsDue(store, undefined, { employeeId: 'EMP-001' })), ['2026-09-03']);
    const overview = explanationsOverview(store, admin);
    assert.equal(overview.due.length, 1); assert.equal(overview.explanations[0].status, 'rejected');
    assert.throws(() => explanationsOverview(store, worker), /permission/i);
  } finally { store.close(); }
});

test('the schedule of that day is used (day-specific start time; flexible days are never late)', () => {
  const store = fixture(s => {
    Object.assign(s.attendance.find(a => a.date === '2026-09-02'), { timeIn: '08:50', scheduledIn: '' });   // Wednesday starts 08:30: 20 min late
    Object.assign(s.attendance.find(a => a.date === '2026-09-03'), { timeIn: '11:00' });                    // Thursday is flexible
  });
  try {
    const profile = { daySchedules: [{ day: 3, scheduleStart: '08:30', scheduleEnd: '17:30', hoursPerDay: 8, mealBreakMinutes: 60, arrangement: 'Office' }, { day: 4, scheduleStart: '', scheduleEnd: '', hoursPerDay: 4, mealBreakMinutes: 0, arrangement: 'Office', flexible: true }] };
    store.db.prepare("INSERT INTO employee_profiles(employee_id, section, data) VALUES('EMP-001','attendance',?)").run(JSON.stringify(profile));
    assert.deepEqual(dates(explanationsDue(store)), ['2026-09-01', '2026-09-02']);
    assert.equal(explanationsDue(store).find(d => d.date === '2026-09-02').lateMinutes, 20);
  } finally { store.close(); }
});

test('administrators get one consolidated notice for earlier days, only once; records are unchanged', () => {
  const store = fixture();
  try {
    const before = JSON.stringify(store.read().attendance);
    runMigrations(store); runMigrations(store);
    const notices = store.db.prepare("SELECT message FROM notifications WHERE employee_id IS NULL AND message LIKE '%earlier late arrival%'").all();
    assert.equal(notices.length, 1); assert.match(notices[0].message, /^2 earlier late arrivals .* by 1 employee/);
    assert.equal(JSON.stringify(store.read().attendance), before, 'attendance records are not changed');
  } finally { store.close(); }
});

test('time in 15+ minutes late asks for an explanation and notifies the administrator; submitting notifies again', () => {
  const store = fixture(s => { s.attendance = []; });
  try {
    const late = new Date('2026-09-01T00:20:00Z');   // 08:20 in Manila, schedule 08:00
    punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', late), late);
    const admins = () => store.db.prepare('SELECT message FROM notifications WHERE employee_id IS NULL').all().map(r => r.message);
    assert.ok(admins().some(m => /20 minutes late on 2026-09-01\. Explanation required/.test(m)));
    assert.ok(store.db.prepare('SELECT message FROM notifications WHERE employee_id=?').all('EMP-001').some(r => /submit a written explanation/.test(r.message)));
    assert.deepEqual(dates(employeeDashboard(store, worker, late).explanationsDue), ['2026-09-01'], 'today, before the time out');
    submitExplanation(store, worker, explain('2026-09-01'));
    assert.ok(admins().some(m => /submitted an attendance explanation for 2026-09-01/.test(m)));
    assert.equal(explanationsDue(store).length, 0);
    assert.equal(todayAttendance(store, store.read().employees[0], late).lateLetter, undefined);
  } finally { store.close(); }
});

test('a time in under 15 minutes late asks for nothing', () => {
  const store = fixture(s => { s.attendance = []; });
  try {
    const now = new Date('2026-09-01T00:10:00Z');
    punch(store, worker, reading('in', '11111111-1111-4111-8111-111111111111', now), now);
    assert.equal(explanationsDue(store).length, 0);
    assert.ok(!store.db.prepare('SELECT message FROM notifications').all().some(r => /explanation/i.test(r.message)));
  } finally { store.close(); }
});

test('payroll lateness is the same whether or not an explanation was submitted (unapproved)', () => {
  const store = fixture();
  try {
    const row = () => { const r = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0]; return { net: r.net, late: r.late.map(l => l.deductibleMinutes) }; };
    const before = row();
    submitExplanation(store, worker, explain('2026-09-03'));
    assert.deepEqual(row(), before);
  } finally { store.close(); }
});
