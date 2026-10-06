import test from 'node:test';
import assert from 'node:assert/strict';
import { titleCase, personalNames, sectionNames } from '../src/names.mjs';

test('names are capitalized word by word', () => {
  assert.equal(titleCase('juan DELA cruz'), 'Juan Dela Cruz');
  assert.equal(titleCase('  ma.   rita  '), 'Ma. Rita');
  assert.equal(titleCase("anne-marie o'brien"), "Anne-Marie O'Brien");
  assert.equal(titleCase('iii'), 'III'); assert.equal(titleCase('jr.'), 'Jr.');
  assert.equal(titleCase('ñoño'), 'Ñoño');
  assert.deepEqual(personalNames({ firstName: 'PATRICK oliver', lastName: 'reyes', sex: 'Male' }), { firstName: 'Patrick Oliver', lastName: 'Reyes', sex: 'Male' });
  assert.equal(sectionNames('family', { spouse: { name: 'maria santos' }, children: [{ name: 'ana santos' }] }).children[0].name, 'Ana Santos');
});

test('existing upper-case names are capitalized once, with an audit entry', async () => {
  const { Store } = await import('../src/store.mjs');
  const { completeState } = await import('./helpers.mjs');
  const { capitalizeExistingNames } = await import('../src/names.mjs');
  const store = new Store(':memory:');
  try {
    const s = completeState(); s.employees[0].name = 'REYES, PATRICK OLIVER L.'; store.write(s);
    store.db.prepare("INSERT INTO employee_profiles VALUES('EMP-001','personal',?)").run(JSON.stringify({ lastName: 'REYES', firstName: 'PATRICK OLIVER', middleName: 'L.' }));
    assert.ok(capitalizeExistingNames(store) >= 2);
    assert.equal(store.read().employees[0].name, 'Reyes, Patrick Oliver L.');
    assert.equal(store.audit().find(a => a.kind === 'employees' && a.action === 'capitalize-names').before.name, 'REYES, PATRICK OLIVER L.');
    assert.equal(capitalizeExistingNames(store), 0, 'runs only once');
  } finally { store.close(); }
});

test('every employee is moved to GDS Capital HQ once, audited', async () => {
  const { Store } = await import('../src/store.mjs');
  const { completeState } = await import('./helpers.mjs');
  const { runMigrations, HEADQUARTERS } = await import('../src/migrations.mjs');
  const store = new Store(':memory:');
  try {
    store.write(completeState());
    assert.equal(runMigrations(store).departments, 1);
    assert.equal(store.read().employees[0].department, HEADQUARTERS);
    assert.equal(store.audit().find(a => a.action === 'set-department').before.department, 'Operations');
    assert.equal(runMigrations(store).departments, 0, 'runs only once');
  } finally { store.close(); }
});

test('leave policy: 7 days vacation leave + 5 days SIL for the named employees, SIL for others, after 1 year', async () => {
  const { Store } = await import('../src/store.mjs');
  const { completeState } = await import('./helpers.mjs');
  const { runMigrations } = await import('../src/migrations.mjs');
  const { leaveBalance } = await import('../src/engine.mjs');
  const store = new Store(':memory:');
  try {
    const s = completeState(), base = s.employees[0];
    s.employees = [{ ...base, id: '2017-0420', name: 'Hernando, Erika Lima', startDate: '2017-04-20', leaveEligibility: ['unpaid'] }, { ...base, id: '2018-0918', name: 'Dormiendo, Ma. Rita', startDate: '2018-09-18', leaveEligibility: ['sil'] }, { ...base, id: '2026-0908', name: 'Toledo, Alexis', startDate: '2026-09-08', leaveEligibility: ['sil'] }];
    if (!s.leaveTypes.some(t => t.id === 'vacation')) s.leaveTypes.push({ ...s.leaveTypes.find(t => t.id === 'sil'), id: 'vacation', name: 'Vacation Leave' });
    store.write(s); runMigrations(store);
    const st = store.read(), type = id => st.leaveTypes.find(t => t.id === id), emp = id => st.employees.find(e => e.id === id);
    assert.equal(type('vacation').entitledDays, 7); assert.equal(type('sil').entitledDays, 5); assert.equal(type('vacation').minServiceMonths, 12);
    assert.deepEqual(['sil', 'vacation'].every(t => emp('2017-0420').leaveEligibility.includes(t)), true, 'Erika: VL + SIL');
    assert.ok(!emp('2018-0918').leaveEligibility.includes('vacation'), 'Ma. Rita: SIL only');
    assert.equal(leaveBalance(st, emp('2017-0420'), type('vacation'), '2026-10-05').available, 7);
    assert.equal(leaveBalance(st, emp('2026-0908'), type('sil'), '2026-10-05').available, 0, 'new hire: after 1 year');
  } finally { store.close(); }
});

test('employees exempt from withholding tax have none; contributions once a month', async () => {
  const { Store } = await import('../src/store.mjs');
  const { completeState } = await import('./helpers.mjs');
  const { runMigrations } = await import('../src/migrations.mjs');
  const { calculatePayroll } = await import('../src/engine.mjs');
  const store = new Store(':memory:');
  try {
    const s = completeState(); s.rules[0].taxBrackets = [{ from: 0, to: null, fixed: 0, rate: 0.1, excessOver: 0 }]; s.rules[0].contributionTiming = 'second'; store.write(s);
    assert.ok(calculatePayroll(store.read(), '2026-09-01', '2026-09-15').rows[0].deductions.tax > 0);
    runMigrations(store);
    const st = store.read(), row = calculatePayroll(st, '2026-09-01', '2026-09-15').rows[0];
    assert.equal(row.deductions.tax, 0); assert.match(row.trace.find(t => t.component === 'tax').formula, /Exempt/);
    assert.equal(st.rules[0].contributionTiming, 'second', 'contributions once a month, on the 16th–end cutoff');
    assert.equal(row.contributionFactor, 0, 'nothing on the 1st–15th cutoff');
    assert.equal(calculatePayroll(st, '2026-09-16', '2026-09-30').rows[0].contributionFactor, 1, 'full monthly amount on the 16th–end cutoff');
  } finally { store.close(); }
});
