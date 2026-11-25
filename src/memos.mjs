// Memos: HR drafts, HR Managers publish to everyone / departments / named employees, and each recipient
// acknowledges RECEIPT of the issued version themselves. Issued versions never change; a revision is a new version
// with its own acknowledgements. Nothing is acknowledged on anyone's behalf.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { scopeEmployees, activity } from './hr201.mjs';
import { validFile } from './documents201.mjs';
import { HR_MANAGERS, HR_TEAM } from './roles.mjs';
import { remittanceOnlyIds } from './remittance-only.mjs';
import { DISCIPLINARY_CATEGORY, ACK_WORDING, ACK_BUTTON, STATUS_LABELS, dueDate, recipientDetail, recipientStatus, eventsFor, noteAcknowledged, ensureTracking } from './memo-tracking.mjs';
export const MEMO_COMPANIES = ['GDS CAPITAL INC.', 'Philippine Dragon Media Network', 'PDMN RECHARGE'];
export const CONFIDENTIAL_CATEGORY = 'Confidential HR notice';

const dateField = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default('');
const memoSchema = z.object({
  title: z.string().trim().min(3, 'Give the memo a title.').max(200), category: z.string().trim().max(80).default('General Announcement'), reference: z.string().trim().max(60).default(''),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the issue date.'), body: z.string().trim().min(1, 'Write the memo text.').max(20000),
  recipients: z.object({ mode: z.enum(['all', 'departments', 'employees']), departments: z.array(z.string().max(120)).max(100).default([]), employees: z.array(z.string().max(80)).max(1000).default([]) }).strict(),
  ackRequired: z.boolean().default(true), ackDeadline: dateField, effectiveDate: dateField, company: z.enum(MEMO_COMPANIES).default('GDS CAPITAL INC.'),
}).strict();
const read = (store, id) => { const row = store.db.prepare('SELECT data FROM memos WHERE id=?').get(id); if (!row) throw new AppError('Memo not found.', 404); return JSON.parse(row.data); };
const write = (store, memo) => store.db.prepare('INSERT INTO memos(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(memo.id, JSON.stringify(memo));
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');

function recipientIds(store, recipients) {
  const skip = remittanceOnlyIds(store);   // remittance-only profiles (e.g. the CEO) receive no memos
  const people = store.read().employees.filter(e => !e.archived && !skip.has(e.id) && activity(e, profileOf(store, e.id, 'employment')) === 'Active');
  const chosen = recipients.mode === 'all' ? people : recipients.mode === 'departments' ? people.filter(e => recipients.departments.includes(e.department)) : people.filter(e => recipients.employees.includes(e.id));
  return chosen.map(e => e.id);
}
const nextReference = (store, issueDate) => {
  const year = issueDate.slice(0, 4), key = `memo:${year}`;
  const n = (store.db.prepare('SELECT value FROM hr_counters WHERE key=?').get(key)?.value || 0) + 1;
  store.db.prepare('INSERT INTO hr_counters(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, n);
  return `MEMO-${year}-${String(n).padStart(3, '0')}`;
};

export function saveMemoDraft(store, actor, id, input) {
  permit(actor, HR_TEAM);
  const v = memoSchema.parse(input);
  if (v.recipients.mode !== 'all' && !v.recipients[v.recipients.mode].length) throw new AppError('Choose at least one recipient.');
  if (v.ackDeadline && v.ackDeadline < v.issueDate) throw new AppError('The acknowledgement deadline is before the issue date.');
  if (v.category === DISCIPLINARY_CATEGORY) throw new AppError('Notices to Explain and disciplinary documents are issued through HR Management → Due Process & Discipline (confidential case workflow with receipt, response period, hearing and decision), not as memos.');
  return store.transaction(() => {
    const existing = id ? read(store, id) : null;
    if (existing && existing.status !== 'draft') throw new AppError('Issued memos cannot be edited. Issue a revised version instead.');
    const memo = { ...(existing || { id: randomUUID(), status: 'draft', version: 0, versions: [], createdBy: actor.username, createdAt: new Date().toISOString(), attachments: [] }), draft: v, updatedAt: new Date().toISOString(), updatedBy: actor.username };
    write(store, memo);
    store.log(actor, existing ? 'update' : 'create', 'memos', memo.id, null, { title: v.title, status: 'draft' });
    return memo;
  });
}
// Publishing (first issue or revision) snapshots the content and assigns this version to its recipients.
export function publishMemo(store, actor, id, input = {}) {
  permit(actor, HR_MANAGERS);
  const { changeNote } = z.object({ changeNote: z.string().trim().max(500).default('') }).strict().parse(input);
  return store.transaction(() => {
    const memo = read(store, id);
    if (memo.status === 'archived') throw new AppError('Archived memos cannot be issued.');
    if (!memo.draft) throw new AppError('Prepare the memo text first.');
    if (memo.version > 0 && changeNote.length < 3) throw new AppError('Describe what changed in this revised version.');
    // Approval step: the person who prepared (last saved) the text cannot issue it; a second HR Manager / Admin does.
    if (memo.updatedBy && memo.updatedBy === actor.username) throw new AppError(`You prepared this ${memo.version ? 'revision' : 'memo'}. Another HR Manager or Administrator must review and approve it before it is issued.`);
    const content = memoSchema.parse(memo.draft), version = memo.version + 1, ids = recipientIds(store, content.recipients);
    if (content.category === DISCIPLINARY_CATEGORY) throw new AppError('Notices to Explain and disciplinary documents are issued through HR Management → Due Process & Discipline, not as memos.');
    if (!ids.length) throw new AppError('No active employees match the chosen recipients.');
    const now = new Date().toISOString();
    const issued = { ...content, approvedBy: actor.username, approvedAt: now, preparedBy: memo.updatedBy || memo.createdBy, reference: content.reference || memo.versions[0]?.reference || nextReference(store, content.issueDate), version, publishedAt: now, publishedBy: actor.username, changeNote, attachments: memo.attachments.filter(a => !a.version || a.version === version).map(a => ({ ...a, version })) };
    const insert = store.db.prepare('INSERT OR IGNORE INTO memo_assignments(memo_id,version,employee_id,assigned_at,acknowledged_at,ack_user) VALUES(?,?,?,?,NULL,NULL)');
    for (const employeeId of ids) insert.run(id, version, employeeId, now);
    for (const a of issued.attachments) store.db.prepare('UPDATE memo_attachments SET version=? WHERE id=? AND version IS NULL').run(version, a.id);
    const updated = { ...memo, status: 'published', version, versions: [...memo.versions, issued], draft: null, attachments: memo.attachments.map(a => ({ ...a, version: a.version || version })) };
    write(store, updated);
    for (const employeeId of ids) store.notify(employeeId, `New memo${version > 1 ? ' (revised)' : ''}: ${issued.title}${issued.ackRequired ? ' — please read and acknowledge receipt.' : ''}`);
    store.log(actor, version > 1 ? 'revise' : 'publish', 'memos', id, null, { version, title: issued.title, recipients: ids.length });
    return updated;
  });
}
// A memo the system issues by itself (e.g. the monthly tardiness reminder) to named employees, with an optional PDF
// attached (`pdf` may be a function of the memo reference): issued at once as version 1, acknowledgement required,
// recorded as issued by the system. Call inside a transaction; returns the issued memo.
export function issueSystemMemo(store, { title, category, body, employeeIds, issueDate = localToday(), pdf = null, pdfName = 'memo.pdf', issuedBy = 'system', kind = '' }) {
  const id = randomUUID(), now = new Date().toISOString(), reference = nextReference(store, issueDate);
  pdf = typeof pdf === 'function' ? pdf(reference) : pdf;
  const attachment = pdf ? { id: randomUUID(), name: pdfName.replace('{ref}', reference), mime: 'application/pdf', size: pdf.length, version: 1 } : null;
  if (attachment) store.db.prepare('INSERT INTO memo_attachments(id,memo_id,version,name,mime,content) VALUES(?,?,1,?,?,?)').run(attachment.id, id, attachment.name, attachment.mime, pdf);
  const issued = { title, category, reference, issueDate, body, recipients: { mode: 'employees', departments: [], employees: employeeIds }, ackRequired: true, ackDeadline: '', version: 1, publishedAt: now, publishedBy: issuedBy, changeNote: '', attachments: attachment ? [attachment] : [] };
  const memo = { id, status: 'published', version: 1, versions: [issued], draft: null, attachments: attachment ? [attachment] : [], createdBy: issuedBy, createdAt: now, kind };
  write(store, memo);
  const insert = store.db.prepare('INSERT OR IGNORE INTO memo_assignments(memo_id,version,employee_id,assigned_at,acknowledged_at,ack_user) VALUES(?,1,?,?,NULL,NULL)');
  for (const employeeId of employeeIds) { insert.run(id, employeeId, now); store.notify(employeeId, `New memo: ${title} — please read and acknowledge receipt.`); }
  store.log({ username: issuedBy }, 'publish', 'memos', id, null, { version: 1, title, recipients: employeeIds.length, reference, kind });
  return { ...memo, reference };
}
// A revision starts from the issued text; it is published separately.
export function startRevision(store, actor, id) {
  permit(actor, HR_MANAGERS);
  return store.transaction(() => {
    const memo = read(store, id);
    if (memo.status !== 'published') throw new AppError('Only issued memos can be revised.');
    const last = memo.versions.at(-1);
    const updated = { ...memo, updatedAt: new Date().toISOString(), updatedBy: actor.username, draft: { title: last.title, category: last.category, reference: last.reference, issueDate: localToday(), body: last.body, recipients: last.recipients, ackRequired: last.ackRequired, ackDeadline: '', effectiveDate: last.effectiveDate || '', company: last.company || 'GDS CAPITAL INC.' } };
    write(store, updated); return updated;
  });
}
export function saveRevision(store, actor, id, input) {
  permit(actor, HR_MANAGERS);
  const v = memoSchema.parse(input);
  return store.transaction(() => {
    const memo = read(store, id);
    if (memo.status !== 'published' || !memo.draft) throw new AppError('Start a revision first.');
    const updated = { ...memo, draft: v, updatedAt: new Date().toISOString(), updatedBy: actor.username };
    write(store, updated); return updated;
  });
}
export function archiveMemo(store, actor, id) {
  permit(actor, HR_MANAGERS);
  return store.transaction(() => {
    const memo = read(store, id), updated = { ...memo, status: 'archived', archivedAt: new Date().toISOString(), archivedBy: actor.username };
    write(store, updated); store.log(actor, 'archive', 'memos', id, null, { title: memo.versions.at(-1)?.title || memo.draft?.title });
    return updated;
  });
}
export function deleteMemoDraft(store, actor, id) {
  permit(actor, HR_TEAM);
  return store.transaction(() => {
    const memo = read(store, id);
    if (memo.status !== 'draft') throw new AppError('Only unissued drafts can be deleted.');
    store.db.prepare('DELETE FROM memos WHERE id=?').run(id); store.db.prepare('DELETE FROM memo_attachments WHERE memo_id=?').run(id);
    store.log(actor, 'delete', 'memos', id, { title: memo.draft?.title }, null); return { ok: true };
  });
}
export function addMemoAttachment(store, actor, id, input) {
  permit(actor, HR_TEAM);
  const v = z.object({ name: z.string().trim().min(1).max(180).refine(x => !/[\x00-\x1f\\/]/.test(x)), mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']), data: z.string().min(1).max(14000000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict().parse(input);
  const bytes = Buffer.from(v.data, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !validFile(v.mime, bytes)) throw new AppError('Attach a PDF, PNG or JPEG up to 10 MB.');
  return store.transaction(() => {
    const memo = read(store, id);
    if (memo.status === 'archived' || (memo.status === 'published' && !memo.draft)) throw new AppError('Attach files to a draft or a revision in progress.');
    const attachment = { id: randomUUID(), name: v.name, mime: v.mime, size: bytes.length, version: null };
    store.db.prepare('INSERT INTO memo_attachments(id,memo_id,version,name,mime,content) VALUES(?,?,NULL,?,?,?)').run(attachment.id, id, v.name, v.mime, bytes);
    write(store, { ...memo, attachments: [...memo.attachments, attachment] });
    return attachment;
  });
}
export function memoAttachment(store, actor, attachmentId) {
  const row = store.db.prepare('SELECT * FROM memo_attachments WHERE id=?').get(attachmentId);
  if (!row) throw new AppError('Attachment not found.', 404);
  if (actor.role === 'employee') {
    if (row.version === null || !store.db.prepare('SELECT 1 FROM memo_assignments WHERE memo_id=? AND version=? AND employee_id=?').get(row.memo_id, row.version, actor.employeeId)) throw new AppError('This attachment is not addressed to you.', 403);
  } else permit(actor, [...HR_TEAM, 'viewer', 'dept_manager']);
  return row;
}

// ---------- Views ----------
function assignmentStats(store, memo, allowed = null) {
  const rows = store.db.prepare('SELECT employee_id, assigned_at, acknowledged_at FROM memo_assignments WHERE memo_id=? AND version=?').all(memo.id, memo.version).filter(r => !allowed || allowed.has(r.employee_id));
  return { recipients: rows.length, acknowledged: rows.filter(r => r.acknowledged_at).length, pending: rows.filter(r => !r.acknowledged_at).length, rows };
}
// Each recipient of one issued version with status, deadline, views, clarifications and reminders.
function versionRecipients(store, state, memo, version, team, today = localToday()) {
  ensureTracking(store);
  return store.db.prepare('SELECT * FROM memo_assignments WHERE memo_id=? AND version=?').all(memo.id, version.version).filter(r => !team || team.has(r.employee_id)).map(r => recipientDetail(store, state, memo, version, r, today));
}
export function listMemos(store, actor) {
  permit(actor, [...HR_TEAM, 'viewer', 'dept_manager']);
  const team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  // Names on the list itself, so HR sees who received the memo and who has not acknowledged it without opening it.
  const state = store.read(), names = new Map(state.employees.map(e => [e.id, e.name])), nameOf = id => names.get(id) || id, today = localToday();
  return store.db.prepare('SELECT data FROM memos').all().map(r => JSON.parse(r.data))
    .filter(m => HR_TEAM.includes(actor.role) || m.status !== 'draft')
    .filter(m => ((m.versions.at(-1) || m.draft)?.category !== CONFIDENTIAL_CATEGORY) || HR_MANAGERS.includes(actor.role))
    .map(m => { const issued = m.versions.at(-1), stats = m.version ? assignmentStats(store, m, team) : null; const shown = issued || m.draft || {}; return { id: m.id, status: m.status, version: m.version, excerpt: String(shown.body || '').replace(/\s+/g, ' ').trim().slice(0, 160), author: issued?.preparedBy || m.updatedBy || m.createdBy || '', approvedBy: issued?.approvedBy || '', publishedAt: issued?.publishedAt || '', updatedAt: m.updatedAt || m.createdAt || '', recipientMode: shown.recipients?.mode || 'all', departments: shown.recipients?.departments || [], title: issued?.title || m.draft?.title, category: issued?.category || m.draft?.category, reference: issued?.reference || m.draft?.reference || '', issueDate: issued?.issueDate || m.draft?.issueDate, ackRequired: issued?.ackRequired ?? m.draft?.ackRequired, ackDeadline: issued?.ackDeadline || '', revisionInProgress: m.status === 'published' && !!m.draft, recipients: stats?.recipients ?? 0, acknowledged: stats?.acknowledged ?? 0, pending: issued?.ackRequired ? stats?.pending ?? 0 : 0, recipientNames: (stats?.rows || []).map(r => nameOf(r.employee_id)), pendingNames: issued?.ackRequired ? (stats?.rows || []).filter(r => !r.acknowledged_at).map(r => nameOf(r.employee_id)) : [], ...(() => { if (!issued?.ackRequired || m.status !== 'published') return { overdue: 0, clarifications: 0 }; const rows = versionRecipients(store, state, m, issued, team, today); return { overdue: rows.filter(r => r.status === 'overdue').length, clarifications: rows.filter(r => r.status === 'clarification').length, company: issued.company || 'GDS CAPITAL INC.' }; })() }; })
    .filter(m => !team || m.recipients)
    .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
}
export function memoDetail(store, actor, id) {
  permit(actor, [...HR_TEAM, 'viewer', 'dept_manager']);
  const memo = read(store, id);
  if (memo.status === 'draft' && !HR_TEAM.includes(actor.role)) throw new AppError('Memo not found.', 404);
  if ((memo.versions.at(-1) || memo.draft)?.category === CONFIDENTIAL_CATEGORY && !HR_MANAGERS.includes(actor.role)) throw new AppError('Memo not found.', 404);
  const team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  const names = new Map(store.read().employees.map(e => [e.id, { name: e.name, department: e.department }]));
  const state = store.read(), today = localToday();
  const versions = memo.versions.map(v => ({ ...v, assignments: versionRecipients(store, state, memo, v, team, today).map(r => ({ ...r, ...names.get(r.employeeId) })) }));
  return { ...memo, versions, canEdit: HR_TEAM.includes(actor.role), canPublish: HR_MANAGERS.includes(actor.role), canRecordPaper: HR_MANAGERS.includes(actor.role), ackWording: ACK_WORDING, statusLabels: STATUS_LABELS };
}
// Employee view: memos assigned to them (each issued version they received).
export function myMemos(store, actor) {
  permit(actor, ['employee']);
  ensureTracking(store);
  const rows = store.db.prepare('SELECT * FROM memo_assignments WHERE employee_id=?').all(actor.employeeId);
  const today = localToday(), state = store.read(), employee = state.employees.find(e => e.id === actor.employeeId);
  return rows.map(r => {
    const memo = JSON.parse(store.db.prepare('SELECT data FROM memos WHERE id=?').get(r.memo_id)?.data ?? 'null');
    const v = memo?.versions.find(x => x.version === r.version);
    if (!v) return null;
    const events = eventsFor(store, memo.id, v.version, actor.employeeId), due = v.ackRequired ? dueDate(state, employee, v, r.assigned_at) : '';
    const status = recipientStatus(memo, v, r, events, due, today);
    const clarifications = events.filter(e => e.kind === 'clarification').map(q => { const a = events.find(e => e.kind === 'answer' && e.questionId === q.id); return { question: q.question, askedAt: q.at, answer: a?.answer || '', answeredAt: a?.at || '' }; });
    return { memoId: memo.id, version: r.version, latest: memo.version === r.version, archived: memo.status === 'archived', title: v.title, category: v.category, reference: v.reference, issueDate: v.issueDate, effectiveDate: v.effectiveDate || '', body: v.body, changeNote: v.changeNote, attachments: v.attachments.map(a => ({ id: a.id, name: a.name })), ackRequired: v.ackRequired, ackDeadline: due, assignedAt: r.assigned_at, acknowledgedAt: r.acknowledged_at, manualAck: String(r.ack_user || '').startsWith('manual:'), overdue: status === 'overdue', status, statusLabel: STATUS_LABELS[status], clarifications, ackWording: ACK_WORDING, ackButton: ACK_BUTTON };
  }).filter(Boolean).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.version - a.version);
}
export function acknowledgeMemo(store, actor, memoId, version) {
  permit(actor, ['employee']);
  return store.transaction(() => {
    const row = store.db.prepare('SELECT acknowledged_at FROM memo_assignments WHERE memo_id=? AND version=? AND employee_id=?').get(memoId, version, actor.employeeId);
    if (!row) throw new AppError('This memo was not addressed to you.', 403);
    if (row.acknowledged_at) return { acknowledgedAt: row.acknowledged_at };
    if (!eventsFor(store, memoId, version, actor.employeeId).some(e => e.kind === 'viewed')) throw new AppError('Open and read the memo first: acknowledgment is available after the memo has been viewed.');
    const at = new Date().toISOString();
    store.db.prepare('UPDATE memo_assignments SET acknowledged_at=?, ack_user=? WHERE memo_id=? AND version=? AND employee_id=?').run(at, actor.username, memoId, version, actor.employeeId);
    noteAcknowledged(store, actor, memoId, version);
    store.log(actor, 'acknowledge-receipt', 'memos', memoId, null, { version, employeeId: actor.employeeId, wording: ACK_WORDING });
    return { acknowledgedAt: at };
  });
}
export function memoSummary(store, actor) {
  const memos = listMemos(store, actor).filter(m => m.status === 'published' && m.ackRequired), today = localToday();
  const team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  const state = store.read(), names = new Map(state.employees.map(e => [e.id, e])), rows = [];
  for (const m of memos) {
    const memo = read(store, m.id), v = memo.versions.find(x => x.version === memo.version);
    for (const r of versionRecipients(store, state, memo, v, team, today).filter(x => !x.acknowledgedAt && x.status !== 'withdrawn'))
      rows.push({ memoId: m.id, title: m.title, reference: m.reference, version: m.version, employeeId: r.employeeId, name: names.get(r.employeeId)?.name || r.employeeId, department: names.get(r.employeeId)?.department || '', assignedAt: r.assignedAt, deadline: r.due, overdue: r.status === 'overdue', status: r.status });
  }
  return { pending: rows.length, overdue: rows.filter(r => r.overdue).length, clarifications: rows.filter(r => r.status === 'clarification').length, rows };
}
// Employee profile tab.
export function memosForEmployee(store, actor, employeeId) {
  return store.db.prepare('SELECT memo_id, version, assigned_at, acknowledged_at FROM memo_assignments WHERE employee_id=?').all(employeeId).map(r => {
    const memo = JSON.parse(store.db.prepare('SELECT data FROM memos WHERE id=?').get(r.memo_id)?.data ?? 'null'), v = memo?.versions.find(x => x.version === r.version);
    return v ? { memoId: memo.id, title: v.title, reference: v.reference, version: r.version, issueDate: v.issueDate, ackRequired: v.ackRequired, assignedAt: r.assigned_at, acknowledgedAt: r.acknowledged_at } : null;
  }).filter(Boolean);
}
