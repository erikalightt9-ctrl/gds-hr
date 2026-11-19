// Memo & due process management: disciplinary cases handled under procedural due process (Labor Code art. 292(b);
// DOLE Department Order No. 147-15): written notice of the charge, a reasonable opportunity (at least five calendar
// days, configurable upward) to answer in writing, a hearing or conference when requested, when the evidence is
// disputed or when company policy requires it, evaluation, and a written notice of decision.
//
// The system never decides. HR documents and evaluates; a PROPOSED decision is issued only after an authorised
// manager (a configurable role, never the person who proposed it) approves it. Notices (NTE, notice of hearing, notice
// of decision) are issued through the Memos module on the company letterhead, so the employee receives and
// acknowledges them like any memo. Disciplinary records are the approved decisions (one source, no second copy).
// Every action is recorded in the case history and in the audit trail. Access: HR managers and administrators
// manage cases; Management reads them and may approve decisions; employees see only their own case from the NTE on.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { readSettings } from './hr201.mjs';
import { validFile } from './documents201.mjs';
import { issueSystemMemo } from './memos.mjs';
import { renderMemoPdf } from './memo-pdf.mjs';

export const DISCIPLINE_MANAGE = ['admin', 'hr'], DISCIPLINE_VIEW = ['admin', 'hr', 'viewer'];
export const STATUSES = ['Pending', 'Under Investigation', 'Awaiting Explanation', 'For Evaluation', 'Resolved', 'Closed'];
export const ACTIONS = ['No disciplinary action', 'Verbal warning', 'Written warning', 'Final written warning', 'Suspension', 'Termination', 'Other'];
const DEFAULT_SETTINGS = {
  minResponseDays: 5, approverRoles: ['admin', 'viewer'], hearingForTermination: true, maxSuspensionDays: 30,
  offenses: ['Tardiness / habitual tardiness', 'Absence without official leave (AWOL)', 'Insubordination', 'Neglect of duty', 'Dishonesty', 'Misconduct', 'Violation of company policy', 'Fraud or breach of trust', 'Damage to company property', 'Other'],
};
const ensure = store => store.db.exec(`CREATE TABLE IF NOT EXISTS discipline_cases (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS discipline_files (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, data TEXT NOT NULL, content BLOB NOT NULL);
  CREATE TABLE IF NOT EXISTS discipline_settings (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);`);
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const text = (min, max, msg) => z.string().trim().min(min, msg).max(max);
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = d => (d ? `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : '');

// ---------- Settings ----------
export function disciplineSettings(store) {
  ensure(store);
  const saved = JSON.parse(store.db.prepare('SELECT data FROM discipline_settings WHERE id=1').get()?.data ?? '{}');
  return { ...DEFAULT_SETTINGS, ...saved };
}
export function saveDisciplineSettings(store, actor, input) {
  permit(actor, ['admin']);
  const v = z.object({ minResponseDays: z.number().int().min(5, 'DOLE D.O. 147-15 requires at least five (5) calendar days to answer.').max(30), approverRoles: z.array(z.enum(['admin', 'hr', 'viewer'])).min(1, 'Choose who may approve decisions.'), hearingForTermination: z.boolean(), maxSuspensionDays: z.number().int().min(1).max(60), offenses: z.array(text(2, 120)).min(1).max(100) }).strict().parse(input);
  ensure(store);
  return store.transaction(() => {
    const before = disciplineSettings(store);
    store.db.prepare('INSERT INTO discipline_settings(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(JSON.stringify(v));
    store.log(actor, 'update', 'discipline-settings', 'policy', before, v);
    return disciplineSettings(store);
  });
}

// ---------- Storage ----------
const read = (store, id) => { ensure(store); const row = store.db.prepare('SELECT data FROM discipline_cases WHERE id=?').get(id); if (!row) throw new AppError('Case not found.', 404); return JSON.parse(row.data); };
const write = (store, c) => store.db.prepare('INSERT INTO discipline_cases(id,employee_id,status,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, data=excluded.data').run(c.id, c.employeeId, c.status, JSON.stringify(c));
const nextReference = (store, date) => {
  const key = `case:${date.slice(0, 4)}`, n = (store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(key)?.value || 0) + 1;
  store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, n);
  return `CASE-${date.slice(0, 4)}-${String(n).padStart(3, '0')}`;
};
// One step: changes the case, appends to its history, writes the audit trail.
function step(store, actor, c, action, detail, changes) {
  const before = { status: c.status, stage: c.stage };
  const after = { ...c, ...changes, updatedAt: new Date().toISOString(), history: [...c.history, { at: new Date().toISOString(), by: actor.username, action, detail: detail || '' }] };
  write(store, after);
  store.log(actor, action, 'discipline-case', c.id, before, { status: after.status, stage: after.stage, reference: c.reference, employeeId: c.employeeId, detail: detail || '' });
  return after;
}
const companyName = store => readSettings(store).company.name || 'GDS CAPITAL INC.';
const staffName = (store, username) => { const u = store.db.prepare('SELECT employee_id FROM users WHERE username=?').get(username); const e = u?.employee_id && store.read().employees.find(x => x.id === u.employee_id); return e?.name || username; };
const formalName = n => { const [last, first] = String(n).split(',').map(s => s.trim()); return first ? `${first} ${last}` : n; };

// ---------- Incident documentation ----------
const incidentSchema = z.object({
  employeeId: z.string().trim().min(1).max(80), incidentDate: z.string().regex(dateRe, 'Enter the incident date.'), incidentTime: z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/).default(''),
  place: z.string().trim().max(200).default(''), offense: text(2, 120, 'Choose the offense or rule concerned.'), description: text(20, 8000, 'Describe the incident (at least 20 characters): what happened, when, where and who was involved.'),
  reportedBy: text(2, 200, 'Who reported the incident?'), witnesses: z.string().trim().max(1000).default(''),
}).strict();
export function createCase(store, actor, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const v = incidentSchema.parse(input), state = store.read(), e = state.employees.find(x => x.id === v.employeeId);
  if (!e || e.draft) throw new AppError('Choose a registered employee.');
  if (v.incidentDate > localToday()) throw new AppError('The incident date cannot be in the future.');
  ensure(store);
  return store.transaction(() => {
    const now = new Date().toISOString(), job = profileOf(store, e.id, 'employment');
    const c = { id: randomUUID(), reference: nextReference(store, localToday()), employeeId: e.id, employee: { name: e.name, department: job.department || e.department || '', position: job.position || '' }, incident: { ...v }, status: 'Pending', stage: 'incident', files: [], history: [{ at: now, by: actor.username, action: 'opened', detail: `Incident documented: ${v.offense}` }], openedAt: now, openedBy: actor.username, updatedAt: now };
    write(store, c);
    store.log(actor, 'create', 'discipline-case', c.id, null, { reference: c.reference, employeeId: e.id, offense: v.offense });
    return c;
  });
}
// The incident can be corrected until the NTE is issued; after that the charge is fixed (notes can still be added).
export function updateIncident(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const rest = { ...(input || {}) }; delete rest.employeeId;   // the employee of a case never changes
  const v = incidentSchema.omit({ employeeId: true }).parse(rest);
  return store.transaction(() => {
    const c = read(store, id);
    if (!['Pending', 'Under Investigation'].includes(c.status)) throw new AppError('The incident can no longer be edited: a Notice to Explain was issued. Add a note instead.');
    return step(store, actor, c, 'edit-incident', 'Incident details corrected', { incident: { ...c.incident, ...v } });
  });
}
export function startInvestigation(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const { note } = z.object({ note: z.string().trim().max(2000).default('') }).strict().parse(input || {});
  return store.transaction(() => {
    const c = read(store, id);
    if (c.status !== 'Pending') throw new AppError('Only a pending case can be placed under investigation.');
    return step(store, actor, c, 'investigate', note || 'Investigation started', { status: 'Under Investigation', stage: 'investigation' });
  });
}
export function addCaseNote(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const { note } = z.object({ note: text(3, 4000, 'Write the note.') }).strict().parse(input);
  return store.transaction(() => { const c = read(store, id); if (c.status === 'Closed') throw new AppError('The case is closed.'); return step(store, actor, c, 'note', note, {}); });
}

// ---------- Files (evidence, explanation documents, hearing minutes) ----------
const fileSchema = z.object({ name: z.string().trim().min(1).max(180).refine(x => !/[\x00-\x1f\\/]/.test(x), 'Invalid file name.'), mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']), data: z.string().min(1).max(14_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/), kind: z.enum(['evidence', 'explanation', 'hearing', 'other']).default('evidence'), description: z.string().trim().max(500).default('') }).strict();
function storeFile(store, actor, c, input, forceKind = null) {
  const v = fileSchema.parse(input), bytes = Buffer.from(v.data, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !validFile(v.mime, bytes)) throw new AppError('Attach a PDF, PNG or JPEG up to 10 MB.');
  const meta = { id: randomUUID(), name: v.name, mime: v.mime, size: bytes.length, kind: forceKind || v.kind, description: v.description, uploadedBy: actor.username, uploadedAt: new Date().toISOString() };
  store.db.prepare('INSERT INTO discipline_files(id,case_id,data,content) VALUES(?,?,?,?)').run(meta.id, c.id, JSON.stringify(meta), bytes);
  return meta;
}
export function addCaseFile(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  return store.transaction(() => {
    const c = read(store, id);
    if (c.status === 'Closed') throw new AppError('The case is closed.');
    const meta = storeFile(store, actor, c, input);
    return step(store, actor, c, 'attach', `${meta.kind}: ${meta.name}`, { files: [...c.files, meta] });
  });
}
export function caseFile(store, actor, fileId) {
  ensure(store);
  const row = store.db.prepare('SELECT case_id, data, content FROM discipline_files WHERE id=?').get(fileId);
  if (!row) throw new AppError('File not found.', 404);
  const c = read(store, row.case_id), meta = JSON.parse(row.data);
  if (actor.role === 'employee') { if (c.employeeId !== actor.employeeId || meta.kind !== 'explanation') throw new AppError('File not found.', 404); }
  else permit(actor, DISCIPLINE_VIEW);
  store.log(actor, 'download', 'discipline-file', fileId, null, { case: c.reference, name: meta.name });
  return { meta, content: row.content };
}

// ---------- Notices (issued as memos on the letterhead) ----------
function issueNotice(store, actor, c, { title, kind, subject, paragraphs, after = [] }) {
  const today = localToday(), issuer = staffName(store, actor.username);
  const pdf = reference => renderMemoPdf({ reference, date: longDate(today), to: `${formalName(c.employee.name)} (${c.employeeId}) · ${c.employee.position || ''} · ${c.employee.department || ''}`, from: `${issuer}, Human Resources`, subject, paragraphs, after, signature: [issuer, 'Human Resources', companyName(store)] });
  return issueSystemMemo(store, { title, category: 'Notice to Explain / Disciplinary', body: [`Subject: ${subject}`, '', ...paragraphs, '', ...after, '', issuer, 'Human Resources'].join('\n'), employeeIds: [c.employeeId], issueDate: today, pdf, pdfName: `${kind}-${c.reference}-{ref}.pdf`, issuedBy: actor.username, kind: `discipline-${kind}` });
}
const nteSchema = z.object({ allegations: text(20, 8000, 'State the specific acts or omissions charged (at least 20 characters).'), rules: text(3, 2000, 'Name the company rule or policy allegedly violated.'), possibleSanction: text(3, 300, 'State the penalty that may be imposed if the charge is proven.'), responseDeadline: z.string().regex(dateRe, 'Choose the date by which the employee must answer.'), hearingOffered: z.boolean().default(true) }).strict();
export function issueNte(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const v = nteSchema.parse(input), settings = disciplineSettings(store), today = localToday(), earliest = addDays(today, settings.minResponseDays);
  if (v.responseDeadline < earliest) throw new AppError(`Give the employee at least ${settings.minResponseDays} calendar days to answer: the earliest deadline is ${earliest}.`);
  return store.transaction(() => {
    const c = read(store, id);
    if (!['Pending', 'Under Investigation'].includes(c.status)) throw new AppError('A Notice to Explain can be issued only once, before the explanation stage.');
    const name = formalName(c.employee.name);
    const memo = issueNotice(store, actor, c, { title: `Notice to Explain · ${c.reference}`, kind: 'nte', subject: `NOTICE TO EXPLAIN · ${c.incident.offense}`,
      paragraphs: [`Dear ${name},`, `This is to notify you of the following charge, based on the incident of ${longDate(c.incident.incidentDate)}${c.incident.place ? ` at ${c.incident.place}` : ''}:`, v.allegations, `Rule / policy concerned: ${v.rules}`, `If proven, this may warrant the following penalty: ${v.possibleSanction}.`],
      after: [`You are directed to submit a written explanation on or before ${longDate(v.responseDeadline)} (${settings.minResponseDays} or more calendar days from receipt of this notice). You may attach supporting documents, and you may consult a representative of your choice.`, v.hearingOffered ? 'You may request a hearing or conference where you can present your side and evidence. State the request in your explanation.' : 'A hearing or conference will be scheduled if you request one in writing or if the evidence requires it.', 'You may submit your explanation in your employee account (My memos / My cases) or in writing to Human Resources. If no explanation is received by the deadline, the case will be evaluated on the basis of the available evidence.', 'This notice is not a finding of guilt. No penalty is imposed by this notice.'] });
    const nte = { ...v, issuedAt: new Date().toISOString(), issuedBy: actor.username, memoId: memo.id, memoReference: memo.reference };
    store.notify(c.employeeId, `Notice to Explain ${c.reference}: please submit your written explanation by ${v.responseDeadline}.`);
    return step(store, actor, c, 'issue-nte', `NTE ${memo.reference} issued; explanation due ${v.responseDeadline}`, { nte, status: 'Awaiting Explanation', stage: 'explanation' });
  });
}

// ---------- Employee explanation ----------
const explanationSchema = z.object({ text: text(10, 20000, 'Write your explanation (at least 10 characters).'), requestsHearing: z.boolean().default(false), files: z.array(fileSchema.omit({ kind: true })).max(5).default([]) }).strict();
function receiveExplanation(store, actor, c, v, by) {
  if (c.status !== 'Awaiting Explanation') throw new AppError(c.explanation ? 'An explanation was already received for this case.' : 'This case is not waiting for an explanation.');
  const files = v.files.map(f => storeFile(store, actor, c, { ...f, kind: 'explanation' }, 'explanation'));
  const explanation = { text: v.text, requestsHearing: v.requestsHearing, submittedAt: new Date().toISOString(), submittedBy: actor.username, by, late: localToday() > c.nte.responseDeadline, fileIds: files.map(f => f.id) };
  return step(store, actor, c, 'explanation', `${by === 'employee' ? 'Employee submitted' : 'HR recorded'} the written explanation${explanation.late ? ' (after the deadline)' : ''}${v.requestsHearing ? '; hearing requested' : ''}`, { explanation, files: [...c.files, ...files], status: 'For Evaluation', stage: v.requestsHearing ? 'hearing' : 'evaluation' });
}
export function submitCaseExplanation(store, actor, id, input) {
  permit(actor, ['employee']);
  const v = explanationSchema.parse(input);
  return store.transaction(() => {
    const c = read(store, id);
    if (c.employeeId !== actor.employeeId || !c.nte) throw new AppError('Case not found.', 404);
    const after = receiveExplanation(store, actor, c, v, 'employee');
    store.notify(null, `${c.employeeId} ${c.employee.name}: written explanation received for ${c.reference}${v.requestsHearing ? ' (hearing requested)' : ''}.`);
    return employeeView(after);
  });
}
export function recordExplanation(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const v = explanationSchema.parse(input);
  return store.transaction(() => receiveExplanation(store, actor, read(store, id), v, 'hr'));
}
// After the deadline without an answer, HR records that none was received; the case is then evaluated on the evidence.
export function recordNoExplanation(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const { note } = z.object({ note: z.string().trim().max(2000).default('') }).strict().parse(input || {});
  return store.transaction(() => {
    const c = read(store, id);
    if (c.status !== 'Awaiting Explanation') throw new AppError('This case is not waiting for an explanation.');
    if (localToday() <= c.nte.responseDeadline) throw new AppError(`The employee has until ${c.nte.responseDeadline} to answer. Wait until the deadline has passed.`);
    return step(store, actor, c, 'no-explanation', note || 'No written explanation received by the deadline', { noExplanation: { recordedAt: new Date().toISOString(), recordedBy: actor.username, note }, status: 'For Evaluation', stage: 'evaluation' });
  });
}

// ---------- Administrative hearing / conference ----------
const hearingSchema = z.object({ date: z.string().regex(dateRe, 'Choose the hearing date.'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Choose the time.'), place: text(2, 200, 'Enter the venue or meeting link.'), panel: z.string().trim().max(500).default(''), sendNotice: z.boolean().default(true) }).strict();
export function scheduleHearing(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const v = hearingSchema.parse(input);
  if (v.date < localToday()) throw new AppError('The hearing date is in the past.');
  return store.transaction(() => {
    const c = read(store, id);
    if (!['Awaiting Explanation', 'For Evaluation'].includes(c.status) || c.proposal) throw new AppError('A hearing can be scheduled after the Notice to Explain and before a decision is proposed.');
    let notice = null;
    if (v.sendNotice) {
      const memo = issueNotice(store, actor, c, { title: `Notice of Hearing · ${c.reference}`, kind: 'hearing', subject: `NOTICE OF ADMINISTRATIVE HEARING · ${c.reference}`, paragraphs: [`Dear ${formalName(c.employee.name)},`, `In connection with the Notice to Explain ${c.nte?.memoReference || ''} (${c.incident.offense}), you are invited to an administrative hearing / conference on ${longDate(v.date)} at ${v.time}, ${v.place}.`], after: ['You may present your explanation, witnesses and evidence, and you may be assisted by a representative of your choice. If you cannot attend, inform Human Resources in advance so the hearing can be rescheduled.'] });
      notice = { memoId: memo.id, memoReference: memo.reference };
      store.notify(c.employeeId, `Administrative hearing for ${c.reference} on ${v.date} at ${v.time}, ${v.place}.`);
    }
    const hearing = { ...v, ...notice, scheduledAt: new Date().toISOString(), scheduledBy: actor.username, held: false };
    return step(store, actor, c, 'schedule-hearing', `Hearing set for ${v.date} ${v.time}, ${v.place}`, { hearing, stage: 'hearing' });
  });
}
const proceedingsSchema = z.object({ held: z.boolean(), employeeAttended: z.boolean().default(false), attendees: text(2, 1000, 'List who attended.'), statements: z.string().trim().max(20000).default(''), minutes: text(10, 40000, 'Record the proceedings (at least 10 characters).') }).strict();
export function recordHearing(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const v = proceedingsSchema.parse(input);
  return store.transaction(() => {
    const c = read(store, id);
    if (!c.hearing) throw new AppError('Schedule the hearing first.');
    if (c.proposal) throw new AppError('A decision was already proposed.');
    const hearing = { ...c.hearing, ...v, recordedAt: new Date().toISOString(), recordedBy: actor.username };
    return step(store, actor, c, 'record-hearing', v.held ? `Hearing held${v.employeeAttended ? '' : ' (employee did not attend)'}` : 'Hearing did not take place', { hearing, stage: c.status === 'For Evaluation' ? 'evaluation' : c.stage });
  });
}

// ---------- Evaluation, proposed decision, management approval ----------
const hearingNeeded = (c, action, settings) => c.explanation?.requestsHearing || (action === 'Termination' && settings.hearingForTermination);
export function evaluateCase(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const v = z.object({ substantiated: z.boolean(), findings: text(20, 20000, 'Write the findings: the evidence considered and the employee\'s explanation (at least 20 characters).') }).strict().parse(input);
  return store.transaction(() => {
    const c = read(store, id);
    if (c.status !== 'For Evaluation') throw new AppError('The case can be evaluated after the explanation is received (or the deadline has passed without one).');
    if (c.explanation?.requestsHearing && !c.hearing?.recordedAt) throw new AppError('The employee requested a hearing. Schedule it and record the proceedings before evaluating.');
    if (c.proposal) throw new AppError('A decision was already proposed. The approver can return it for re-evaluation.');
    return step(store, actor, c, 'evaluate', v.substantiated ? 'Charge found substantiated' : 'Charge not substantiated', { evaluation: { ...v, by: actor.username, at: new Date().toISOString() }, stage: 'evaluation' });
  });
}
const proposalSchema = z.object({ action: z.enum(ACTIONS), otherAction: z.string().trim().max(200).default(''), suspensionDays: z.number().int().min(0).max(60).default(0), effectiveFrom: z.union([z.string().regex(dateRe), z.literal('')]).default(''), effectiveTo: z.union([z.string().regex(dateRe), z.literal('')]).default(''), rationale: text(20, 20000, 'Explain the basis of the proposed decision (at least 20 characters).') }).strict();
export function proposeDecision(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const v = proposalSchema.parse(input), settings = disciplineSettings(store);
  if (v.action === 'Other' && v.otherAction.length < 3) throw new AppError('Describe the other action.');
  if (v.action === 'Suspension') {
    if (v.suspensionDays < 1 || v.suspensionDays > settings.maxSuspensionDays) throw new AppError(`Suspension must be 1 to ${settings.maxSuspensionDays} days.`);
    if (!v.effectiveFrom || !v.effectiveTo || v.effectiveTo < v.effectiveFrom) throw new AppError('Enter the suspension dates.');
  }
  return store.transaction(() => {
    const c = read(store, id);
    if (c.status !== 'For Evaluation' || !c.evaluation) throw new AppError('Evaluate the case before proposing a decision.');
    if (c.proposal) throw new AppError('A decision is already waiting for approval.');
    if (!c.evaluation.substantiated && v.action !== 'No disciplinary action') throw new AppError('The charge was not substantiated: the only possible decision is no disciplinary action.');
    if (hearingNeeded(c, v.action, settings) && !c.hearing?.recordedAt) throw new AppError(v.action === 'Termination' ? 'Company policy requires a hearing or conference before a termination decision. Schedule it and record the proceedings first.' : 'The employee requested a hearing. Record the proceedings first.');
    store.notify(null, `${c.reference}: proposed decision (${v.action}) is waiting for management approval.`);
    return step(store, actor, c, 'propose', `Proposed: ${v.action}${v.action === 'Suspension' ? ` (${v.suspensionDays} days)` : ''}`, { proposal: { ...v, by: actor.username, at: new Date().toISOString() }, stage: 'approval' });
  });
}
const actionLabel = p => (p.action === 'Other' ? p.otherAction : p.action === 'Suspension' ? `Suspension of ${p.suspensionDays} day${p.suspensionDays === 1 ? '' : 's'} (${p.effectiveFrom} to ${p.effectiveTo})` : p.action);
export function reviewDecision(store, actor, id, input) {
  const settings = disciplineSettings(store);
  permit(actor, settings.approverRoles);
  const v = z.object({ decision: z.enum(['approve', 'return']), note: z.string().trim().max(4000).default('') }).strict().parse(input);
  if (v.decision === 'return' && v.note.length < 5) throw new AppError('Say what should be reconsidered.');
  return store.transaction(() => {
    const c = read(store, id);
    if (!c.proposal) throw new AppError('No decision is waiting for approval.');
    if (c.proposal.by === actor.username) throw new AppError('The decision must be approved by someone other than the person who proposed it.', 403);
    if (v.decision === 'return') return step(store, actor, c, 'return-decision', v.note, { proposal: null, evaluation: null, returned: [...(c.returned || []), { ...c.proposal, returnedBy: actor.username, returnedAt: new Date().toISOString(), note: v.note }], stage: 'evaluation' });
    const p = c.proposal, label = actionLabel(p), name = formalName(c.employee.name);
    const memo = issueNotice(store, actor, c, { title: `Notice of Decision · ${c.reference}`, kind: 'decision', subject: `NOTICE OF DECISION · ${c.reference}`,
      paragraphs: [`Dear ${name},`, `This refers to the Notice to Explain ${c.nte?.memoReference || ''} dated ${longDate(c.nte?.issuedAt?.slice(0, 10))} concerning: ${c.incident.offense}.`, c.explanation ? `Your written explanation dated ${longDate(c.explanation.submittedAt.slice(0, 10))} was received and considered.` : 'No written explanation was received by the deadline given; the case was evaluated on the available evidence.', ...(c.hearing?.recordedAt ? [`An administrative hearing / conference was ${c.hearing.held ? `held on ${longDate(c.hearing.date)}` : 'scheduled but did not take place'}.`] : []), `Findings: ${c.evaluation.findings}`, `Basis of the decision: ${p.rationale}`],
      after: [`DECISION: ${label}.`, p.action === 'No disciplinary action' ? 'The charge is considered closed and no penalty is imposed.' : 'This decision forms part of your employment record. You may seek clarification from Human Resources.'] });
    const record = { action: p.action, label, suspensionDays: p.action === 'Suspension' ? p.suspensionDays : 0, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, decisionDate: localToday(), memoId: memo.id, memoReference: memo.reference, approvedBy: actor.username, approvedAt: new Date().toISOString(), approvalNote: v.note, proposedBy: p.by };
    store.notify(c.employeeId, `Notice of Decision for ${c.reference} has been issued. Please read and acknowledge receipt.`);
    return step(store, actor, c, 'approve-decision', `Approved and issued: ${label} (${memo.reference})`, { decision: record, proposal: null, status: 'Resolved', stage: 'decision' });
  });
}
// Closure: after the decision (records the final outcome), or before any NTE when the matter is dropped.
export function closeCase(store, actor, id, input) {
  permit(actor, DISCIPLINE_MANAGE);
  const v = z.object({ outcome: text(5, 4000, 'Record the final outcome.') }).strict().parse(input);
  return store.transaction(() => {
    const c = read(store, id);
    if (!['Resolved', 'Pending', 'Under Investigation'].includes(c.status)) throw new AppError('A case can be closed after its decision is issued, or before a Notice to Explain if the matter is dropped.');
    return step(store, actor, c, 'close', v.outcome, { closure: { outcome: v.outcome, dropped: c.status !== 'Resolved', by: actor.username, at: new Date().toISOString() }, status: 'Closed', stage: 'closed' });
  });
}

// ---------- Views ----------
const summary = c => ({ id: c.id, reference: c.reference, employeeId: c.employeeId, employeeName: c.employee.name, department: c.employee.department, position: c.employee.position, offense: c.incident.offense, incidentDate: c.incident.incidentDate, status: c.status, stage: c.stage, openedAt: c.openedAt, updatedAt: c.updatedAt, responseDeadline: c.nte?.responseDeadline || '', awaitingApproval: !!c.proposal, action: c.decision?.label || '', overdueExplanation: c.status === 'Awaiting Explanation' && localToday() > (c.nte?.responseDeadline || '9999') });
export function listCases(store, actor, filters = {}) {
  permit(actor, DISCIPLINE_VIEW); ensure(store);
  const q = String(filters.q || '').trim().toLowerCase();
  return store.db.prepare('SELECT data FROM discipline_cases').all().map(r => summary(JSON.parse(r.data)))
    .filter(c => (!filters.status || c.status === filters.status) && (!filters.employeeId || c.employeeId === filters.employeeId) && (!q || `${c.reference} ${c.employeeName} ${c.employeeId} ${c.offense} ${c.department}`.toLowerCase().includes(q)))
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}
export function caseDetail(store, actor, id) {
  permit(actor, DISCIPLINE_VIEW);
  const c = read(store, id), settings = disciplineSettings(store);
  store.log(actor, 'view', 'discipline-case', id, null, { reference: c.reference });
  return { ...c, canManage: DISCIPLINE_MANAGE.includes(actor.role), canApprove: settings.approverRoles.includes(actor.role) && !!c.proposal && c.proposal.by !== actor.username, settings: { minResponseDays: settings.minResponseDays, maxSuspensionDays: settings.maxSuspensionDays, hearingForTermination: settings.hearingForTermination, earliestDeadline: addDays(localToday(), settings.minResponseDays) } };
}
// Disciplinary record of one employee: the approved decisions (verbal / written warnings, suspensions, ...).
export function disciplinaryRecords(store, actor, employeeId) {
  permit(actor, DISCIPLINE_VIEW); ensure(store);
  return store.db.prepare('SELECT data FROM discipline_cases WHERE employee_id=?').all(employeeId).map(r => JSON.parse(r.data))
    .map(c => ({ caseId: c.id, reference: c.reference, offense: c.incident.offense, incidentDate: c.incident.incidentDate, status: c.status, ...(c.decision || {}) }))
    .sort((a, b) => b.incidentDate.localeCompare(a.incidentDate));
}
export function disciplinaryRegister(store, actor) {
  permit(actor, DISCIPLINE_VIEW); ensure(store);
  return store.db.prepare('SELECT data FROM discipline_cases').all().map(r => JSON.parse(r.data)).map(c => ({ ...summary(c), nteIssued: c.nte?.issuedAt?.slice(0, 10) || '', explanationReceived: c.explanation?.submittedAt?.slice(0, 10) || (c.noExplanation ? 'None received' : ''), hearingDate: c.hearing?.date || '', decisionDate: c.decision?.decisionDate || '', action: c.decision?.label || '', suspensionDays: c.decision?.suspensionDays || 0, closedAt: c.closure?.at || '' })).sort((a, b) => a.reference.localeCompare(b.reference));
}
export function disciplineSummary(store, actor) {
  if (!DISCIPLINE_VIEW.includes(actor.role)) return null;
  const list = listCases(store, actor), settings = disciplineSettings(store);
  return { open: list.filter(c => c.status !== 'Closed').length, awaitingApproval: settings.approverRoles.includes(actor.role) ? list.filter(c => c.awaitingApproval).length : 0, overdueExplanations: list.filter(c => c.overdueExplanation).length };
}
// Employee view: only their own cases, from the NTE on, without HR's evaluation notes or the proposal.
function employeeView(c) {
  return { id: c.id, reference: c.reference, offense: c.incident.offense, incidentDate: c.incident.incidentDate, status: c.status, nte: c.nte ? { allegations: c.nte.allegations, rules: c.nte.rules, possibleSanction: c.nte.possibleSanction, responseDeadline: c.nte.responseDeadline, issuedAt: c.nte.issuedAt, memoReference: c.nte.memoReference, hearingOffered: c.nte.hearingOffered } : null, explanation: c.explanation ? { text: c.explanation.text, submittedAt: c.explanation.submittedAt, requestsHearing: c.explanation.requestsHearing, late: c.explanation.late, files: c.files.filter(f => c.explanation.fileIds.includes(f.id)).map(f => ({ id: f.id, name: f.name })) } : null, hearing: c.hearing ? { date: c.hearing.date, time: c.hearing.time, place: c.hearing.place } : null, decision: c.decision ? { label: c.decision.label, decisionDate: c.decision.decisionDate, memoReference: c.decision.memoReference } : null, canExplain: c.status === 'Awaiting Explanation' };
}
export function myCases(store, actor) {
  permit(actor, ['employee']); ensure(store);
  return store.db.prepare('SELECT data FROM discipline_cases WHERE employee_id=?').all(actor.employeeId).map(r => JSON.parse(r.data)).filter(c => c.nte).map(employeeView).sort((a, b) => b.incidentDate.localeCompare(a.incidentDate));
}
// Whether a memo may be issued as a written warning: it must refer to a case whose approved decision is a warning.
export function warningCaseOk(store, caseId, employeeIds) {
  ensure(store);
  const row = caseId && store.db.prepare('SELECT data FROM discipline_cases WHERE id=?').get(caseId);
  const c = row ? JSON.parse(row.data) : null;
  return !!c?.decision && /warning/i.test(c.decision.action) && employeeIds.length === 1 && employeeIds[0] === c.employeeId;
}
