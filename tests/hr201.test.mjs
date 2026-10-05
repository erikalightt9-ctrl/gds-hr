import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';
import { createEmployee, updateEmployee, directory, dashboard, employeeForm, archiveEmployee, readSettings, saveSettings } from '../src/hr201.mjs';
import { upload201, reviewDocument, employeeChecklist, documentSummary, document201Content, setNotApplicable } from '../src/documents201.mjs';
import { saveMemoDraft, publishMemo, myMemos, acknowledgeMemo, memoSummary, startRevision, listMemos } from '../src/memos.mjs';
import { saveTraining, assignParticipants, updateParticipant, trainingsForEmployee, participationRows } from '../src/trainings.mjs';
import { saveMySheet, reviewSheet, listSheets } from '../src/datasheets.mjs';
import { completeState } from './helpers.mjs';

// Fictional demonstration people only.
const admin = { id: 'a', username: 'admin', role: 'admin' }, hr = { username: 'hr.manager', role: 'hr' }, staff = { username: 'hr.staff', role: 'hr_staff' };
const PDF = Buffer.from('%PDF-1.4\n% demo\n').toString('base64');
const form = (first, last, extra = {}) => ({
  personal: { firstName: first, lastName: last, birthDate: '1995-03-14', ...extra.personal },
  contact: { workEmail: `${first.toLowerCase()}@example.test`, mobile: '09170000000', ...extra.contact },
  emergency: { name: 'Demo Contact', relationship: 'Sibling', contact: '09170000001' },
  employment: { dateHired: '2026-09-01', department: 'Operations', position: 'Analyst', classification: 'Probationary', ...extra.employment },
});
function fresh() { const store = new Store(':memory:'); const s = completeState(); s.employees = []; store.write(s); return store; }

test('HR adds an employee with an automatic number; it persists after reopening; duplicates are flagged', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hr201-')), file = path.join(dir, 'hr.sqlite');
  try {
    let store = new Store(file); const s = completeState(); s.employees = []; store.write(s);
    const a = createEmployee(store, staff, form('Ana', 'Demo'));
    assert.equal(a.created.id, 'EMP-2026-0001');
    const b = createEmployee(store, hr, form('Ben', 'Sample'));
    assert.equal(b.created.id, 'EMP-2026-0002');
    const dup = createEmployee(store, hr, form('Ana', 'Demo'));
    assert.equal(dup.created, null); assert.equal(dup.duplicates[0].id, 'EMP-2026-0001');
    assert.throws(() => createEmployee(store, hr, form('Cy', 'Test', { contact: { workEmail: 'not-an-email' } })), /valid email/);
    assert.throws(() => createEmployee(store, { username: 'v', role: 'viewer' }, form('Di', 'Test')), /permission/i);
    store.close();
    store = new Store(file);
    const people = directory(store, hr);
    assert.deepEqual(people.map(p => p.id).sort(), ['EMP-2026-0001', 'EMP-2026-0002']);
    assert.equal(people.find(p => p.id === 'EMP-2026-0001').position, 'Analyst');
    // Changing the displayed number keeps the stable internal id.
    updateEmployee(store, hr, 'EMP-2026-0001', { ...form('Ana', 'Demo'), employeeNumber: 'GDS-0099' });
    assert.equal(directory(store, hr).find(p => p.id === 'EMP-2026-0001').number, 'GDS-0099');
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('uploading and verifying a required document updates completion and the dashboard', () => {
  const store = fresh();
  try {
    const id = createEmployee(store, hr, form('Ana', 'Demo')).created.id;
    const before = documentSummary(store, hr);
    const list = employeeChecklist(store, hr, id), required = list.requiredCount;
    assert.equal(list.items.find(i => i.requirement.id === 'contract').status, 'Missing');
    const doc = upload201(store, staff, id, { requirementId: 'contract', name: 'contract.pdf', mime: 'application/pdf', data: PDF });
    assert.equal(employeeChecklist(store, hr, id).items.find(i => i.requirement.id === 'contract').status, 'Submitted');
    assert.equal(employeeChecklist(store, hr, id).completeCount, 0, 'unreviewed documents are not complete');
    reviewDocument(store, staff, doc.id, { decision: 'Verified' });
    const after = employeeChecklist(store, hr, id);
    assert.equal(after.completeCount, 1); assert.equal(after.percent, Math.round(100 / required));
    assert.equal(documentSummary(store, hr).missingDocuments, before.missingDocuments - 1);
    // Replacing a verified document needs a reason and keeps the old version.
    assert.throws(() => upload201(store, hr, id, { requirementId: 'contract', name: 'v2.pdf', mime: 'application/pdf', data: PDF }), /reason/);
    upload201(store, hr, id, { requirementId: 'contract', name: 'v2.pdf', mime: 'application/pdf', data: PDF, replaceReason: 'Signed copy' });
    const item = employeeChecklist(store, hr, id).items.find(i => i.requirement.id === 'contract');
    assert.equal(item.versions.length, 2); assert.equal(item.status, 'Submitted');
    // Expired documents are not complete.
    const idDoc = upload201(store, hr, id, { requirementId: 'valid-id', name: 'id.pdf', mime: 'application/pdf', data: PDF, expiryDate: '2020-01-01' });
    reviewDocument(store, hr, idDoc.id, { decision: 'Verified' });
    assert.equal(employeeChecklist(store, hr, id).items.find(i => i.requirement.id === 'valid-id').status, 'Expired');
    assert.throws(() => reviewDocument(store, hr, idDoc.id, { decision: 'Rejected' }), /reason/);
    setNotApplicable(store, hr, id, 'nbi', { notApplicable: true, reason: 'Transferred from affiliate with clearance on file' });
    assert.equal(employeeChecklist(store, hr, id).items.find(i => i.requirement.id === 'nbi').status, 'Not Applicable');
    assert.throws(() => upload201(store, hr, id, { requirementId: 'contract', name: 'x.pdf', mime: 'application/pdf', data: Buffer.from('not a pdf').toString('base64') }), /does not match/);
    const dash = dashboard(store, hr);
    assert.equal(dash.totals.total, 1); assert.equal(dash.totals.newHires, dash.asOf >= '2026-09-01' && dash.asOf <= '2026-10-01' ? 1 : dash.totals.newHires);
  } finally { store.close(); }
});

test('restricted documents and other teams stay private, including direct requests', () => {
  const store = fresh();
  try {
    const a = createEmployee(store, hr, form('Ana', 'Demo')).created.id;
    const b = createEmployee(store, hr, form('Ben', 'Other', { employment: { department: 'Finance' } })).created.id;
    assert.throws(() => upload201(store, staff, a, { requirementId: 'medical', name: 'm.pdf', mime: 'application/pdf', data: PDF }), /restricted/i);
    const med = upload201(store, hr, a, { requirementId: 'medical', name: 'm.pdf', mime: 'application/pdf', data: PDF });
    assert.throws(() => document201Content(store, staff, med.id), /restricted/);
    assert.ok(document201Content(store, hr, med.id).content.length);
    assert.equal(employeeChecklist(store, staff, a).items.find(i => i.requirement.id === 'medical').current, null);
    // Department manager linked to Ana (Operations) cannot open Ben (Finance).
    const manager = { username: 'mgr', role: 'dept_manager', employeeId: a };
    assert.deepEqual(directory(store, manager).map(p => p.id), [a]);
    assert.throws(() => employeeForm(store, manager, b), /outside your assigned team/);
    assert.throws(() => document201Content(store, manager, med.id), /permission/i);
    // Employees reach only their own uploads; government numbers are masked for HR Staff.
    const ben = { username: 'ben', role: 'employee', employeeId: b };
    assert.throws(() => document201Content(store, ben, med.id), /restricted/);
    updateEmployee(store, hr, a, { ...form('Ana', 'Demo'), government: { tin: '123-456-789', sss: '', philHealth: '', pagIbig: '' } });
    assert.equal(employeeForm(store, staff, a).form.government.tin, '•••• 789');
    assert.equal(employeeForm(store, hr, a).form.government.tin, '123-456-789');
    archiveEmployee(store, hr, b, { reason: 'Resigned (demo)' });
    assert.equal(directory(store, hr).find(p => p.id === b).status, 'Archived');
    assert.throws(() => archiveEmployee(store, staff, a, { reason: 'test' }), /permission/i);
  } finally { store.close(); }
});

test('an employee data sheet updates the same record only after HR approval', () => {
  const store = fresh();
  try {
    const id = createEmployee(store, hr, form('Ana', 'Demo')).created.id;
    const me = { username: 'ana', role: 'employee', employeeId: id };
    const fields = { personal: { firstName: 'Ana', lastName: 'Demo', middleName: 'Marie', preferredName: 'Annie' }, contact: { mobile: '09179999999', personalEmail: 'ana.personal@example.test', currentAddress: 'Demo Street 1' }, emergency: { name: 'New Contact', relationship: 'Parent', contact: '09171111111' }, government: { tin: '', sss: '01-2345678-9', philHealth: '', pagIbig: '' } };
    saveMySheet(store, me, fields, false);
    assert.equal(listSheets(store, hr).length, 0, 'drafts are private to the employee');
    const sheet = saveMySheet(store, me, fields, true);
    assert.equal(employeeForm(store, hr, id).form.contact.mobile, '09170000000', 'nothing changes before approval');
    assert.throws(() => reviewSheet(store, staff, sheet.id, { decision: 'approve' }), /permission/i);
    reviewSheet(store, staff, sheet.id, { decision: 'under-review' });
    reviewSheet(store, hr, sheet.id, { decision: 'approve' });
    const after = employeeForm(store, hr, id).form;
    assert.equal(after.contact.mobile, '09179999999'); assert.equal(after.personal.middleName, 'Marie'); assert.equal(after.emergency.name, 'New Contact'); assert.equal(after.government.sss, '01-2345678-9');
    assert.equal(directory(store, hr).length, 1, 'no duplicate employee');
    assert.equal(after.contact.workEmail, 'ana@example.test', 'HR-only fields untouched');
  } finally { store.close(); }
});

test('memos reach only their recipients and an acknowledgement clears the pending count', () => {
  const store = fresh();
  try {
    const a = createEmployee(store, hr, form('Ana', 'Demo')).created.id;
    const b = createEmployee(store, hr, form('Ben', 'Other', { employment: { department: 'Finance' } })).created.id;
    const memo = saveMemoDraft(store, staff, null, { title: 'Demo policy update', issueDate: '2026-10-01', body: 'Fictional memo text.', recipients: { mode: 'departments', departments: ['Operations'] }, ackRequired: true, ackDeadline: '2026-10-10' });
    assert.equal(myMemos(store, { role: 'employee', username: 'ana', employeeId: a }).length, 0, 'drafts are not delivered');
    assert.throws(() => publishMemo(store, staff, memo.id), /permission/i);
    publishMemo(store, hr, memo.id);
    const ana = { role: 'employee', username: 'ana', employeeId: a }, ben = { role: 'employee', username: 'ben', employeeId: b };
    assert.equal(myMemos(store, ana).length, 1); assert.equal(myMemos(store, ben).length, 0);
    assert.equal(memoSummary(store, hr).pending, 1);
    assert.throws(() => acknowledgeMemo(store, ben, memo.id, 1), /not addressed/);
    acknowledgeMemo(store, ana, memo.id, 1);
    assert.equal(memoSummary(store, hr).pending, 0);
    assert.ok(myMemos(store, ana)[0].acknowledgedAt);
    startRevision(store, hr, memo.id);
    assert.throws(() => publishMemo(store, hr, memo.id), /what changed/);
    publishMemo(store, hr, memo.id, { changeNote: 'Clarified section 2' });
    assert.equal(memoSummary(store, hr).pending, 1, 'a revision needs its own acknowledgement');
    assert.equal(listMemos(store, hr)[0].version, 2);
  } finally { store.close(); }
});

test('training assignment, attendance and completion show in the profile and reports', () => {
  const store = fresh();
  try {
    const a = createEmployee(store, hr, form('Ana', 'Demo')).created.id;
    const t = saveTraining(store, staff, null, { title: 'Demo safety orientation', date: '2026-09-15', startTime: '09:00', endTime: '11:00', venue: 'Training room', required: true });
    assignParticipants(store, staff, t.id, { employeeIds: [a] });
    const ana = { role: 'employee', username: 'ana', employeeId: a };
    updateParticipant(store, ana, t.id, a, { registration: 'confirmed' });
    assert.throws(() => updateParticipant(store, ana, t.id, a, { completion: 'completed' }), /registration only/);
    assert.throws(() => updateParticipant(store, staff, t.id, a, { completion: 'completed' }), /attendance before/);
    updateParticipant(store, staff, t.id, a, { attendance: 'attended', completion: 'completed' });
    const mine = trainingsForEmployee(store, a)[0];
    assert.equal(mine.registration, 'confirmed'); assert.equal(mine.attendance, 'attended'); assert.equal(mine.completion, 'completed');
    assert.equal(participationRows(store, hr)[0].completion, 'completed');
    assert.throws(() => saveTraining(store, staff, null, { title: 'Bad times', date: '2026-09-15', startTime: '11:00', endTime: '09:00' }), /after the start/);
  } finally { store.close(); }
});

test('settings: only administrators change them; classifications drive the form', () => {
  const store = fresh();
  try {
    const s = readSettings(store);
    assert.throws(() => saveSettings(store, hr, s), /permission/i);
    saveSettings(store, admin, { ...s, classifications: ['Regular', 'Probationary', 'Consultant'], idFormat: { prefix: 'GDS', includeYear: false, digits: 3 } });
    assert.equal(createEmployee(store, hr, form('Ana', 'Demo', { employment: { classification: 'Consultant' } })).created.id, 'GDS-001');
    assert.throws(() => createEmployee(store, hr, form('Ben', 'Demo', { employment: { classification: 'Fixed-Term' } })), /classification/);
  } finally { store.close(); }
});
