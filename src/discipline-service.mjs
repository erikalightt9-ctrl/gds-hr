// Due process safeguards under the Company Communications, Acknowledgment and Disciplinary Process Policy (Nov 20,
// 2026): service of each notice (method, HR-verified date of receipt, evidence) kept apart from the portal view and
// the employee's acknowledgement; the explanation deadline counted from the documented receipt (never shortened);
// requests for more time and HR extensions with reasons (earlier deadlines kept); the employee's request for review
// of a decision and HR's Review / Appeal Outcome; and the daily reminder lines (receipt and explanation separately).
// Nothing here decides a case: no admission, finding, sanction, suspension or deduction is ever automatic.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { SANCTIONS } from './discipline-settings.mjs';
import { MANAGE, readCase, allCases, storeFile, longDate } from './discipline.mjs';

export const NTE_ACK_WORDING = 'I acknowledge receipt of this Notice to Explain. This acknowledgment is not an admission of the allegations and does not waive my right to explain or present evidence.';
export const NOTICE_ACK_WORDING = 'I acknowledge receipt of this notice. This acknowledgment confirms receipt only and does not mean that I agree with its contents.';
export const SERVICE_METHODS = ['Personal service (hand delivery)', 'Courier / registered mail to the last known address', 'Email', 'GDS TimeHub portal', 'Other (describe)'];
export const REVIEW_DAYS = 5;   // calendar days from receipt of the decision to ask for an internal review
const NOTICE = { nte: 'nte', hearing: 'hearing', decision: 'decision', review: 'review' };
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.');
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const manilaDay = iso => new Date(new Date(iso).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const issuedOf = (c, key) => (key === 'hearing' ? c.hearing?.noticeIssuedAt : c[key]?.issuedAt);

function save(store, actor, id, action, fn, detail = '') {
  return store.transaction(() => {
    const before = readCase(store, id), now = new Date().toISOString(), updated = fn(before, now);
    const after = { ...updated, updatedAt: now, history: [...before.history, { at: now, by: actor.username, action, detail }] };
    store.db.prepare('INSERT INTO dp_cases VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(after.id, after.employeeId, JSON.stringify(after));
    store.log(actor, action, 'discipline', id, { reference: before.reference, status: before.status }, { reference: after.reference, status: after.status, employeeId: after.employeeId, ...(detail ? { detail } : {}) });
    return after;
  });
}

// The date the explanation period runs from: HR-verified receipt, else the employee's own acknowledgement, else the
// issue date (provisional until receipt is documented).
export function receiptBasis(nte) {
  if (nte.service?.receivedOn) return { date: nte.service.receivedOn, basis: 'HR-verified receipt' };
  if (nte.receivedAt) return { date: manilaDay(nte.receivedAt), basis: 'employee acknowledgement' };
  return { date: nte.issuedAt, basis: 'issue date (provisional until receipt is documented)' };
}
// A later receipt moves the deadline later; nothing ever shortens it. Earlier deadlines stay in deadlineHistory.
export function withReceiptDeadline(c, by, at) {
  if (!c.nte?.issuedAt) return c;
  const { date, basis } = receiptBasis(c.nte), counted = addDays(date, c.nte.responseDays);
  if (counted <= c.nte.deadline) return { ...c, nte: { ...c.nte, deadlineBasis: basis } };
  const history = [...(c.nte.deadlineHistory || []), { from: c.nte.deadline, to: counted, reason: `${c.nte.responseDays} calendar days counted from the ${basis} (${longDate(date)})`, by, at }];
  return { ...c, nte: { ...c.nte, deadline: counted, deadlineBasis: basis, deadlineHistory: history } };
}

// HR records how and when a notice was served and actually received (evidence optional but recommended).
const serviceSchema = z.object({ notice: z.enum(['nte', 'hearing', 'decision', 'review']), method: z.enum(SERVICE_METHODS), receivedOn: DATE, details: z.string().trim().max(1000).default(''), file: z.object({ name: z.string(), mime: z.string(), data: z.string() }).strict().nullable().default(null) }).strict();
export function recordService(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = serviceSchema.parse(input);
  if (v.receivedOn > localToday()) throw new AppError('The date of receipt cannot be in the future.');
  if (v.method === 'Other (describe)' && v.details.length < 5) throw new AppError('Describe how the notice was served.');
  const updated = save(store, actor, id, 'record-service', (c, at) => {
    const key = NOTICE[v.notice], issued = issuedOf(c, key);
    if (!issued) throw new AppError('That notice has not been issued yet.');
    if (v.receivedOn < issued.slice(0, 10)) throw new AppError('The date of receipt is before the notice was issued.');
    const evidence = v.file ? storeFile(store, c.id, { ...v.file, kind: 'evidence', note: `Proof of service (${v.notice})` }, actor.username) : null;
    const service = { method: v.method, receivedOn: v.receivedOn, details: v.details, evidenceFileId: evidence?.id || null, recordedBy: actor.username, recordedAt: at, previous: c[key].service ? [...(c[key].service.previous || []), { ...c[key].service, previous: undefined }] : [] };
    const next = { ...c, files: evidence ? [...c.files, evidence] : c.files, [key]: { ...c[key], service } };
    return key === 'nte' ? withReceiptDeadline(next, actor.username, at) : next;
  }, `${v.notice}: ${v.method}, received ${v.receivedOn}`);
  if (v.notice === 'nte' && updated.status === 'awaiting') store.notify(updated.employeeId, `Notice to Explain ${updated.nte.reference}: HR recorded that you received it on ${longDate(v.receivedOn)}. Your written explanation is due by ${longDate(updated.nte.deadline)}.`);
  return updated;
}

// The employee asks for more time to explain; HR grants (with a new deadline) or declines, always with a reason.
export function requestExtension(store, actor, id, input) {
  permit(actor, ['employee']);
  const v = z.object({ reason: z.string().trim().min(10, 'Say why you need more time (at least 10 characters).').max(2000), until: DATE }).strict().parse(input);
  const c0 = readCase(store, id);
  if (c0.employeeId !== actor.employeeId || !c0.nte?.issuedAt) throw new AppError('Case not found.', 404);
  const updated = save(store, actor, id, 'request-extension', (c, at) => {
    if (c.status !== 'awaiting' || (c.explanation && !c.explanation.none) || c.decision) throw new AppError('More time can only be asked for while your explanation is still open.');
    if (v.until <= c.nte.deadline) throw new AppError(`Choose a date after the current deadline (${longDate(c.nte.deadline)}).`);
    if ((c.nte.extensionRequests || []).some(r => r.status === 'pending')) throw new AppError('Your earlier request for more time is still with HR.');
    return { ...c, nte: { ...c.nte, extensionRequests: [...(c.nte.extensionRequests || []), { id: randomUUID(), reason: v.reason, until: v.until, at, status: 'pending' }] } };
  }, `until ${v.until}`);
  store.notify(null, `${updated.employee.name} asked for more time to answer ${updated.nte.reference} (until ${longDate(v.until)}). Decide in Due Process & Discipline.`);
  return { ok: true };
}
export function decideExtension(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = z.object({ requestId: z.string().default(''), action: z.enum(['grant', 'decline']), deadline: z.union([z.literal(''), DATE]).default(''), reason: z.string().trim().min(5, 'Give the reason (at least 5 characters).').max(2000) }).strict().parse(input);
  const updated = save(store, actor, id, v.action === 'grant' ? 'grant-extension' : 'decline-extension', (c, at) => {
    if (!c.nte?.issuedAt || c.decision?.issuedAt || c.status === 'closed') throw new AppError('The response period can no longer be changed.');
    const requests = (c.nte.extensionRequests || []).map(r => (r.id === v.requestId ? { ...r, status: v.action === 'grant' ? 'granted' : 'declined', decidedBy: actor.username, decidedAt: at, decisionReason: v.reason } : r));
    if (v.requestId && !requests.some(r => r.id === v.requestId)) throw new AppError('Request not found.', 404);
    if (v.action === 'decline') { if (!v.requestId) throw new AppError('Choose the request to decline.'); return { ...c, nte: { ...c.nte, extensionRequests: requests } }; }
    if (!v.deadline || v.deadline <= c.nte.deadline) throw new AppError(`Choose a new deadline after ${longDate(c.nte.deadline)}.`);
    const history = [...(c.nte.deadlineHistory || []), { from: c.nte.deadline, to: v.deadline, reason: `Extension: ${v.reason}`, by: actor.username, at }];
    // A case already moved to evaluation for lack of an explanation is reopened for the explanation.
    const reopen = c.status === 'evaluation' && c.explanation?.none && !c.explanation.waived && !c.evaluation;
    return { ...c, status: reopen ? 'awaiting' : c.status, explanation: reopen ? null : c.explanation, nte: { ...c.nte, deadline: v.deadline, deadlineHistory: history, extensionRequests: requests } };
  }, v.action === 'grant' ? `new deadline ${v.deadline}` : 'declined');
  store.notify(updated.employeeId, v.action === 'grant' ? `Notice to Explain ${updated.nte.reference}: your explanation is now due by ${longDate(updated.nte.deadline)}. Reason: ${v.reason}` : `Notice to Explain ${updated.nte.reference}: your request for more time was not granted. Reason: ${v.reason}. Your explanation is due by ${longDate(updated.nte.deadline)}.`);
  return updated;
}

// Review / appeal of an issued decision: asked for by the employee within REVIEW_DAYS of receipt; HR records the
// Review / Appeal Outcome as its own notice (affirmed, modified or reversed), which the employee acknowledges.
export const reviewDeadline = d => addDays(d.service?.receivedOn || (d.receivedAt ? manilaDay(d.receivedAt) : d.issuedAt), REVIEW_DAYS);
export function requestReview(store, actor, id, input) {
  permit(actor, ['employee']);
  const v = z.object({ grounds: z.string().trim().min(20, 'State the grounds for the review (at least 20 characters).').max(8000) }).strict().parse(input);
  const c0 = readCase(store, id);
  if (c0.employeeId !== actor.employeeId) throw new AppError('Case not found.', 404);
  const updated = save(store, actor, id, 'request-review', (c, at) => {
    if (!c.decision?.issuedAt || c.decision.sanction === 'No disciplinary action') throw new AppError('There is no decision to review.');
    if (c.review) throw new AppError('A review was already asked for.');
    if (c.status === 'closed') throw new AppError('This case is closed. Please talk to HR.');
    if (localToday() > reviewDeadline(c.decision)) throw new AppError(`The period to ask for a review ended on ${longDate(reviewDeadline(c.decision))}. Please talk to HR.`);
    return { ...c, review: { grounds: v.grounds, requestedAt: at } };
  });
  store.notify(null, `${updated.employee.name} asked for a review of the decision in ${updated.reference}. Record the Review / Appeal Outcome in Due Process & Discipline.`);
  return { ok: true };
}
export function recordReviewOutcome(store, actor, id, input) {
  permit(actor, MANAGE);
  const v = z.object({ outcome: z.enum(['Affirmed', 'Modified', 'Reversed']), sanction: z.union([z.literal(''), z.enum(SANCTIONS)]).default(''), body: z.string().trim().min(20, 'Write the reasons for the review outcome (at least 20 characters).').max(12000) }).strict().parse(input);
  if (v.outcome === 'Modified' && !v.sanction) throw new AppError('Choose the modified sanction.');
  const updated = save(store, actor, id, 'issue-review-outcome', (c, at) => {
    if (!c.review?.requestedAt) throw new AppError('No review was asked for.');
    if (c.review.issuedAt) throw new AppError('The review outcome was already issued.');
    const sanction = v.outcome === 'Affirmed' ? c.decision.sanction : v.outcome === 'Reversed' ? 'No disciplinary action' : v.sanction;
    return { ...c, review: { ...c.review, outcome: v.outcome, sanction, body: v.body, reference: `${c.reference}-ROR`, issuedAt: localToday(), issuedBy: actor.username, issuedOn: at, receivedAt: null } };
  }, v.outcome);
  store.notify(updated.employeeId, `Review / Appeal Outcome ${updated.review.reference} was issued to you. Please read and acknowledge receipt (menu: Notices & due process).`);
  return updated;
}
// The sanction that stands after any review.
export const finalSanction = c => (c.review?.issuedAt ? c.review.sanction : c.decision?.sanction);

// The employee opened their notices: first view of each issued notice is kept (never an acknowledgement).
export function markViewed(store, employeeId) {
  const at = new Date().toISOString();
  for (const c of allCases(store).filter(x => x.employeeId === employeeId)) {
    const keys = Object.values(NOTICE).filter(k => issuedOf(c, k) && !c[k].viewedAt);
    if (!keys.length) continue;
    const after = { ...c, ...Object.fromEntries(keys.map(k => [k, { ...c[k], viewedAt: at }])) };
    store.db.prepare('UPDATE dp_cases SET data=? WHERE id=?').run(JSON.stringify(after), c.id);
  }
}

// Daily reminder lines for one employee: receipt acknowledgements and the explanation, tracked separately.
export function dpReminderLines(store, employeeId) {
  const lines = [], today = localToday();
  for (const c of allCases(store).filter(x => x.employeeId === employeeId && x.status !== 'closed')) {
    for (const [key, title] of [['nte', 'Notice to Explain'], ['hearing', 'Notice of Administrative Hearing'], ['decision', 'Notice of Decision'], ['review', 'Review / Appeal Outcome']])
      if (issuedOf(c, key) && !c[key].receivedAt) lines.push(`🔔 Pending Acknowledgment: ${title} ${c[key].reference || c.reference}`);
    if (c.status === 'awaiting' && !c.explanation) lines.push(`📝 Explanation Required: ${c.nte.reference} — due ${longDate(c.nte.deadline)}${today > c.nte.deadline ? ' (deadline passed; HR may still accept it — contact HR)' : ''}`);
  }
  return lines;
}
// HR bell: requests for more time and for review.
export function dpRequestBell(store, actor) {
  if (!MANAGE.includes(actor.role)) return [];
  const items = [];
  for (const c of allCases(store)) {
    for (const r of (c.nte?.extensionRequests || []).filter(x => x.status === 'pending')) items.push({ text: `${c.employee.name}: asks for more time to answer ${c.nte.reference} (until ${longDate(r.until)})`, nav: 'discipline', id: c.id, date: r.at.slice(0, 10) });
    if (c.review?.requestedAt && !c.review.issuedAt) items.push({ text: `${c.employee.name}: review of the decision asked for (${c.reference})`, nav: 'discipline', id: c.id, date: c.review.requestedAt.slice(0, 10) });
  }
  return items;
}
