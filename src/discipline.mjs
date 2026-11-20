// Due process cases: incident documentation → Notice to Explain → employee's explanation → administrative hearing
// (when requested or required) → evaluation → decision (approved by authorized management before it is issued) →
// closure. Nothing is decided by the system: HR records each step, management approves the decision, and every
// step is validated, timestamped in the case history and written to the audit trail (without the case text).
// Access: admin / hr manage cases; Management (viewer) can read and approve; the employee sees only notices issued
// to them and their own explanation.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { displayNumber } from './hr201.mjs';
import { validFile } from './documents201.mjs';
import { readDpSettings, fillTemplate, SANCTIONS } from './discipline-settings.mjs';

export const VIEW = ['admin', 'hr', 'viewer'], MANAGE = ['admin', 'hr'];
export const STATUS = { pending: 'Pending', investigation: 'Under Investigation', awaiting: 'Awaiting Explanation', evaluation: 'For Evaluation', resolved: 'Resolved', closed: 'Closed' };
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.');
const text = (min, max, message) => z.string().trim().min(min, message).max(max);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const longDate = iso => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');

export function ensure(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS dp_cases (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dp_files (id TEXT PRIMARY KEY, case_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, content BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS dp_actions (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, data TEXT NOT NULL);`);
}
export function readCase(store, id) { ensure(store); const row = store.db.prepare('SELECT data FROM dp_cases WHERE id=?').get(id); if (!row) throw new AppError('Case not found.', 404); return JSON.parse(row.data); }
const writeCase = (store, c) => store.db.prepare('INSERT INTO dp_cases VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(c.id, c.employeeId, JSON.stringify(c));
export const allCases = store => { ensure(store); return store.db.prepare('SELECT data FROM dp_cases ORDER BY rowid DESC').all().map(r => JSON.parse(r.data)); };
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
function nextReference(store, prefix = 'DP') {
  const year = localToday().slice(0, 4), key = `${prefix.toLowerCase()}:${year}`;
  const n = (store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(key)?.value || 0) + 1;
  store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, n);
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}
// One case change: validated by `fn` (which returns the updated case), history entry, audit entry without the text.
function change(store, actor, id, action, fn, detail = '') {
  return store.transaction(() => {
    const before = readCase(store, id), now = new Date().toISOString();
    const updated = fn(before, now);
    const after = { ...updated, updatedAt: now, history: [...before.history, { at: now, by: actor.username, action, detail }] };
    writeCase(store, after);
    store.log(actor, action, 'discipline', id, { reference: before.reference, status: before.status }, { reference: after.reference, status: after.status, employeeId: after.employeeId, ...(detail ? { detail } : {}) });
    return after;
  });
}
export function templateVars(c, extra = {}) {
  const ld = iso => (iso ? longDate(iso) : undefined);   // not known yet: the placeholder stays in the text
  return { employeeName: c.employee.name, employeeNumber: c.employee.number, position: c.employee.position || '—', department: c.employee.department || '—', reference: c.reference, today: longDate(localToday()), incidentDate: longDate(c.incident.date), incidentPlace: c.incident.place || '—', offense: c.incident.offense, description: c.incident.description, reportedBy: c.incident.reportedBy || '—', issuingOfficer: c.incident.issuingOfficer, allegations: c.nte?.allegations, rules: c.nte?.rules, possibleSanction: c.nte?.possibleSanction?.toLowerCase(), responseDays: c.nte?.responseDays, deadline: ld(c.nte?.deadline), nteDate: ld(c.nte?.issuedAt), hearingDate: c.hearing?.scheduledAt ? `${longDate(c.hearing.scheduledAt)} at ${c.hearing.scheduledAt.slice(11, 16)}` : undefined, hearingPlace: c.hearing?.place, ...extra };
}

// ---------- 1. Incident documentation ----------
const incidentSchema = z.object({
  employeeId: z.string().trim().min(1, 'Choose the employee.').max(80), date: DATE, time: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]).default(''),
  place: z.string().trim().max(200).default(''), offenseId: z.string().trim().min(1, 'Choose the offense.').max(40), offenseOther: z.string().trim().max(200).default(''),
  description: text(10, 10000, 'Describe what happened (at least 10 characters).'), reportedBy: z.string().trim().max(200).default(''), witnesses: z.string().trim().max(1000).default(''),
  issuingOfficer: text(3, 200, 'Name the issuing officer.'),
}).strict();
function incidentFrom(store, input) {
  const v = incidentSchema.parse(input), settings = readDpSettings(store);
  if (v.date > localToday()) throw new AppError('The incident date cannot be in the future.');
  const offense = v.offenseId === 'other' ? v.offenseOther : settings.offenses.find(o => o.id === v.offenseId)?.name;
  if (!offense || offense.length < 3) throw new AppError(v.offenseId === 'other' ? 'Describe the offense.' : 'Choose an offense from the list.');
  return { ...v, offense, severity: settings.offenses.find(o => o.id === v.offenseId)?.severity || '' };
}
export function createCase(store, actor, input) {
  permit(actor, MANAGE);
  const incident = incidentFrom(store, input);
  ensure(store);
  return store.transaction(() => {
    const e = store.read().employees.find(x => x.id === incident.employeeId);
    if (!e) throw new AppError('Employee not found.', 404);
    const job = profileOf(store, e.id, 'employment'), now = new Date().toISOString();
    const c = { id: randomUUID(), reference: nextReference(store), employeeId: e.id, employee: { name: e.name, number: displayNumber(e), department: e.department || '', position: job.position || '' }, status: 'pending', incident, nte: null, explanation: null, hearing: null, evaluation: null, decision: null, closure: null, files: [], notes: [], createdAt: now, createdBy: actor.username, updatedAt: now, history: [{ at: now, by: actor.username, action: 'create', detail: 'Incident documented' }] };
    writeCase(store, c);
    store.log(actor, 'create', 'discipline', c.id, null, { reference: c.reference, status: c.status, employeeId: e.id });
    return c;
  });
}
export function updateIncident(store, actor, id, input) {
  permit(actor, MANAGE);
  const incident = incidentFrom(store, input);
  return change(store, actor, id, 'update-incident', c => {
    if (c.nte?.issuedAt) throw new AppError('The Notice to Explain was already issued; add a note or a file instead of changing the incident.');
    if (incident.employeeId !== c.employeeId) throw new AppError('The employee of a case cannot change. Open a new case instead.');
    return { ...c, incident };
  });
}
const fileSchema = z.object({ name: z.string().trim().min(1).max(180).refine(x => !/[\x00-\x1f\\/]/.test(x), 'Invalid file name.'), mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']), data: z.string().min(1).max(14000000).regex(/^[A-Za-z0-9+/]*={0,2}$/), kind: z.enum(['evidence', 'hearing', 'other']).default('evidence'), note: z.string().trim().max(300).default('') }).strict();
export function storeFile(store, caseId, v, by, byEmployee = false) {
  const bytes = Buffer.from(v.data, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !validFile(v.mime, bytes)) throw new AppError('Attach a PDF, PNG or JPEG up to 10 MB.');
  const meta = { id: randomUUID(), name: v.name, mime: v.mime, size: bytes.length, kind: byEmployee ? 'explanation' : v.kind, note: v.note || '', by, byEmployee, at: new Date().toISOString() };
  store.db.prepare('INSERT INTO dp_files VALUES(?,?,?,?,?)').run(meta.id, caseId, v.name, v.mime, bytes);
  return meta;
}
export function addFile(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = fileSchema.parse(input);
  return change(store, actor, id, 'add-file', c => { if (c.status === 'closed') throw new AppError('This case is closed.'); return { ...c, files: [...c.files, storeFile(store, id, v, actor.username)] }; }, v.kind);
}
export function addNote(store, actor, id, input) {
  permit(actor, MANAGE);
  const { text: note } = z.object({ text: text(3, 4000, 'Write the note.') }).strict().parse(input);
  return change(store, actor, id, 'add-note', (c, at) => ({ ...c, notes: [...c.notes, { at, by: actor.username, text: note }] }));
}

// ---------- 2. Notice to Explain ----------
export function saveNte(store, actor, id, input) {
  permit(actor, MANAGE);
  const settings = readDpSettings(store);
  const v = z.object({ allegations: text(10, 8000, 'State the specific facts and circumstances (at least 10 characters).'), rules: text(3, 1000, 'Name the company rule or policy concerned.'), possibleSanction: z.enum(SANCTIONS.filter(s => s !== 'No disciplinary action')), responseDays: z.coerce.number().int().min(settings.minResponseDays, `Give the employee at least ${settings.minResponseDays} calendar days to answer.`).max(30), body: z.string().trim().max(12000).default('') }).strict().parse(input);
  return change(store, actor, id, 'save-nte', c => {
    if (c.nte?.issuedAt) throw new AppError('The Notice to Explain was already issued and cannot be changed.');
    const nte = { ...v, issuedAt: null };
    // {{deadline}} stays a placeholder until the notice is issued (counted from the day of issue).
    return { ...c, status: 'investigation', nte: { ...nte, body: v.body || fillTemplate(settings.templates.nte, templateVars({ ...c, nte })) } };
  });
}
export function issueNte(store, actor, id) {
  permit(actor, MANAGE);
  const updated = change(store, actor, id, 'issue-nte', c => {
    if (!c.nte) throw new AppError('Prepare the Notice to Explain first.');
    if (c.nte.issuedAt) throw new AppError('The Notice to Explain was already issued.');
    const day = localToday(), deadline = addDays(day, c.nte.responseDays);
    const body = fillTemplate(c.nte.body, { deadline: longDate(deadline), nteDate: longDate(day), today: longDate(day) });
    return { ...c, status: 'awaiting', nte: { ...c.nte, body, reference: `${c.reference}-NTE`, issuedAt: day, issuedBy: actor.username, deadline, receivedAt: null } };
  });
  store.notify(updated.employeeId, `Notice to Explain ${updated.reference}: please read it and submit your written explanation by ${longDate(updated.nte.deadline)} (menu: Notices & due process).`);
  return updated;
}
// No explanation by the deadline (or a written waiver): the case moves to evaluation on the available records.
export function toEvaluation(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = z.object({ waived: z.boolean().default(false), note: z.string().trim().max(1000).default('') }).strict().parse(input);
  return change(store, actor, id, 'no-explanation', c => {
    if (c.status !== 'awaiting') throw new AppError('Only a case awaiting the explanation can move to evaluation this way.');
    if (v.waived && v.note.length < 5) throw new AppError('Describe the employee\'s written waiver (date and how it was given).');
    if (!v.waived && localToday() <= c.nte.deadline) throw new AppError(`The employee has until ${longDate(c.nte.deadline)} to explain. Wait for the deadline to pass.`);
    return { ...c, status: 'evaluation', explanation: { none: true, waived: v.waived, note: v.note, recordedAt: new Date().toISOString(), recordedBy: actor.username } };
  }, v.waived ? 'Employee waived the explanation' : 'No explanation received by the deadline');
}

// ---------- 4. Administrative hearing ----------
export function scheduleHearing(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = z.object({ scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, 'Choose the hearing date and time.'), place: text(3, 200, 'Enter the place (or the video-call link).'), body: z.string().trim().max(12000).default('') }).strict().parse(input);
  if (v.scheduledAt.slice(0, 10) < localToday()) throw new AppError('The hearing date cannot be in the past.');
  const settings = readDpSettings(store);
  const updated = change(store, actor, id, 'schedule-hearing', c => {
    if (!c.nte?.issuedAt) throw new AppError('Issue the Notice to Explain before scheduling a hearing.');
    if (c.decision?.issuedAt || c.status === 'closed') throw new AppError('The decision was already issued.');
    if (c.hearing?.record) throw new AppError('The hearing was already recorded.');
    const previous = c.hearing?.scheduledAt ? [...(c.hearing.previous || []), { scheduledAt: c.hearing.scheduledAt, place: c.hearing.place, noticeIssuedAt: c.hearing.noticeIssuedAt }] : [];
    const hearing = { scheduledAt: v.scheduledAt, place: v.place, previous };
    return { ...c, hearing: { ...hearing, body: v.body || fillTemplate(settings.templates.hearing, templateVars({ ...c, hearing })), noticeIssuedAt: localToday(), noticeIssuedBy: actor.username, receivedAt: null } };
  });
  store.notify(updated.employeeId, `Notice of administrative hearing (${updated.reference}): ${longDate(updated.hearing.scheduledAt)} at ${updated.hearing.scheduledAt.slice(11, 16)}, ${updated.hearing.place}.`);
  return updated;
}
export function recordHearing(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = z.object({ outcome: z.enum(['held', 'waived', 'no-show']), heldOn: z.union([z.literal(''), DATE]).default(''), attendees: z.string().trim().max(1000).default(''), employeeAttended: z.boolean().default(false), representative: z.string().trim().max(200).default(''), statements: z.string().trim().max(12000).default(''), minutes: z.string().trim().max(12000).default('') }).strict().parse(input);
  if (v.outcome === 'held' && (!v.heldOn || v.statements.length < 10)) throw new AppError('Enter the date held and the statements made at the hearing.');
  if (v.heldOn && v.heldOn > localToday()) throw new AppError('The hearing date cannot be in the future.');
  if (v.outcome === 'waived' && v.minutes.length < 5) throw new AppError('Describe the employee\'s waiver of the hearing (date and how it was given).');
  return change(store, actor, id, 'record-hearing', c => {
    if (!c.nte?.issuedAt) throw new AppError('Issue the Notice to Explain first.');
    if (v.outcome !== 'waived' && !c.hearing?.scheduledAt) throw new AppError('Schedule the hearing (and issue its notice) first.');
    if (c.decision?.issuedAt) throw new AppError('The decision was already issued.');
    return { ...c, hearing: { ...(c.hearing || {}), record: { ...v, recordedAt: new Date().toISOString(), recordedBy: actor.username } } };
  }, v.outcome);
}

// ---------- 5. Evaluation ----------
export function saveEvaluation(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = z.object({ findings: text(10, 12000, 'Write the findings (at least 10 characters).'), evidence: z.string().trim().max(4000).default(''), recommendation: z.enum(SANCTIONS) }).strict().parse(input);
  return change(store, actor, id, 'save-evaluation', c => {
    if (c.status !== 'evaluation') throw new AppError(c.status === 'awaiting' ? 'Wait for the employee\'s explanation or the deadline first.' : 'This case is not for evaluation.');
    if (c.explanation?.hearingRequested && !c.hearing?.record) throw new AppError('The employee asked for a hearing. Schedule and record it (held, waived or not attended) before the evaluation.');
    return { ...c, evaluation: { ...v, by: actor.username, at: new Date().toISOString() } };
  });
}

// ---------- 6. Decision (approved by management before it is issued) ----------
export function draftDecision(store, actor, id, input) {
  permit(actor, MANAGE);
  const settings = readDpSettings(store);
  const v = z.object({ sanction: z.enum(SANCTIONS), suspensionDays: z.coerce.number().int().min(0).max(30).default(0), effectiveFrom: z.union([z.literal(''), DATE]).default(''), findings: text(10, 12000, 'State the findings the decision is based on.'), body: z.string().trim().max(12000).default('') }).strict().parse(input);
  if (v.sanction === 'Suspension' && (!v.suspensionDays || !v.effectiveFrom)) throw new AppError('Enter the number of suspension days (1-30) and the first day of the suspension.');
  if (['Suspension', 'Demotion', 'Dismissal'].includes(v.sanction) && !v.effectiveFrom) throw new AppError('Enter the effective date.');
  return change(store, actor, id, 'draft-decision', c => {
    if (!c.evaluation) throw new AppError('Complete the evaluation first.');
    if (c.decision?.issuedAt) throw new AppError('The decision was already issued.');
    if (v.sanction === 'Dismissal' && settings.hearingForDismissal && !c.hearing?.record) throw new AppError('Company setting: a dismissal needs a hearing or conference on record (held, waived or not attended).');
    const effectiveTo = v.sanction === 'Suspension' ? addDays(v.effectiveFrom, v.suspensionDays - 1) : '';
    const detail = v.sanction === 'Suspension' ? ` of ${v.suspensionDays} day${v.suspensionDays === 1 ? '' : 's'} without pay, from ${longDate(v.effectiveFrom)} to ${longDate(effectiveTo)}` : v.effectiveFrom ? `, effective ${longDate(v.effectiveFrom)}` : '';
    const body = v.body || fillTemplate(settings.templates.decision, templateVars(c, { findings: v.findings, sanction: v.sanction.toUpperCase(), sanctionDetail: detail }));
    return { ...c, decision: { ...v, effectiveTo, body, status: 'draft', draftedBy: actor.username, draftedAt: new Date().toISOString(), approvals: c.decision?.approvals || [] } };
  });
}
export function submitDecision(store, actor, id) {
  permit(actor, MANAGE);
  const updated = change(store, actor, id, 'submit-decision', c => {
    if (!c.decision || !['draft', 'returned'].includes(c.decision.status)) throw new AppError('Prepare the decision first.');
    return { ...c, decision: { ...c.decision, status: 'for-approval', submittedBy: actor.username, submittedAt: new Date().toISOString() } };
  });
  store.notify(null, `Due process ${updated.reference} (${updated.employee.name}): decision waiting for management approval.`);
  return updated;
}
export function reviewDecision(store, actor, id, input) {
  const settings = readDpSettings(store);
  permit(actor, settings.approverRoles);
  const v = z.object({ action: z.enum(['approve', 'return']), note: z.string().trim().max(2000).default('') }).strict().parse(input);
  if (v.action === 'return' && v.note.length < 5) throw new AppError('Say what must change before the decision can be approved.');
  return change(store, actor, id, v.action === 'approve' ? 'approve-decision' : 'return-decision', (c, at) => {
    if (c.decision?.status !== 'for-approval') throw new AppError('This decision is not waiting for approval.');
    if (settings.separateApprover && [c.decision.draftedBy, c.decision.submittedBy].includes(actor.username)) throw new AppError('Company setting: the decision must be approved by someone other than the person who prepared it.');
    const approvals = [...c.decision.approvals, { by: actor.username, role: actor.role, at, action: v.action, note: v.note }];
    return { ...c, decision: { ...c.decision, approvals, status: v.action === 'approve' ? 'approved' : 'returned', ...(v.action === 'approve' ? { approvedBy: actor.username, approvedAt: at } : {}) } };
  });
}
export function issueDecision(store, actor, id) {
  permit(actor, MANAGE);
  const updated = change(store, actor, id, 'issue-decision', c => {
    if (c.decision?.status !== 'approved') throw new AppError('The decision must be approved by authorized management before it is issued.');
    return { ...c, status: 'resolved', decision: { ...c.decision, status: 'issued', reference: `${c.reference}-NOD`, issuedAt: localToday(), issuedBy: actor.username, receivedAt: null } };
  });
  store.notify(updated.employeeId, `Notice of Decision ${updated.reference} was issued to you. Please read and acknowledge receipt (menu: Notices & due process).`);
  return updated;
}

// ---------- 7. Closure ----------
export function closeCase(store, actor, id, input) {
  permit(actor, MANAGE);
  const { remarks } = z.object({ remarks: z.string().trim().max(4000).default('') }).strict().parse(input);
  return store.transaction(() => {
    const c = readCase(store, id);
    if (c.status === 'closed') throw new AppError('This case is already closed.');
    if (c.nte?.issuedAt && !c.decision?.issuedAt) throw new AppError('Issue the decision before closing (it may be "No disciplinary action").');
    if (!c.nte?.issuedAt && remarks.length < 10) throw new AppError('No notice was issued. Explain why the case is closed without action (at least 10 characters).');
    const outcome = c.decision?.issuedAt ? c.decision.sanction : 'Closed without action';
    let actionId = null;
    if (c.decision?.issuedAt && c.decision.sanction !== 'No disciplinary action') {
      actionId = randomUUID();
      const record = { id: actionId, employeeId: c.employeeId, type: c.decision.sanction, date: c.decision.issuedAt, caseId: c.id, reference: c.reference, offense: c.incident.offense, suspensionDays: c.decision.suspensionDays || 0, effectiveFrom: c.decision.effectiveFrom || '', effectiveTo: c.decision.effectiveTo || '', source: 'case', remarks, by: actor.username, at: new Date().toISOString() };
      store.db.prepare('INSERT INTO dp_actions VALUES(?,?,?)').run(actionId, c.employeeId, JSON.stringify(record));
    }
    const now = new Date().toISOString(), after = { ...c, status: 'closed', closure: { outcome, remarks, actionId, closedAt: now, closedBy: actor.username }, updatedAt: now, history: [...c.history, { at: now, by: actor.username, action: 'close', detail: outcome }] };
    writeCase(store, after);
    store.log(actor, 'close', 'discipline', id, { reference: c.reference, status: c.status }, { reference: c.reference, status: 'closed', outcome, employeeId: c.employeeId });
    return after;
  });
}
