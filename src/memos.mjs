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

const dateField = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).default('');
const memoSchema = z.object({
  title: z.string().trim().min(3, 'Give the memo a title.').max(200), category: z.string().trim().max(80).default('General'), reference: z.string().trim().max(60).default(''),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the issue date.'), body: z.string().trim().min(1, 'Write the memo text.').max(20000),
  recipients: z.object({ mode: z.enum(['all', 'departments', 'employees']), departments: z.array(z.string().max(120)).max(100).default([]), employees: z.array(z.string().max(80)).max(1000).default([]) }).strict(),
  ackRequired: z.boolean().default(true), ackDeadline: dateField,
}).strict();
const read = (store, id) => { const row = store.db.prepare('SELECT data FROM memos WHERE id=?').get(id); if (!row) throw new AppError('Memo not found.', 404); return JSON.parse(row.data); };
const write = (store, memo) => store.db.prepare('INSERT INTO memos(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(memo.id, JSON.stringify(memo));
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');

function recipientIds(store, recipients) {
  const people = store.read().employees.filter(e => !e.archived && activity(e, profileOf(store, e.id, 'employment')) === 'Active');
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
    const content = memoSchema.parse(memo.draft), version = memo.version + 1, ids = recipientIds(store, content.recipients);
    if (!ids.length) throw new AppError('No active employees match the chosen recipients.');
    const now = new Date().toISOString();
    const issued = { ...content, reference: content.reference || memo.versions[0]?.reference || nextReference(store, content.issueDate), version, publishedAt: now, publishedBy: actor.username, changeNote, attachments: memo.attachments.filter(a => !a.version || a.version === version).map(a => ({ ...a, version })) };
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
// A revision starts from the issued text; it is published separately.
export function startRevision(store, actor, id) {
  permit(actor, HR_MANAGERS);
  return store.transaction(() => {
    const memo = read(store, id);
    if (memo.status !== 'published') throw new AppError('Only issued memos can be revised.');
    const last = memo.versions.at(-1);
    const updated = { ...memo, draft: { title: last.title, category: last.category, reference: last.reference, issueDate: localToday(), body: last.body, recipients: last.recipients, ackRequired: last.ackRequired, ackDeadline: '' } };
    write(store, updated); return updated;
  });
}
export function saveRevision(store, actor, id, input) {
  permit(actor, HR_MANAGERS);
  const v = memoSchema.parse(input);
  return store.transaction(() => {
    const memo = read(store, id);
    if (memo.status !== 'published' || !memo.draft) throw new AppError('Start a revision first.');
    write(store, { ...memo, draft: v }); return { ...memo, draft: v };
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
export function listMemos(store, actor) {
  permit(actor, [...HR_TEAM, 'viewer', 'dept_manager']);
  const team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  return store.db.prepare('SELECT data FROM memos').all().map(r => JSON.parse(r.data))
    .filter(m => HR_TEAM.includes(actor.role) || m.status !== 'draft')
    .map(m => { const issued = m.versions.at(-1), stats = m.version ? assignmentStats(store, m, team) : null; return { id: m.id, status: m.status, version: m.version, title: issued?.title || m.draft?.title, category: issued?.category || m.draft?.category, reference: issued?.reference || m.draft?.reference || '', issueDate: issued?.issueDate || m.draft?.issueDate, ackRequired: issued?.ackRequired ?? m.draft?.ackRequired, ackDeadline: issued?.ackDeadline || '', revisionInProgress: m.status === 'published' && !!m.draft, recipients: stats?.recipients ?? 0, acknowledged: stats?.acknowledged ?? 0, pending: issued?.ackRequired ? stats?.pending ?? 0 : 0 }; })
    .filter(m => !team || m.recipients)
    .sort((a, b) => (b.issueDate || '').localeCompare(a.issueDate || ''));
}
export function memoDetail(store, actor, id) {
  permit(actor, [...HR_TEAM, 'viewer', 'dept_manager']);
  const memo = read(store, id);
  if (memo.status === 'draft' && !HR_TEAM.includes(actor.role)) throw new AppError('Memo not found.', 404);
  const team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  const names = new Map(store.read().employees.map(e => [e.id, { name: e.name, department: e.department }]));
  const versions = memo.versions.map(v => ({ ...v, assignments: assignmentStats(store, { id, version: v.version }, team).rows.map(r => ({ employeeId: r.employee_id, ...names.get(r.employee_id), assignedAt: r.assigned_at, acknowledgedAt: r.acknowledged_at })) }));
  return { ...memo, versions, canEdit: HR_TEAM.includes(actor.role), canPublish: HR_MANAGERS.includes(actor.role) };
}
// Employee view: memos assigned to them (each issued version they received).
export function myMemos(store, actor) {
  permit(actor, ['employee']);
  const rows = store.db.prepare('SELECT memo_id, version, assigned_at, acknowledged_at FROM memo_assignments WHERE employee_id=?').all(actor.employeeId);
  const today = localToday();
  return rows.map(r => {
    const memo = JSON.parse(store.db.prepare('SELECT data FROM memos WHERE id=?').get(r.memo_id)?.data ?? 'null');
    const v = memo?.versions.find(x => x.version === r.version);
    if (!v) return null;
    return { memoId: memo.id, version: r.version, latest: memo.version === r.version, archived: memo.status === 'archived', title: v.title, category: v.category, reference: v.reference, issueDate: v.issueDate, body: v.body, changeNote: v.changeNote, attachments: v.attachments.map(a => ({ id: a.id, name: a.name })), ackRequired: v.ackRequired, ackDeadline: v.ackDeadline, assignedAt: r.assigned_at, acknowledgedAt: r.acknowledged_at, overdue: v.ackRequired && !r.acknowledged_at && !!v.ackDeadline && v.ackDeadline < today };
  }).filter(Boolean).sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.version - a.version);
}
export function acknowledgeMemo(store, actor, memoId, version) {
  permit(actor, ['employee']);
  return store.transaction(() => {
    const row = store.db.prepare('SELECT acknowledged_at FROM memo_assignments WHERE memo_id=? AND version=? AND employee_id=?').get(memoId, version, actor.employeeId);
    if (!row) throw new AppError('This memo was not addressed to you.', 403);
    if (row.acknowledged_at) return { acknowledgedAt: row.acknowledged_at };
    const at = new Date().toISOString();
    store.db.prepare('UPDATE memo_assignments SET acknowledged_at=?, ack_user=? WHERE memo_id=? AND version=? AND employee_id=?').run(at, actor.username, memoId, version, actor.employeeId);
    store.log(actor, 'acknowledge-receipt', 'memos', memoId, null, { version, employeeId: actor.employeeId });
    return { acknowledgedAt: at };
  });
}
export function memoSummary(store, actor) {
  const memos = listMemos(store, actor).filter(m => m.status === 'published' && m.ackRequired), today = localToday();
  const team = actor.role === 'dept_manager' ? new Set(scopeEmployees(store, actor).map(e => e.id)) : null;
  let overdue = 0; const rows = [];
  const names = new Map(store.read().employees.map(e => [e.id, e]));
  for (const m of memos) {
    for (const r of store.db.prepare('SELECT employee_id, assigned_at FROM memo_assignments WHERE memo_id=? AND version=? AND acknowledged_at IS NULL').all(m.id, m.version)) {
      if (team && !team.has(r.employee_id)) continue;
      const late = !!m.ackDeadline && m.ackDeadline < today; if (late) overdue++;
      rows.push({ memoId: m.id, title: m.title, reference: m.reference, version: m.version, employeeId: r.employee_id, name: names.get(r.employee_id)?.name || r.employee_id, department: names.get(r.employee_id)?.department || '', assignedAt: r.assigned_at, deadline: m.ackDeadline, overdue: late });
    }
  }
  return { pending: rows.length, overdue, rows };
}
// Employee profile tab.
export function memosForEmployee(store, actor, employeeId) {
  return store.db.prepare('SELECT memo_id, version, assigned_at, acknowledged_at FROM memo_assignments WHERE employee_id=?').all(employeeId).map(r => {
    const memo = JSON.parse(store.db.prepare('SELECT data FROM memos WHERE id=?').get(r.memo_id)?.data ?? 'null'), v = memo?.versions.find(x => x.version === r.version);
    return v ? { memoId: memo.id, title: v.title, reference: v.reference, version: r.version, issueDate: v.issueDate, ackRequired: v.ackRequired, assignedAt: r.assigned_at, acknowledgedAt: r.acknowledged_at } : null;
  }).filter(Boolean);
}
