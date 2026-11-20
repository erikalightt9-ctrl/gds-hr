import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
import { completeState, admin } from './helpers.mjs';
import { issueSystemMemo, myMemos, acknowledgeMemo, memoDetail, memoSummary, saveMemoDraft, listMemos } from '../src/memos.mjs';
import { recordView, requestClarification, answerClarification, recordPaperAck, sendDailyReminders, dueDate, outstandingMemos, ACK_WORDING } from '../src/memo-tracking.mjs';
import { memoPdf } from '../src/memo-letter.mjs';
import { createCase, saveNte, issueNte, toEvaluation, saveEvaluation, draftDecision, submitDecision, reviewDecision, issueDecision, closeCase, readCase } from '../src/discipline.mjs';
import { myCases, acknowledgeNotice } from '../src/discipline-views.mjs';
import { recordService, requestExtension, decideExtension, requestReview, recordReviewOutcome, dpReminderLines, NTE_ACK_WORDING } from '../src/discipline-service.mjs';
import { localToday } from '../src/profiles.mjs';

// EMP-001 rests Saturday and Sunday.
const hr = { username: 'hr1', role: 'hr' }, boss = { username: 'boss', role: 'viewer' };
const worker = { username: 'emp', role: 'employee', employeeId: 'EMP-001' };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
function fixture() { const store = new Store(':memory:'); store.write(completeState()); return store; }
const memoFor = (store, issueDate) => store.transaction(() => issueSystemMemo(store, { title: 'Office hours from Monday', category: 'Office Order / Schedule', body: 'Fictional instructions.', employeeIds: ['EMP-001'], issueDate, issuedBy: 'hr1' }));

test('memos: default deadline is the next scheduled working day; opening never acknowledges; clarification, answer, then acknowledgment', () => {
  const store = fixture();
  try {
    const s = store.read(), e = s.employees[0];
    assert.equal(dueDate(s, e, { issueDate: '2026-11-20', ackDeadline: '' }, '2026-11-20T02:00:00Z'), '2026-11-23', 'Friday memo: due Monday (weekend rest days skipped)');
    assert.equal(dueDate(s, e, { issueDate: '2026-11-20', ackDeadline: '2026-11-30' }, '2026-11-20T02:00:00Z'), '2026-11-30', 'the issuer may give longer');
    const memo = memoFor(store, localToday());
    recordView(store, worker, memo.id, 1); recordView(store, worker, memo.id, 1);
    memoPdf(store, worker, memo.id, 1);
    let mine = myMemos(store, worker)[0];
    assert.equal(mine.acknowledgedAt, null, 'viewing and opening the PDF do not acknowledge');
    assert.equal(mine.status, 'pending'); assert.equal(mine.ackWording, ACK_WORDING);
    let r = memoDetail(store, hr, memo.id).versions[0].assignments[0];
    assert.ok(r.firstViewedAt); assert.equal(r.status, 'pending');
    requestClarification(store, worker, memo.id, 1, { question: 'Does this apply on Saturdays?' });
    mine = myMemos(store, worker)[0];
    assert.equal(mine.status, 'clarification'); assert.equal(mine.statusLabel, 'Clarification Requested');
    assert.equal(memoSummary(store, hr).clarifications, 1);
    const q = memoDetail(store, hr, memo.id).versions[0].assignments[0].clarifications[0];
    assert.throws(() => answerClarification(store, worker, memo.id, q.id, { answer: 'x' }), /permission/i);
    answerClarification(store, hr, memo.id, q.id, { answer: 'No, weekdays only.' });
    assert.equal(myMemos(store, worker)[0].status, 'answered');
    acknowledgeMemo(store, worker, memo.id, 1);
    r = memoDetail(store, hr, memo.id).versions[0].assignments[0];
    assert.equal(r.status, 'acknowledged'); assert.equal(r.ackWording, ACK_WORDING); assert.equal(r.manual, null);
    assert.equal(acknowledgeMemo(store, worker, memo.id, 1).acknowledgedAt, r.acknowledgedAt, 'once per version');
  } finally { store.close(); }
});

test('memos: one daily reminder per day until acknowledged; overdue flagged; paper acknowledgment needs evidence and is marked manual', () => {
  const store = fixture();
  try {
    const memo = memoFor(store, '2026-11-16');
    store.db.prepare('UPDATE memo_assignments SET assigned_at=?').run('2026-11-16T01:00:00.000Z');
    const day1 = new Date('2026-11-18T01:00:00Z');   // Wed 9 AM Manila: due Tue Nov 17 passed
    assert.equal(outstandingMemos(store, 'EMP-001', day1)[0].status, 'overdue');
    assert.equal(sendDailyReminders(store, new Date('2026-11-17T22:00:00Z')).sent, 0, 'not before 8 AM Manila');
    assert.equal(sendDailyReminders(store, day1).sent, 1);
    assert.equal(sendDailyReminders(store, new Date('2026-11-18T05:00:00Z')).sent, 0, 'never twice a day');
    const notes = store.db.prepare("SELECT message FROM notifications WHERE employee_id='EMP-001' AND message LIKE 'Daily reminder%'").all();
    assert.equal(notes.length, 1); assert.match(notes[0].message, /Overdue Acknowledgment: .*Office hours from Monday/);
    assert.ok(memoDetail(store, hr, memo.id).versions[0].assignments[0].lastReminderAt);
    assert.throws(() => recordPaperAck(store, admin, memo.id, 1, 'EMP-001', { receivedOn: '2026-11-18', note: 'Signed copy', name: 'x.png', mime: 'image/png', data: 'AAAA' }), /Attach the signed/);
    recordPaperAck(store, admin, memo.id, 1, 'EMP-001', { receivedOn: '2026-11-18', note: 'Signed paper copy filed in the 201', name: 'signed.png', mime: 'image/png', data: PNG });
    const r = memoDetail(store, hr, memo.id).versions[0].assignments[0];
    assert.equal(r.status, 'acknowledged'); assert.ok(r.manual?.evidenceId); assert.equal(r.manual.by, 'admin');
    assert.equal(sendDailyReminders(store, new Date('2026-11-19T01:00:00Z')).sent, 0, 'reminders stop once acknowledged');
  } finally { store.close(); }
});

test('memos: disciplinary documents cannot be issued as memos; the official PDF of an issued version is kept unchanged', () => {
  const store = fixture();
  try {
    assert.throws(() => saveMemoDraft(store, hr, null, { title: 'Notice to explain tardiness', category: 'Notice to Explain / Disciplinary', issueDate: localToday(), body: 'Text', recipients: { mode: 'all' } }), /Due Process & Discipline/);
    const memo = memoFor(store, localToday()), first = memoPdf(store, hr, memo.id).body;
    store.db.prepare("UPDATE memos SET data=json_set(data, '$.versions[0].title', 'Changed later') WHERE id=?").run(memo.id);
    assert.equal(Buffer.compare(Buffer.from(memoPdf(store, hr, memo.id).body), Buffer.from(first)), 0, 'the exact published PDF is what is opened later');
    assert.equal(listMemos(store, hr)[0].clarifications, 0);
  } finally { store.close(); }
});

test('due process: response period from documented receipt, extensions with reasons, separate reminders, review outcome before closing', () => {
  const store = fixture();
  try {
    const today = localToday();
    const c = createCase(store, hr, { employeeId: 'EMP-001', date: today, time: '09:30', place: 'Main office', offenseId: 'insubordination', description: 'Refused a lawful instruction from the supervisor twice.', reportedBy: 'Supervisor', witnesses: '', issuingOfficer: 'HR Manager' });
    saveNte(store, hr, c.id, { allegations: 'On the date above you refused to complete the assigned report after two instructions.', rules: 'Code of Conduct section 4.2', possibleSanction: 'Written warning', responseDays: 5 });
    issueNte(store, hr, c.id);
    assert.deepEqual(dpReminderLines(store, 'EMP-001').map(l => /Pending Acknowledgment|Explanation Required/.exec(l)?.[0]), ['Pending Acknowledgment', 'Explanation Required'], 'receipt and explanation tracked separately');
    // A later verified receipt moves the deadline later and keeps the earlier one.
    const later = recordService(store, hr, c.id, { notice: 'nte', method: 'Personal service (hand delivery)', receivedOn: today, details: 'Handed over at the office' });
    assert.equal(later.nte.deadline, addDays(today, 5)); assert.equal(later.nte.deadlineBasis, 'HR-verified receipt');
    const mine = myCases(store, worker)[0];
    assert.ok(mine.notices[0].viewedAt, 'viewing is recorded'); assert.equal(mine.notices[0].receivedAt, null, 'viewing is not receipt');
    acknowledgeNotice(store, worker, c.id, 'nte');
    assert.equal(readCase(store, c.id).nte.receiptWording, NTE_ACK_WORDING);
    assert.equal(readCase(store, c.id).nte.deadline, addDays(today, 5), 'acknowledging never shortens the period');
    assert.equal(dpReminderLines(store, 'EMP-001').length, 1, 'receipt reminder stops; explanation reminder continues');
    requestExtension(store, worker, c.id, { reason: 'I need my time records from the client site.', until: addDays(today, 8) });
    assert.throws(() => toEvaluation(store, hr, c.id, {}), /more time/);
    const req = readCase(store, c.id).nte.extensionRequests[0];
    assert.throws(() => decideExtension(store, hr, c.id, { requestId: req.id, action: 'grant', deadline: addDays(today, 8), reason: '' }), /reason/);
    const granted = decideExtension(store, hr, c.id, { requestId: req.id, action: 'grant', deadline: addDays(today, 8), reason: 'Records requested from the client' });
    assert.equal(granted.nte.deadline, addDays(today, 8)); assert.equal(granted.nte.deadlineHistory.at(-1).from, addDays(today, 5));
    // No explanation is assumed: HR records the waiver; evaluation and decision are management's.
    toEvaluation(store, hr, c.id, { waived: true, note: 'Written waiver signed on the date of issue.' });
    saveEvaluation(store, hr, c.id, { findings: 'The refusal is established by the supervisor and two records.', recommendation: 'Written warning' });
    draftDecision(store, hr, c.id, { sanction: 'Written warning', findings: 'The refusal is established by the supervisor and two records.' });
    submitDecision(store, hr, c.id); reviewDecision(store, boss, c.id, { action: 'approve' }); issueDecision(store, hr, c.id);
    assert.ok(myCases(store, worker)[0].canAskReview);
    requestReview(store, worker, c.id, { grounds: 'The supervisor instruction conflicted with the client deadline.' });
    assert.throws(() => closeCase(store, hr, c.id, {}), /Review \/ Appeal Outcome/);
    recordReviewOutcome(store, hr, c.id, { outcome: 'Modified', sanction: 'Verbal warning', body: 'Considering the client deadline, the sanction is reduced to a verbal warning.' });
    assert.ok(dpReminderLines(store, 'EMP-001').some(l => /Review \/ Appeal Outcome/.test(l)));
    const closed = closeCase(store, hr, c.id, {});
    assert.equal(closed.closure.outcome, 'Verbal warning', 'the sanction that stands after the review is recorded');
  } finally { store.close(); }
});
