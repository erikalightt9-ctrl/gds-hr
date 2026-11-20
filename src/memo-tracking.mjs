// Memo acknowledgement tracking under the Company Communications, Acknowledgment and Disciplinary Process Policy
// (Nov 20, 2026): views, clarification requests and answers, HR-recorded paper acknowledgements (with evidence),
// per-recipient deadlines, statuses and one daily in-account reminder. Opening, downloading or printing a memo never
// acknowledges it; only the employee's own "Acknowledge" (or a documented paper receipt recorded by HR) does.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { HR_MANAGERS, HR_TEAM } from './roles.mjs';
import { isRest } from './engine.mjs';
import { validFile } from './documents201.mjs';

export const ROUTINE_CATEGORIES = ['General Announcement', 'Policy / Guidelines', 'Advisory / Reminder', 'Office Order / Schedule'];
export const DISCIPLINARY_CATEGORY = 'Notice to Explain / Disciplinary';
export const ACK_WORDING = 'I confirm that I have received and read this document and understand the instructions that apply to me.';
export const ACK_BUTTON = 'Acknowledge — Received, Read and Understood';
export const STATUS_LABELS = { pending: 'Pending Acknowledgment', overdue: 'Overdue Acknowledgment', clarification: 'Clarification Requested', answered: 'Clarification Answered — Please Acknowledge', acknowledged: 'Acknowledged', withdrawn: 'Withdrawn', 'not-required': 'No acknowledgment needed' };
export const REMINDER_HOUR = 8;   // Manila time; one reminder per employee per day from then on

const manilaNow = (now = new Date()) => new Date(now.getTime() + 8 * 3600000).toISOString();
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const longDate = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function ensureTracking(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS memo_events (id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, version INTEGER NOT NULL, employee_id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, by TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}');
    CREATE INDEX IF NOT EXISTS memo_events_by_memo ON memo_events(memo_id, version, employee_id);
    CREATE TABLE IF NOT EXISTS memo_pdfs (memo_id TEXT NOT NULL, version INTEGER NOT NULL, content BLOB NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(memo_id, version));
    CREATE TABLE IF NOT EXISTS memo_evidence (id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, version INTEGER NOT NULL, employee_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, content BLOB NOT NULL);`);
}
const readMemo = (store, id) => { const row = store.db.prepare('SELECT data FROM memos WHERE id=?').get(id); if (!row) throw new AppError('Memo not found.', 404); return JSON.parse(row.data); };
function addEvent(store, { memoId, version, employeeId, kind, by, data = {}, at = new Date().toISOString() }) {
  ensureTracking(store);
  const id = randomUUID();
  store.db.prepare('INSERT INTO memo_events(id,memo_id,version,employee_id,kind,at,by,data) VALUES(?,?,?,?,?,?,?,?)').run(id, memoId, version, employeeId, kind, at, by, JSON.stringify(data));
  return id;
}
export function eventsFor(store, memoId, version, employeeId = null) {
  ensureTracking(store);
  const rows = employeeId ? store.db.prepare('SELECT * FROM memo_events WHERE memo_id=? AND version=? AND employee_id=? ORDER BY at').all(memoId, version, employeeId) : store.db.prepare('SELECT * FROM memo_events WHERE memo_id=? AND version=? ORDER BY at').all(memoId, version);
  return rows.map(r => ({ id: r.id, employeeId: r.employee_id, kind: r.kind, at: r.at, by: r.by, ...JSON.parse(r.data) }));
}

// The default deadline: the end of the employee's next scheduled working day after the memo reached them (rest days
// and holidays skipped), unless the issuer set a date. A memo assigned on a later day counts from that day.
export function dueDate(state, employee, version, assignedAt) {
  if (version.ackDeadline) return version.ackDeadline;
  const from = [version.issueDate, manilaNow(new Date(assignedAt)).slice(0, 10)].sort().at(-1);
  const off = new Set(state.holidays.filter(h => ['regular', 'special', 'double'].includes(h.kind)).map(h => h.date));
  let d = addDays(from, 1);
  for (let i = 0; employee && i < 14 && (isRest(employee, d) || off.has(d)); i++) d = addDays(d, 1);
  return d;
}
// One recipient's state for one version.
export function recipientStatus(memo, version, row, events, due, today) {
  if (!version.ackRequired) return 'not-required';
  if (row.acknowledged_at) return 'acknowledged';
  if (memo.status === 'archived' || memo.version !== version.version) return 'withdrawn';
  const asked = events.filter(e => e.kind === 'clarification'), open = asked.filter(q => !events.some(a => a.kind === 'answer' && a.questionId === q.id));
  if (open.length) return 'clarification';
  if (due < today) return 'overdue';
  return asked.length ? 'answered' : 'pending';
}
// Everything HR sees about one recipient of one version.
export function recipientDetail(store, state, memo, version, row, today) {
  const events = eventsFor(store, memo.id, version.version, row.employee_id), employee = state.employees.find(e => e.id === row.employee_id);
  const due = dueDate(state, employee, version, row.assigned_at), views = events.filter(e => e.kind === 'viewed'), manual = events.find(e => e.kind === 'manual-ack');
  const clarifications = events.filter(e => e.kind === 'clarification').map(q => { const a = events.find(e => e.kind === 'answer' && e.questionId === q.id); return { id: q.id, question: q.question, askedAt: q.at, answer: a?.answer || '', answeredAt: a?.at || '', answeredBy: a?.by || '' }; });
  const status = recipientStatus(memo, version, row, events, due, today);
  return { employeeId: row.employee_id, assignedAt: row.assigned_at, due, status, statusLabel: STATUS_LABELS[status], firstViewedAt: views[0]?.at || '', lastViewedAt: views.at(-1)?.at || '', acknowledgedAt: row.acknowledged_at, manual: manual ? { by: manual.by, note: manual.note, receivedOn: manual.receivedOn, evidenceId: manual.evidenceId, evidenceName: manual.evidenceName } : null, ackWording: events.find(e => e.kind === 'acknowledged')?.wording || (row.acknowledged_at && !manual ? ACK_WORDING : ''), lastReminderAt: events.filter(e => e.kind === 'reminded').at(-1)?.at || '', clarifications };
}

const assignment = (store, memoId, version, employeeId) => store.db.prepare('SELECT * FROM memo_assignments WHERE memo_id=? AND version=? AND employee_id=?').get(memoId, version, employeeId);
// The employee opened the official PDF / viewer (one record per day; never an acknowledgement).
export function recordView(store, actor, memoId, version) {
  permit(actor, ['employee']);
  if (!assignment(store, memoId, version, actor.employeeId)) throw new AppError('This memo was not addressed to you.', 403);
  const day = manilaNow().slice(0, 10);
  if (eventsFor(store, memoId, version, actor.employeeId).some(e => e.kind === 'viewed' && manilaNow(new Date(e.at)).slice(0, 10) === day)) return { ok: true };
  addEvent(store, { memoId, version, employeeId: actor.employeeId, kind: 'viewed', by: actor.username });
  return { ok: true };
}
export function requestClarification(store, actor, memoId, version, input) {
  permit(actor, ['employee']);
  const { question } = z.object({ question: z.string().trim().min(5, 'Write your question (at least 5 characters).').max(2000) }).strict().parse(input);
  const row = assignment(store, memoId, version, actor.employeeId);
  if (!row) throw new AppError('This memo was not addressed to you.', 403);
  const memo = readMemo(store, memoId), v = memo.versions.find(x => x.version === version);
  return store.transaction(() => {
    const id = addEvent(store, { memoId, version, employeeId: actor.employeeId, kind: 'clarification', by: actor.username, data: { question } });
    store.log(actor, 'request-clarification', 'memos', memoId, null, { version, employeeId: actor.employeeId });
    const name = store.read().employees.find(e => e.id === actor.employeeId)?.name || actor.employeeId;
    store.notify(null, `${name} asked for clarification on memo ${v.reference}: ${v.title}. Answer it in Memos → Open.`);
    store.notify(actor.employeeId, `Your question on memo ${v.reference} was sent to HR. Status: Clarification Requested.`);
    return { id, status: 'clarification' };
  });
}
export function answerClarification(store, actor, memoId, questionId, input) {
  permit(actor, HR_TEAM);
  const { answer } = z.object({ answer: z.string().trim().min(3, 'Write the answer.').max(4000) }).strict().parse(input);
  ensureTracking(store);
  const q = store.db.prepare("SELECT * FROM memo_events WHERE id=? AND memo_id=? AND kind='clarification'").get(questionId, memoId);
  if (!q) throw new AppError('Question not found.', 404);
  if (store.db.prepare("SELECT 1 FROM memo_events WHERE memo_id=? AND kind='answer' AND data LIKE ?").get(memoId, `%"questionId":"${questionId}"%`)) throw new AppError('This question was already answered.');
  const v = readMemo(store, memoId).versions.find(x => x.version === q.version);
  return store.transaction(() => {
    addEvent(store, { memoId, version: q.version, employeeId: q.employee_id, kind: 'answer', by: actor.username, data: { questionId, answer } });
    store.log(actor, 'answer-clarification', 'memos', memoId, null, { version: q.version, employeeId: q.employee_id });
    store.notify(q.employee_id, `HR answered your question on memo ${v.reference}: ${answer.slice(0, 300)} — please acknowledge the memo once it is clear.`);
    return { ok: true };
  });
}
// A genuine paper acknowledgement (or other documented receipt) recorded by HR: marked as manual, evidence kept.
export function recordPaperAck(store, actor, memoId, version, employeeId, input) {
  permit(actor, HR_MANAGERS);
  const v = z.object({ receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date the employee signed.'), note: z.string().trim().min(5, 'Describe the signed document (at least 5 characters).').max(500), name: z.string().trim().min(1).max(180), mime: z.enum(['application/pdf', 'image/png', 'image/jpeg']), data: z.string().min(1).max(14000000) }).strict().parse(input);
  const bytes = Buffer.from(v.data, 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !validFile(v.mime, bytes)) throw new AppError('Attach the signed acknowledgement (PDF, PNG or JPEG up to 10 MB).');
  const row = assignment(store, memoId, version, employeeId);
  if (!row) throw new AppError('This memo was not addressed to that employee.', 404);
  if (row.acknowledged_at) throw new AppError('This employee has already acknowledged this version.');
  if (v.receivedOn > manilaNow().slice(0, 10)) throw new AppError('The signing date cannot be in the future.');
  ensureTracking(store);
  return store.transaction(() => {
    const evidenceId = randomUUID(), at = `${v.receivedOn}T00:00:00.000Z`;
    store.db.prepare('INSERT INTO memo_evidence(id,memo_id,version,employee_id,name,mime,content) VALUES(?,?,?,?,?,?,?)').run(evidenceId, memoId, version, employeeId, v.name, v.mime, bytes);
    store.db.prepare('UPDATE memo_assignments SET acknowledged_at=?, ack_user=? WHERE memo_id=? AND version=? AND employee_id=?').run(at, `manual:${actor.username}`, memoId, version, employeeId);
    addEvent(store, { memoId, version, employeeId, kind: 'manual-ack', by: actor.username, data: { receivedOn: v.receivedOn, note: v.note, evidenceId, evidenceName: v.name } });
    store.log(actor, 'record-paper-acknowledgement', 'memos', memoId, null, { version, employeeId, receivedOn: v.receivedOn, evidence: v.name });
    return { acknowledgedAt: at, manual: true };
  });
}
export function ackEvidence(store, actor, evidenceId) {
  permit(actor, HR_TEAM);
  ensureTracking(store);
  const row = store.db.prepare('SELECT * FROM memo_evidence WHERE id=?').get(evidenceId);
  if (!row) throw new AppError('File not found.', 404);
  return row;
}
// The employee's own acknowledgement: the accepted wording is kept with it.
export function noteAcknowledged(store, actor, memoId, version) {
  addEvent(store, { memoId, version, employeeId: actor.employeeId, kind: 'acknowledged', by: actor.username, data: { wording: ACK_WORDING } });
}

// Outstanding memo actions of one employee (latest issued versions only), for the portal and the daily reminder.
export function outstandingMemos(store, employeeId, now = new Date()) {
  ensureTracking(store);
  const state = store.read(), employee = state.employees.find(e => e.id === employeeId), today = manilaNow(now).slice(0, 10), out = [];
  for (const row of store.db.prepare('SELECT * FROM memo_assignments WHERE employee_id=? AND acknowledged_at IS NULL').all(employeeId)) {
    const data = store.db.prepare('SELECT data FROM memos WHERE id=?').get(row.memo_id); if (!data) continue;
    const memo = JSON.parse(data.data), v = memo.versions.find(x => x.version === row.version);
    if (!v?.ackRequired || memo.status !== 'published' || memo.version !== row.version) continue;
    const events = eventsFor(store, memo.id, v.version, employeeId), due = dueDate(state, employee, v, row.assigned_at);
    const status = recipientStatus(memo, v, row, events, due, today);
    out.push({ memoId: memo.id, version: v.version, reference: v.reference, title: v.title, due, status, statusLabel: STATUS_LABELS[status] });
  }
  return out;
}

// One in-account reminder per employee per day (from 8 AM Manila), listing every outstanding memo and due process
// action; `extra(employeeId)` supplies the due process lines. Recorded per memo as 'reminded' for HR's monitoring.
export function sendDailyReminders(store, now = new Date(), extra = () => []) {
  ensureTracking(store);
  const local = manilaNow(now), today = local.slice(0, 10);
  if (Number(local.slice(11, 13)) < REMINDER_HOUR) return { sent: 0 };
  const sentToday = new Set(store.db.prepare("SELECT employee_id FROM memo_events WHERE kind='daily-reminder' AND data LIKE ?").all(`%"day":"${today}"%`).map(r => r.employee_id));
  const employees = store.db.prepare('SELECT DISTINCT employee_id FROM memo_assignments WHERE acknowledged_at IS NULL').all().map(r => r.employee_id);
  const all = new Set([...employees, ...store.read().employees.map(e => e.id)]);
  let sent = 0;
  for (const employeeId of all) {
    if (sentToday.has(employeeId)) continue;
    // Not on the day the memo arrived (that notice was just sent).
    const memos = outstandingMemos(store, employeeId, now).filter(m => {
      const row = assignment(store, m.memoId, m.version, employeeId);
      return manilaNow(new Date(row.assigned_at)).slice(0, 10) < today && m.status !== 'clarification';
    });
    const other = extra(employeeId);
    if (!memos.length && !other.length) continue;
    const lines = [...memos.map(m => `${m.status === 'overdue' ? '⚠️ Overdue Acknowledgment' : m.status === 'answered' ? '🔔 Pending Acknowledgment (your question was answered)' : '🔔 Pending Acknowledgment'}: ${m.reference} ${m.title} (due ${longDate(m.due)})`), ...other];
    store.transaction(() => {
      store.notify(employeeId, `Daily reminder — ${lines.length} item${lines.length === 1 ? '' : 's'} need${lines.length === 1 ? 's' : ''} your action:\n${lines.join('\n')}`);
      addEvent(store, { memoId: '', version: 0, employeeId, kind: 'daily-reminder', by: 'system', data: { day: today, count: lines.length } });
      for (const m of memos) addEvent(store, { memoId: m.memoId, version: m.version, employeeId, kind: 'reminded', by: 'system', data: { day: today } });
    });
    sent++;
  }
  return { sent };
}
