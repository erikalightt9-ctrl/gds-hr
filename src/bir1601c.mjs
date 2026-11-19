// BIR Form 1601-C: Monthly Remittance Return of Income Taxes Withheld on Compensation.
// One return per taxable month (YYYY-MM). Its employee lines are generated from the posted payroll whose cutoff starts
// in that month (gross compensation, 13th month, employee SSS / PhilHealth / Pag-IBIG shares, tax withheld) and can be
// encoded or edited by Payroll / HR before filing. The return items follow the form (items 14 to 36):
//   14 total compensation · 15-20 non-taxable (MWE basic, MWE holiday/OT/NSD/hazard, 13th month & other benefits,
//   de minimis, employee contributions & union dues, other) · 21 total non-taxable · 22 total taxable · 23 taxable
//   compensation not subject to withholding · 24 net taxable · 25 total taxes withheld · 26 adjustment from previous
//   months · 27 taxes withheld for remittance · 28 tax remitted in the return previously filed (amended return) · 29 other
//   remittances · 30 total remittances · 31 tax still due · 32-34 surcharge, interest, compromise · 35 total penalties ·
//   36 total amount still due.
// Due date: the 10th of the following month (the December return: January 15). A filed return is locked; an
// administrator can reopen it (for an amended return) with a reason. Every change is audited.
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { readSettings } from './hr201.mjs';
import { formattedWorkbook } from './export.mjs';

export const BIR_EDIT = ['admin', 'hr', 'payroll'], BIR_VIEW = [...BIR_EDIT, 'viewer'];
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = ym => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose the taxable month (YYYY-MM).');
export const LINE_FIELDS = ['gross', 'mweBasic', 'mweOther', 'thirteenth', 'deMinimis', 'contributions', 'otherNonTaxable', 'notSubject', 'taxWithheld'];
export const LINE_LABELS = { gross: 'Total compensation', mweBasic: 'Statutory minimum wage (MWE)', mweOther: 'MWE holiday / OT / NSD / hazard pay', thirteenth: '13th month & other benefits', deMinimis: 'De minimis benefits', contributions: 'SSS / PhilHealth / Pag-IBIG (employee share) & union dues', otherNonTaxable: 'Other non-taxable compensation', notSubject: 'Taxable compensation not subject to withholding', taxWithheld: 'Tax withheld' };
const NON_TAXABLE = ['mweBasic', 'mweOther', 'thirteenth', 'deMinimis', 'contributions', 'otherNonTaxable'];

const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS bir_1601c (month TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL)');
const load = (store, month) => { ensure(store); const row = store.db.prepare('SELECT data FROM bir_1601c WHERE month=?').get(month); return row ? JSON.parse(row.data) : null; };
const save = (store, value) => store.db.prepare('INSERT INTO bir_1601c(month,status,data) VALUES(?,?,?) ON CONFLICT(month) DO UPDATE SET status=excluded.status, data=excluded.data').run(value.month, value.status, JSON.stringify(value));
export function dueDate(month) {
  const [y, m] = month.split('-').map(Number), next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return `${next}-${m === 12 ? '15' : '10'}`;
}
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');

// Lines from the posted payroll of that month (cutoffs that start in the month), one per employee.
export function payrollLines(store, month, state = store.read()) {
  const byEmployee = new Map();
  for (const run of state.runs.filter(r => r.status === 'posted' && r.start.startsWith(month))) for (const row of run.rows) {
    const line = byEmployee.get(row.employeeId) || { employeeId: row.employeeId, name: row.employeeName, gross: 0, mweBasic: 0, mweOther: 0, thirteenth: 0, deMinimis: 0, contributions: 0, otherNonTaxable: 0, notSubject: 0, taxWithheld: 0, cutoffs: [] };
    line.gross = r2(line.gross + (row.gross || 0));
    line.thirteenth = r2(line.thirteenth + (row.earnings?.thirteenth || 0));
    line.contributions = r2(line.contributions + (row.deductions?.SSS || 0) + (row.deductions?.PhilHealth || 0) + (row.deductions?.['Pag-IBIG'] || 0));
    line.taxWithheld = r2(line.taxWithheld + (row.deductions?.tax || 0));
    line.cutoffs.push(`${run.start} to ${run.end}`);
    byEmployee.set(row.employeeId, line);
  }
  return [...byEmployee.values()].map(l => ({ ...l, tin: profileOf(store, l.employeeId, 'government').tin || '', source: 'payroll', edited: false })).sort((a, b) => a.name.localeCompare(b.name));
}
const lineTaxable = l => Math.max(0, r2(l.gross - NON_TAXABLE.reduce((s, k) => s + (l[k] || 0), 0)));
// Items 14-36 of the return from its lines and return-level amounts.
export function computeItems(ret) {
  const sum = k => r2(ret.lines.reduce((s, l) => s + (l[k] || 0), 0)), a = ret.amounts || {};
  const i = { 14: sum('gross'), 15: sum('mweBasic'), 16: sum('mweOther'), 17: sum('thirteenth'), 18: sum('deMinimis'), 19: sum('contributions'), 20: sum('otherNonTaxable') };
  i[21] = r2(i[15] + i[16] + i[17] + i[18] + i[19] + i[20]);
  i[22] = Math.max(0, r2(i[14] - i[21]));
  i[23] = sum('notSubject');
  i[24] = Math.max(0, r2(i[22] - i[23]));
  i[25] = sum('taxWithheld');
  i[26] = r2(a.adjustment || 0);
  i[27] = r2(i[25] + i[26]);
  i[28] = r2(a.previouslyRemitted || 0);
  i[29] = r2(a.otherRemittances || 0);
  i[30] = r2(i[28] + i[29]);
  i[31] = r2(i[27] - i[30]);
  i[32] = r2(a.surcharge || 0); i[33] = r2(a.interest || 0); i[34] = r2(a.compromise || 0);
  i[35] = r2(i[32] + i[33] + i[34]);
  i[36] = r2(i[31] + i[35]);
  return i;
}
export const ITEM_LABELS = { 14: 'Total amount of compensation', 15: 'Statutory minimum wage for minimum wage earners (MWEs)', 16: 'Holiday pay, overtime pay, night shift differential pay, hazard pay (for MWEs only)', 17: '13th month pay and other benefits', 18: 'De minimis benefits', 19: 'SSS, GSIS, PHIC, HDMF mandatory contributions & union dues (employee\'s share only)', 20: 'Other non-taxable compensation', 21: 'Total non-taxable compensation (sum of items 15 to 20)', 22: 'Total taxable compensation (item 14 less item 21)', 23: 'Less: taxable compensation not subject to withholding tax', 24: 'Net taxable compensation (item 22 less item 23)', 25: 'Total taxes withheld', 26: 'Add/(less): adjustment of taxes withheld from previous month/s', 27: 'Taxes withheld for remittance (sum of items 25 and 26)', 28: 'Less: tax remitted in return previously filed, if this is an amended return', 29: 'Other remittances made', 30: 'Total tax remittances made (sum of items 28 and 29)', 31: 'Tax still due / (over-remittance) (item 27 less item 30)', 32: 'Surcharge', 33: 'Interest', 34: 'Compromise', 35: 'Total penalties (sum of items 32 to 34)', 36: 'Total amount still due / (over-remittance) (sum of items 31 and 35)' };

function decorate(store, ret, month) {
  const payroll = payrollLines(store, month), payrollTax = r2(payroll.reduce((s, l) => s + l.taxWithheld, 0)), payrollGross = r2(payroll.reduce((s, l) => s + l.gross, 0));
  const items = computeItems(ret), due = dueDate(month), today = localToday();
  return { ...ret, lines: ret.lines.map(l => ({ ...l, taxable: lineTaxable(l) })), items, dueDate: due, overdue: ret.status !== 'filed' && today > due, reconciliation: { payrollGross, payrollTax, differenceGross: r2(items[14] - payrollGross), differenceTax: r2(items[25] - payrollTax) } };
}
const header = (store, previous) => ({ agentName: readSettings(store).company.name, tin: previous?.header?.tin || '', rdoCode: previous?.header?.rdoCode || '', category: previous?.header?.category || 'Private', amended: false });
const previousReturn = (store, month) => { ensure(store); const row = store.db.prepare('SELECT data FROM bir_1601c WHERE month<? ORDER BY month DESC LIMIT 1').get(month); return row ? JSON.parse(row.data) : null; };

// The return for a month: the saved one, or an unsaved preview from posted payroll.
export function birReturn(store, actor, monthInput) {
  permit(actor, BIR_VIEW);
  const month = monthSchema.parse(String(monthInput || ''));
  const saved = load(store, month);
  const ret = saved || { month, status: 'not started', header: header(store, previousReturn(store, month)), lines: payrollLines(store, month), amounts: {}, filing: {}, history: [] };
  return { ...decorate(store, ret, month), saved: !!saved, canEdit: BIR_EDIT.includes(actor.role) && ret.status !== 'filed', canReopen: actor.role === 'admin' && ret.status === 'filed' };
}
// Twelve months of a year with status, totals and due dates (monitoring).
export function birYear(store, actor, yearInput) {
  permit(actor, BIR_VIEW);
  const year = /^\d{4}$/.test(String(yearInput)) ? String(yearInput) : localToday().slice(0, 4);
  return { year, months: Array.from({ length: 12 }, (_, i) => {
    const r = birReturn(store, actor, `${year}-${String(i + 1).padStart(2, '0')}`);
    return { month: r.month, status: r.status, saved: r.saved, employees: r.lines.length, compensation: r.items[14], taxable: r.items[22], taxWithheld: r.items[25], stillDue: r.items[36], dueDate: r.dueDate, overdue: r.overdue && r.lines.length > 0, dateFiled: r.filing?.dateFiled || '', referenceNo: r.filing?.referenceNo || '', payrollTax: r.reconciliation.payrollTax, differenceTax: r.reconciliation.differenceTax };
  }) };
}

const money = z.number().min(-100_000_000).max(100_000_000);
const lineSchema = z.object({ employeeId: z.string().trim().min(1).max(80), name: z.string().trim().min(1).max(200), tin: z.string().trim().max(30).default(''), ...Object.fromEntries(LINE_FIELDS.map(k => [k, z.number().min(0).max(100_000_000)])) }).passthrough();
const saveSchema = z.object({
  header: z.object({ agentName: z.string().trim().min(1).max(200), tin: z.string().trim().max(30).default(''), rdoCode: z.string().trim().max(10).default(''), category: z.enum(['Private', 'Government']).default('Private'), amended: z.boolean().default(false) }).strict(),
  lines: z.array(lineSchema).max(2000),
  amounts: z.object({ adjustment: money.default(0), previouslyRemitted: z.number().min(0).max(100_000_000).default(0), otherRemittances: z.number().min(0).max(100_000_000).default(0), surcharge: z.number().min(0).max(100_000_000).default(0), interest: z.number().min(0).max(100_000_000).default(0), compromise: z.number().min(0).max(100_000_000).default(0) }).strict(),
  filing: z.object({ dateFiled: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(''), referenceNo: z.string().trim().max(80).default(''), paymentDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(''), amountPaid: z.number().min(0).max(100_000_000).default(0), bank: z.string().trim().max(120).default(''), notes: z.string().trim().max(2000).default('') }).strict().default({}),
}).strict();

// Encode / edit a draft. Lines must be one per employee; a line that differs from payroll is marked edited.
export function saveBirReturn(store, actor, monthInput, input) {
  permit(actor, BIR_EDIT);
  const month = monthSchema.parse(String(monthInput || '')), v = saveSchema.parse(input);
  const ids = v.lines.map(l => l.employeeId);
  if (new Set(ids).size !== ids.length) throw new AppError('Each employee may appear only once in the return.');
  for (const l of v.lines) if (l.notSubject > lineTaxable(l)) throw new AppError(`${l.name}: taxable compensation not subject to withholding is more than the taxable compensation.`);
  return store.transaction(() => {
    const before = load(store, month);
    if (before?.status === 'filed') throw new AppError('This return is filed and locked. An administrator can reopen it for an amended return.', 409);
    const fromPayroll = new Map(payrollLines(store, month).map(l => [l.employeeId, l]));
    const lines = v.lines.map(l => { const p = fromPayroll.get(l.employeeId), clean = Object.fromEntries(LINE_FIELDS.map(k => [k, r2(l[k])])); return { employeeId: l.employeeId, name: l.name, tin: l.tin, ...clean, cutoffs: p?.cutoffs || [], source: p ? 'payroll' : 'manual', edited: !p || LINE_FIELDS.some(k => r2(p[k]) !== clean[k]) }; });
    const now = new Date().toISOString();
    const value = { month, status: 'draft', header: v.header, lines, amounts: v.amounts, filing: v.filing, createdAt: before?.createdAt || now, createdBy: before?.createdBy || actor.username, updatedAt: now, updatedBy: actor.username, history: [...(before?.history || []), { at: now, by: actor.username, action: before ? 'edited' : 'created' }] };
    save(store, value);
    store.log(actor, before ? 'update' : 'create', 'bir-1601c', month, before ? { items: computeItems(before), lines: before.lines.length } : null, { items: computeItems(value), lines: lines.length });
    return birReturn(store, actor, month);
  });
}
// Replace the lines with a fresh copy of the posted payroll (keeps header, amounts and filing details).
export function refreshFromPayroll(store, actor, monthInput) {
  permit(actor, BIR_EDIT);
  const month = monthSchema.parse(String(monthInput || ''));
  const current = birReturn(store, actor, month);
  if (current.status === 'filed') throw new AppError('This return is filed and locked.', 409);
  const lines = payrollLines(store, month);
  if (!lines.length) throw new AppError(`There is no posted payroll in ${monthName(month)} to copy.`);
  return saveBirReturn(store, actor, month, { header: current.header, lines, amounts: current.amounts || {}, filing: current.filing || {} });
}
export function fileBirReturn(store, actor, monthInput, input) {
  permit(actor, BIR_EDIT);
  const month = monthSchema.parse(String(monthInput || ''));
  const f = z.object({ dateFiled: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date filed.'), referenceNo: z.string().trim().min(3, 'Enter the eFPS / eBIRForms reference or confirmation number.').max(80), paymentDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/).default(''), amountPaid: z.number().min(0).max(100_000_000).default(0), bank: z.string().trim().max(120).default(''), notes: z.string().trim().max(2000).default('') }).strict().parse(input);
  return store.transaction(() => {
    const ret = load(store, month);
    if (!ret) throw new AppError('Save the return first.');
    if (ret.status === 'filed') throw new AppError('This return is already filed.', 409);
    if (!ret.header.tin) throw new AppError('Enter the withholding agent TIN before filing.');
    if (!ret.lines.length) throw new AppError('The return has no employee lines.');
    const now = new Date().toISOString(), value = { ...ret, status: 'filed', filing: { ...ret.filing, ...f }, filedAt: now, filedBy: actor.username, history: [...(ret.history || []), { at: now, by: actor.username, action: 'filed', detail: f.referenceNo }] };
    save(store, value);
    store.log(actor, 'file', 'bir-1601c', month, { status: ret.status }, { status: 'filed', ...f, items: computeItems(value) });
    return birReturn(store, actor, month);
  });
}
export function reopenBirReturn(store, actor, monthInput, input) {
  permit(actor, ['admin']);
  const month = monthSchema.parse(String(monthInput || ''));
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Give the reason for reopening (e.g. amended return).').max(500) }).strict().parse(input);
  return store.transaction(() => {
    const ret = load(store, month);
    if (ret?.status !== 'filed') throw new AppError('Only a filed return can be reopened.');
    const now = new Date().toISOString(), items = computeItems(ret);
    // An amended return starts with the tax already remitted under the original return (item 28).
    const value = { ...ret, status: 'draft', header: { ...ret.header, amended: true }, amounts: { ...ret.amounts, previouslyRemitted: r2(items[27] - (ret.amounts?.otherRemittances || 0)) }, previousFiling: [...(ret.previousFiling || []), ret.filing], filing: {}, history: [...(ret.history || []), { at: now, by: actor.username, action: 'reopened', detail: reason }] };
    save(store, value);
    store.log(actor, 'reopen', 'bir-1601c', month, { status: 'filed' }, { status: 'draft', reason });
    return birReturn(store, actor, month);
  });
}

// ---------- Excel ----------
// Month: employee lines with formulas (non-taxable, taxable, totals) and the return items linked to those totals.
function monthSheets(ret) {
  const head = ['#', 'Employee ID', 'Employee name', 'TIN', ...LINE_FIELDS.slice(0, 7).map(k => LINE_LABELS[k]), 'Total non-taxable', 'Taxable compensation', LINE_LABELS.notSubject, 'Net taxable', LINE_LABELS.taxWithheld, 'Source', 'Cutoffs'];
  const first = 5, last = first + Math.max(ret.lines.length, 1) - 1;   // data rows (1-based)
  const rows = [[{ v: `BIR Form 1601-C · ${monthName(ret.month)}`, s: 'title' }], [{ v: `${ret.header.agentName} · TIN ${ret.header.tin || '—'} · RDO ${ret.header.rdoCode || '—'} · Status: ${ret.status}${ret.header.amended ? ' (amended)' : ''}`, s: 'note' }], [{ v: `Due ${ret.dueDate}${ret.filing?.dateFiled ? ` · Filed ${ret.filing.dateFiled} · Ref ${ret.filing.referenceNo}` : ''}`, s: 'note' }], head];
  ret.lines.forEach((l, i) => {
    const n = first + i;
    rows.push([i + 1, l.employeeId, l.name, l.tin, l.gross, l.mweBasic, l.mweOther, l.thirteenth, l.deMinimis, l.contributions, l.otherNonTaxable, { f: `SUM(F${n}:K${n})` }, { f: `MAX(0,E${n}-L${n})` }, l.notSubject, { f: `MAX(0,M${n}-N${n})` }, l.taxWithheld, l.source === 'payroll' ? (l.edited ? 'Payroll (edited)' : 'Payroll') : 'Encoded', (l.cutoffs || []).join('; ')]);
  });
  if (!ret.lines.length) rows.push(['', '', 'No employee lines', '']);
  const total = last + 1, sum = c => ({ f: `SUM(${c}${first}:${c}${last})`, s: 'total' });
  rows.push(['', '', { v: 'TOTAL', s: 'bold' }, '', ...['E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'].map(sum), '', '']);
  const E = `'Employees'!`, a = ret.amounts || {};
  const itemRows = [[{ v: `BIR Form 1601-C · ${monthName(ret.month)} · Return items`, s: 'title' }], [{ v: 'Items 14-25 come from the Employees sheet totals; change the employee lines there.', s: 'note' }], ['Item', 'Description', 'Amount']];
  const ref = { 14: `${E}E${total}`, 15: `${E}F${total}`, 16: `${E}G${total}`, 17: `${E}H${total}`, 18: `${E}I${total}`, 19: `${E}J${total}`, 20: `${E}K${total}` };
  const at = item => `C${item - 14 + 4}`;
  const formula = { ...ref, 21: `SUM(${at(15)}:${at(20)})`, 22: `MAX(0,${at(14)}-${at(21)})`, 23: `${E}N${total}`, 24: `MAX(0,${at(22)}-${at(23)})`, 25: `${E}P${total}`, 27: `${at(25)}+${at(26)}`, 30: `${at(28)}+${at(29)}`, 31: `${at(27)}-${at(30)}`, 35: `SUM(${at(32)}:${at(34)})`, 36: `${at(31)}+${at(35)}` };
  const typed = { 26: a.adjustment || 0, 28: a.previouslyRemitted || 0, 29: a.otherRemittances || 0, 32: a.surcharge || 0, 33: a.interest || 0, 34: a.compromise || 0 };
  for (let item = 14; item <= 36; item++) itemRows.push([item, ITEM_LABELS[item], item in typed ? typed[item] : { f: formula[item], s: [21, 22, 24, 27, 31, 36].includes(item) ? 'total' : undefined }]);
  return [
    { name: 'Employees', rows, header: 3, money: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], widths: [5, 14, 30, 16, 14, 14, 14, 14, 12, 16, 14, 14, 14, 14, 14, 14, 16, 34] },
    { name: 'Return items', rows: itemRows, header: 2, money: [2], widths: [8, 78, 18] },
  ];
}
export function birMonthWorkbook(store, actor, month) {
  const ret = birReturn(store, actor, month);
  store.log(actor, 'export', 'bir-1601c', ret.month, null, { format: 'xlsx', status: ret.status });
  return { filename: `BIR-1601C-${ret.month}.xlsx`, body: formattedWorkbook(monthSheets(ret)) };
}
// Year: one summary row per month (with totals) and each month's employee lines on its own sheet.
export function birYearWorkbook(store, actor, year) {
  const y = birYear(store, actor, year), rows = [[{ v: `BIR Form 1601-C · ${y.year} monitoring`, s: 'title' }], [{ v: `${readSettings(store).company.name} · Generated ${localToday()}`, s: 'note' }], ['Taxable month', 'Status', 'Employees', 'Total compensation (14)', 'Total taxable (22)', 'Taxes withheld (25)', 'Amount still due (36)', 'Payroll tax withheld', 'Difference vs payroll', 'Due date', 'Date filed', 'Reference no.']];
  y.months.forEach((m, i) => { const n = i + 4; rows.push([monthName(m.month), m.status, m.employees, m.compensation, m.taxable, m.taxWithheld, m.stillDue, m.payrollTax, { f: `F${n}-H${n}` }, m.dueDate, m.dateFiled, m.referenceNo]); });
  rows.push([{ v: 'TOTAL', s: 'bold' }, '', { f: 'SUM(C4:C15)', s: 'bold' }, ...['D', 'E', 'F', 'G', 'H', 'I'].map(c => ({ f: `SUM(${c}4:${c}15)`, s: 'total' })), '', '', '']);
  const sheets = [{ name: `Summary ${y.year}`, rows, header: 2, money: [3, 4, 5, 6, 7, 8], widths: [18, 12, 11, 20, 18, 18, 18, 18, 18, 12, 12, 22] }];
  for (const m of y.months.filter(x => x.employees)) {
    const [emp] = monthSheets(birReturn(store, actor, m.month));
    sheets.push({ ...emp, name: MONTHS[Number(m.month.slice(5)) - 1] });
  }
  store.log(actor, 'export', 'bir-1601c', y.year, null, { format: 'xlsx', year: y.year });
  return { filename: `BIR-1601C-${y.year}.xlsx`, body: formattedWorkbook(sheets) };
}
