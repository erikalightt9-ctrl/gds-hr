import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { saveRecordedMonth } from '../src/contribution-history.mjs';
import { myBenefits, employeeBenefits, benefitsOverview, recordRemittance, saveHmo, saveAllowance, recordAllowancePayment, proofFile } from '../src/benefits.mjs';

const employee = { id: 'u-emp', username: 'emp', role: 'employee', employeeId: 'EMP-001' };
const other = { id: 'u-other', username: 'other', role: 'employee', employeeId: 'EMP-002' };
const hr = { id: 'u-hr', username: 'hr.one', role: 'hr' };
const payroll = { id: 'u-pay', username: 'pay.one', role: 'payroll' };
const finance = { id: 'u-fin', username: 'fin.one', role: 'viewer', finance: true };
const viewer = { id: 'u-view', username: 'mgmt', role: 'viewer' };
const pdf = { name: 'SSS receipt.pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1.4 test').toString('base64') };

function fixture() {
  const store = new Store(':memory:');
  const state = completeState();
  state.employees.push({ ...state.employees[0], id: 'EMP-002', name: 'Other, Person' });
  store.write(state);
  // An October 2026 remittance sheet: the month's figures are final.
  saveRecordedMonth(store, admin, { month: '2026-10', fee: 0, rows: [
    { name: 'Sample Employee', employeeId: 'EMP-001', compensation: 20000, sssEE: 1000, sssER: 1910, phBasis: 20000, phEE: 500, phER: 500, piEE: 200, piER: 200 },
    { name: 'Other, Person', employeeId: 'EMP-002', compensation: 20000, sssEE: 1000, sssER: 1910, phBasis: 20000, phEE: 500, phER: 500, piEE: 200, piER: 200 },
  ] });
  return store;
}

test('contributions: report figures per agency; Finance records the payment (date, reference, status, proof); HR and Payroll cannot', () => {
  const store = fixture();
  try {
    const before = myBenefits(store, employee).contributions;
    assert.deepEqual(before.map(c => [c.month, c.agency, c.employeeShare, c.employerShare]), [['2026-10', 'sss', 1000, 1910], ['2026-10', 'philhealth', 500, 500], ['2026-10', 'pagibig', 200, 200]]);
    assert.equal(before[0].status, 'Remitted (recorded sheet)');
    assert.throws(() => recordRemittance(store, hr, { month: '2026-10', agency: 'sss', status: 'paid', paymentDate: '2026-11-10', reference: 'SSS-123' }), /Finance/);
    assert.throws(() => recordRemittance(store, payroll, { month: '2026-10', agency: 'sss', status: 'paid', paymentDate: '2026-11-10', reference: 'SSS-123' }), /Finance/);
    assert.throws(() => recordRemittance(store, finance, { month: '2026-10', agency: 'sss', status: 'paid', paymentDate: '2026-11-10', reference: '' }));
    const paid = recordRemittance(store, finance, { month: '2026-10', agency: 'sss', status: 'paid', paymentDate: '2026-11-10', reference: 'SSS-123', proof: pdf });
    assert.equal(paid.recordedBy, 'fin.one'); assert.ok(paid.proof.id);
    const sss = myBenefits(store, employee).contributions.find(c => c.agency === 'sss');
    assert.equal(sss.status, 'Paid'); assert.equal(sss.reference, 'SSS-123'); assert.equal(sss.paymentDate, '2026-11-10');
    const verified = recordRemittance(store, admin, { month: '2026-10', agency: 'sss', status: 'verified', paymentDate: '2026-11-10', reference: 'SSS-123' });
    assert.equal(verified.verifiedBy, 'admin'); assert.equal(verified.proof.id, paid.proof.id, 'the proof is kept when none is attached');
    assert.equal(myBenefits(store, employee).contributions.find(c => c.agency === 'sss').status, 'Verified');
    const audit = store.db.prepare("SELECT actor, action FROM audit WHERE kind='benefit-remittance' ORDER BY at, rowid").all();
    assert.deepEqual(audit.map(a => [a.actor, a.action]), [['fin.one', 'record'], ['admin', 'update']]);
    // Proof: the employee whose month it covers may open it; staff may; another employee's month only if theirs too.
    assert.equal(proofFile(store, employee, paid.proof.id).mime, 'application/pdf');
    assert.equal(proofFile(store, viewer, paid.proof.id).name, 'SSS receipt.pdf');
    assert.throws(() => proofFile(store, { ...employee, employeeId: 'EMP-404' }, paid.proof.id), /not found/i);
  } finally { store.close(); }
});

test('HMO: HR records the coverage (dependents, dates, status); employees only read; expired coverage reads Expired; audited and notified', () => {
  const store = fixture();
  try {
    const hmo = { employeeId: 'EMP-001', provider: 'Maxicare', memberNo: 'MX-1', plan: 'Gold', coverage: 'In-patient up to ₱150,000', startDate: '2026-01-01', endDate: '2026-12-31', status: 'Active', dependents: [{ name: 'Ana Sample', relationship: 'Daughter' }] };
    assert.throws(() => saveHmo(store, employee, hmo), /permission/);
    assert.throws(() => saveHmo(store, payroll, hmo), /permission/);
    assert.throws(() => saveHmo(store, hr, { ...hmo, endDate: '2025-01-01' }), /expiration/);
    saveHmo(store, hr, hmo);
    const mine = myBenefits(store, employee).hmo;
    assert.equal(mine.provider, 'Maxicare'); assert.equal(mine.dependents[0].relationship, 'Daughter');
    saveHmo(store, hr, { ...hmo, endDate: '2026-02-01' });
    assert.equal(myBenefits(store, employee).hmo.status, 'Expired', 'Active coverage past its expiration date reads Expired');
    assert.equal(myBenefits(store, other).hmo, null, 'each employee sees only their own');
    assert.equal(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='benefit-hmo'").get().n, 2);
    assert.ok(store.db.prepare("SELECT message FROM notifications WHERE employee_id='EMP-001'").all().some(n => /HMO/.test(n.message)));
  } finally { store.close(); }
});

test('allowances: HR adds and edits; HR or Finance records payments; Payroll and employees cannot change them; history lists every change', () => {
  const store = fixture();
  try {
    const base = { employeeId: 'EMP-001', type: 'Rice allowance', amount: 1500, frequency: 'Monthly', effectiveDate: '2026-10-01', status: 'Active', eligibility: 'Regular employees' };
    assert.throws(() => saveAllowance(store, payroll, base), /permission/);
    assert.throws(() => saveAllowance(store, employee, base), /permission/);
    const a = saveAllowance(store, hr, base);
    assert.throws(() => recordAllowancePayment(store, payroll, a.id, { date: '2026-10-31', amount: 1500 }), /HR, Finance/);
    recordAllowancePayment(store, finance, a.id, { date: '2026-10-31', amount: 1500, reference: 'PR-OCT' });
    saveAllowance(store, hr, { ...base, id: a.id, amount: 2000 });
    const mine = myBenefits(store, employee);
    assert.equal(mine.allowances.length, 1); assert.equal(mine.allowances[0].amount, 2000);
    assert.equal(mine.allowances[0].payments.length, 1, 'editing keeps the payment history');
    assert.equal(mine.allowances[0].payments[0].reference, 'PR-OCT');
    assert.deepEqual(mine.history.filter(h => h.category === 'Allowance').map(h => h.text.split(':')[0]), ['Rice allowance updated', 'Rice allowance payment recorded', 'Rice allowance added']);
    assert.ok(mine.history.every(h => h.by && h.at), 'every change shows who and when');
    assert.deepEqual(myBenefits(store, other).allowances, []);
    assert.throws(() => saveAllowance(store, hr, { ...base, id: a.id, employeeId: 'EMP-002' }), /another employee/);
  } finally { store.close(); }
});

test('views: employees use only their own page; staff (HR, Payroll, Finance, Management) read one employee and the consolidated report', () => {
  const store = fixture();
  try {
    assert.throws(() => myBenefits(store, hr), /Only employees/);
    assert.throws(() => employeeBenefits(store, employee, 'EMP-002'), /permission/);
    assert.throws(() => benefitsOverview(store, employee, '2026-10'), /permission/);
    for (const actor of [hr, payroll, finance, viewer, admin]) assert.equal(employeeBenefits(store, actor, 'EMP-001').contributions.length, 3);
    const report = benefitsOverview(store, viewer, '2026-10');
    assert.equal(report.remittances.find(r => r.agency === 'sss').total, 5820);
    assert.equal(report.canRecordPayments, false); assert.equal(benefitsOverview(store, finance, '2026-10').canRecordPayments, true);
    assert.equal(report.people.length, 2);
  } finally { store.close(); }
});

test('HMO billing from the provider sheet: HR / Finance see premium, VAT, invoice and account; the employee sees coverage only', () => {
  const store = fixture();
  try {
    const hmo = { employeeId: 'EMP-001', provider: 'Maxicare Healthcare Corporation', memberNo: '9700783986_XX000001', plan: 'Bronze', startDate: '2026-02-14', endDate: '2027-02-13', status: 'Active',
      account: '9700788655 - SAMPLE CORP.', planId: '20115909000040', rank: 'RANK AND FILE', months: 12, premium: 12527.68, vat: 1503.32, totalGross: 14031, movementType: 'Renewal', invoiceNo: 'BS-1', invoiceDate: '2026-03-16', benefitLimit: 70000, benefitType: 'MBL' };
    assert.throws(() => saveHmo(store, hr, { ...hmo, premium: -1 }), /./, 'negative amounts are refused');
    saveHmo(store, hr, hmo);
    const staff = employeeBenefits(store, hr, 'EMP-001').hmo;
    assert.equal(staff.premium, 12527.68); assert.equal(staff.invoiceNo, 'BS-1'); assert.equal(staff.account, '9700788655 - SAMPLE CORP.');
    const mine = myBenefits(store, employee).hmo;
    assert.equal(mine.planId, '20115909000040'); assert.equal(mine.rank, 'RANK AND FILE'); assert.equal(mine.benefitLimit, 70000); assert.equal(mine.benefitType, 'MBL');
    for (const k of ['premium', 'vat', 'totalGross', 'invoiceNo', 'invoiceDate', 'account', 'months', 'movementType']) assert.equal(mine[k], undefined, `${k} is not sent to the employee`);
    const old = { employeeId: 'EMP-002', provider: 'Maxicare', memberNo: 'MX-2', plan: 'Gold', startDate: '2026-01-01', status: 'Active' };
    assert.equal(saveHmo(store, hr, old).premium, '', 'records without billing still save');
  } finally { store.close(); }
});
