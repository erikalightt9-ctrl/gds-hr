import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { localToday } from '../src/profiles.mjs';
import { createCase, updateIncident, startInvestigation, addCaseFile, caseFile, issueNte, submitCaseExplanation, recordNoExplanation, scheduleHearing, recordHearing, evaluateCase, proposeDecision, reviewDecision, closeCase, listCases, caseDetail, disciplinaryRecords, myCases, saveDisciplineSettings, disciplineSettings } from '../src/discipline.mjs';
import { saveMemoDraft, publishMemo, myMemos } from '../src/memos.mjs';

const hr = { username: 'hr.manager', role: 'hr' }, mgmt = { username: 'mgmt', role: 'viewer' }, staff = { username: 'staff', role: 'hr_staff' };
const worker = { id: 'worker', username: 'employee1', role: 'employee', employeeId: 'EMP-001' }, other = { id: 'o', username: 'employee2', role: 'employee', employeeId: 'EMP-002' };
const pdf = Buffer.from('%PDF-1.4\n%test\n').toString('base64');
const day = n => { const d = new Date(`${localToday()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function fixture() {
  const store = new Store(':memory:'), s = completeState();
  s.employees.push({ ...s.employees[0], id: 'EMP-002', name: 'Other Person' });
  store.write(s);
  store.db.prepare("INSERT INTO employee_profiles(employee_id,section,data) VALUES('EMP-001','employment',?)").run(JSON.stringify({ department: 'Operations', position: 'Clerk', status: 'Active' }));
  return store;
}
const incident = { employeeId: 'EMP-001', incidentDate: day(-3), incidentTime: '09:30', place: 'Main office', offense: 'Insubordination', description: 'Refused a lawful instruction of the supervisor to file the daily report.', reportedBy: 'Supervisor A', witnesses: 'B, C' };
const nte = deadline => ({ allegations: 'On the date stated you refused the lawful instruction of your supervisor to file the daily report.', rules: 'Code of Conduct, section 4.2', possibleSanction: 'Written warning up to suspension', responseDeadline: deadline, hearingOffered: true });

test('incident → NTE (at least 5 days, issued as a memo) → explanation → evaluation → proposal → approval by someone else → decision → closure', () => {
  const store = fixture();
  try {
    assert.throws(() => createCase(store, staff, incident), /permission/);
    assert.throws(() => createCase(store, hr, { ...incident, description: 'short' }), /20 characters/);
    const c = createCase(store, hr, incident);
    assert.equal(c.status, 'Pending'); assert.match(c.reference, /^CASE-\d{4}-001$/);
    assert.equal(c.employee.position, 'Clerk'); assert.equal(c.employee.department, 'Operations');
    assert.equal(startInvestigation(store, hr, c.id, { note: 'Collecting statements' }).status, 'Under Investigation');
    addCaseFile(store, hr, c.id, { name: 'incident-report.pdf', mime: 'application/pdf', data: pdf, kind: 'evidence', description: 'Supervisor report' });
    assert.throws(() => addCaseFile(store, hr, c.id, { name: 'x.pdf', mime: 'application/pdf', data: Buffer.from('not a pdf').toString('base64') }), /PDF/);
    assert.equal(updateIncident(store, hr, c.id, { ...incident, employeeId: undefined, place: 'Warehouse' }).incident.place, 'Warehouse');
    assert.equal(myCases(store, worker).length, 0, 'the employee does not see the case before the NTE');
    assert.throws(() => issueNte(store, hr, c.id, nte(day(4))), /at least 5 calendar days/);
    const afterNte = issueNte(store, hr, c.id, nte(day(5)));
    assert.equal(afterNte.status, 'Awaiting Explanation');
    assert.throws(() => updateIncident(store, hr, c.id, { ...incident, employeeId: undefined }), /no longer be edited/);
    const memo = myMemos(store, worker).find(m => m.title.startsWith('Notice to Explain'));
    assert.ok(memo && memo.ackRequired && memo.attachments.length === 1, 'NTE delivered as a memo with the letterhead PDF');
    assert.throws(() => recordNoExplanation(store, hr, c.id, {}), /until/);
    assert.throws(() => evaluateCase(store, hr, c.id, { substantiated: true, findings: 'x'.repeat(30) }), /after the explanation/);
    // The employee answers from their account; another employee cannot.
    assert.throws(() => submitCaseExplanation(store, other, c.id, { text: 'Not me at all.' }), /not found/i);
    const mine = submitCaseExplanation(store, worker, c.id, { text: 'I was attending to a client at the time.', requestsHearing: false, files: [{ name: 'client-log.pdf', mime: 'application/pdf', data: pdf, description: '' }] });
    assert.equal(mine.status, 'For Evaluation'); assert.equal(mine.explanation.files.length, 1);
    assert.throws(() => submitCaseExplanation(store, worker, c.id, { text: 'Second answer here.' }), /already received/);
    const fileId = mine.explanation.files[0].id;
    assert.equal(caseFile(store, worker, fileId).meta.name, 'client-log.pdf');
    assert.throws(() => caseFile(store, worker, caseDetail(store, hr, c.id).files.find(f => f.kind === 'evidence').id), /not found/i, 'evidence stays with HR');
    assert.throws(() => proposeDecision(store, hr, c.id, { action: 'Written warning', rationale: 'x'.repeat(30) }), /Evaluate/);
    evaluateCase(store, hr, c.id, { substantiated: true, findings: 'The client log shows the meeting ended before the instruction was given.' });
    assert.throws(() => proposeDecision(store, hr, c.id, { action: 'Suspension', suspensionDays: 0, rationale: 'x'.repeat(30) }), /Suspension must be/);
    const proposed = proposeDecision(store, hr, c.id, { action: 'Written warning', rationale: 'First offense under section 4.2; written warning is the prescribed penalty.' });
    assert.equal(proposed.status, 'For Evaluation'); assert.equal(proposed.stage, 'approval');
    assert.equal(listCases(store, mgmt).find(x => x.id === c.id).awaitingApproval, true);
    // Nothing is imposed automatically: no decision memo yet, no record yet.
    assert.equal(disciplinaryRecords(store, mgmt, 'EMP-001')[0].action, undefined);
    assert.throws(() => reviewDecision(store, hr, c.id, { decision: 'approve' }), /permission|someone other/, 'HR is not an approver by default');
    assert.throws(() => reviewDecision(store, staff, c.id, { decision: 'approve' }), /permission/);
    const decided = reviewDecision(store, mgmt, c.id, { decision: 'approve', note: 'Approved.' });
    assert.equal(decided.status, 'Resolved'); assert.equal(decided.decision.action, 'Written warning'); assert.equal(decided.decision.approvedBy, 'mgmt');
    assert.ok(myMemos(store, worker).some(m => m.title.startsWith('Notice of Decision')));
    const record = disciplinaryRecords(store, mgmt, 'EMP-001')[0];
    assert.equal(record.action, 'Written warning'); assert.equal(record.reference, c.reference);
    const mineNow = myCases(store, worker)[0];
    assert.equal(mineNow.decision.label, 'Written warning'); assert.equal(mineNow.evaluation, undefined, 'HR findings are not shown to the employee');
    assert.throws(() => closeCase(store, hr, c.id, { outcome: 'no' }), /final outcome/);
    assert.equal(closeCase(store, hr, c.id, { outcome: 'Written warning served and acknowledged.' }).status, 'Closed');
    const history = caseDetail(store, mgmt, c.id).history.map(h => h.action);
    for (const a of ['opened', 'investigate', 'attach', 'edit-incident', 'issue-nte', 'explanation', 'evaluate', 'propose', 'approve-decision', 'close']) assert.ok(history.includes(a), a);
    assert.ok(store.db.prepare("SELECT COUNT(*) n FROM audit WHERE kind='discipline-case'").get().n >= 10);
  } finally { store.close(); }
});

test('a requested hearing must be held and recorded first; termination needs a hearing; a returned proposal goes back to evaluation', () => {
  const store = fixture();
  try {
    const c = createCase(store, hr, { ...incident, offense: 'Fraud or breach of trust' });
    issueNte(store, hr, c.id, nte(day(7)));
    submitCaseExplanation(store, worker, c.id, { text: 'I deny the charge and ask to be heard.', requestsHearing: true });
    assert.throws(() => evaluateCase(store, hr, c.id, { substantiated: true, findings: 'x'.repeat(30) }), /requested a hearing/);
    assert.throws(() => recordHearing(store, hr, c.id, { held: true, attendees: 'HR', minutes: 'x'.repeat(20) }), /Schedule/);
    const scheduled = scheduleHearing(store, hr, c.id, { date: day(2), time: '10:00', place: 'Conference room', sendNotice: true });
    assert.ok(scheduled.hearing.memoReference);
    assert.ok(myMemos(store, worker).some(m => m.title.startsWith('Notice of Hearing')));
    recordHearing(store, hr, c.id, { held: true, employeeAttended: true, attendees: 'HR manager, employee, supervisor', statements: 'Employee denied.', minutes: 'The employee presented documents and denied the charge.' });
    evaluateCase(store, hr, c.id, { substantiated: false, findings: 'The documents presented contradict the supervisor report.' });
    assert.throws(() => proposeDecision(store, hr, c.id, { action: 'Termination', rationale: 'x'.repeat(30) }), /not substantiated/);
    proposeDecision(store, hr, c.id, { action: 'No disciplinary action', rationale: 'The charge was not substantiated by the evidence presented.' });
    const returned = reviewDecision(store, admin, c.id, { decision: 'return', note: 'Interview the second witness first.' });
    assert.equal(returned.stage, 'evaluation'); assert.equal(returned.proposal, null); assert.equal(returned.evaluation, null); assert.equal(returned.returned.length, 1);
    // Termination without a hearing is refused when policy requires one.
    const c2 = createCase(store, hr, { ...incident, offense: 'Dishonesty' });
    issueNte(store, hr, c2.id, nte(day(5)));
    submitCaseExplanation(store, worker, c2.id, { text: 'I admit and apologise.' });
    evaluateCase(store, hr, c2.id, { substantiated: true, findings: 'Admitted in the written explanation dated today.' });
    assert.throws(() => proposeDecision(store, hr, c2.id, { action: 'Termination', rationale: 'Serious misconduct under the Code.' }), /requires a hearing/);
  } finally { store.close(); }
});

test('no explanation after the deadline; dropped cases; written warning memos only for approved cases; settings', () => {
  const store = fixture();
  try {
    const c = createCase(store, hr, incident);
    issueNte(store, hr, c.id, nte(day(5)));
    // Move the deadline into the past to simulate time passing.
    const row = JSON.parse(store.db.prepare('SELECT data FROM discipline_cases WHERE id=?').get(c.id).data); row.nte.responseDeadline = day(-1);
    store.db.prepare('UPDATE discipline_cases SET data=? WHERE id=?').run(JSON.stringify(row), c.id);
    assert.equal(listCases(store, hr).find(x => x.id === c.id).overdueExplanation, true);
    assert.equal(recordNoExplanation(store, hr, c.id, { note: 'Nothing received' }).status, 'For Evaluation');
    const dropped = createCase(store, hr, { ...incident, offense: 'Neglect of duty' });
    assert.equal(closeCase(store, hr, dropped.id, { outcome: 'Dropped: the report was withdrawn.' }).closure.dropped, true);
    assert.equal(listCases(store, hr, { q: 'neglect' }).length, 1); assert.equal(listCases(store, hr, { status: 'Closed' }).length, 1);
    const warning = { title: 'Written warning', category: 'Written Warning', issueDate: localToday(), body: 'Written warning text', recipients: { mode: 'employees', departments: [], employees: ['EMP-001'] }, ackRequired: true, details: { template: 'written-warning', employeeId: 'EMP-001', issuingOfficer: 'HR Manager', caseId: c.id } };
    const draft = saveMemoDraft(store, hr, null, warning);
    assert.throws(() => publishMemo(store, hr, draft.id), /approved decision is a warning/);
    assert.throws(() => saveDisciplineSettings(store, admin, { ...disciplineSettings(store), minResponseDays: 3 }), /five/);
    assert.throws(() => saveDisciplineSettings(store, hr, disciplineSettings(store)), /permission/);
    assert.equal(saveDisciplineSettings(store, admin, { ...disciplineSettings(store), minResponseDays: 7, approverRoles: ['admin'] }).minResponseDays, 7);
    const c3 = createCase(store, hr, incident);
    assert.throws(() => issueNte(store, hr, c3.id, nte(day(6))), /7 calendar days/);
    // An administrator who proposes cannot approve their own proposal.
    evaluateCase(store, admin, c.id, { substantiated: true, findings: 'No explanation; the supervisor report stands.' });
    proposeDecision(store, admin, c.id, { action: 'Verbal warning', rationale: 'First offense; verbal warning under the Code.' });
    assert.throws(() => reviewDecision(store, admin, c.id, { decision: 'approve' }), /someone other/);
    assert.throws(() => listCases(store, staff), /permission/);
    assert.throws(() => listCases(store, worker), /permission/);
  } finally { store.close(); }
});
