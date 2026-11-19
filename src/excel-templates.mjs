// Excel report templates for administrative, HR, accounting and operational reporting, and a library of maintained
// (uploaded, edited) report files. Each template is filled with the current records the role may see, with frozen,
// shaded headings, filters on every column, Excel formulas for computed columns and totals, and peso formatting.
// Templates reuse the system's records; they do not store a second copy of any data. Uploaded files are kept as
// versions per template and period (nothing is overwritten) and every download, upload and removal is audited.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, permit } from './service.mjs';
import { localToday } from './profiles.mjs';
import { readSettings } from './hr201.mjs';
import { leaveBalance } from './engine.mjs';
import { formattedWorkbook, colName } from './export.mjs';
import { readSpreadsheet } from './xlsx-read.mjs';
import { birMonthWorkbook, monthName } from './bir1601c.mjs';
import { disciplinaryRegister, DISCIPLINE_VIEW } from './discipline.mjs';
import { HR_TEAM } from './roles.mjs';

const PAY = ['admin', 'hr', 'payroll'], MANAGEMENT = ['admin', 'hr', 'viewer'];
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const monthOf = p => (/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month || '') ? p.month : localToday().slice(0, 7));
const yearOf = p => (/^\d{4}$/.test(p.year || '') ? p.year : localToday().slice(0, 4));
const yearsBetween = (from, to) => { if (!from) return ''; const a = new Date(`${from}T00:00:00Z`), b = new Date(`${to}T00:00:00Z`); let y = b.getUTCFullYear() - a.getUTCFullYear(); if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--; return Math.max(0, y); };
const active = state => state.employees.filter(e => !e.draft && !e.archived);
// A titled sheet: title, subtitle, a blank line, headings (row 4), data rows, then a totals row of SUM formulas.
function sheet(name, title, subtitle, headers, rows, { money = [], sum = [], count = false, widths } = {}) {
  const first = 5, last = first + Math.max(rows.length, 1) - 1, out = [[{ v: title, s: 'title' }], [{ v: subtitle, s: 'note' }], [], headers, ...(rows.length ? rows : [['No records']])];
  if (sum.length || count) out.push(headers.map((_, c) => (c === 0 ? { v: count ? `TOTAL (${rows.length})` : 'TOTAL', s: 'bold' } : sum.includes(c) ? { f: `SUM(${colName(c)}${first}:${colName(c)}${last})`, s: money.includes(c) ? 'total' : 'bold' } : '')));
  return { name, rows: out, header: 3, money, widths: widths || headers.map(h => Math.min(40, Math.max(10, h.length + 2))) };
}
const subtitle = (store, extra) => `${readSettings(store).company.name} · ${extra} · Generated ${localToday()}`;

export const TEMPLATES = {
  'employee-masterlist': {
    title: 'Employee masterlist', category: 'HR', roles: [...HR_TEAM, 'viewer'], params: [],
    description: 'Every current employee with department, position, classification, status, date hired and years of service; a headcount summary by department (COUNTIF formulas).',
    build(store) {
      const state = store.read(), today = localToday();
      const rows = active(state).map(e => { const j = profileOf(store, e.id, 'employment'); return [e.id, e.name, e.department || '', j.position || '', j.classification || '', j.employmentType || '', j.status || (e.active ? 'Active' : 'Inactive'), j.dateHired || e.startDate || '', yearsBetween(j.dateHired || e.startDate, today), e.endDate || '']; });
      const list = sheet('Masterlist', 'Employee masterlist', subtitle(store, `${rows.length} employees`), ['Employee ID', 'Name', 'Department', 'Position', 'Classification', 'Employment type', 'Status', 'Date hired', 'Years of service', 'End date'], rows, { count: true, widths: [14, 30, 22, 26, 16, 16, 12, 12, 10, 12] });
      const depts = [...new Set(rows.map(r => r[2]).filter(Boolean))].sort(), end = 4 + rows.length;
      const summary = sheet('By department', 'Headcount by department', 'Counts are formulas on the Masterlist sheet; they follow edits made there.', ['Department', 'Employees', 'Active', 'Share of total'], depts.map((d, i) => [d, { f: `COUNTIF(Masterlist!C5:C${end},A${5 + i})` }, { f: `COUNTIFS(Masterlist!C5:C${end},A${5 + i},Masterlist!G5:G${end},"Active")` }, { f: `IF(SUM(B$5:B$${4 + depts.length})=0,0,B${5 + i}/SUM(B$5:B$${4 + depts.length}))` }]), { sum: [1, 2], widths: [30, 12, 12, 14] });
      return [list, summary];
    },
  },
  'leave-utilization': {
    title: 'Leave utilization', category: 'HR', roles: ['admin', 'hr', 'viewer'], params: ['year'],
    description: 'Per employee and leave type: entitlement, carry-over, used, available and utilization % (formula), with totals.',
    build(store, actor, p) {
      const state = store.read(), year = yearOf(p), day = year === localToday().slice(0, 4) ? localToday() : `${year}-12-31`, rows = [];
      for (const e of active(state)) for (const t of state.leaveTypes.filter(x => e.leaveEligibility.includes(x.id))) { const b = leaveBalance(state, e, t, day); rows.push([e.id, e.name, e.department || '', t.name, b.entitled, b.carry, b.used, null, null]); }
      rows.forEach((r, i) => { const n = 5 + i; r[7] = { f: `E${n}+F${n}-G${n}` }; r[8] = { f: `IF(E${n}+F${n}=0,0,G${n}/(E${n}+F${n}))` }; });
      return [sheet(`Leave ${year}`, `Leave utilization ${year}`, subtitle(store, `Balances as of ${day}`), ['Employee ID', 'Name', 'Department', 'Leave type', 'Entitled', 'Carry-over', 'Used / reserved', 'Available', 'Utilization'], rows, { sum: [4, 5, 6, 7], widths: [14, 28, 20, 24, 10, 11, 14, 11, 11] })];
    },
  },
  'disciplinary-register': {
    title: 'Disciplinary case register', category: 'HR', roles: DISCIPLINE_VIEW, params: ['year'], sensitive: true,
    description: 'Due process cases with status, stage dates (NTE, explanation, hearing, decision) and the approved action. Confidential.',
    build(store, actor, p) {
      const year = yearOf(p), cases = disciplinaryRegister(store, actor).filter(c => c.incidentDate.startsWith(year) || c.openedAt.startsWith(year));
      const rows = cases.map(c => [c.reference, c.employeeId, c.employeeName, c.department, c.position, c.incidentDate, c.offense, c.status, c.nteIssued || '', c.explanationReceived || '', c.hearingDate || '', c.decisionDate || '', c.action || '', c.suspensionDays || null, c.closedAt ? c.closedAt.slice(0, 10) : '']);
      const statuses = ['Pending', 'Under Investigation', 'Awaiting Explanation', 'For Evaluation', 'Resolved', 'Closed'], end = 4 + rows.length;
      return [sheet(`Cases ${year}`, `Disciplinary case register ${year}`, subtitle(store, 'CONFIDENTIAL · HR and management only'), ['Case no.', 'Employee ID', 'Employee', 'Department', 'Position', 'Incident date', 'Offense / rule', 'Status', 'NTE issued', 'Explanation received', 'Hearing', 'Decision', 'Action', 'Suspension days', 'Closed'], rows, { count: true, sum: [13], widths: [16, 13, 26, 18, 20, 12, 30, 20, 12, 14, 12, 12, 22, 10, 12] }),
        sheet('By status', 'Cases by status', 'COUNTIF formulas on the case sheet.', ['Status', 'Cases'], statuses.map((s, i) => [s, { f: `COUNTIF('Cases ${year}'!H5:H${end},A${5 + i})` }]), { sum: [1], widths: [24, 10] })];
    },
  },
  'headcount-movement': {
    title: 'Headcount movement', category: 'Administrative', roles: MANAGEMENT, params: ['year'],
    description: 'Per month: opening headcount, hires, separations and closing headcount (closing = opening + hires - separations), with turnover %.',
    build(store, actor, p) {
      const year = yearOf(p), people = store.read().employees.filter(e => !e.draft && e.startDate), rows = [];
      for (let m = 1; m <= 12; m++) {
        const ym = `${year}-${String(m).padStart(2, '0')}`, start = `${ym}-01`, n = 4 + m;
        const opening = people.filter(e => e.startDate < start && (!e.endDate || e.endDate >= start)).length;
        rows.push([monthName(ym), m === 1 ? opening : { f: `E${n - 1}` }, people.filter(e => e.startDate.startsWith(ym)).length, people.filter(e => e.endDate && e.endDate.startsWith(ym)).length, { f: `B${n}+C${n}-D${n}` }, { f: `IF((B${n}+E${n})=0,0,D${n}/((B${n}+E${n})/2))` }]);
      }
      return [sheet(`Headcount ${year}`, `Headcount movement ${year}`, subtitle(store, 'Hires by start date, separations by end date'), ['Month', 'Opening', 'Hires', 'Separations', 'Closing', 'Turnover'], rows, { sum: [2, 3], widths: [18, 10, 10, 12, 10, 10] })];
    },
  },
  'payroll-journal': {
    title: 'Payroll journal entry', category: 'Accounting', roles: PAY, params: ['month'], sensitive: true,
    description: 'Accounting summary of the posted payroll of a month per cutoff: salaries and employer contributions (debit); contributions, withholding tax, loans, other deductions and net pay payable (credit); debit = credit check.',
    build(store, actor, p) {
      const month = monthOf(p), runs = store.read().runs.filter(r => r.status === 'posted' && r.start.startsWith(month)).sort((a, b) => a.start.localeCompare(b.start));
      const acc = runs.map(run => { const s = k => r2(run.rows.reduce((t, r) => t + (k(r) || 0), 0)); return { cutoff: `${run.start} to ${run.end}`, gross: s(r => r.gross), er: s(r => r.employerTotal), sss: s(r => r.deductions.SSS + (r.employer?.SSS || 0) + (r.employer?.['SSS EC'] || 0)), phic: s(r => r.deductions.PhilHealth + (r.employer?.PhilHealth || 0)), hdmf: s(r => r.deductions['Pag-IBIG'] + (r.employer?.['Pag-IBIG'] || 0)), tax: s(r => r.deductions.tax), loans: s(r => (r.deductions.loans || 0) + (r.deductions.sssLoan || 0) + (r.deductions.pagibigLoan || 0) + (r.deductions.salaryDeduction || 0)), other: s(r => r.totalDeductions - r.deductions.SSS - r.deductions.PhilHealth - r.deductions['Pag-IBIG'] - r.deductions.tax - (r.deductions.loans || 0) - (r.deductions.sssLoan || 0) - (r.deductions.pagibigLoan || 0) - (r.deductions.salaryDeduction || 0)), net: s(r => r.net) }; });
      const lines = [['Salaries and wages expense', 'gross', 'Debit'], ['Employer contributions expense (SSS, EC, PhilHealth, Pag-IBIG)', 'er', 'Debit'], ['SSS payable (EE + ER + EC)', 'sss', 'Credit'], ['PhilHealth payable (EE + ER)', 'phic', 'Credit'], ['Pag-IBIG payable (EE + ER)', 'hdmf', 'Credit'], ['Withholding tax on compensation payable', 'tax', 'Credit'], ['Loans receivable / payable', 'loans', 'Credit'], ['Other deductions', 'other', 'Credit'], ['Salaries payable (net pay)', 'net', 'Credit']];
      const headers = ['Account', 'Side', ...acc.map(a => a.cutoff), 'Month total'], last = 1 + acc.length;
      const rows = lines.map(([label, key, side], i) => [label, side, ...acc.map(a => a[key]), { f: acc.length ? `SUM(C${5 + i}:${colName(last)}${5 + i})` : '0' }]);
      const n = 5 + lines.length, col = colName(last + 1);
      rows.push(['Total debit', '', ...acc.map((_, i) => ({ f: `SUMIF($B$5:$B$${n - 1},"Debit",${colName(2 + i)}5:${colName(2 + i)}${n - 1})`, s: 'total' })), { f: `SUMIF($B$5:$B$${n - 1},"Debit",${col}5:${col}${n - 1})`, s: 'total' }]);
      rows.push(['Total credit', '', ...acc.map((_, i) => ({ f: `SUMIF($B$5:$B$${n - 1},"Credit",${colName(2 + i)}5:${colName(2 + i)}${n - 1})`, s: 'total' })), { f: `SUMIF($B$5:$B$${n - 1},"Credit",${col}5:${col}${n - 1})`, s: 'total' }]);
      rows.push(['Difference (should be 0.00)', '', ...acc.map((_, i) => ({ f: `${colName(2 + i)}${n}-${colName(2 + i)}${n + 1}`, s: 'total' })), { f: `${col}${n}-${col}${n + 1}`, s: 'total' }]);
      return [sheet(`Journal ${month}`, `Payroll journal entry · ${monthName(month)}`, subtitle(store, `${runs.length} posted cutoff${runs.length === 1 ? '' : 's'}`), headers, rows, { money: headers.map((_, i) => i).filter(i => i >= 2), widths: [52, 8, ...acc.map(() => 24), 16] })];
    },
  },
  'payroll-cost-department': {
    title: 'Payroll cost by department', category: 'Accounting', roles: ['admin', 'hr', 'payroll', 'viewer'], params: ['year'], sensitive: true,
    description: 'Posted payroll for a year by department and month: gross pay, employer contributions and total cost (formula), with totals.',
    build(store, actor, p) {
      const year = yearOf(p), state = store.read(), deptOf = id => state.employees.find(e => e.id === id)?.department || 'Unassigned', sums = new Map();
      for (const run of state.runs.filter(r => r.status === 'posted' && r.start.startsWith(year))) for (const r of run.rows) {
        const key = `${run.start.slice(0, 7)}|${deptOf(r.employeeId)}`, x = sums.get(key) || { gross: 0, er: 0, people: new Set() };
        x.gross = r2(x.gross + r.gross); x.er = r2(x.er + (r.employerTotal || 0)); x.people.add(r.employeeId); sums.set(key, x);
      }
      const rows = [...sums].sort(([a], [b]) => a.localeCompare(b)).map(([key, x], i) => { const [m, d] = key.split('|'), n = 5 + i; return [monthName(m), d, x.people.size, x.gross, x.er, { f: `D${n}+E${n}` }]; });
      return [sheet(`Cost ${year}`, `Payroll cost by department ${year}`, subtitle(store, 'Posted payroll'), ['Month', 'Department', 'Employees paid', 'Gross pay', 'Employer contributions', 'Total cost'], rows, { money: [3, 4, 5], sum: [3, 4, 5], widths: [18, 26, 14, 16, 20, 16] })];
    },
  },
  'attendance-summary': {
    title: 'Monthly attendance summary', category: 'Operational', roles: MANAGEMENT, params: ['month'],
    description: 'Per employee for a month: days present, late days, late minutes, absences, approved leave days and attendance rate (formula), with totals.',
    build(store, actor, p) {
      const month = monthOf(p), state = store.read(), mins = t => { const [h, m] = String(t || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
      const rows = active(state).map(e => {
        const recs = state.attendance.filter(a => a.employeeId === e.id && a.date.startsWith(month)), present = recs.filter(a => a.status === 'present');
        const late = present.map(a => (mins(a.timeIn) !== null && mins(a.scheduledIn) !== null ? Math.max(0, mins(a.timeIn) - mins(a.scheduledIn)) : 0)).filter(x => x > 0);
        const leave = state.leaves.filter(l => l.employeeId === e.id && l.status === 'approved').reduce((s, l) => s + (l.countedDates || []).filter(d => d.startsWith(month)).length - (l.partialDates || []).filter(d => d.startsWith(month)).length * 0.5, 0);
        return [e.id, e.name, e.department || '', present.length, late.length, late.reduce((s, x) => s + x, 0), recs.filter(a => a.status === 'absent').length, leave, null];
      });
      rows.forEach((r, i) => { const n = 5 + i; r[8] = { f: `IF((D${n}+G${n})=0,0,D${n}/(D${n}+G${n}))` }; });
      return [sheet(`Attendance ${month}`, `Attendance summary · ${monthName(month)}`, subtitle(store, 'Recorded attendance and approved leave'), ['Employee ID', 'Name', 'Department', 'Days present', 'Late days', 'Late minutes', 'Absences', 'Leave days', 'Attendance rate'], rows, { sum: [3, 4, 5, 6, 7], widths: [14, 28, 20, 12, 10, 12, 10, 11, 14] })];
    },
  },
  'overtime-summary': {
    title: 'Overtime summary', category: 'Operational', roles: PAY, params: ['month'],
    description: 'Overtime filings of a month per employee: filed, approved and night-differential hours, pending and rejected counts, with totals.',
    build(store, actor, p) {
      const month = monthOf(p), state = store.read(), filings = store.db.prepare('SELECT data FROM overtime_requests WHERE date LIKE ?').all(`${month}-%`).map(r => JSON.parse(r.data)), by = new Map();
      for (const o of filings) { const x = by.get(o.employeeId) || { filed: 0, approved: 0, night: 0, pending: 0, rejected: 0 }; x.filed = r2(x.filed + (o.hours || 0)); if (o.status === 'approved') { x.approved = r2(x.approved + (o.approvedHours ?? o.hours ?? 0)); x.night = r2(x.night + (o.nightHours || 0)); } if (o.status === 'pending') x.pending++; if (o.status === 'rejected') x.rejected++; by.set(o.employeeId, x); }
      const rows = [...by].map(([id, x]) => { const e = state.employees.find(y => y.id === id); return [id, e?.name || id, e?.department || '', x.filed, x.approved, x.night, x.pending, x.rejected]; }).sort((a, b) => a[1].localeCompare(b[1]));
      return [sheet(`Overtime ${month}`, `Overtime summary · ${monthName(month)}`, subtitle(store, 'Overtime filings by work date'), ['Employee ID', 'Name', 'Department', 'Filed hours', 'Approved hours', 'Night hours (approved)', 'Pending filings', 'Rejected filings'], rows, { sum: [3, 4, 5, 6, 7], widths: [14, 28, 20, 12, 14, 18, 14, 14] })];
    },
  },
  'bir-1601c': {
    title: 'BIR Form 1601-C (monthly)', category: 'Accounting', roles: ['admin', 'hr', 'payroll', 'viewer'], params: ['month'], sensitive: true,
    description: 'The 1601-C return of a taxable month: employee compensation, non-taxable items, taxable compensation and tax withheld, and return items 14-36 as formulas. Prepared on the BIR Form 1601-C page.',
    workbook: (store, actor, p) => birMonthWorkbook(store, actor, monthOf(p)),
  },
};

export function templateList(store, actor) {
  ensure(store);
  return Object.entries(TEMPLATES).filter(([, t]) => t.roles.includes(actor.role)).map(([key, t]) => ({ key, title: t.title, category: t.category, description: t.description, params: t.params, sensitive: !!t.sensitive, canUpload: t.roles.filter(r => r !== 'viewer').includes(actor.role), files: store.db.prepare('SELECT COUNT(*) n FROM report_files WHERE template_key=? AND removed=0').get(key).n }));
}
function templateFor(actor, key) {
  const t = TEMPLATES[key];
  if (!t) throw new AppError('Template not found.', 404);
  if (!t.roles.includes(actor.role)) throw new AppError('You cannot open this report.', 403);
  return t;
}
export function buildTemplate(store, actor, key, params = {}) {
  const t = templateFor(actor, key), clean = { month: typeof params.month === 'string' ? params.month : '', year: typeof params.year === 'string' ? params.year : '' };
  if (t.workbook) return t.workbook(store, actor, clean);
  const sheets = t.build(store, actor, clean), period = t.params.includes('month') ? monthOf(clean) : t.params.includes('year') ? yearOf(clean) : localToday();
  store.log(actor, 'export', 'report-template', key, null, { period });
  return { filename: `${key}-${period}.xlsx`, body: formattedWorkbook(sheets) };
}

// ---------- Maintained report files (uploads) ----------
const ensure = store => store.db.exec('CREATE TABLE IF NOT EXISTS report_files (id TEXT PRIMARY KEY, template_key TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL, content BLOB NOT NULL)');
const uploadSchema = z.object({ name: z.string().trim().min(1).max(180).refine(x => !/[\x00-\x1f\\/]/.test(x), 'Invalid file name.').refine(x => /\.xlsx$/i.test(x), 'Upload an Excel workbook (.xlsx).'), period: z.string().trim().max(40).default(''), notes: z.string().trim().max(1000).default(''), data: z.string().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).strict();
export function uploadReportFile(store, actor, key, input) {
  const t = templateFor(actor, key);
  permit(actor, t.roles.filter(r => r !== 'viewer'));
  const v = uploadSchema.parse(input), bytes = Buffer.from(v.data, 'base64');
  const sheets = readSpreadsheet(v.name, bytes);   // rejects anything that is not a readable .xlsx (size-capped)
  ensure(store);
  return store.transaction(() => {
    const version = store.db.prepare("SELECT COUNT(*) n FROM report_files WHERE template_key=? AND json_extract(data,'$.period')=?").get(key, v.period).n + 1;
    const meta = { id: randomUUID(), templateKey: key, name: v.name, period: v.period, notes: v.notes, version, size: bytes.length, sheets: sheets.map(s => ({ name: s.name, rows: s.rows.length })), uploadedBy: actor.username, uploadedAt: new Date().toISOString() };
    store.db.prepare('INSERT INTO report_files(id,template_key,removed,data,content) VALUES(?,?,0,?,?)').run(meta.id, key, JSON.stringify(meta), bytes);
    store.log(actor, 'upload', 'report-file', meta.id, null, { templateKey: key, name: v.name, period: v.period, version });
    return meta;
  });
}
export function reportFiles(store, actor, key) {
  templateFor(actor, key); ensure(store);
  return store.db.prepare('SELECT removed, data FROM report_files WHERE template_key=? ORDER BY rowid DESC').all(key).map(r => ({ ...JSON.parse(r.data), removed: !!r.removed }));
}
export function reportFileContent(store, actor, id) {
  ensure(store);
  const row = store.db.prepare('SELECT template_key, removed, data, content FROM report_files WHERE id=?').get(id);
  if (!row || row.removed) throw new AppError('File not found.', 404);
  templateFor(actor, row.template_key);
  const meta = JSON.parse(row.data);
  store.log(actor, 'download', 'report-file', id, null, { name: meta.name });
  return { meta, content: row.content };
}
// Removing keeps the file in the database (marked removed, with reason) so the history is never lost.
export function removeReportFile(store, actor, id, input) {
  permit(actor, ['admin', 'hr']);
  const { reason } = z.object({ reason: z.string().trim().min(3, 'Give the reason for removing the file.').max(500) }).strict().parse(input);
  ensure(store);
  return store.transaction(() => {
    const row = store.db.prepare('SELECT template_key, removed, data FROM report_files WHERE id=?').get(id);
    if (!row || row.removed) throw new AppError('File not found.', 404);
    templateFor(actor, row.template_key);
    const meta = { ...JSON.parse(row.data), removedBy: actor.username, removedAt: new Date().toISOString(), removeReason: reason };
    store.db.prepare('UPDATE report_files SET removed=1, data=? WHERE id=?').run(JSON.stringify(meta), id);
    store.log(actor, 'remove', 'report-file', id, null, { name: meta.name, reason });
    return { ok: true };
  });
}
