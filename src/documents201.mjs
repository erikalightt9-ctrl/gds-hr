// Digital 201 documents: a per-employee checklist built from the configured requirements, versioned uploads,
// HR review (Submitted → Under Review → Verified / Rejected), expiry, Not Applicable overrides and completeness.
// Files stay in the private database; every preview and download goes through an authorisation check.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { readSettings, assertCanView, scopeEmployees } from './hr201.mjs';
import { HR_MANAGERS, HR_TEAM } from './roles.mjs';

export const DOC_STATUSES = ['Missing', 'Submitted', 'Under Review', 'Verified', 'Rejected', 'Expired', 'Not Applicable'];
const TYPE = '201 Document';
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const docsOf = (store, employeeId) => store.db.prepare('SELECT metadata FROM employee_documents WHERE employee_id=?').all(employeeId).map(r => JSON.parse(r.metadata)).filter(m => m.type === TYPE);
const canSeeRestricted = actor => HR_MANAGERS.includes(actor.role);

export function applicableRequirements(settings, employee, job) {
  return settings.documentRequirements.filter(r => (!r.departments.length || r.departments.includes(employee.department)) && (!r.classifications.length || r.classifications.includes(job.employmentStatus || '')));
}
function statusOf(doc, today) {
  if (!doc) return 'Missing';
  if (doc.expiryDate && doc.expiryDate < today && doc.reviewStatus !== 'Rejected') return 'Expired';
  return doc.reviewStatus;
}
// The checklist for one employee. `actor` decides whether restricted items show file details.
export function checklistFor(store, actor, employee, settings = readSettings(store), today = localToday()) {
  const job = profileOf(store, employee.id, 'employment'), docs = docsOf(store, employee.id);
  const overrides = new Map(store.db.prepare('SELECT requirement_id, data FROM requirement_overrides WHERE employee_id=?').all(employee.id).map(r => [r.requirement_id, JSON.parse(r.data)]));
  const items = applicableRequirements(settings, employee, job).map(req => {
    const versions = docs.filter(d => d.requirementId === req.id).sort((a, b) => b.version - a.version), current = versions[0] || null;
    const na = overrides.get(req.id);
    const status = na ? 'Not Applicable' : statusOf(current, today);
    const due = req.dueDays !== null && req.dueDays !== undefined && employee.startDate ? addDays(employee.startDate, req.dueDays) : '';
    const hidden = req.restricted && !canSeeRestricted(actor);
    return {
      requirement: req, status, due, overdue: status === 'Missing' && req.required && !!due && due < today,
      expiringSoon: status === 'Verified' && !!current?.expiryDate && current.expiryDate <= addDays(today, settings.reminders.expiryDays),
      notApplicable: na || null, restricted: req.restricted, hidden,
      current: hidden ? null : current, versions: hidden ? [] : versions,
    };
  });
  const required = items.filter(i => i.requirement.required && i.status !== 'Not Applicable');
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
  if (actor.role === 'employee') return { ...list, items: list.items.filter(i => !i.restricted).map(i => ({ ...i, versions: i.versions.filter(v => v.uploadedBy === actor.username) })) };
  return list;
}

// ---------- Upload, review, Not Applicable ----------
const uploadSchema = z.object({
  requirementId: z.string().regex(/^[a-z0-9-]{1,60}$/), name: z.string().trim().min(1).max(180).refine(v => !/[\x00-\x1f\\/]/.test(v), 'Invalid file name'),
  mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']), data: z.string().min(1).max(28000000).regex(/^[A-Za-z0-9+/]*={0,2}$/),
  issueDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''), expiryDate: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default(''),
  replaceReason: z.string().trim().max(500).default(''), remarks: z.string().trim().max(500).default(''),
}).strict();
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
  if (req.restricted && !canSeeRestricted(actor)) throw new AppError('Only HR Managers can file restricted documents.', 403);
  if (!bytes.length || bytes.length > settings.uploads.documentMB * 1024 * 1024) throw new AppError(`Choose a file up to ${settings.uploads.documentMB} MB.`);
  if (!validFile(v.mime, bytes)) throw new AppError('The file content does not match a PDF, PNG or JPEG.');
  if (v.expiryDate && v.issueDate && v.expiryDate < v.issueDate) throw new AppError('Expiry date is before the issue date.');
  return store.transaction(() => {
    const previous = docsOf(store, employeeId).filter(d => d.requirementId === req.id).sort((a, b) => b.version - a.version)[0];
    if (previous && !self && previous.reviewStatus === 'Verified' && v.replaceReason.length < 3) throw new AppError('Give a reason for replacing a verified document.');
    const meta = {
      id: randomUUID(), employeeId, type: TYPE, requirementId: req.id, requirementName: req.name, category: req.category, restricted: req.restricted,
      name: v.name, mime: v.mime, size: bytes.length, version: (previous?.version || 0) + 1, replaces: previous?.id || null, replaceReason: v.replaceReason,
      issueDate: v.issueDate, expiryDate: v.expiryDate, expiry: v.expiryDate, remarks: v.remarks,
      uploadedAt: new Date().toISOString(), uploadedBy: actor.username, reviewStatus: 'Submitted', reviewer: '', reviewedAt: '', reviewNote: '', status: 'Active',
    };
    store.db.prepare('INSERT INTO employee_documents VALUES(?,?,?,?)').run(meta.id, employeeId, JSON.stringify(meta), bytes);
    store.db.prepare('DELETE FROM requirement_overrides WHERE employee_id=? AND requirement_id=?').run(employeeId, req.id);
    store.log(actor, previous ? 'replace' : 'upload', `document:${TYPE}`, employeeId, previous ? { id: previous.id, version: previous.version } : null, { id: meta.id, requirement: req.name, version: meta.version, reason: v.replaceReason });
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
    if (meta.restricted && !canSeeRestricted(actor)) throw new AppError('Only HR Managers can review restricted documents.', 403);
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
  const { notApplicable, reason } = z.object({ notApplicable: z.boolean(), reason: z.string().trim().max(500).default('') }).strict().parse(input);
  if (notApplicable && reason.length < 3) throw new AppError('Give a reason for marking the requirement Not Applicable.');
  return store.transaction(() => {
    if (notApplicable) store.db.prepare('INSERT INTO requirement_overrides(employee_id,requirement_id,data) VALUES(?,?,?) ON CONFLICT(employee_id,requirement_id) DO UPDATE SET data=excluded.data').run(employeeId, requirementId, JSON.stringify({ reason, by: actor.username, at: new Date().toISOString() }));
    else store.db.prepare('DELETE FROM requirement_overrides WHERE employee_id=? AND requirement_id=?').run(employeeId, requirementId);
    store.log(actor, notApplicable ? 'not-applicable' : 'applicable', `document:${TYPE}`, employeeId, null, { requirementId, reason });
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
    if (meta.restricted && !canSeeRestricted(actor)) throw new AppError('This document is restricted.', 403);
  }
  store.log(actor, 'view-document', `document:${TYPE}`, meta.employeeId, null, { id: docId, requirement: meta.requirementName, version: meta.version });
  return { meta, content };
}

// ---------- Totals for the dashboard and reports ----------
export function documentSummary(store, actor, employees = scopeEmployees(store, actor).filter(e => !e.archived)) {
  const settings = readSettings(store), today = localToday(), rows = [];
  let missingDocuments = 0, employeesMissing = 0, expired = 0, expiringSoon = 0, pendingReview = 0, overdue = 0;
  for (const e of employees) {
    const list = checklistFor(store, actor, e, settings, today);
    const missing = list.items.filter(i => i.requirement.required && ['Missing', 'Rejected', 'Expired'].includes(i.status));
    missingDocuments += missing.length; if (missing.length) employeesMissing++;
    expired += list.items.filter(i => i.status === 'Expired').length;
    expiringSoon += list.items.filter(i => i.expiringSoon).length;
    pendingReview += list.items.filter(i => ['Submitted', 'Under Review'].includes(i.status)).length;
    overdue += list.items.filter(i => i.overdue).length;
    for (const i of list.items) if (i.status !== 'Verified' && i.status !== 'Not Applicable' && (i.requirement.required || i.status !== 'Missing')) rows.push({ employeeId: e.id, name: e.name, number: e.employeeNumber || e.id, department: e.department, requirement: i.requirement.name, category: i.requirement.category, required: i.requirement.required, status: i.status, due: i.due, overdue: i.overdue, expiry: i.current?.expiryDate || '' });
    if (list.items.some(i => i.expiringSoon)) for (const i of list.items.filter(x => x.expiringSoon)) rows.push({ employeeId: e.id, name: e.name, number: e.employeeNumber || e.id, department: e.department, requirement: i.requirement.name, category: i.requirement.category, required: i.requirement.required, status: 'Expiring soon', due: '', overdue: false, expiry: i.current?.expiryDate || '' });
  }
  return { missingDocuments, employeesMissing, expired, expiringSoon, pendingReview, overdue, rows };
}
export function completionReport(store, actor) {
  const settings = readSettings(store);
  return scopeEmployees(store, actor).filter(e => !e.archived).map(e => ({ employee: e, ...checklistFor(store, actor, e, settings) }));
}
