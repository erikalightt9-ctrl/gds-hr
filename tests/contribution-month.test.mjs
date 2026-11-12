import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { addContributionEmployee } from '../src/contribution-encode.mjs';
import { monthlyContributions, firstMonthWorkdays } from '../src/contribution-report.mjs';
import { saveMonthEdit } from '../src/contribution-month.mjs';

function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }
const setStart = (store, id, startDate) => { const s = store.read(); s.employees = s.employees.map(e => (e.id === id ? { ...e, startDate, restDays: [0] } : e)); store.write(s); };

test('first month: remitted only with 15 or more workdays from the start date, otherwise listed as not included', () => {
  const store = fixture();
  try {
    addContributionEmployee(store, admin, { lastName: 'Bay', firstName: 'Eric', employeeNumber: 'N-1', monthlySalary: 25000, startMonth: '2026-10' });
    assert.equal(firstMonthWorkdays({ startDate: '2026-10-22', restDays: [0] }, '2026-10'), 9, 'Oct 22-31 less Sunday Oct 25');
    assert.equal(firstMonthWorkdays({ startDate: '2026-10-22', restDays: [0] }, '2026-11'), null, 'not the first month');
    setStart(store, 'N-1', '2026-10-22');
    const oct = monthlyContributions(store, '2026-10');
    assert.ok(!oct.people.some(p => p.employeeId === 'N-1'));
    assert.deepEqual(oct.excluded.map(x => [x.employeeId, x.workdays]), [['N-1', 9]]);
    assert.ok(monthlyContributions(store, '2026-11').people.some(p => p.employeeId === 'N-1'), 'remitted from the next month');
    setStart(store, 'N-1', '2026-10-13');   // Oct 13-31: 17 workdays
    assert.ok(monthlyContributions(store, '2026-10').people.some(p => p.employeeId === 'N-1'));
  } finally { store.close(); }
});

test('month edit: any amount of one month (employer share included); blank boxes clear it; HR / Admin only; audited', () => {
  const store = fixture();
  try {
    addContributionEmployee(store, admin, { lastName: 'Cheng', firstName: 'Demry', employeeNumber: 'CEO-1', monthlySalary: 22000, startMonth: '2026-09' });
    const before = monthlyContributions(store, '2026-10').people.find(p => p.employeeId === 'CEO-1');
    saveMonthEdit(store, admin, { employeeId: 'CEO-1', month: '2026-10', values: { sssER: 0, phER: 0, piER: 0, sssEE: 0 }, reason: 'Not yet registered' });
    const p = monthlyContributions(store, '2026-10').people.find(x => x.employeeId === 'CEO-1');
    assert.equal(p.sssER, 0); assert.equal(p.phER, 0); assert.equal(p.piER, 0); assert.equal(p.sssEE, 0);
    assert.equal(p.computed.sssER, before.sssER); assert.equal(p.edited.reason, 'Not yet registered');
    assert.equal(p.deductions, Math.round((p.phEE + p.piEE) * 100) / 100);
    assert.equal(monthlyContributions(store, '2026-11').people.find(x => x.employeeId === 'CEO-1').sssER, before.sssER, 'other months unchanged');
    assert.throws(() => saveMonthEdit(store, { username: 'p', role: 'payroll' }, { employeeId: 'CEO-1', month: '2026-10', values: {} }), /permission/i);
    assert.throws(() => saveMonthEdit(store, admin, { employeeId: 'CEO-1', month: '2026-10', values: { sssER: -1 } }));
    saveMonthEdit(store, admin, { employeeId: 'CEO-1', month: '2026-10', values: {} });
    assert.equal(monthlyContributions(store, '2026-10').people.find(x => x.employeeId === 'CEO-1').sssER, before.sssER, 'back to computed');
    assert.deepEqual(store.audit().filter(a => a.kind === 'contributions').map(a => a.action).slice(0, 2), ['clear-contribution-month', 'edit-contribution-month']);
  } finally { store.close(); }
});
