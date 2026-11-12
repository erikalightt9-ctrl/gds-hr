import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { applyLeave, attachLeaveProof, reviewLeaveProof, requestLeaveProof, employeeDashboard } from '../src/portal.mjs';
import { uploadDocument } from '../src/profiles.mjs';
import { saveRecord } from '../src/service.mjs';

const worker = { id: 'worker', username: 'employee1', role: 'employee', employeeId: 'EMP-001' };
const other = { id: 'other', username: 'employee2', role: 'employee', employeeId: 'EMP-002' };
const pdf = Buffer.from('%PDF-1.7\nmedical certificate').toString('base64');

function fixture() {
  const store = new Store(':memory:');
  const state = completeState();
  state.attendance = [];
  state.employees[0].leaveEligibility = ['sil', 'unpaid', 'sick'];
  state.employees.push({ ...state.employees[0], id: 'EMP-002', name: 'Second Employee' });
  state.leaveTypes = state.leaveTypes.map(t => t.id === 'sick' ? { ...t, entitledDays: 5, documentsRequired: true } : t);
  store.write(state);
  return store;
}
const upload = (store, actor = worker) => uploadDocument(store, actor, actor.employeeId, { type: 'Leave Supporting', name: 'medcert.pdf', mime: 'application/pdf', data: pdf });
const sick = { typeId: 'sick', startDate: '2026-09-21', endDate: '2026-09-21', reason: 'Fever' };

test('an attachment is optional when applying, even for leave types that usually have one', () => {
  const store = fixture();
  try {
    const leave = applyLeave(store, worker, sick);
    assert.equal(leave.status, 'pending');
    assert.equal(leave.proofStatus, '', 'not marked as needing proof until HR asks');
    const withProof = applyLeave(store, worker, { ...sick, startDate: '2026-09-22', endDate: '2026-09-22', documentId: upload(store).id });
    assert.equal(withProof.proofStatus, 'submitted');
    assert.equal(applyLeave(store, worker, { typeId: 'unpaid', startDate: '2026-09-23', endDate: '2026-09-23', reason: 'Errand' }).proofStatus, '', 'no proof needed');
  } finally { store.close(); }
});

test('employees attach proof only to their own leave, with their own document', () => {
  const store = fixture();
  try {
    const leave = applyLeave(store, worker, sick);
    assert.throws(() => attachLeaveProof(store, other, leave.id, { documentId: upload(store, other).id }), /not found/);
    assert.throws(() => attachLeaveProof(store, worker, leave.id, { documentId: upload(store, other).id }));
    const attached = attachLeaveProof(store, worker, leave.id, { documentId: upload(store).id });
    assert.equal(attached.proofStatus, 'submitted');
    assert.ok(store.read().leaves.find(l => l.id === leave.id).documentReference);
  } finally { store.close(); }
});

test('HR confirms or rejects proof, the employee is told, and a rejected proof can be replaced', () => {
  const store = fixture();
  try {
    const leave = applyLeave(store, worker, sick);
    assert.throws(() => reviewLeaveProof(store, admin, leave.id, { decision: 'verified', note: '' }), /No proof/);
    attachLeaveProof(store, worker, leave.id, { documentId: upload(store).id });
    assert.throws(() => reviewLeaveProof(store, worker, leave.id, { decision: 'verified', note: '' }));
    const rejected = reviewLeaveProof(store, admin, leave.id, { decision: 'rejected', note: 'Certificate is unsigned' });
    assert.equal(rejected.proofStatus, 'rejected');
    assert.equal(rejected.proofNote, 'Certificate is unsigned');
    assert.throws(() => reviewLeaveProof(store, admin, leave.id, { decision: 'rejected', note: '' }), /reason/);
    const notes = employeeDashboard(store, worker).notifications.map(n => n.message).join(' ');
    assert.match(notes, /Certificate is unsigned/);
    assert.equal(attachLeaveProof(store, worker, leave.id, { documentId: upload(store).id }).proofStatus, 'submitted');
    const verified = reviewLeaveProof(store, admin, leave.id, { decision: 'verified', note: '' });
    assert.equal(verified.proofStatus, 'verified');
    assert.equal(verified.proofReviewedBy, admin.username);
  } finally { store.close(); }
});

test('HR asks for proof: the employee is told; approval does not wait for it; HR edits keep the proof status', () => {
  const store = fixture();
  try {
    const leave = applyLeave(store, worker, sick);
    const approve = l => saveRecord(store, admin, 'leaves', { id: l.id, employeeId: l.employeeId, typeId: l.typeId, startDate: l.startDate, endDate: l.endDate, days: l.days, reason: l.reason, documentReference: l.documentReference, status: 'approved', eligibilityVerified: true });
    assert.throws(() => requestLeaveProof(store, worker, leave.id, { note: 'Medical certificate' }), /permission/i);
    assert.throws(() => requestLeaveProof(store, admin, leave.id, { note: '' }), /document is needed/);
    const asked = requestLeaveProof(store, admin, leave.id, { note: 'Medical certificate for the sick day' });
    assert.equal(asked.proofStatus, 'required'); assert.equal(asked.proofNote, 'Medical certificate for the sick day');
    assert.match(employeeDashboard(store, worker).notifications[0].message, /HR asks for a supporting document .*Medical certificate for the sick day/);
    assert.throws(() => requestLeaveProof(store, admin, leave.id, { note: 'Again' }), /already asked/);
    attachLeaveProof(store, worker, leave.id, { documentId: upload(store).id });
    reviewLeaveProof(store, admin, leave.id, { decision: 'verified', note: '' });
    approve(store.read().leaves.find(l => l.id === leave.id));
    const saved = store.read().leaves.find(l => l.id === leave.id);
    assert.equal(saved.status, 'approved');
    assert.equal(saved.proofStatus, 'verified', 'HR form save does not erase the proof review');
  } finally { store.close(); }
});

test('without a request from HR, a leave without an attachment can be approved', () => {
  const store = fixture();
  try {
    const leave = applyLeave(store, worker, sick);
    const saved = saveRecord(store, admin, 'leaves', { id: leave.id, employeeId: leave.employeeId, typeId: leave.typeId, startDate: leave.startDate, endDate: leave.endDate, days: leave.days, reason: leave.reason, documentReference: '', status: 'approved', eligibilityVerified: true });
    assert.equal(saved.status, 'approved'); assert.equal(saved.proofStatus, '');
  } finally { store.close(); }
});

test('open leave requests marked proof needed automatically (never by HR) are cleared once at start-up', async () => {
  const { runMigrations } = await import('../src/migrations.mjs');
  const store = fixture();
  try {
    const s = store.read();
    s.leaves.push({ ...structuredClone(s.leaves[0] || {}), id: 'auto', employeeId: 'EMP-001', typeId: 'sick', startDate: '2026-09-21', endDate: '2026-09-21', days: 1, reason: 'Fever', documentReference: '', status: 'pending', proofStatus: 'required', proofNote: '', proofReviewedBy: '', proofReviewedAt: '', countedDates: ['2026-09-21'] });
    s.leaves.push({ ...s.leaves.at(-1), id: 'asked', startDate: '2026-09-22', endDate: '2026-09-22', countedDates: ['2026-09-22'], proofNote: 'Medical certificate', proofReviewedBy: 'hr1' });
    store.write(s);
    assert.equal(runMigrations(store).leaveProofOptional, 1);
    const after = store.read().leaves;
    assert.equal(after.find(l => l.id === 'auto').proofStatus, '');
    assert.equal(after.find(l => l.id === 'asked').proofStatus, 'required', 'a request made by HR stays');
    assert.equal(runMigrations(store).leaveProofOptional, 0, 'runs once');
  } finally { store.close(); }
});

test('supporting documents are optional: any leave can be approved without one', () => {
  const store = fixture();
  try {
    const two = applyLeave(store, worker, { ...sick, startDate: '2026-09-21', endDate: '2026-09-22' });
    assert.equal(two.days, 2); assert.equal(two.proofStatus, '', 'no document is asked for automatically');
    const approve = l => saveRecord(store, admin, 'leaves', { id: l.id, employeeId: l.employeeId, typeId: l.typeId, startDate: l.startDate, endDate: l.endDate, days: l.days, reason: l.reason, documentReference: l.documentReference, status: 'approved', eligibilityVerified: true });
    assert.equal(approve(two).status, 'approved', 'approved without a document');
    const one = applyLeave(store, worker, { ...sick, startDate: '2026-09-23', endDate: '2026-09-23' });
    assert.equal(one.proofStatus, '', 'a 1-day leave stays optional');
    const withDoc = applyLeave(store, worker, { ...sick, startDate: '2026-09-24', endDate: '2026-09-25', documentId: upload(store).id });
    assert.equal(withDoc.proofStatus, 'submitted', 'attached when applying');
  } finally { store.close(); }
});
