import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { preview, postPayroll } from '../src/service.mjs';
import { savePriorEarnings, saveThirteenthOverrides, thirteenthLedger } from '../src/thirteenth.mjs';
import { thirteenthStatement, finalizeThirteenthPayslip, voidThirteenthPayslip, thirteenthPayslip, addThirteenthAdjustment, reviewThirteenthAdjustment } from '../src/thirteenth-payslip.mjs';
import { renderThirteenthPdf } from '../src/thirteenth-pdf.mjs';
import { completeState, admin } from './helpers.mjs';

const payroll = { username: 'pay1', role: 'payroll' }, hr = { username: 'hr1', role: 'hr' };
function fixture() {
  const store = new Store(':memory:'), s = completeState(); s.loans = []; store.write(s);
  savePriorEarnings(store, payroll, { entries: ['01', '02', '03', '04', '05', '06', '07', '08'].map(m => ({ employeeId: 'EMP-001', month: `2026-${m}`, basic: 30000, thirteenthPaid: m === '03' ? 5000 : 0, notes: m === '03' ? 'Mid-year advance' : '' })) });
  return store;
}

test('draft 13th month payslip shows basic earned, 13th month, adjustments, previous payments and remaining', () => {
  const store = fixture();
  try {
    const d = thirteenthStatement(store, hr, 'EMP-001', '2026');
    assert.equal(d.draft, true);
    assert.equal(d.totalBasic, 240000); assert.equal(d.thirteenth, 20000);
    assert.equal(d.previousTotal, 5000); assert.equal(d.payments[0].source, 'encoded');
    assert.equal(d.totalDue, 20000); assert.equal(d.remaining, 15000);
    assert.equal(d.coveredStart, '2026-01-01'); assert.equal(d.coveredEnd, '2026-12-31');
    const pdf = renderThirteenthPdf(d).toString('latin1');
    assert.match(pdf, /^%PDF-1\.4/); assert.match(pdf, /13TH MONTH PAY PAYSLIP/); assert.match(pdf, /DRAFT - FOR REVIEW ONLY/); assert.match(pdf, /15,000\.00/);
    assert.throws(() => thirteenthStatement(store, { username: 'm', role: 'maker' }, 'EMP-001', '2026'), /permission/);
    assert.throws(() => thirteenthStatement(store, { username: 'e', role: 'employee' }, 'EMP-001', '2026'), /permission/);
  } finally { store.close(); }
});

test('saved changes are reflected in the draft; a stale draft cannot be finalized', () => {
  const store = fixture();
  try {
    const before = thirteenthStatement(store, hr, 'EMP-001', '2026');
    saveThirteenthOverrides(store, payroll, { year: '2026', entries: [{ employeeId: 'EMP-001', totalBasic: null, thirteenth: 21000 }] });
    const after = thirteenthStatement(store, hr, 'EMP-001', '2026');
    assert.equal(after.thirteenth, 21000); assert.match(after.thirteenthBasis, /Edited by HR/); assert.equal(after.remaining, 16000);
    assert.notEqual(after.fingerprint, before.fingerprint);
    assert.throws(() => finalizeThirteenthPayslip(store, payroll, { employeeId: 'EMP-001', year: '2026', fingerprint: before.fingerprint }), /changed after this draft/);
    assert.throws(() => finalizeThirteenthPayslip(store, hr, { employeeId: 'EMP-001', year: '2026', fingerprint: after.fingerprint }), /permission/);
  } finally { store.close(); }
});

test('adjustments: HR entries wait for an administrator; only approved ones count; pending ones block finalizing', () => {
  const store = fixture();
  try {
    const pending = addThirteenthAdjustment(store, hr, { employeeId: 'EMP-001', year: '2026', amount: 1500, reason: 'Unpaid basic from June correction' });
    assert.equal(pending.status, 'pending');
    let d = thirteenthStatement(store, hr, 'EMP-001', '2026');
    assert.equal(d.adjustmentsTotal, 0); assert.equal(d.pendingAdjustments, 1);
    assert.throws(() => finalizeThirteenthPayslip(store, admin, { employeeId: 'EMP-001', year: '2026', fingerprint: d.fingerprint }), /waiting for approval/);
    assert.throws(() => reviewThirteenthAdjustment(store, hr, pending.id, { decision: 'approve' }), /permission/);
    reviewThirteenthAdjustment(store, admin, pending.id, { decision: 'approve' });
    assert.throws(() => reviewThirteenthAdjustment(store, admin, pending.id, { decision: 'approve' }), /already approved/);
    const own = addThirteenthAdjustment(store, admin, { employeeId: 'EMP-001', year: '2026', amount: -500, reason: 'Overpayment in March' });
    assert.equal(own.status, 'approved');
    d = thirteenthStatement(store, hr, 'EMP-001', '2026');
    assert.equal(d.adjustmentsTotal, 1000); assert.equal(d.totalDue, 21000); assert.equal(d.remaining, 16000);
    assert.equal(thirteenthLedger(store, payroll, '2026')[0].balance, 16000, 'the ledger shows the same balance');
    assert.match(renderThirteenthPdf(d).toString('latin1'), /Overpayment in March/);
  } finally { store.close(); }
});

test('finalizing pays the remaining once: no second payslip, payroll does not pay it again, cancelling restores it', () => {
  const store = fixture();
  try {
    const d = thirteenthStatement(store, payroll, 'EMP-001', '2026');
    const slip = finalizeThirteenthPayslip(store, payroll, { employeeId: 'EMP-001', year: '2026', fingerprint: d.fingerprint });
    assert.equal(slip.status, 'final'); assert.equal(slip.amountPaid, 15000); assert.equal(slip.finalizedBy, 'pay1');
    const pdf = renderThirteenthPdf(thirteenthPayslip(store, hr, slip.id)).toString('latin1');
    assert.doesNotMatch(pdf, /DRAFT/); assert.match(pdf, /AMOUNT PAID ON THIS PAYSLIP/);
    // Same draft again, or a fresh one: nothing left to pay.
    assert.throws(() => finalizeThirteenthPayslip(store, payroll, { employeeId: 'EMP-001', year: '2026', fingerprint: d.fingerprint }), /changed after this draft/);
    const again = thirteenthStatement(store, payroll, 'EMP-001', '2026');
    assert.equal(again.remaining, 0); assert.equal(again.previousTotal, 20000); assert.equal(again.payments.at(-1).source, 'payslip');
    assert.throws(() => finalizeThirteenthPayslip(store, payroll, { employeeId: 'EMP-001', year: '2026', fingerprint: again.fingerprint }), /already been paid in full/);
    // Payroll "Pay accrued balance" now pays only basic earned after this payslip, not the 15,000 again.
    const run = preview(store, '2026-09-01', '2026-09-15', true, ['EMP-001']), row = run.rows[0];
    assert.equal(row.thirteenthPaid, 20000);
    assert.equal(row.earnings.thirteenth, Math.round(row.applicableBasic / 12 * 100) / 100);
    // The finalized snapshot does not change when records change later.
    saveThirteenthOverrides(store, payroll, { year: '2026', entries: [{ employeeId: 'EMP-001', totalBasic: null, thirteenth: 25000 }] });
    assert.equal(thirteenthPayslip(store, hr, slip.id).amountPaid, 15000);
    assert.equal(thirteenthStatement(store, hr, 'EMP-001', '2026').remaining, 5000, 'only the difference is payable');
    // Cancelling (administrators only) removes the payment.
    assert.throws(() => voidThirteenthPayslip(store, payroll, slip.id, { reason: 'Wrong amount' }), /permission/);
    const voided = voidThirteenthPayslip(store, admin, slip.id, { reason: 'Wrong amount' });
    assert.equal(voided.status, 'void'); assert.match(renderThirteenthPdf(voided).toString('latin1'), /CANCELLED/);
    assert.throws(() => voidThirteenthPayslip(store, admin, slip.id, { reason: 'Again' }), /already cancelled/);
    assert.equal(thirteenthStatement(store, hr, 'EMP-001', '2026').remaining, 20000);
    assert.ok(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='thirteenth-payslip'").get().n >= 2, 'finalize and void are audited');
  } finally { store.close(); }
});

test('13th month already paid in payroll appears as a previous payment', () => {
  const store = fixture();
  try {
    const run = preview(store, '2026-09-01', '2026-09-15', true, ['EMP-001']);
    postPayroll(store, admin, { start: run.start, end: run.end, pay13th: true, fingerprint: run.fingerprint, employeeIds: ['EMP-001'] });
    const d = thirteenthStatement(store, hr, 'EMP-001', '2026');
    assert.ok(d.payments.some(p => p.source === 'payroll' && /Sep 1-15, 2026/.test(p.label)));
    assert.equal(d.remaining, 0);
  } finally { store.close(); }
});
