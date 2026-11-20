// BIR Form 1601-C: Monthly Remittance Return of Income Taxes Withheld on Compensation (January 2018 ENCS layout).
// Figures per employee come from payroll for the taxable month (posted cutoffs, else the current draft computation),
// like the Government Contributions report. HR / Payroll may type any figure of one employee for one month (reason
// required); the month's return keeps its own Part I / Part II entries (adjustments, penalties, filing details).
// Marking a month Filed freezes the rows and totals as filed; only an administrator can reopen it (reason, audited).
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError, permit } from './service.mjs';
import { calculatePayroll } from './engine.mjs';
import { localToday } from './profiles.mjs';
import { readSettings } from './hr201.mjs';

export const VIEW_ROLES = ['admin', 'hr', 'payroll', 'viewer'];
export const EDIT_ROLES = ['admin', 'hr', 'payroll'];
export const THIRTEENTH_CAP = 90000;   // 13th month pay and other benefits: non-taxable up to ₱90,000 a year (TRAIN law)
// Per-employee figures (pesos for the month). compensation = item 14; the next six are items 15-20; notSubject = item 23.
export const ROW_FIELDS = ['compensation', 'mweBasic', 'mwePremiums', 'thirteenth', 'deMinimis', 'contributions', 'otherNonTaxable', 'notSubject', 'taxWithheld'];
export const ROW_LABELS = { compensation: 'Total compensation', mweBasic: 'Statutory minimum wage (MWE)', mwePremiums: 'Holiday, OT, NSD, hazard pay (MWE)', thirteenth: '13th month pay & other benefits', deMinimis: 'De minimis benefits', contributions: 'SSS / PhilHealth / Pag-IBIG (employee share)', otherNonTaxable: 'Other non-taxable compensation', notSubject: 'Taxable not subject to withholding', taxWithheld: 'Tax withheld' };
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose the taxable month.');
const amount = z.union([z.null(), z.coerce.number().min(0, 'Amounts cannot be negative.').max(1e9)]);
const lastDay = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
export const monthName = month => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function ensure(store) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS bir1601c_edits (employee_id TEXT NOT NULL, month TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(employee_id, month));
    CREATE TABLE IF NOT EXISTS bir1601c_returns (month TEXT PRIMARY KEY, data TEXT NOT NULL);`);
}
const profile = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const readReturn = (store, month) => JSON.parse(store.db.prepare('SELECT data FROM bir1601c_returns WHERE month=?').get(month)?.data ?? 'null');
const writeReturn = (store, month, data) => store.db.prepare('INSERT INTO bir1601c_returns VALUES(?,?) ON CONFLICT(month) DO UPDATE SET data=excluded.data').run(month, JSON.stringify(data));

const DRAFT_CACHE = new Map();
// Payroll rows of the month: posted cutoffs where they exist, otherwise the draft computation as of today.
function payrollRows(state, month) {
  const cutoff = state.rules[0]?.cutoff || 'semi-monthly', end = lastDay(month);
  const periods = cutoff === 'monthly' ? [[`${month}-01`, end]] : [[`${month}-01`, `${month}-15`], [`${month}-16`, end]];
  let draft = false;
  const rows = periods.flatMap(([start, stop]) => {
    const posted = state.runs.find(r => r.status === 'posted' && r.start === start && r.end === stop);
    if (posted) return posted.rows;
    // Nothing recorded for the cutoff (before the system was used, or not reached yet): no draft to compute.
    if (!state.attendance.some(x => x.date >= start && x.date <= stop) && !state.runs.some(r => r.status === 'posted' && r.start <= stop && r.end >= start)) return [];
    draft = true;
    // Draft payroll of a cutoff is cached until any record it reads changes (hash of the data) or the day changes (the year view
    // computes up to 24 cutoffs).
    const key = `${start}|${stop}|${localToday()}|${createHash('sha1').update(JSON.stringify(state)).digest('hex')}`;
    if (!DRAFT_CACHE.has(key)) { if (DRAFT_CACHE.size > 60) DRAFT_CACHE.clear(); try { DRAFT_CACHE.set(key, calculatePayroll({ ...state, asOf: localToday() }, start, stop).rows); } catch { DRAFT_CACHE.set(key, []); } }
    return DRAFT_CACHE.get(key);
  });
  return { rows, draft };
}
// 13th month and other benefits already treated as non-taxable earlier in the year (posted payroll only).
function thirteenthEarlier(state, month) {
  const year = month.slice(0, 4), out = new Map();
  for (const run of state.runs.filter(r => r.status === 'posted' && r.start.startsWith(year) && r.start.slice(0, 7) < month))
    for (const row of run.rows) out.set(row.employeeId, (out.get(row.employeeId) || 0) + (row.earnings?.thirteenth || 0));
  return out;
}
const derive = r => {
  const nonTaxable = r2(r.mweBasic + r.mwePremiums + r.thirteenth + r.deMinimis + r.contributions + r.otherNonTaxable);
  // Not clamped at zero, so the employee figures always add up to the return (item 22 = 14 less 21); a negative
  // taxable amount (non-taxable items above the month's pay, e.g. a partial draft month) is flagged for review.
  const taxable = r2(r.compensation - nonTaxable);
  return { ...r, nonTaxable, taxable, netTaxable: r2(taxable - r.notSubject), check: nonTaxable > r.compensation };
};
// Computed rows (before HR's typed figures) for every employee paid in the month.
function computedRows(store, month) {
  const state = store.read(), { rows, draft } = payrollRows(state, month), earlier = thirteenthEarlier(state, month), by = new Map();
  for (const row of rows) {
    const t = by.get(row.employeeId) || { employeeId: row.employeeId, name: row.employeeName, gross: 0, thirteenthPaid: 0, contributions: 0, tax: 0 };
    const d = row.deductions || {};
    t.gross += (row.gross || 0) - (d.absence || 0) - (d.undertime || 0);
    t.thirteenthPaid += row.earnings?.thirteenth || 0;
    t.contributions += (d.SSS || 0) + (d.PhilHealth || 0) + (d['Pag-IBIG'] || 0);
    t.tax += d.tax || 0;
    by.set(row.employeeId, t);
  }
  const people = [...by.values()].map(t => {
    const room = Math.max(0, THIRTEENTH_CAP - (earlier.get(t.employeeId) || 0)), thirteenth = r2(Math.min(t.thirteenthPaid, room));
    const exempt = profile(store, t.employeeId, 'payroll').withholdingTax === 'exempt';
    const base = { employeeId: t.employeeId, name: t.name, tin: profile(store, t.employeeId, 'government').tin || '', compensation: r2(t.gross), mweBasic: 0, mwePremiums: 0, thirteenth, deMinimis: 0, contributions: r2(t.contributions), otherNonTaxable: 0, notSubject: 0, taxWithheld: r2(t.tax), exempt };
    const d = derive(base);
    return exempt ? derive({ ...base, notSubject: d.taxable }) : d;   // exempt from withholding: taxable goes to item 23
  });
  return { people, draft, state };
}
function edits(store, month) {
  ensure(store);
  return new Map(store.db.prepare('SELECT employee_id, data FROM bir1601c_edits WHERE month=?').all(month).map(r => [r.employee_id, JSON.parse(r.data)]));
}
// The month's rows: computed figures with HR's typed figures applied (typed rows for people not in payroll included).
export function monthRows(store, month) {
  const { people, draft, state } = computedRows(store, month), typed = edits(store, month), names = new Map(state.employees.map(e => [e.id, e.name]));
  const zero = id => ({ employeeId: id, name: names.get(id) || id, tin: profile(store, id, 'government').tin || '', ...Object.fromEntries(ROW_FIELDS.map(k => [k, 0])), exempt: false, nonTaxable: 0, taxable: 0, netTaxable: 0 });
  const all = new Map(people.map(p => [p.employeeId, p]));
  for (const id of typed.keys()) if (!all.has(id)) all.set(id, zero(id));
  const rows = [...all.values()].map(p => {
    const e = typed.get(p.employeeId); if (!e) return p;
    const values = Object.fromEntries(ROW_FIELDS.filter(k => e.values?.[k] != null).map(k => [k, r2(e.values[k])]));
    return { ...derive({ ...p, ...values }), computed: Object.fromEntries(Object.keys(values).map(k => [k, p[k]])), edited: { by: e.by, at: e.at, reason: e.reason } };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { rows, draft };
}
const sum = (rows, k) => r2(rows.reduce((s, r) => s + (r[k] || 0), 0));
// Part II items 14-36 from the rows and the return's own entries.
export function items(rows, ret = {}) {
  const v = k => r2(ret[k] || 0), i = {};
  i[14] = sum(rows, 'compensation'); i[15] = sum(rows, 'mweBasic'); i[16] = sum(rows, 'mwePremiums'); i[17] = sum(rows, 'thirteenth'); i[18] = sum(rows, 'deMinimis'); i[19] = sum(rows, 'contributions'); i[20] = sum(rows, 'otherNonTaxable');
  i[21] = r2(i[15] + i[16] + i[17] + i[18] + i[19] + i[20]); i[22] = r2(i[14] - i[21]); i[23] = sum(rows, 'notSubject'); i[24] = r2(i[22] - i[23]);
  i[25] = sum(rows, 'taxWithheld'); i[26] = r2((ret.adjustmentSign === 'less' ? -1 : 1) * v('adjustment')); i[27] = r2(i[25] + i[26]);
  i[28] = v('previouslyRemitted'); i[29] = v('otherRemittances'); i[30] = r2(i[28] + i[29]); i[31] = r2(i[27] - i[30]);
  i[32] = v('surcharge'); i[33] = v('interest'); i[34] = v('compromise'); i[35] = r2(i[32] + i[33] + i[34]); i[36] = r2(i[31] + i[35]);
  return i;
}
export const ITEM_LABELS = { 14: 'Total amount of compensation', 15: 'Statutory minimum wage (for minimum wage earners)', 16: 'Holiday pay, overtime pay, night shift differential, hazard pay (MWEs only)', 17: '13th month pay and other benefits', 18: 'De minimis benefits', 19: 'SSS, GSIS, PHIC, HDMF mandatory contributions & union dues (employee share)', 20: 'Other non-taxable compensation', 21: 'Total non-taxable compensation (15 to 20)', 22: 'Total taxable compensation (14 less 21)', 23: 'Less: taxable compensation not subject to withholding tax (₱250,000 & below a year, other than MWEs)', 24: 'Net taxable compensation (22 less 23)', 25: 'Total taxes withheld', 26: 'Add / (less): adjustment of taxes withheld from previous month(s)', 27: 'Taxes withheld for remittance (25 and 26)', 28: 'Less: tax remitted in return previously filed (amended return)', 29: 'Other remittances made', 30: 'Total tax remittances made (28 and 29)', 31: 'Tax still due / (over-remittance) (27 less 30)', 32: 'Surcharge', 33: 'Interest', 34: 'Compromise', 35: 'Total penalties (32 to 34)', 36: 'TOTAL AMOUNT STILL DUE / (over-remittance) (31 and 35)' };

// Deadline: manual filing on the 10th of the following month; eFPS groups A-E on the 15th-11th; December by January 15.
const EFPS_DAY = { A: 15, B: 14, C: 13, D: 12, E: 11 };
export function dueDate(month, efpsGroup = '') {
  const [y, m] = month.split('-').map(Number), next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${next}-${String(m === 12 ? 15 : EFPS_DAY[efpsGroup] || 10).padStart(2, '0')}`;
}
const AGENT_DEFAULTS = { tin: '', rdo: '', name: '', address: '', zip: '', contact: '', email: '', category: 'Private', efpsGroup: '' };
function agentInfo(store) { const saved = readReturn(store, 'agent') || {}, c = readSettings(store).company; return { ...AGENT_DEFAULTS, name: c.name || '', ...saved }; }
const defaultReturn = month => ({ month, status: 'draft', amended: false, adjustment: 0, adjustmentSign: 'add', previouslyRemitted: 0, otherRemittances: 0, otherRemittancesNote: '', surcharge: 0, interest: 0, compromise: 0, taxRelief: false, sheets: 0, filedOn: '', confirmationNo: '', paymentDate: '', paymentRef: '', paymentChannel: '', remarks: '', history: [] });

export function month1601c(store, actor, monthInput) {
  permit(actor, VIEW_ROLES);
  const month = MONTH.parse(monthInput || localToday().slice(0, 7));
  ensure(store);
  const ret = { ...defaultReturn(month), ...(readReturn(store, month) || {}) }, agent = agentInfo(store);
  const live = ret.status === 'filed' && ret.snapshot ? { rows: ret.snapshot.rows, draft: false } : monthRows(store, month);
  return { month, monthName: monthName(month), dueDate: dueDate(month, agent.efpsGroup), today: localToday(), agent, return: ret, rows: live.rows, draft: live.draft, items: ret.status === 'filed' && ret.snapshot ? ret.snapshot.items : items(live.rows, ret), canEdit: EDIT_ROLES.includes(actor.role) && ret.status !== 'filed', canReopen: actor.role === 'admin' && ret.status === 'filed', fields: ROW_FIELDS, labels: ROW_LABELS, itemLabels: ITEM_LABELS };
}
// Monitoring: the 12 months of a year with status, deadline and amounts.
export function year1601c(store, actor, yearInput) {
  permit(actor, VIEW_ROLES);
  const year = /^\d{4}$/.test(String(yearInput || '')) ? String(yearInput) : localToday().slice(0, 4), today = localToday(), agent = agentInfo(store);
  ensure(store);
  return { year, months: Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`, ret = readReturn(store, month), filed = ret?.status === 'filed', due = dueDate(month, agent.efpsGroup);
    const future = month > today.slice(0, 7);
    const figures = filed && ret.snapshot ? ret.snapshot.items : future ? null : items(monthRows(store, month).rows, ret || {});
    return { month, name: monthName(month), due, status: filed ? 'filed' : future ? 'upcoming' : today > due ? 'overdue' : 'open', filedOn: ret?.filedOn || '', confirmationNo: ret?.confirmationNo || '', employees: filed ? ret.snapshot.rows.length : null, compensation: figures?.[14] ?? null, taxWithheld: figures?.[25] ?? null, amountDue: figures?.[36] ?? null, amended: !!ret?.amended };
  }) };
}

const rowSchema = z.object({ employeeId: z.string().trim().min(1).max(40), month: MONTH, values: z.object(Object.fromEntries(ROW_FIELDS.map(k => [k, amount.optional()]))).strict().default({}), reason: z.string().trim().max(500).default('') }).strict();
const assertOpen = (store, month) => { if (readReturn(store, month)?.status === 'filed') throw new AppError('This month is already filed. An administrator must reopen it before figures change.'); };
// Save (or clear, when every box is blank) one employee's figures for one month.
export function saveRow(store, actor, input) {
  permit(actor, EDIT_ROLES);
  const v = rowSchema.parse(input), values = Object.fromEntries(ROW_FIELDS.filter(k => v.values[k] != null).map(k => [k, r2(v.values[k])]));
  ensure(store);
  return store.transaction(() => {
    assertOpen(store, v.month);
    if (!store.read().employees.some(e => e.id === v.employeeId)) throw new AppError('Employee not found.', 404);
    const before = JSON.parse(store.db.prepare('SELECT data FROM bir1601c_edits WHERE employee_id=? AND month=?').get(v.employeeId, v.month)?.data ?? 'null');
    if (!Object.keys(values).length) {
      store.db.prepare('DELETE FROM bir1601c_edits WHERE employee_id=? AND month=?').run(v.employeeId, v.month);
      store.log(actor, 'clear-1601c-row', 'bir1601c', `${v.employeeId}:${v.month}`, before, null);
      return { cleared: true };
    }
    if (v.reason.length < 3) throw new AppError('Give the reason for the typed figures (e.g. de minimis benefits paid outside payroll).');
    const after = { employeeId: v.employeeId, month: v.month, values, reason: v.reason, by: actor.username, at: new Date().toISOString() };
    store.db.prepare('INSERT INTO bir1601c_edits VALUES(?,?,?) ON CONFLICT(employee_id, month) DO UPDATE SET data=excluded.data').run(v.employeeId, v.month, JSON.stringify(after));
    store.log(actor, 'edit-1601c-row', 'bir1601c', `${v.employeeId}:${v.month}`, before, after);
    return after;
  });
}
const money = z.coerce.number().min(0, 'Amounts cannot be negative.').max(1e9);
const returnSchema = z.object({
  month: MONTH, amended: z.boolean().default(false), adjustment: money.default(0), adjustmentSign: z.enum(['add', 'less']).default('add'), previouslyRemitted: money.default(0), otherRemittances: money.default(0),
  otherRemittancesNote: z.string().trim().max(200).default(''), surcharge: money.default(0), interest: money.default(0), compromise: money.default(0), taxRelief: z.boolean().default(false), sheets: z.coerce.number().int().min(0).max(99).default(0), remarks: z.string().trim().max(1000).default(''),
  agent: z.object({ tin: z.string().trim().max(20).regex(/^[\d-]*$/, 'TIN: digits and dashes only.'), rdo: z.string().trim().max(5), name: z.string().trim().max(200), address: z.string().trim().max(300), zip: z.string().trim().max(10), contact: z.string().trim().max(40), email: z.union([z.literal(''), z.string().trim().email('Enter a valid email address.').max(120)]), category: z.enum(['Private', 'Government']), efpsGroup: z.enum(['', 'A', 'B', 'C', 'D', 'E']) }).strict().optional(),
}).strict();
export function saveReturn(store, actor, input) {
  permit(actor, EDIT_ROLES);
  const v = returnSchema.parse(input);
  ensure(store);
  return store.transaction(() => {
    assertOpen(store, v.month);
    const before = readReturn(store, v.month), base = { ...defaultReturn(v.month), ...(before || {}) };
    const { agent, ...entries } = v, after = { ...base, ...entries, updatedBy: actor.username, updatedAt: new Date().toISOString() };
    if (!after.amended && after.previouslyRemitted > 0) throw new AppError('Tax remitted in a previously filed return applies to amended returns only. Tick "Amended return".');
    writeReturn(store, v.month, after);
    if (agent) { const old = readReturn(store, 'agent'); writeReturn(store, 'agent', agent); store.log(actor, 'update-1601c-agent', 'bir1601c', 'agent', old, agent); }
    store.log(actor, 'update-1601c-return', 'bir1601c', v.month, before && { ...before, snapshot: undefined }, { ...after, snapshot: undefined });
    return after;
  });
}
const fileSchema = z.object({ month: MONTH, filedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date filed.'), confirmationNo: z.string().trim().min(3, 'Enter the filing reference (eFPS / eBIRForms confirmation or TRA number).').max(80), paymentDate: z.union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).default(''), paymentRef: z.string().trim().max(80).default(''), paymentChannel: z.string().trim().max(80).default('') }).strict();
// Marks the month filed: the rows and Part II as they stand are kept as the filed return.
export function fileReturn(store, actor, input) {
  permit(actor, EDIT_ROLES);
  const v = fileSchema.parse(input);
  if (v.filedOn > localToday()) throw new AppError('The filing date cannot be in the future.');
  ensure(store);
  return store.transaction(() => {
    assertOpen(store, v.month);
    const before = readReturn(store, v.month), base = { ...defaultReturn(v.month), ...(before || {}) }, { rows, draft } = monthRows(store, v.month);
    if (draft && !rows.length) throw new AppError('There is no payroll or typed figure for this month yet.');
    const at = new Date().toISOString(), snapshot = { rows, items: items(rows, base), fromDraftPayroll: draft, at };
    const after = { ...base, ...v, status: 'filed', filedBy: actor.username, filedAt: at, snapshot, history: [...base.history, { at, by: actor.username, action: 'filed', note: v.confirmationNo }] };
    writeReturn(store, v.month, after);
    store.log(actor, 'file-1601c', 'bir1601c', v.month, null, { month: v.month, filedOn: v.filedOn, confirmationNo: v.confirmationNo, taxWithheld: snapshot.items[25], amountDue: snapshot.items[36], employees: rows.length });
    return after;
  });
}
export function reopenReturn(store, actor, input) {
  permit(actor, ['admin']);
  const v = z.object({ month: MONTH, reason: z.string().trim().min(5, 'Give the reason for reopening (e.g. amended return).').max(500) }).strict().parse(input);
  ensure(store);
  return store.transaction(() => {
    const before = readReturn(store, v.month);
    if (before?.status !== 'filed') throw new AppError('This month is not filed.');
    const at = new Date().toISOString(), after = { ...before, status: 'draft', previousFilings: [...(before.previousFilings || []), { filedOn: before.filedOn, confirmationNo: before.confirmationNo, snapshot: before.snapshot }], snapshot: null, history: [...before.history, { at, by: actor.username, action: 'reopened', note: v.reason }] };
    writeReturn(store, v.month, after);
    store.log(actor, 'reopen-1601c', 'bir1601c', v.month, { status: 'filed', confirmationNo: before.confirmationNo }, { status: 'draft', reason: v.reason });
    return after;
  });
}
