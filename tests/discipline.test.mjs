import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { createCase, updateIncident, saveNte, issueNte, toEvaluation, scheduleHearing, recordHearing, saveEvaluation, draftDecision, submitDecision, reviewDecision, issueDecision, closeCase, addFile, readCase } from '../src/discipline.mjs';
import { listCases, caseDetail, myCases, acknowledgeNotice, submitExplanation, listRecords, recordPriorAction, disciplineBell, caseFile } from '../src/discipline-views.mjs';
import { saveDpSettings, readDpSettings } from '../src/discipline-settings.mjs';
import { casePdf } from '../src/discipline-pdf.mjs';
import { buildReport } from '../src/reports.mjs';
import { localToday } from '../src/profiles.mjs';

const hr = { username: 'hr1', role: 'hr' }, boss = { username: 'boss', role: 'viewer' }, staff = { username: 'staff', role: 'hr_staff' };
const worker = { username: 'emp', role: 'employee', employeeId: 'EMP-001' }, other = { username: 'other', role: 'employee', employeeId: 'EMP-002' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function fixture() {
  const store = new Store(':memory:'), state = completeState();
  state.employees.push({ ...state.employees[0], id: 'EMP-002', name: 'Other Person' });
  store.write(state); return store;
}
const incident = { employeeId: 'EMP-001', date: localToday(), time: '09:30', place: 'Main office', offenseId: 'insubordination', description: 'Refused a lawful instruction from the supervisor twice.', reportedBy: 'Supervisor', witnesses: '', issuingOfficer: 'HR Manager' };
const nte = { allegations: 'On the date above you refused to complete the assigned report after two instructions.', rules: 'Code of Conduct section 4.2', possibleSanction: 'Written warning', responseDays: 5 };
// Moves a fresh case to "For Evaluation" through the employee's own explanation.
function explained(store, hearingRequested = false) {
  const c = createCase(store, hr, incident); saveNte(store, hr, c.id, nte); issueNte(store, hr, c.id);
  submitExplanation(store, worker, c.id, { text: 'I was finishing an urgent task for the client and asked for one more hour.', hearingRequested, files: [{ name: 'proof.pdf', mime: 'application/pdf', data: PDF }] });
  return c.id;
}

test('due process: the seven steps in order, management approval before issue, record kept on closure, audited', () => {
  const store = fixture();
  try {
    const c = createCase(store, hr, incident);
    assert.equal(c.status, 'pending'); assert.match(c.reference, /^DP-\d{4}-0001$/);
    addFile(store, hr, c.id, { name: 'cctv.pdf', mime: 'application/pdf', data: PDF, kind: 'evidence' });
    assert.throws(() => issueNte(store, hr, c.id), /Prepare the Notice to Explain/);
    assert.throws(() => saveNte(store, hr, c.id, { ...nte, responseDays: 3 }), /at least 5 calendar days/);
    saveNte(store, hr, c.id, nte);
    assert.equal(readCase(store, c.id).status, 'investigation');
    const issued = issueNte(store, hr, c.id);
    assert.equal(issued.status, 'awaiting'); assert.equal(issued.nte.deadline, addDays(localToday(), 5));
    assert.match(issued.nte.body, /calendar days/); assert.doesNotMatch(issued.nte.body, /\{\{deadline\}\}/, 'deadline filled in on issue');
    assert.throws(() => updateIncident(store, hr, c.id, incident), /already issued/);
    assert.throws(() => toEvaluation(store, hr, c.id, {}), /verify service/, 'no non-response finding before receipt is documented');
    // Employee: sees only their notice, acknowledges it, explains and asks for a hearing.
    assert.equal(myCases(store, other).length, 0);
    const mine = myCases(store, worker)[0];
    assert.equal(mine.notices[0].kind, 'nte'); assert.ok(mine.canExplain); assert.equal('evaluation' in mine, false); assert.equal('notes' in mine, false);
    acknowledgeNotice(store, worker, c.id, 'nte');
    submitExplanation(store, worker, c.id, { text: 'I was finishing an urgent task for the client and asked for one more hour.', hearingRequested: true, files: [] });
    assert.throws(() => submitExplanation(store, worker, c.id, { text: 'A second explanation that should be refused.', files: [] }), /can no longer be submitted/);
    assert.equal(readCase(store, c.id).status, 'evaluation');
    assert.ok(disciplineBell(store, hr).some(i => /written explanation received/.test(i.text)));
    // A requested hearing must be held (or waived) before the evaluation.
    assert.throws(() => saveEvaluation(store, hr, c.id, { findings: 'The refusal is admitted.', recommendation: 'Written warning' }), /asked for a hearing/);
    scheduleHearing(store, hr, c.id, { scheduledAt: `${addDays(localToday(), 2)}T10:00`, place: 'Conference room' });
    assert.equal(myCases(store, worker)[0].notices.length, 2, 'hearing notice reaches the employee');
    recordHearing(store, hr, c.id, { outcome: 'held', heldOn: localToday(), employeeAttended: true, statements: 'The employee admitted the refusal and apologised.', attendees: 'HR, supervisor, employee' });
    saveEvaluation(store, hr, c.id, { findings: 'The refusal is admitted; urgent client work partly explains it.', recommendation: 'Written warning' });
    // Decision: prepared by HR, approved by management (not the preparer), then issued.
    assert.throws(() => draftDecision(store, hr, c.id, { sanction: 'Suspension', findings: 'Refusal admitted.' }), /suspension days/);
    draftDecision(store, hr, c.id, { sanction: 'Written warning', findings: 'Refusal admitted; first offense.' });
    assert.doesNotMatch(readCase(store, c.id).decision.body, /\{\{/, 'every placeholder of the decision is filled in');
    assert.doesNotMatch(readCase(store, c.id).nte.body, /\{\{/, 'every placeholder of the issued notice is filled in');
    assert.throws(() => issueDecision(store, hr, c.id), /approved by authorized management/);
    submitDecision(store, hr, c.id);
    assert.throws(() => reviewDecision(store, hr, c.id, { action: 'approve' }), /permission/, 'HR is not an approver by default');
    assert.throws(() => reviewDecision(store, { username: 'hr1', role: 'admin' }, c.id, { action: 'approve' }), /someone other than/);
    assert.throws(() => reviewDecision(store, boss, c.id, { action: 'return' }), /Say what must change/);
    assert.ok(disciplineBell(store, boss).some(i => /waiting for your approval/.test(i.text)));
    reviewDecision(store, boss, c.id, { action: 'approve', note: 'Proportionate.' });
    const resolved = issueDecision(store, hr, c.id);
    assert.equal(resolved.status, 'resolved'); assert.equal(resolved.decision.reference, `${c.reference}-NOD`);
    acknowledgeNotice(store, worker, c.id, 'decision');
    const closed = closeCase(store, hr, c.id, {});
    assert.equal(closed.status, 'closed'); assert.equal(closed.closure.outcome, 'Written warning');
    assert.deepEqual(listRecords(store, hr, 'EMP-001').map(r => [r.type, r.reference, r.source]), [['Written warning', c.reference, 'case']]);
    const actions = store.audit().filter(a => a.kind === 'discipline').map(a => a.action);
    for (const a of ['create', 'add-file', 'save-nte', 'issue-nte', 'acknowledge-receipt', 'submit-explanation', 'schedule-hearing', 'record-hearing', 'save-evaluation', 'draft-decision', 'submit-decision', 'approve-decision', 'issue-decision', 'close']) assert.ok(actions.includes(a), a);
    assert.ok(!JSON.stringify(store.audit().filter(a => a.kind === 'discipline')).includes('Refused a lawful instruction'), 'case text is not copied into the audit trail');
    assert.ok(readCase(store, c.id).history.length >= 14, 'timestamped case history');
  } finally { store.close(); }
});

test('due process: access is limited to HR managers and management; employees reach only their own notices and files', () => {
  const store = fixture();
  try {
    const id = explained(store);
    assert.throws(() => listCases(store, staff), /permission/);
    assert.throws(() => createCase(store, boss, incident), /permission/, 'management reads and approves, HR runs the case');
    assert.equal(listCases(store, boss).length, 1);
    assert.throws(() => caseDetail(store, worker, id), /permission/);
    const fileId = readCase(store, id).files[0].id;
    assert.equal(caseFile(store, worker, fileId).name, 'proof.pdf');
    assert.throws(() => caseFile(store, other, fileId), /not found/i);
    assert.throws(() => casePdf(store, other, id, 'nte'), /not found/i);
    assert.throws(() => casePdf(store, worker, id, 'decision'), /not found/i, 'no decision issued yet');
    assert.equal(casePdf(store, worker, id, 'nte').body.subarray(0, 5).toString(), '%PDF-');
    assert.throws(() => buildReport(store, staff, 'discipline-cases', 'xlsx'), /cannot download/);
    assert.equal(buildReport(store, hr, 'discipline-cases', 'xlsx').body.subarray(0, 2).toString(), 'PK');
  } finally { store.close(); }
});

test('due process: no explanation by the deadline, dismissal needs a hearing (setting), closing without a notice needs a reason', () => {
  const store = fixture();
  try {
    const c = createCase(store, hr, incident); saveNte(store, hr, c.id, { ...nte, possibleSanction: 'Dismissal' }); issueNte(store, hr, c.id);
    // Pretend the deadline passed.
    const row = readCase(store, c.id);
    store.db.prepare('UPDATE dp_cases SET data=? WHERE id=?').run(JSON.stringify({ ...row, nte: { ...row.nte, deadline: addDays(localToday(), -1) } }), c.id);
    assert.ok(disciplineBell(store, hr).some(i => /no explanation by/.test(i.text)));
    assert.throws(() => toEvaluation(store, hr, c.id, {}), /verify service/);
    const served = readCase(store, c.id);
    store.db.prepare('UPDATE dp_cases SET data=? WHERE id=?').run(JSON.stringify({ ...served, nte: { ...served.nte, service: { method: 'Personal service (hand delivery)', receivedOn: addDays(localToday(), -6) } } }), c.id);
    toEvaluation(store, hr, c.id, {});
    assert.equal(myCases(store, worker)[0].canExplain, true, 'a late explanation is still accepted until a decision is drafted');
    saveEvaluation(store, hr, c.id, { findings: 'No explanation was received; records show the refusal.', recommendation: 'Dismissal' });
    assert.throws(() => draftDecision(store, hr, c.id, { sanction: 'Dismissal', effectiveFrom: localToday(), findings: 'Serious misconduct proven.' }), /needs a hearing/);
    recordHearing(store, hr, c.id, { outcome: 'waived', minutes: 'Employee waived the hearing in writing on the NTE copy.' });
    draftDecision(store, hr, c.id, { sanction: 'Dismissal', effectiveFrom: localToday(), findings: 'Serious misconduct proven.' });
    assert.equal(myCases(store, worker)[0].canExplain, false);
    const fresh = createCase(store, hr, incident);
    assert.throws(() => closeCase(store, hr, fresh.id, {}), /Explain why/);
    assert.equal(closeCase(store, hr, fresh.id, { remarks: 'Report withdrawn by the supervisor after review.' }).closure.outcome, 'Closed without action');
    assert.equal(listRecords(store, hr).length, 0, 'no disciplinary record without a decision');
    assert.throws(() => closeCase(store, hr, c.id, {}), /Issue the decision before closing/);
  } finally { store.close(); }
});

test('due process settings: minimum five days, approver roles configurable (admin only); prior paper records encoded', () => {
  const store = fixture();
  try {
    const s = readDpSettings(store);
    assert.throws(() => saveDpSettings(store, hr, s), /permission/);
    assert.throws(() => saveDpSettings(store, admin, { ...s, minResponseDays: 3 }), /five \(5\) calendar days/);
    saveDpSettings(store, admin, { ...s, approverRoles: ['hr'], separateApprover: false, minResponseDays: 7 });
    const c = createCase(store, hr, incident);
    assert.throws(() => saveNte(store, hr, c.id, nte), /at least 7/);
    saveNte(store, hr, c.id, { ...nte, responseDays: 7 }); issueNte(store, hr, c.id);
    submitExplanation(store, worker, c.id, { text: 'I accept the finding and will follow the instruction next time.', files: [] });
    saveEvaluation(store, hr, c.id, { findings: 'Admitted, first offense.', recommendation: 'Verbal warning' });
    draftDecision(store, hr, c.id, { sanction: 'Verbal warning', findings: 'Admitted, first offense.' }); submitDecision(store, hr, c.id);
    reviewDecision(store, hr, c.id, { action: 'approve' });
    assert.equal(readCase(store, c.id).decision.status, 'approved');
    assert.throws(() => recordPriorAction(store, hr, { employeeId: 'EMP-001', type: 'Written warning', date: '2099-01-01', offense: 'Tardiness', remarks: 'Paper memo on file' }), /future/);
    recordPriorAction(store, hr, { employeeId: 'EMP-001', type: 'Written warning', date: '2025-03-01', offense: 'Habitual tardiness', reference: 'MEMO-2025-014', remarks: 'Paper memo in the 201 folder' });
    assert.equal(caseDetail(store, hr, c.id).prior.length, 1);
    assert.equal(buildReport(store, hr, 'discipline-records', 'xlsx').body.subarray(0, 2).toString(), 'PK');
  } finally { store.close(); }
});
