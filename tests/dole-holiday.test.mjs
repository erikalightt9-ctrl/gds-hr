import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { calculatePayroll, dates, isRest, ruleOn } from '../src/engine.mjs';
import { defaultRules, initialState } from '../src/defaults.mjs';
import { DOLE_HOLIDAY_BASIS, DOLE_HOLIDAY_DRAFT_ID, DOLE_HOLIDAY_EFFECTIVE, DOLE_HOLIDAY_RATES, holidayPremiums } from '../src/holiday-rates.mjs';
import { doleHolidayDraft, runMigrations } from '../src/migrations.mjs';

// Daily rate 800, 8-hour day → hourly 100, so a percent is a peso amount (130% of an hour = 130).
const DAILY = 800, HOURLY = 100;
const round2 = n => Math.round(n * 100) / 100;

function baseState() {
  const s = initialState();
  const zero = [{ from: 0, to: null, fixed: 0, rate: 0, excessOver: 0 }];
  s.rules = [{
    ...defaultRules, id: 'dole', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true,
    calendarReviewedYears: [2026], dailyDivisor: 26, overtimeApproval: 'attendance',
    contributions: { SSS: zero, PhilHealth: zero, 'Pag-IBIG': zero }, taxBrackets: zero,
  }];
  s.employees = [{
    id: 'E1', name: 'Holiday, Test', department: 'Ops', monthlySalary: 20800, startDate: '2025-01-01', endDate: '',
    restDays: [0], scheduleStart: '08:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true,
    leaveEligibility: ['vacation', 'unpaid'], active: true,
  }];
  s.employeeProfiles = [{ employeeId: 'E1', section: 'payroll', basis: 'daily', dailyRate: DAILY, hourlyRate: null, frequency: 'semi-monthly', schedule: '', status: 'Active', withholdingTax: 'exempt' }];
  return s;
}
const present = (date, extra = {}) => ({
  id: date, employeeId: 'E1', date, status: 'present', scheduledIn: extra.scheduledIn || '08:00', timeIn: extra.timeIn || '08:00',
  timeOut: extra.timeOut || '16:00', endNextDay: !!extra.endNextDay, breaks: [], approved: true, offsetMinutes: 0, exception: false,
  explanation: '', holidayEligible: true, ...extra,
});
function fill(s, start, end, skip = []) {
  const skipSet = new Set(skip);
  s.attendance = dates(start, end).filter(d => !isRest(s.employees[0], d) && !skipSet.has(d)).map(d => present(d));
  return s;
}
const pay = (s, start, end) => calculatePayroll(s, start, end).rows[0];
const holidayPayOn = (row, date) => row.holidays.find(h => h.date === date)?.pay;

test('default rules match the DOLE handbook combined rates', () => {
  const p = holidayPremiums(defaultRules);
  assert.deepEqual(p, {
    regularUnworked: 1, regular: 2, regularOT: 2.6, regularRest: 2.6, regularRestOT: 3.38, regularNight: 2.2,
    specialUnworked: 1, special: 1.3, specialOT: 1.69, specialRest: 1.5, specialRestOT: 1.95,
    doubleUnworked: 2, double: 3, doubleOT: 3.9, doubleRest: 3.9, doubleRestOT: 5.07,
    nsd: 0.1,
  });
  assert.deepEqual({ ...DOLE_HOLIDAY_RATES }, {
    ordinaryOT: defaultRules.ordinaryOT, rest: defaultRules.rest, premiumOT: defaultRules.premiumOT,
    special: defaultRules.special, specialRest: defaultRules.specialRest, regular: defaultRules.regular,
    double: defaultRules.double, other: defaultRules.other, nsd: defaultRules.nsd,
    specialUnworked: defaultRules.specialUnworked, regularUnworked: defaultRules.regularUnworked,
    doubleUnworked: defaultRules.doubleUnworked, otherUnworked: defaultRules.otherUnworked,
  });
});

test('each holiday type, with overtime, prices at the DOLE percent of the hourly rate', () => {
  const day = '2026-11-16'; // Monday, inside the 16–30 cutoff
  const run = (kind, rest, timeOut) => {
    const s = baseState();
    if (rest) s.employees[0].restDays = [1]; // Monday off
    s.holidays = [{ id: 'h', date: day, name: 'Test', kind, basis: 'Test' }];
    fill(s, '2026-11-16', '2026-11-30', rest ? [] : [day]);
    if (rest) s.attendance = s.attendance.filter(a => a.date !== day);
    s.attendance.push(present(day, { timeOut }));
    return pay(s, '2026-11-16', '2026-11-30');
  };
  const regular = run('regular', false, '16:00');
  assert.equal(regular.earnings.regularHoliday, 8 * HOURLY * 1, '200% = day already in basic + 100% premium');
  assert.equal(regular.earnings.regularHolidayOT || 0, 0);
  const regularOT = run('regular', false, '18:00');
  assert.equal(regularOT.earnings.regularHoliday, 800);
  assert.equal(regularOT.earnings.regularHolidayOT, 2 * HOURLY * 2.6, '2 h × 260%');
  const regularRest = run('regular', true, '16:00');
  assert.equal(regularRest.earnings.regularHoliday, 8 * HOURLY * 2.6, '260% and the rest day is not already in basic');
  const regularRestOT = run('regular', true, '17:00');
  assert.equal(regularRestOT.earnings.regularHolidayOT, HOURLY * 3.38, '338%');
  const special = run('special', false, '17:00');
  assert.equal(special.earnings.specialHoliday, 8 * HOURLY * 0.3, '130% = basic + 30%');
  assert.equal(special.earnings.specialOT, HOURLY * 1.69, '169%');
  const specialRest = run('special', true, '17:00');
  assert.equal(specialRest.earnings.specialHoliday, 8 * HOURLY * 1.5, '150%');
  assert.equal(specialRest.earnings.specialOT, HOURLY * 1.95, '195%');
  const doubled = run('double', false, '17:00');
  assert.equal(doubled.earnings.regularHoliday, 8 * HOURLY * 2, '300% = basic + 200% premium');
  assert.equal(doubled.earnings.regularHolidayOT, HOURLY * 3.9, '390%');
  const doubleRest = run('double', true, '17:00');
  assert.equal(doubleRest.earnings.regularHoliday, 8 * HOURLY * 3.9, '390% on a rest day');
  assert.equal(doubleRest.earnings.regularHolidayOT, HOURLY * 5.07, '507%');
});

test('night differential is 10% of the holiday rate for that hour, added on top', () => {
  const s = baseState();
  s.holidays = [{ id: 'h', date: '2026-11-16', name: 'Night', kind: 'regular', basis: 'Test' }];
  fill(s, '2026-11-16', '2026-11-30', ['2026-11-16']);
  s.attendance.push(present('2026-11-16', { scheduledIn: '16:00', timeIn: '16:00', timeOut: '00:00', endNextDay: true }));
  const row = pay(s, '2026-11-16', '2026-11-30');
  assert.equal(row.earnings.regularHoliday, 800, '8 h at the 100% premium (200% total with basic)');
  assert.equal(row.earnings.nsd, 2 * HOURLY * 2 * 0.1, '2 night hours × 200% × 10%');
  const night = row.workBreakdown.find(b => b.night && !b.overtime);
  assert.equal(night.combinedMultiplier, 2.2, 'handbook: regular holiday night shift 2 × 1.1');
});

test('Bonifacio Day 30 November 2026 (regular holiday, Nov 16–30): 100% if the Saturday before was worked, 200% / 260% if worked', () => {
  const holiday = { id: 'bonifacio', date: '2026-11-30', name: 'Bonifacio Day', kind: 'regular', basis: 'Proclamation' };
  const setup = (skip = ['2026-11-30']) => {
    const s = baseState();
    s.holidays = [holiday];
    return fill(s, '2026-11-16', '2026-11-30', skip);
  };
  const qualified = pay(setup(), '2026-11-16', '2026-11-30');
  assert.equal(holidayPayOn(qualified, '2026-11-30'), DAILY, 'present on Sat 28 Nov → 100% of the daily rate');
  assert.equal(qualified.earnings.regularHoliday || 0, 0, 'not worked, so no 200% premium');
  const early = pay({ ...setup(), asOf: '2026-11-29' }, '2026-11-16', '2026-11-30');
  const due = pay({ ...setup(), asOf: '2026-11-30' }, '2026-11-16', '2026-11-30');
  assert.equal(holidayPayOn(early, '2026-11-30'), 0, 'not credited before the date');
  assert.equal(holidayPayOn(due, '2026-11-30'), DAILY);
  assert.equal(round2(due.earnings.basic - early.earnings.basic), DAILY);

  const absentBefore = setup(['2026-11-28', '2026-11-30']);
  assert.equal(holidayPayOn(pay(absentBefore, '2026-11-16', '2026-11-30'), '2026-11-30'), 0, 'absent the preceding workday');

  const onLeave = setup(['2026-11-28', '2026-11-30']);
  onLeave.leaves = [{ id: 'vl', employeeId: 'E1', typeId: 'vacation', startDate: '2026-11-28', endDate: '2026-11-28', days: 1, status: 'approved', eligibilityVerified: true }];
  assert.equal(holidayPayOn(pay(onLeave, '2026-11-16', '2026-11-30'), '2026-11-30'), DAILY, 'paid leave on the preceding workday');

  const worked = setup();
  worked.rules[0].overtimeApproval = 'separate';
  worked.attendance.push(present('2026-11-30', { timeOut: '18:00' }));
  worked.overtimeRequests = [{ employeeId: 'E1', date: '2026-11-30', status: 'approved', approvedHours: 2, startTime: '16:00', endTime: '18:00' }];
  const row = pay(worked, '2026-11-16', '2026-11-30');
  assert.equal(row.earnings.regularHoliday, 800, 'first 8 hours at 200% (800 already in basic)');
  assert.equal(row.earnings.regularHolidayOT, 520, '2 overtime hours at 260%');
  assert.equal(holidayPayOn(row, '2026-11-30'), DAILY);

  const uncovered = setup();
  uncovered.employees[0].coveredHoliday = false;
  assert.equal(holidayPayOn(pay(uncovered, '2026-11-16', '2026-11-30'), '2026-11-30'), 0);
});

test('unworked special day is paid by default (company policy), unpaid at 0; successive regular holidays follow the handbook', () => {
  const special = baseState();
  special.holidays = [{ id: 's', date: '2026-11-16', name: 'Special', kind: 'special', basis: 'Test' }];
  fill(special, '2026-11-16', '2026-11-30', ['2026-11-16']);
  assert.equal(holidayPayOn(pay(special, '2026-11-16', '2026-11-30'), '2026-11-16'), DAILY);
  special.rules[0].specialUnworked = 0;
  assert.equal(holidayPayOn(pay(special, '2026-11-16', '2026-11-30'), '2026-11-16'), 0);

  // 1 Apr 2026 Wednesday, 2 Apr Maundy Thursday, 3 Apr Good Friday. Sunday rest.
  const holy = (workedThursday = false, wednesday = 'present') => {
    const s = baseState();
    s.holidays = [
      { id: 'thu', date: '2026-04-02', name: 'Maundy Thursday', kind: 'regular', basis: 'Test' },
      { id: 'fri', date: '2026-04-03', name: 'Good Friday', kind: 'regular', basis: 'Test' },
    ];
    const skip = ['2026-04-02', '2026-04-03'];
    if (wednesday !== 'present') skip.push('2026-04-01');
    fill(s, '2026-04-01', '2026-04-15', skip);
    if (wednesday === 'leave') s.leaves = [{ id: 'vl', employeeId: 'E1', typeId: 'vacation', startDate: '2026-04-01', endDate: '2026-04-01', days: 1, status: 'approved', eligibilityVerified: true }];
    if (wednesday === 'unpaid') s.leaves = [{ id: 'ul', employeeId: 'E1', typeId: 'unpaid', startDate: '2026-04-01', endDate: '2026-04-01', days: 1, status: 'approved', eligibilityVerified: true }];
    if (workedThursday) s.attendance.push(present('2026-04-02'));
    return pay(s, '2026-04-01', '2026-04-15');
  };
  const both = holy(false, 'present');
  assert.equal(holidayPayOn(both, '2026-04-02'), DAILY);
  assert.equal(holidayPayOn(both, '2026-04-03'), DAILY, 'the Thursday qualified, so the Friday does too');
  const missed = holy(false, 'absent');
  assert.equal(holidayPayOn(missed, '2026-04-02'), 0);
  assert.equal(holidayPayOn(missed, '2026-04-03'), 0);
  const workedFirst = holy(true, 'absent');
  assert.equal(workedFirst.earnings.regularHoliday, 800, 'Thursday worked: 200%');
  assert.equal(holidayPayOn(workedFirst, '2026-04-03'), DAILY, 'working the first holiday pays the second');
  const leaveBefore = holy(false, 'leave');
  assert.equal(holidayPayOn(leaveBefore, '2026-04-02'), DAILY);
  assert.equal(holidayPayOn(holy(false, 'unpaid'), '2026-04-02'), 0);
});

test('an unworked double regular holiday pays 200% when the preceding workday was worked', () => {
  const s = baseState();
  s.holidays = [{ id: 'd', date: '2026-11-16', name: 'Double regular', kind: 'double', basis: 'Test' }];
  fill(s, '2026-11-16', '2026-11-30', ['2026-11-16']);
  // Sunday 15 Nov is a rest day, so the workday before Monday 16 Nov is Saturday 14 Nov.
  s.attendance.push(present('2026-11-14'));
  const row = pay(s, '2026-11-16', '2026-11-30');
  assert.equal(holidayPayOn(row, '2026-11-16'), DAILY, 'the 100% already in basic');
  assert.equal(row.earnings.regularHoliday, DAILY, 'the extra 100% (200% total)');
  s.attendance = s.attendance.filter(a => a.date !== '2026-11-14');
  const missed = pay(s, '2026-11-16', '2026-11-30');
  assert.equal(holidayPayOn(missed, '2026-11-16'), 0);
  assert.equal(missed.earnings.regularHoliday || 0, 0);
});

test('work from home counted present on the preceding workday qualifies for the regular holiday', () => {
  const s = baseState();
  s.holidays = [{ id: 'h', date: '2026-11-30', name: 'Bonifacio Day', kind: 'regular', basis: 'Test' }];
  s.employeeProfiles.push({ employeeId: 'E1', section: 'attendance', daySchedules: [{ day: 6, scheduleStart: '', scheduleEnd: '', hoursPerDay: null, mealBreakMinutes: null, arrangement: 'WFH', flexible: false, autoPresent: true }] });
  fill(s, '2026-11-16', '2026-11-30', ['2026-11-28', '2026-11-30']);
  assert.equal(holidayPayOn(pay(s, '2026-11-16', '2026-11-30'), '2026-11-30'), DAILY);
});

test('the DOLE rules version is saved as an unapproved draft and does not change finalized payroll', () => {
  const store = new Store(':memory:');
  try {
    const state = baseState();
    state.rules[0].id = 'live';
    state.rules[0].special = 9;
    state.rules[0].dailyDivisor = 26;
    const frozen = { id: 'run-1', status: 'posted', start: '2026-10-16', end: '2026-10-31', ruleId: 'live', rows: [{ employeeId: 'E1', earnings: { basic: 111, regularHoliday: 222 }, net: 100 }] };
    state.runs = [structuredClone(frozen)];
    store.write(state);
    store.log({ username: 'admin' }, 'create', 'holidays', 'keep', null, { date: '2026-01-01' });
    const auditBefore = store.audit().map(row => row.id);
    const runsBefore = JSON.stringify(store.read().runs);
    assert.equal(doleHolidayDraft(store), 1);
    const after = store.read();
    assert.equal(JSON.stringify(after.runs), runsBefore, 'posted rows are not rewritten');
    assert.equal(after.rules.find(r => r.id === 'live').special, 9, 'the approved version is not edited');
    assert.equal(after.rules.find(r => r.id === 'live').approvedBy, 'admin');
    const draft = after.rules.find(r => r.id === DOLE_HOLIDAY_DRAFT_ID);
    assert.ok(draft);
    assert.equal(draft.approvedBy, '');
    assert.equal(draft.effectiveDate, DOLE_HOLIDAY_EFFECTIVE);
    assert.equal(draft.dailyDivisor, 26, 'divisor and the rest of the approved version are copied');
    assert.equal(draft.regular, DOLE_HOLIDAY_RATES.regular);
    assert.equal(draft.special, DOLE_HOLIDAY_RATES.special);
    assert.equal(draft.specialUnworked, 1, 'company policy: unworked special days stay paid');
    assert.equal(draft.basis, DOLE_HOLIDAY_BASIS);
    assert.ok(draft.basis.length <= 1000);
    assert.doesNotMatch(draft.basis, /\bdraft\b/i);
    assert.equal(ruleOn(after, '2026-11-16').id, 'live', 'payroll still selects the approved version');
    assert.equal(doleHolidayDraft(store), 0, 'the migration runs once');
    const auditAfter = store.audit();
    assert.ok(auditBefore.every(id => auditAfter.some(row => row.id === id)), 'older audit rows stay');
    assert.ok(auditAfter.some(row => row.action === 'create' && row.kind === 'rules' && row.recordId === DOLE_HOLIDAY_DRAFT_ID));
    const computed = calculatePayroll(after, '2026-11-16', '2026-11-30');
    assert.equal(computed.ruleId, 'live');
    assert.equal(JSON.stringify(store.read().runs), runsBefore);
    assert.deepEqual(store.read().runs[0], frozen);
  } finally { store.close(); }
});

test('runMigrations wires the same unapproved draft and does not recalculate a finalized run', () => {
  const store = new Store(':memory:');
  try {
    const state = baseState();
    state.runs = [{ id: 'run-2', status: 'posted', start: '2026-10-01', end: '2026-10-15', ruleId: 'dole', rows: [{ employeeId: 'E1', net: 50, earnings: { regularHoliday: 7 } }] }];
    const before = JSON.stringify(state.runs);
    store.write(state);
    const result = runMigrations(store);
    assert.equal(result.doleHolidayDraft, 1);
    const saved = store.read();
    assert.equal(saved.rules.find(r => r.id === DOLE_HOLIDAY_DRAFT_ID).approvedBy, '');
    assert.equal(JSON.stringify(saved.runs), before);
    assert.equal(runMigrations(store).doleHolidayDraft, 0);
  } finally { store.close(); }
});
