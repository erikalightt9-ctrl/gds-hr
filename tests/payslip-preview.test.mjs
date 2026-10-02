import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { preview, postPayroll, saveRecord } from '../src/service.mjs';
import { payslipFromRow, payslipPdf, staffPayslip } from '../src/portal.mjs';

const hr = { username: 'hr1', role: 'hr' }, viewer = { username: 'v', role: 'viewer' };
function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }
const adjustment = extra => ({ id: 'adj1', employeeId: 'EMP-001', date: '2026-09-15', kind: 'additional', amount: 500, reason: 'Transport allowance correction', approved: true, includedIn13th: false, ...extra });

test('HR can add a manual adjustment and the recomputed preview reflects it', () => {
  const store = fixture();
  try {
    const before = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0];
    saveRecord(store, hr, 'adjustments', adjustment());
    const after = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']).rows[0];
    assert.equal(after.gross, before.gross + 500);
    assert.throws(() => saveRecord(store, viewer, 'adjustments', adjustment({ id: 'adj2' })));
  } finally { store.close(); }
});

test('the draft payslip is built from the same computation as the posted payslip', () => {
  const store = fixture();
  try {
    saveRecord(store, hr, 'adjustments', adjustment());
    const run = preview(store, '2026-09-01', '2026-09-15', false, ['EMP-001']);
    const draft = payslipFromRow({ ...run, id: 'preview' }, run.rows[0]);
    assert.equal(draft.net, run.rows[0].net);
    assert.ok(draft.deductionItems.length > 0);
    const pdf = payslipPdf(draft, { draft: true }).toString('latin1');
    assert.match(pdf, /^%PDF-/);
    assert.match(pdf, /DRAFT/);
    const posted = postPayroll(store, admin, { start: run.start, end: run.end, pay13th: false, fingerprint: run.fingerprint, employeeIds: ['EMP-001'] });
    const final = staffPayslip(store, hr, posted.id, 'EMP-001');
    for (const key of ['gross', 'totalDeductions', 'net', 'employerTotal']) assert.equal(final[key], draft[key], `${key} matches the draft`);
    assert.deepEqual(final.earnings, draft.earnings);
    assert.doesNotMatch(payslipPdf(final).toString('latin1'), /DRAFT/);
    assert.throws(() => staffPayslip(store, viewer, posted.id, 'EMP-001'), /permission/i);
  } finally { store.close(); }
});
