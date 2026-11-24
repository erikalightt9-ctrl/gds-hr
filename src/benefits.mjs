// My Benefits (Nov 24, 2026): government contributions with their remittance payments, HMO coverage and allowances.
// Contribution amounts come from the Government Contributions report (posted payroll, recorded remittance sheets and
// month edits), so the employee sees the same figures HR remits; Finance records each month's payment per agency
// (date, reference, status, proof). HR keeps the HMO and allowance records. Every change is in the audit trail.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { monthlyContributions } from './contribution-report.mjs';
import { recordedMonth } from './contribution-history.mjs';
import { fullNameOf, staffNames } from './staff-names.mjs';

export const AGENCIES = { sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG Fund' };
const SHARE = { sss: ['sssEE', 'sssER'], philhealth: ['phEE', 'phER'], pagibig: ['piEE', 'piER'] };
export const HMO_STATUSES = ['Active', 'Pending', 'Suspended', 'Expired', 'Cancelled'];
export const ALLOWANCE_FREQUENCIES = ['Monthly', 'Semi-monthly', 'Per cutoff', 'Weekly', 'Quarterly', 'Annual', 'One-time'];
export const ALLOWANCE_STATUSES = ['Active', 'Suspended', 'Ended'];
const HISTORY_MONTHS = 24, MAX_PROOF_BYTES = 5 * 1024 * 1024;
const PROOF_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function ensure(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS benefit_remittances (id TEXT PRIMARY KEY, month TEXT NOT NULL, agency TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS benefit_hmo (employee_id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS benefit_allowances (id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS benefit_files (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, content BLOB NOT NULL, uploaded_by TEXT NOT NULL, uploaded_at TEXT NOT NULL);`);
}
const rows = (store, sql, ...args) => store.db.prepare(sql).all(...args).map(r => JSON.parse(r.data));

// Who may do what. Finance logins sign in as 'viewer' with finance: true.
const isFinance = actor => actor?.role === 'admin' || !!actor?.finance;
const STAFF_VIEW = ['admin', 'hr', 'payroll', 'viewer'];
const HR_MANAGE = ['admin', 'hr'];
function permitFinance(actor) { if (!isFinance(actor)) throw new AppError('Only Finance or the System Administrator records contribution payments.', 403); }
function permitAllowancePayment(actor) { if (!(isFinance(actor) || actor?.role === 'hr')) throw new AppError('Only HR, Finance or the System Administrator records allowance payments.', 403); }

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.');
const optDate = z.union([date, z.literal('')]).default('');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.');
const text = (max, min = 0) => z.string().trim().min(min).max(max);
const proofSchema = z.object({ name: text(160, 1), mime: z.enum(PROOF_TYPES, { message: 'Attach a PDF, JPG, PNG or WEBP file.' }), data: z.string().min(4).max(7_100_000) }).strict();

function saveProof(store, actor, ownerId, proof) {
  const bytes = Buffer.from(proof.data, 'base64');
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES) throw new AppError('The proof file must be 5 MB or smaller.');
  const id = randomUUID();
  store.db.prepare('INSERT INTO benefit_files VALUES(?,?,?,?,?,?,?)').run(id, ownerId, proof.name, proof.mime, bytes, actor.username, new Date().toISOString());
  return { id, name: proof.name, mime: proof.mime, size: bytes.length };
}

// ---------- Government contribution payments (Finance) ----------
const remittanceSchema = z.object({
  month, agency: z.enum(Object.keys(AGENCIES)), status: z.enum(['paid', 'verified']), paymentDate: date,
  reference: text(80, 3), amountPaid: z.coerce.number().min(0).max(100_000_000).optional(), note: text(500).default(''), proof: proofSchema.optional(),
}).strict();
export function remittance(store, monthValue, agency) {
  ensure(store);
  const row = store.db.prepare('SELECT data FROM benefit_remittances WHERE id=?').get(`${monthValue}:${agency}`);
  return row ? JSON.parse(row.data) : null;
}
export function recordRemittance(store, actor, input) {
  permitFinance(actor);
  ensure(store);
  const v = remittanceSchema.parse(input);
  return store.transaction(() => {
    const id = `${v.month}:${v.agency}`, before = remittance(store, v.month, v.agency), now = new Date().toISOString();
    const proof = v.proof ? saveProof(store, actor, id, v.proof) : before?.proof || null;
    const after = { id, month: v.month, agency: v.agency, status: v.status, paymentDate: v.paymentDate, reference: v.reference, amountPaid: v.amountPaid ?? before?.amountPaid ?? null, note: v.note, proof,
      recordedBy: before?.recordedBy || actor.username, recordedAt: before?.recordedAt || now, updatedBy: actor.username, updatedAt: now,
      ...(v.status === 'verified' ? { verifiedBy: before?.status === 'verified' ? before.verifiedBy : actor.username, verifiedAt: before?.status === 'verified' ? before.verifiedAt : now } : {}) };
    store.db.prepare('INSERT INTO benefit_remittances(id,month,agency,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, v.month, v.agency, JSON.stringify(after));
    store.log(actor, before ? 'update' : 'record', 'benefit-remittance', id, before, after);
    return after;
  });
}

// Months in which the employee's contributions are final: every payroll cutoff of the month posted, or a recorded
// remittance sheet. Draft months are left out (their figures can still change).
function finalMonths(store, employeeId) {
  const state = store.read(), monthly = (state.rules[0]?.cutoff || 'semi-monthly') === 'monthly';
  const posted = state.runs.filter(r => r.status === 'posted');
  const months = new Set();
  for (const run of posted) if (run.rows.some(r => r.employeeId === employeeId)) months.add(run.start.slice(0, 7));
  ensure(store);
  for (const m of store.db.prepare('SELECT month FROM contribution_records').all().map(r => r.month)) months.add(m);
  for (const m of store.db.prepare('SELECT DISTINCT month FROM benefit_remittances').all().map(r => r.month)) months.add(m);
  const final = m => recordedMonth(store, m) || (posted.some(r => r.start === `${m}-01`) && (monthly || posted.some(r => r.start === `${m}-16`)));
  return [...months].filter(final).sort().reverse().slice(0, HISTORY_MONTHS);
}
export function contributionHistory(store, employeeId) {
  ensure(store);
  const out = [];
  for (const m of finalMonths(store, employeeId)) {
    const report = monthlyContributions(store, m), person = report.people.find(p => p.employeeId === employeeId);
    if (!person) continue;
    const recordedSheet = !!recordedMonth(store, m);
    for (const [agency, [ee, er]] of Object.entries(SHARE)) {
      if (!person[ee] && !person[er]) continue;
      const pay = remittance(store, m, agency);
      out.push({ month: m, agency, agencyName: AGENCIES[agency], employeeShare: person[ee], employerShare: person[er], total: Math.round((person[ee] + person[er]) * 100) / 100,
        status: pay ? (pay.status === 'verified' ? 'Verified' : 'Paid') : recordedSheet ? 'Remitted (recorded sheet)' : 'Deducted — payment not yet recorded',
        paymentDate: pay?.paymentDate || '', reference: pay?.reference || '', proof: pay?.proof ? { id: pay.proof.id, name: pay.proof.name } : null });
    }
  }
  return out;
}

// ---------- HMO (HR) ----------
const dependentSchema = z.object({ name: text(160, 1), relationship: text(60, 1), memberNo: text(60).default(''), birthDate: optDate }).strict();
const hmoSchema = z.object({
  employeeId: text(40, 1), provider: text(120, 1), memberNo: text(60, 1), plan: text(120, 1), coverage: text(1000).default(''),
  startDate: date, endDate: optDate, status: z.enum(HMO_STATUSES), dependents: z.array(dependentSchema).max(12).default([]), note: text(500).default(''),
}).strict().refine(v => !v.endDate || v.endDate >= v.startDate, 'The expiration date cannot be before the start date.');
export function hmoOf(store, employeeId) {
  ensure(store);
  const row = store.db.prepare('SELECT data FROM benefit_hmo WHERE employee_id=?').get(employeeId);
  return row ? JSON.parse(row.data) : null;
}
// Coverage that ran past its expiration date reads Expired, whatever was last typed.
const withLiveStatus = (hmo, today) => (hmo && hmo.endDate && hmo.endDate < today && hmo.status === 'Active' ? { ...hmo, status: 'Expired' } : hmo);
export function saveHmo(store, actor, input) {
  permit(actor, HR_MANAGE);
  ensure(store);
  const v = hmoSchema.parse(input);
  if (!store.read().employees.some(e => e.id === v.employeeId)) throw new AppError('Employee not found.', 404);
  return store.transaction(() => {
    const before = hmoOf(store, v.employeeId), now = new Date().toISOString();
    const after = { ...v, id: v.employeeId, createdBy: before?.createdBy || actor.username, createdAt: before?.createdAt || now, updatedBy: actor.username, updatedAt: now };
    store.db.prepare('INSERT INTO benefit_hmo(employee_id,data) VALUES(?,?) ON CONFLICT(employee_id) DO UPDATE SET data=excluded.data').run(v.employeeId, JSON.stringify(after));
    store.log(actor, before ? 'update' : 'create', 'benefit-hmo', v.employeeId, before, after);
    store.notify(v.employeeId, `HR ${before ? 'updated' : 'recorded'} your HMO coverage (${v.provider}, ${v.plan}). See My Benefits.`);
    return after;
  });
}

// ---------- Allowances (HR; payments by HR / Finance) ----------
const allowanceSchema = z.object({
  id: z.string().max(60).optional(), employeeId: text(40, 1), type: text(80, 2), amount: z.coerce.number().positive().max(10_000_000),
  frequency: z.enum(ALLOWANCE_FREQUENCIES), effectiveDate: date, endDate: optDate, status: z.enum(ALLOWANCE_STATUSES), eligibility: text(500).default(''),
}).strict().refine(v => !v.endDate || v.endDate >= v.effectiveDate, 'The end date cannot be before the effective date.');
const allowancePaymentSchema = z.object({ date, amount: z.coerce.number().positive().max(10_000_000), reference: text(80).default(''), note: text(300).default('') }).strict();
export function allowancesOf(store, employeeId) {
  ensure(store);
  return rows(store, 'SELECT data FROM benefit_allowances WHERE employee_id=? ORDER BY rowid', employeeId);
}
function allowanceById(store, id) { ensure(store); const row = store.db.prepare('SELECT data FROM benefit_allowances WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; }
export function saveAllowance(store, actor, input) {
  permit(actor, HR_MANAGE);
  ensure(store);
  const v = allowanceSchema.parse(input);
  if (!store.read().employees.some(e => e.id === v.employeeId)) throw new AppError('Employee not found.', 404);
  return store.transaction(() => {
    const before = v.id ? allowanceById(store, v.id) : null;
    if (v.id && !before) throw new AppError('Allowance not found.', 404);
    if (before && before.employeeId !== v.employeeId) throw new AppError('An allowance cannot be moved to another employee.');
    const now = new Date().toISOString(), id = before?.id || randomUUID();
    const after = { ...v, id, payments: before?.payments || [], createdBy: before?.createdBy || actor.username, createdAt: before?.createdAt || now, updatedBy: actor.username, updatedAt: now };
    store.db.prepare('INSERT INTO benefit_allowances(id,employee_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, v.employeeId, JSON.stringify(after));
    store.log(actor, before ? 'update' : 'create', 'benefit-allowance', id, before, after);
    store.notify(v.employeeId, `HR ${before ? 'updated' : 'added'} your ${v.type} allowance (${v.frequency}, ₱${v.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}). See My Benefits.`);
    return after;
  });
}
export function recordAllowancePayment(store, actor, id, input) {
  permitAllowancePayment(actor);
  const v = allowancePaymentSchema.parse(input);
  return store.transaction(() => {
    const before = allowanceById(store, id);
    if (!before) throw new AppError('Allowance not found.', 404);
    const after = { ...before, payments: [...(before.payments || []), { id: randomUUID(), ...v, by: actor.username, at: new Date().toISOString() }].sort((a, b) => a.date.localeCompare(b.date)), updatedBy: actor.username, updatedAt: new Date().toISOString() };
    store.db.prepare('UPDATE benefit_allowances SET data=? WHERE id=?').run(JSON.stringify(after), id);
    store.log(actor, 'record-payment', 'benefit-allowance', id, before, after);
    return after;
  });
}

// ---------- Views ----------
// The change history of one employee's HMO and allowance records and the contribution payments that cover them.
function auditHistory(store, employeeId, months) {
  const names = staffNames(store), like = `%"employeeId":"${employeeId.replace(/[%_"]/g, '')}"%`;
  const changes = store.db.prepare("SELECT at, actor, action, kind, record_id, after_json FROM audit WHERE kind IN ('benefit-hmo','benefit-allowance') AND (after_json LIKE ? OR before_json LIKE ?) ORDER BY at, rowid").all(like, like);
  const items = changes.map(r => {
    const after = JSON.parse(r.after_json || 'null') || {};
    const label = /allowance$/i.test(after.type || '') ? after.type : `${after.type} allowance`;
    const what = r.kind === 'benefit-hmo' ? `HMO ${r.action === 'create' ? 'coverage recorded' : 'coverage updated'}: ${after.provider || ''} · ${after.plan || ''} · ${after.status || ''}`
      : r.action === 'record-payment' ? `${label} payment recorded: ₱${Number(after.payments?.at(-1)?.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}${after.payments?.at(-1)?.reference ? ` (ref. ${after.payments.at(-1).reference})` : ''}`
        : `${label} ${r.action === 'create' ? 'added' : 'updated'}: ₱${Number(after.amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} ${String(after.frequency || '').toLowerCase()} · ${after.status || ''}`;
    return { at: r.at, category: r.kind === 'benefit-hmo' ? 'HMO' : 'Allowance', text: what, by: fullNameOf(store, r.actor, names) };
  });
  const remits = store.db.prepare("SELECT at, actor, action, record_id, after_json FROM audit WHERE kind='benefit-remittance' ORDER BY at, rowid").all()
    .filter(r => months.has(r.record_id.split(':')[0]))
    .map(r => { const a = JSON.parse(r.after_json || '{}'); return { at: r.at, category: 'Contribution', text: `${AGENCIES[a.agency] || a.agency} ${a.month}: ${a.status === 'verified' ? 'payment verified' : 'payment recorded'} on ${a.paymentDate} (ref. ${a.reference})`, by: fullNameOf(store, r.actor, names) }; });
  // Newest first; changes saved in the same millisecond keep the order they were made in.
  return [...items, ...remits].map((x, i) => ({ ...x, seq: i })).sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq).map(({ seq: _seq, ...x }) => x);
}
export function benefitsOf(store, employeeId, today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())) {
  ensure(store);
  const contributions = contributionHistory(store, employeeId), names = staffNames(store);
  const hmo = withLiveStatus(hmoOf(store, employeeId), today);
  const allowances = allowancesOf(store, employeeId).map(a => ({ ...a, status: a.status === 'Active' && a.endDate && a.endDate < today ? 'Ended' : a.status, payments: (a.payments || []).map(p => ({ ...p, by: fullNameOf(store, p.by, names) })), updatedBy: fullNameOf(store, a.updatedBy, names) }));
  return { employeeId, contributions, hmo: hmo ? { ...hmo, updatedBy: fullNameOf(store, hmo.updatedBy, names) } : null, allowances, history: auditHistory(store, employeeId, new Set(contributions.map(c => c.month))) };
}
export function myBenefits(store, actor) {
  if (actor?.role !== 'employee' || !actor.employeeId) throw new AppError('Only employees have a My Benefits page.', 403);
  return benefitsOf(store, actor.employeeId);
}
export function employeeBenefits(store, actor, employeeId) {
  if (!STAFF_VIEW.includes(actor?.role)) throw new AppError('You do not have permission for this action.', 403);
  if (!store.read().employees.some(e => e.id === employeeId)) throw new AppError('Employee not found.', 404);
  return benefitsOf(store, employeeId);
}
// Consolidated report (HR, Payroll, Finance, Management): the month's remittances per agency and each employee's
// HMO, allowances and contribution shares for that month.
export function benefitsOverview(store, actor, monthValue) {
  if (!STAFF_VIEW.includes(actor?.role)) throw new AppError('You do not have permission for this action.', 403);
  ensure(store);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthValue || '') ? monthValue : today.slice(0, 7);
  const report = monthlyContributions(store, m), state = store.read(), names = staffNames(store);
  const remittances = Object.entries(SHARE).map(([agency, [ee, er]]) => {
    const pay = remittance(store, m, agency), employee = report.people.reduce((s, p) => s + (p[ee] || 0), 0), employer = report.people.reduce((s, p) => s + (p[er] || 0), 0);
    return { agency, agencyName: AGENCIES[agency], employeeShare: Math.round(employee * 100) / 100, employerShare: Math.round(employer * 100) / 100, total: Math.round((employee + employer) * 100) / 100, draft: report.draft,
      payment: pay ? { ...pay, recordedBy: fullNameOf(store, pay.recordedBy, names), updatedBy: fullNameOf(store, pay.updatedBy, names), verifiedBy: pay.verifiedBy ? fullNameOf(store, pay.verifiedBy, names) : '' } : null };
  });
  const people = state.employees.filter(e => !e.archived && !e.draft && (!e.endDate || e.endDate >= `${m}-01`)).map(e => {
    const hmo = withLiveStatus(hmoOf(store, e.id), today), allowances = allowancesOf(store, e.id).filter(a => a.status === 'Active' && (!a.endDate || a.endDate >= today));
    const p = report.people.find(x => x.employeeId === e.id);
    return { employeeId: e.id, name: e.name, department: e.department || '', hmo: hmo ? { provider: hmo.provider, plan: hmo.plan, status: hmo.status, endDate: hmo.endDate } : null,
      allowances: allowances.map(a => ({ id: a.id, type: a.type, amount: a.amount, frequency: a.frequency })),
      contributions: p ? { sss: [p.sssEE, p.sssER], philhealth: [p.phEE, p.phER], pagibig: [p.piEE, p.piER] } : null };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { month: m, draft: report.draft, remittances, people, canRecordPayments: isFinance(actor), canManage: HR_MANAGE.includes(actor.role), canRecordAllowancePayments: isFinance(actor) || actor.role === 'hr' };
}
// A proof file: staff who may view benefits, or an employee whose contribution month it covers.
export function proofFile(store, actor, id) {
  ensure(store);
  const row = store.db.prepare('SELECT owner_id, name, mime, content FROM benefit_files WHERE id=?').get(id);
  if (!row) throw new AppError('File not found.', 404);
  if (actor?.role === 'employee') {
    const [m] = row.owner_id.split(':');
    if (!contributionHistory(store, actor.employeeId).some(c => c.month === m && c.proof?.id === id)) throw new AppError('File not found.', 404);
  } else if (!STAFF_VIEW.includes(actor?.role)) throw new AppError('You do not have permission for this action.', 403);
  return { name: row.name, mime: row.mime, content: row.content };
}
