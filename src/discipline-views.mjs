// Due process: lists, case detail, the employee's own notices and explanation, disciplinary records and bell items.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { readDpSettings, fillTemplate, SANCTIONS, TEMPLATE_TITLES } from './discipline-settings.mjs';
import { VIEW, MANAGE, STATUS, ensure, readCase, allCases, storeFile, templateVars, longDate, canSeeCase, assertParticipant } from './discipline.mjs';
import { NTE_ACK_WORDING, NOTICE_ACK_WORDING, withReceiptDeadline, markViewed, reviewDeadline, dpRequestBell, finalSanction } from './discipline-service.mjs';

const summary = c => ({ id: c.id, reference: c.reference, employeeId: c.employeeId, employeeName: c.employee.name, employeeNumber: c.employee.number, department: c.employee.department, position: c.employee.position, incidentDate: c.incident.date, offense: c.incident.offense, severity: c.incident.severity, status: c.status, statusLabel: STATUS[c.status], deadline: c.nte?.deadline || '', decisionStatus: c.decision?.status || '', sanction: c.decision?.sanction || '', outcome: c.closure?.outcome || '', issuingOfficer: c.incident.issuingOfficer, createdAt: c.createdAt, updatedAt: c.updatedAt });
export function listCases(store, actor, filters = {}) {
  permit(actor, VIEW);
  const q = String(filters.q || '').toLowerCase().slice(0, 100);
  return allCases(store).filter(c => canSeeCase(c, actor)).map(summary).filter(c => (!filters.status || c.status === filters.status) && (!filters.employeeId || c.employeeId === filters.employeeId) && (!q || JSON.stringify(c).toLowerCase().includes(q)));
}
export function records(store, employeeId = null) {
  ensure(store);
  const rows = employeeId ? store.db.prepare('SELECT data FROM dp_actions WHERE employee_id=?').all(employeeId) : store.db.prepare('SELECT data FROM dp_actions').all();
  return rows.map(r => JSON.parse(r.data)).sort((a, b) => b.date.localeCompare(a.date));
}
export function listRecords(store, actor, employeeId = '') {
  permit(actor, VIEW);
  const names = new Map(store.read().employees.map(e => [e.id, e.name]));
  return records(store, employeeId || null).map(r => ({ ...r, employeeName: names.get(r.employeeId) || r.employeeId }));
}
// Disciplinary actions from paper files before the system (no case in the system): encoded with their reference.
export function recordPriorAction(store, actor, input) {
  permit(actor, MANAGE);
  const v = z.object({ employeeId: z.string().trim().min(1, 'Choose the employee.').max(80), type: z.enum(SANCTIONS.filter(s => s !== 'No disciplinary action')), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date of the action.'), offense: z.string().trim().min(3, 'Name the offense.').max(200), reference: z.string().trim().max(80).default(''), suspensionDays: z.coerce.number().int().min(0).max(30).default(0), remarks: z.string().trim().min(5, 'Say where the record comes from (e.g. memo on file, date issued).').max(2000) }).strict().parse(input);
  if (v.date > localToday()) throw new AppError('The date cannot be in the future.');
  if (!store.read().employees.some(e => e.id === v.employeeId)) throw new AppError('Employee not found.', 404);
  ensure(store);
  return store.transaction(() => {
    const record = { id: randomUUID(), ...v, caseId: null, effectiveFrom: '', effectiveTo: '', source: 'encoded', by: actor.username, at: new Date().toISOString() };
    store.db.prepare('INSERT INTO dp_actions VALUES(?,?,?)').run(record.id, v.employeeId, JSON.stringify(record));
    store.log(actor, 'record-prior-action', 'discipline', record.id, null, { employeeId: v.employeeId, type: v.type, date: v.date, reference: v.reference });
    return record;
  });
}
// What the screen should offer next, so HR follows the steps in order.
function nextStep(c) {
  if (c.status === 'closed') return 'Case closed.';
  if (!c.nte) return 'Document the incident and attach the evidence, then prepare the Notice to Explain.';
  if (!c.nte.issuedAt) return 'Review the Notice to Explain and issue it to the employee.';
  if (c.status === 'awaiting') return `Waiting for the employee's written explanation (until ${longDate(c.nte.deadline)}).`;
  if (c.explanation?.hearingRequested && !c.hearing?.record) return 'The employee asked for a hearing: schedule it and record the proceedings.';
  if (!c.evaluation) return 'Evaluate the evidence and the explanation.';
  if (!c.decision) return 'Prepare the decision.';
  if (['draft', 'returned'].includes(c.decision.status)) return c.decision.status === 'returned' ? 'Management returned the decision: revise it and submit it again.' : 'Submit the decision for management approval.';
  if (c.decision.status === 'for-approval') return 'Waiting for management approval of the decision.';
  if (c.decision.status === 'approved') return 'Approved: issue the Notice of Decision to the employee.';
  return 'Decision issued: close the case to record the final outcome.';
}
export function caseDetail(store, actor, id) {
  permit(actor, VIEW);
  const c = readCase(store, id), settings = readDpSettings(store), prior = records(store, c.employeeId).filter(r => r.caseId !== c.id);
  assertParticipant(c, actor);
  const mayApprove = settings.approverRoles.includes(actor.role) && (!settings.separateApprover || ![c.decision?.draftedBy, c.decision?.submittedBy].includes(actor.username));
  return { ...c, statusLabel: STATUS[c.status], nextStep: nextStep(c), prior, sameOffense: prior.filter(r => r.offense === c.incident.offense).length, canManage: MANAGE.includes(actor.role), canApprove: mayApprove && c.decision?.status === 'for-approval', approverRoles: settings.approverRoles, separateApprover: settings.separateApprover, minResponseDays: settings.minResponseDays, deadlinePassed: !!c.nte?.deadline && localToday() > c.nte.deadline };
}
export function dpOptions(store, actor) {
  permit(actor, VIEW);
  const s = readDpSettings(store);
  return { offenses: s.offenses, sanctions: SANCTIONS, status: STATUS, minResponseDays: s.minResponseDays, approverRoles: s.approverRoles, separateApprover: s.separateApprover, hearingForDismissal: s.hearingForDismissal, templates: s.templates, templateTitles: TEMPLATE_TITLES, canManage: MANAGE.includes(actor.role), canSettings: actor.role === 'admin' };
}

// ---------- Employee side: only notices issued to them ----------
const EMPLOYEE_STATUS = { awaiting: 'Waiting for your explanation', evaluation: 'Under evaluation', resolved: 'Decision issued', closed: 'Closed' };
function notices(c) {
  const out = [];
  if (c.nte?.issuedAt) out.push({ kind: 'nte', title: 'Notice to Explain', reference: c.nte.reference, issuedAt: c.nte.issuedAt, body: c.nte.body, receivedAt: c.nte.receivedAt, deadline: c.nte.deadline, deadlineBasis: c.nte.deadlineBasis || '', viewedAt: c.nte.viewedAt || '', serviceReceivedOn: c.nte.service?.receivedOn || '', ackWording: NTE_ACK_WORDING });
  if (c.hearing?.noticeIssuedAt) out.push({ kind: 'hearing', title: 'Notice of Administrative Hearing', reference: c.reference, issuedAt: c.hearing.noticeIssuedAt, body: c.hearing.body, receivedAt: c.hearing.receivedAt, scheduledAt: c.hearing.scheduledAt, place: c.hearing.place, viewedAt: c.hearing.viewedAt || '', ackWording: NOTICE_ACK_WORDING });
  if (c.decision?.issuedAt) out.push({ kind: 'decision', title: 'Notice of Decision', reference: c.decision.reference, issuedAt: c.decision.issuedAt, body: c.decision.body, receivedAt: c.decision.receivedAt, sanction: c.decision.sanction, viewedAt: c.decision.viewedAt || '', ackWording: NOTICE_ACK_WORDING, reviewDeadline: c.decision.sanction !== 'No disciplinary action' ? reviewDeadline(c.decision) : '' });
  if (c.review?.issuedAt) out.push({ kind: 'review', title: 'Review / Appeal Outcome', reference: c.review.reference, issuedAt: c.review.issuedAt, body: c.review.body, receivedAt: c.review.receivedAt, outcome: c.review.outcome, sanction: c.review.sanction, viewedAt: c.review.viewedAt || '', ackWording: NOTICE_ACK_WORDING });
  return out;
}
const own = (store, actor, id) => { permit(actor, ['employee']); const c = readCase(store, id); if (c.employeeId !== actor.employeeId || !c.nte?.issuedAt) throw new AppError('Case not found.', 404); return c; };
export function myCases(store, actor) {
  permit(actor, ['employee']);
  markViewed(store, actor.employeeId);
  const template = readDpSettings(store).templates.explanation;
  return allCases(store).filter(c => c.employeeId === actor.employeeId && c.nte?.issuedAt).map(c => ({
    id: c.id, reference: c.reference, incidentDate: c.incident.date, offense: c.incident.offense, status: EMPLOYEE_STATUS[c.status] || STATUS[c.status], notices: notices(c),
    explanation: c.explanation && !c.explanation.none ? { text: c.explanation.text, submittedAt: c.explanation.submittedAt, late: c.explanation.late, hearingRequested: c.explanation.hearingRequested, files: c.files.filter(f => f.byEmployee).map(f => ({ id: f.id, name: f.name })) } : null,
    canExplain: (!c.explanation || c.explanation.none) && !c.decision && c.status !== 'closed', deadline: c.nte.deadline, explanationTemplate: fillTemplate(template, templateVars(c)),
    extensionRequests: (c.nte.extensionRequests || []).map(r => ({ until: r.until, reason: r.reason, at: r.at, status: r.status, decisionReason: r.decisionReason || '' })), canAskExtension: c.status === 'awaiting' && !c.explanation && !(c.nte.extensionRequests || []).some(r => r.status === 'pending'),
    review: c.review ? { requestedAt: c.review.requestedAt, grounds: c.review.grounds, outcome: c.review.outcome || '', issuedAt: c.review.issuedAt || '' } : null, finalSanction: c.decision?.issuedAt ? finalSanction(c) : '',
    canAskReview: !!c.decision?.issuedAt && c.decision.sanction !== 'No disciplinary action' && !c.review && c.status !== 'closed' && localToday() <= reviewDeadline(c.decision), reviewDeadline: c.decision?.issuedAt ? reviewDeadline(c.decision) : '',
  }));
}
export function acknowledgeNotice(store, actor, id, kind) {
  const c = own(store, actor, id), at = new Date().toISOString();
  const key = { nte: 'nte', hearing: 'hearing', decision: 'decision', review: 'review' }[kind];
  if (!key || !(key === 'hearing' ? c.hearing?.noticeIssuedAt : c[key]?.issuedAt)) throw new AppError('Notice not found.', 404);
  if (c[key].receivedAt) return { receivedAt: c[key].receivedAt };
  return store.transaction(() => {
    const acknowledged = { ...c, [key]: { ...c[key], receivedAt: at, receiptWording: key === 'nte' ? NTE_ACK_WORDING : NOTICE_ACK_WORDING } };
    // The explanation period runs from the documented receipt; acknowledging never shortens it.
    const after = { ...(key === 'nte' ? withReceiptDeadline(acknowledged, actor.username, at) : acknowledged), history: [...c.history, { at, by: actor.username, action: 'acknowledge-receipt', detail: kind }] };
    store.db.prepare('UPDATE dp_cases SET data=? WHERE id=?').run(JSON.stringify(after), id);
    store.log(actor, 'acknowledge-receipt', 'discipline', id, null, { reference: c.reference, notice: kind, employeeId: c.employeeId });
    return { receivedAt: at };
  });
}
const explanationSchema = z.object({ text: z.string().trim().min(20, 'Write your explanation (at least 20 characters).').max(12000), hearingRequested: z.boolean().default(false), files: z.array(z.object({ name: z.string(), mime: z.string(), data: z.string() }).strict()).max(5, 'Attach up to five files.').default([]) }).strict();
export function submitExplanation(store, actor, id, input) {
  const c = own(store, actor, id), v = explanationSchema.parse(input);
  if ((c.explanation && !c.explanation.none) || c.decision || c.status === 'closed') throw new AppError('Your explanation for this case can no longer be submitted here. Please talk to HR.');
  const updated = store.transaction(() => {
    const files = v.files.map(f => storeFile(store, id, { ...f, kind: 'other', note: '' }, actor.username, true));
    const at = new Date().toISOString(), late = localToday() > c.nte.deadline;
    const after = { ...c, status: 'evaluation', files: [...c.files, ...files], explanation: { text: v.text, hearingRequested: v.hearingRequested, submittedAt: at, late }, updatedAt: at, history: [...c.history, { at, by: actor.username, action: 'submit-explanation', detail: `${late ? 'After the deadline' : 'Within the period'}${v.hearingRequested ? '; hearing requested' : ''}` }] };
    store.db.prepare('UPDATE dp_cases SET data=? WHERE id=?').run(JSON.stringify(after), id);
    store.log(actor, 'submit-explanation', 'discipline', id, null, { reference: c.reference, employeeId: c.employeeId, late, hearingRequested: v.hearingRequested, files: files.length });
    return after;
  });
  store.notify(null, `${c.employee.name} submitted a written explanation for ${c.reference}${v.hearingRequested ? ' and asked for a hearing' : ''}.`);
  store.notify(actor.employeeId, `Your written explanation for ${c.reference} was received by HR${v.hearingRequested ? ' with your request for a hearing' : ''}.`);
  return { submittedAt: updated.explanation.submittedAt, late: updated.explanation.late };
}
// Files: HR / management any file of a case; the employee only the files they attached themselves.
export function caseFile(store, actor, fileId) {
  ensure(store);
  const row = store.db.prepare('SELECT * FROM dp_files WHERE id=?').get(fileId);
  if (!row) throw new AppError('File not found.', 404);
  const c = readCase(store, row.case_id), meta = c.files.find(f => f.id === fileId);
  if (actor.role === 'employee') { if (c.employeeId !== actor.employeeId || !meta?.byEmployee) throw new AppError('File not found.', 404); } else { permit(actor, VIEW); assertParticipant(c, actor); }
  store.log(actor, 'view-file', 'discipline', c.id, null, { reference: c.reference, file: row.name });
  return row;
}
// Bell items for HR and the decision approvers.
export function disciplineBell(store, actor) {
  if (!VIEW.includes(actor.role)) return [];
  const settings = readDpSettings(store), today = localToday(), items = [...dpRequestBell(store, actor)], cases = allCases(store).filter(c => canSeeCase(c, actor));
  if (MANAGE.includes(actor.role)) {
    for (const c of cases.filter(x => x.status === 'evaluation' && x.explanation && !x.explanation.none && !x.evaluation)) items.push({ text: `${c.employee.name}: written explanation received for ${c.reference}${c.explanation.hearingRequested ? ' (hearing requested)' : ''}`, nav: 'discipline', id: c.id, date: c.explanation.submittedAt.slice(0, 10) });
    for (const c of cases.filter(x => x.status === 'awaiting' && today > x.nte.deadline)) items.push({ text: `${c.employee.name}: no explanation by ${longDate(c.nte.deadline)} for ${c.reference}`, nav: 'discipline', id: c.id, date: c.nte.deadline });
    for (const c of cases.filter(x => x.decision?.status === 'approved')) items.push({ text: `${c.reference}: decision approved, ready to issue`, nav: 'discipline', id: c.id, date: (c.decision.approvedAt || '').slice(0, 10) });
  }
  if (settings.approverRoles.includes(actor.role))
    for (const c of cases.filter(x => x.decision?.status === 'for-approval' && (!settings.separateApprover || ![x.decision.draftedBy, x.decision.submittedBy].includes(actor.username)))) items.push({ text: `${c.reference} (${c.employee.name}): decision waiting for your approval`, nav: 'discipline', id: c.id, date: (c.decision.submittedAt || '').slice(0, 10) });
  return items;
}
