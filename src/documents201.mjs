// Digital 201 documents: a per-employee checklist built from the configured requirements, versioned uploads,
// HR review (Submitted → Under Review → Verified / Rejected), expiry, Not Applicable overrides and completeness.
// Files stay in the private database; every preview and download goes through an authorisation check.
import { randomUUID } from 'node:crypto';
import { isActive } from './workforce.mjs';
// The 201 document checklist was first tracked in the system in October 2026.
export const TRACKING_FROM = '2026-10-01';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday, isSalaryRequirement } from './profiles.mjs';
import { readSettings, assertCanView, scopeEmployees, NUMBER_REQUIREMENTS } from './hr201.mjs';
import { HR_MANAGERS, HR_TEAM } from './roles.mjs';

export const DOC_STATUSES = ['Missing', 'Submitted', 'Under Review', 'Verified', 'Rejected', 'Expired', 'Not Applicable'];
import { canSeePay, canSeeSensitive } from './account-scope.mjs';
const TYPE = '201 Document';
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const docsOf = (store, employeeId) => store.db.prepare('SELECT metadata FROM employee_documents WHERE employee_id=?').all(employeeId).map(r => JSON.parse(r.metadata)).filter(m => m.type === TYPE);
// Restricted requirements are for HR Managers; Makers see every requirement except salary-bearing ones (the contract).
const canSeeRestricted = (actor, req) => (actor.role === 'maker' ? !isSalaryRequirement(req) : HR_MANAGERS.includes(actor.role));
const SENSITIVE_FILES = /^(valid-id|medical)$|medical|bank/i;
const canSeeBase = (actor, req) => (actor.role === 'maker' ? !isSalaryRequirement(req) : !req.restricted || canSeeRestricted(actor, req));
// Medical certificates, government IDs and bank documents also need the Sensitive permission; salary-bearing ones the Salary permission.
const canSee = (actor, req) => canSeeBase(actor, req) && (actor.role === 'employee' || !SENSITIVE_FILES.test(`${req.id} ${req.category || ''}`) || canSeeSensitive(actor)) && (actor.role === 'employee' || !isSalaryRequirement(req) || canSeePay(actor));

export function applicableRequirements(settings, employee, job) {
  return settings.documentRequirements.filter(r => (!r.departments.length || r.departments.includes(employee.department)) && (!r.classifications.length || r.classifications.includes(job.employmentStatus || '')));
}
// A file expires only when its requirement is set to expire (Settings → requirements); a pre-employment record kept on
// file (e.g. the NBI clearance submitted when hired) keeps its expiry date for reference but never turns Expired.
function statusOf(doc, today, req = { expires: true }) {
  if (!doc) return 'Missing';
  if (req.expires && doc.expiryDate && doc.expiryDate < today && doc.reviewStatus !== 'Rejected') return 'Expired';
  return doc.reviewStatus;
}
// The checklist for one employee. `actor` decides whether restricted items show file details.
export function checklistFor(store, actor, employee, settings = readSettings(store), today = localToday()) {
  const job = profileOf(store, employee.id, 'employment'), docs = docsOf(store, employee.id), gov = profileOf(store, employee.id, 'government');
  const overrides = new Map(store.db.prepare('SELECT requirement_id, data FROM requirement_overrides WHERE employee_id=?').all(employee.id).map(r => [r.requirement_id, JSON.parse(r.data)]));
  const items = applicableRequirements(settings, employee, job).map(req => {
    const versions = docs.filter(d => d.requirementId === req.id).sort((a, b) => b.version - a.version), current = versions[0] || null;
    const na = overrides.get(req.id);
    // Government registrations are complied by the number on file (the number itself is never shown here).
    const number = NUMBER_REQUIREMENTS[req.id];
    const status = na ? (na.waived ? 'Waived' : 'Not Applicable') : number ? (String(gov[number.field] || '').trim() ? 'Verified' : 'Missing') : statusOf(current, today, req);
    // Due date: days after hire, but never earlier than the same days after the requirement began to be tracked
    // (long-serving staff are not overdue from the day a requirement is added). Nov 20, 2026.
    const from = [employee.startDate || '', req.trackedFrom || TRACKING_FROM].sort().at(-1);
    const due = req.dueDays !== null && req.dueDays !== undefined && employee.startDate ? addDays(from, req.dueDays) : '';
    const hidden = !canSee(actor, req);
    return {
      requirement: req, status, due, overdue: status === 'Missing' && req.required && !!due && due < today,
      expiringSoon: status === 'Verified' && req.expires && !!current?.expiryDate && current.expiryDate <= addDays(today, settings.reminders.expiryDays),
      notApplicable: na || null, restricted: req.restricted, hidden, numberOnly: !!number,
      current: hidden ? null : current, versions: hidden ? [] : versions,
    };
  });
  const required = items.filter(i => i.requirement.required && !['Not Applicable', 'Waived'].includes(i.status));
  const complete = required.filter(i => i.status === 'Verified');
  return { employeeId: employee.id, items, requiredCount: required.length, completeCount: complete.length, percent: required.length ? Math.round(complete.length / required.length * 100) : 100 };
}
export function employeeChecklist(store, actor, employeeId) {
  if (actor.role === 'employee') { if (actor.employeeId !== employeeId) throw new AppError('You can only view your own checklist.', 403); }
  else { permit(actor, [...HR_TEAM, 'dept_manager', 'viewer']); assertCanView(store, actor, employeeId); }
  const employee = store.read().employees.find(e => e.id === employeeId);
  if (!employee) throw new AppError('Employee not found.', 404);
  const list = checklistFor(store, actor, employee);
  // Managers and management see progress only, never the files.
  if (!HR_TEAM.includes(actor.role) && actor.role !== 'employee') return { ...list, items: list.items.map(i => ({ ...i, current: null, versions: [] })) };
  if (actor.role === 'employee') return { ...list, items: list.items.filter(i => !i.restricted && (i.requirement.providedBy || 'employee') === 'employee').map(i => ({ ...i, versions: i.versions.filter(v => v.uploadedBy === actor.username) })) };
  return list;
}

// ---------- Upload, review, Not Applicable ----------
// Government-issued ID: the uploader says which ID it is (the same list is in public/hr-common.js).
export const VALID_ID_TYPES = ['Passport', 'PhilSys National ID', 'UMID', 'SSS ID', 'TIN ID', "Driver's license", 'PRC ID', 'PhilHealth ID', 'Pag-IBIG ID', 'Postal ID', "Voter's ID", 'ACR I-Card (foreign national)', 'Senior citizen ID', 'PWD ID', 'Other government ID'];
const uploadSchema = z.object({
  requirementId: z.string().regex(/^[a-z0-9-]{1,60}$/), name: z.string().trim().min(1).max(180).refine(v => !/[\x00-\x1f\\/]/.test(v), 'Invalid file name'),
  mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']), data: z.string().min(1).max(28000000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  issueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''), expiryDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
  replaceReason: z.string().trim().max(500).default(''), remarks: z.string().trim().max(500).default(''),
  idType: z.string().trim().max(80).default(''),
}).strict();
// A Government-issued ID file is named after the chosen ID (e.g. "Passport ID.jpg"); the original name is kept as originalName.
export function idFileName(idType, mime) {
  const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' }[mime];
  return `${/\bID\b|I-Card|license/i.test(idType) ? idType : `${idType} ID`}.${ext}`;
}
export function validFile(mime, bytes) {
  return mime === 'application/pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
}
export function upload201(store, actor, employeeId, input) {
  const self = actor.role === 'employee';
  if (self) { if (actor.employeeId !== employeeId) throw new AppError('You can only upload your own documents.', 403); } else permit(actor, HR_TEAM);
  const v = uploadSchema.parse(input), settings = readSettings(store), bytes = Buffer.from(v.data, 'base64');
  const employee = store.read().employees.find(e => e.id === employeeId);
  if (!employee) throw new AppError('Employee not found.', 404);
  const req = settings.documentRequirements.find(r => r.id === v.requirementId);
  if (!req) throw new AppError('Unknown document requirement.');
  if (NUMBER_REQUIREMENTS[req.id]) throw new AppError(`${req.name}: no file is needed. ${self ? 'Enter the number in My data sheet.' : 'Enter the number under Government IDs.'}`);
  if (!canSee(actor, req)) throw new AppError(actor.role === 'maker' ? 'Salary-bearing documents are filed by HR Managers or Payroll.' : 'Only HR Managers can file restricted documents.', 403);
  if (!bytes.length || bytes.length > settings.uploads.documentMB * 1024 * 1024) throw new AppError(`Choose a file up to ${settings.uploads.documentMB} MB.`);
  if (!validFile(v.mime, bytes)) throw new AppError('The file content does not match a PDF, PNG or JPEG.');
  if (v.expiryDate && v.issueDate && v.expiryDate < v.issueDate) throw new AppError('Expiry date is before the issue date.');
  if (req.id === 'valid-id' && !VALID_ID_TYPES.includes(v.idType)) throw new AppError('Choose which ID you are uploading (e.g. Passport, UMID, TIN ID).');
  return store.transaction(() => {
    const previous = docsOf(store, employeeId).filter(d => d.requirementId === req.id).sort((a, b) => b.version - a.version)[0];
    if (previous && !self && previous.reviewStatus === 'Verified' && v.replaceReason.length < 3) throw new AppError('Give a reason for replacing a verified document.');
    const meta = {
      id: randomUUID(), employeeId, type: TYPE, requirementId: req.id, requirementName: req.name, category: req.category, restricted: req.restricted,
      name: req.id === 'valid-id' ? idFileName(v.idType, v.mime) : v.name, ...(req.id === 'valid-id' ? { originalName: v.name } : {}), mime: v.mime, size: bytes.length, version: (previous?.version || 0) + 1, replaces: previous?.id || null, replaceReason: v.replaceReason,
      issueDate: v.issueDate, expiryDate: v.expiryDate, expiry: v.expiryDate, remarks: v.remarks, idType: req.id === 'valid-id' ? v.idType : '',
      uploadedAt: new Date().toISOString(), uploadedBy: actor.username, reviewStatus: 'Submitted', reviewer: '', reviewedAt: '', reviewNote: '', status: 'Active',
    };
    store.db.prepare('INSERT INTO employee_documents VALUES(?,?,?,?)').run(meta.id, employeeId, JSON.stringify(meta), bytes);
    store.db.prepare('DELETE FROM requirement_overrides WHERE employee_id=? AND requirement_id=?').run(employeeId, req.id);
    if (self) store.notify(null, `${employee.name} uploaded “${req.name}” from their account. Waiting for HR review.`);
    store.log(actor, previous ? 'replace' : 'upload', `document:${TYPE}`, employeeId, previous ? { id: previous.id, version: previous.version } : null, { id: meta.id, requirement: req.name, version: meta.version, reason: v.replaceReason, ...(meta.idType ? { idType: meta.idType } : {}) });
    return meta;
  });
}
function docRow(store, id) {
  const row = store.db.prepare('SELECT * FROM employee_documents WHERE id=?').get(id);
  if (!row) throw new AppError('Document not found.', 404);
  return { meta: JSON.parse(row.metadata), content: row.content };
}
export function reviewDocument(store, actor, docId, input) {
  permit(actor, HR_TEAM);
  const { decision, note } = z.object({ decision: z.enum(['Under Review', 'Verified', 'Rejected']), note: z.string().trim().max(500).default('') }).strict().parse(input);
  return store.transaction(() => {
    const { meta } = docRow(store, docId);
    if (meta.type !== TYPE) throw new AppError('Only 201 documents are reviewed here.');
    if (!canSee(actor, meta)) throw new AppError('Only HR Managers can review restricted documents.', 403);
    const latest = docsOf(store, meta.employeeId).filter(d => d.requirementId === meta.requirementId).sort((a, b) => b.version - a.version)[0];
    if (latest.id !== meta.id) throw new AppError('A newer version exists; review that one instead.');
    if (decision === 'Rejected' && note.length < 3) throw new AppError('Give a reason for rejecting the document.');
    const after = { ...meta, reviewStatus: decision, reviewer: actor.username, reviewedAt: new Date().toISOString(), reviewNote: note };
    store.db.prepare('UPDATE employee_documents SET metadata=? WHERE id=?').run(JSON.stringify(after), docId);
    store.log(actor, `document-${decision.toLowerCase().replace(' ', '-')}`, `document:${TYPE}`, meta.employeeId, { reviewStatus: meta.reviewStatus }, { id: docId, requirement: meta.requirementName, reviewStatus: decision, note });
    return after;
  });
}
export function setNotApplicable(store, actor, employeeId, requirementId, input) {
  permit(actor, HR_MANAGERS);
  const { notApplicable, reason, waive } = z.object({ notApplicable: z.boolean(), reason: z.string().trim().max(500).default(''), waive: z.boolean().default(false) }).strict().parse(input);
  if (notApplicable && reason.length < (waive ? 5 : 3)) throw new AppError(waive ? 'Give the reason for waiving this requirement (at least 5 characters).' : 'Give a reason for marking the requirement Not Applicable.');
  return store.transaction(() => {
    if (notApplicable) store.db.prepare('INSERT INTO requirement_overrides(employee_id,requirement_id,data) VALUES(?,?,?) ON CONFLICT(employee_id,requirement_id) DO UPDATE SET data=excluded.data').run(employeeId, requirementId, JSON.stringify({ reason, ...(waive ? { waived: true } : {}), by: actor.username, at: new Date().toISOString() }));
    else store.db.prepare('DELETE FROM requirement_overrides WHERE employee_id=? AND requirement_id=?').run(employeeId, requirementId);
    store.log(actor, notApplicable ? (waive ? 'waive' : 'not-applicable') : 'applicable', `document:${TYPE}`, employeeId, null, { requirementId, reason });
    return { ok: true };
  });
}
// Preview / download with the same checks as the checklist.
export function document201Content(store, actor, docId) {
  const { meta, content } = docRow(store, docId);
  if (meta.type !== TYPE) throw new AppError('Document not found.', 404);
  if (actor.role === 'employee') { if (meta.employeeId !== actor.employeeId || meta.uploadedBy !== actor.username || meta.restricted) throw new AppError('This document is restricted.', 403); }
  else {
    permit(actor, HR_TEAM); assertCanView(store, actor, meta.employeeId);
    if (!canSee(actor, meta)) throw new AppError('This document is restricted.', 403);
  }
  store.log(actor, 'view-document', `document:${TYPE}`, meta.employeeId, null, { id: docId, requirement: meta.requirementName, version: meta.version });
  return { meta, content };
}

// ---------- Totals for the dashboard and reports ----------
export function documentSummary(store, actor, employees = (state => scopeEmployees(store, actor).filter(e => isActive(state, e)))(store.read())) {
  const settings = readSettings(store), today = localToday(), rows = [];
  let missingDocuments = 0, employeesMissing = 0, expired = 0, expiringSoon = 0, pendingReview = 0, overdue = 0, requiredItems = 0, compliedItems = 0;
  const toReview = [];   // one entry per employee with uploads waiting for HR review (bell items open that 201 file)
  for (const e of employees) {
    const list = checklistFor(store, actor, e, settings, today);
    const missing = list.items.filter(i => i.requirement.required && ['Missing', 'Rejected', 'Expired'].includes(i.status));
    missingDocuments += missing.length; if (missing.length) employeesMissing++;
    // Overall compliance (dashboard): required items that apply, and those verified or waived.
    const applicable = list.items.filter(i => i.requirement.required && i.status !== 'Not Applicable');
    requiredItems += applicable.length; compliedItems += applicable.filter(i => ['Verified', 'Waived'].includes(i.status)).length;
    expired += list.items.filter(i => i.status === 'Expired').length;
    expiringSoon += list.items.filter(i => i.expiringSoon).length;
    const reviewing = list.items.filter(i => ['Submitted', 'Under Review'].includes(i.status));
    pendingReview += reviewing.length;
    if (reviewing.length) toReview.push({ employeeId: e.id, name: e.name, requirements: reviewing.map(i => i.requirement.name), uploadedAt: reviewing.map(i => i.current?.uploadedAt || '').filter(Boolean).sort() });
    overdue += list.items.filter(i => i.overdue).length;
    for (const i of list.items) if (!['Verified', 'Not Applicable', 'Waived'].includes(i.status) && (i.requirement.required || i.status !== 'Missing')) rows.push({ employeeId: e.id, name: e.name, number: e.employeeNumber || e.id, department: e.department, requirement: i.requirement.name, category: i.requirement.category, required: i.requirement.required, status: i.status, due: i.due, overdue: i.overdue, expiry: i.current?.expiryDate || '' });
    if (list.items.some(i => i.expiringSoon)) for (const i of list.items.filter(x => x.expiringSoon)) rows.push({ employeeId: e.id, name: e.name, number: e.employeeNumber || e.id, department: e.department, requirement: i.requirement.name, category: i.requirement.category, required: i.requirement.required, status: 'Expiring soon', due: '', overdue: false, expiry: i.current?.expiryDate || '' });
  }
  return { missingDocuments, employeesMissing, expired, expiringSoon, pendingReview, overdue, requiredItems, compliedItems, rows, toReview };
}
export function completionReport(store, actor) {
  const settings = readSettings(store);
  return scopeEmployees(store, actor).filter(e => !e.archived).map(e => ({ employee: e, ...checklistFor(store, actor, e, settings) }));
}
