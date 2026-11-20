// Excel templates for administrative, HR, accounting and operational reporting. Each one is built from the records
// already in the system (no separate data entry, no duplicated fields), with filter buttons on the headings, frozen
// headings, SUM totals and formula columns that stay live when the workbook is edited in Excel.
import { tableSheet, colName, tablePdf } from './export.mjs';
import { localToday } from './profiles.mjs';
import { activity } from './hr201.mjs';
import { export1601c } from './bir1601c-export.mjs';
import { month1601c, VIEW_ROLES as BIR_ROLES } from './bir1601c.mjs';
import { listCases, listRecords } from './discipline-views.mjs';
import { VIEW as DP_VIEW } from './discipline.mjs';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const monthOf = chosen => (/^\d{4}-(0[1-9]|1[0-2])$/.test(chosen.month || '') ? chosen.month : localToday().slice(0, 7));
const profile = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
const minutes = hm => { const [h, m] = String(hm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
// One-sheet template from the report's own headers / rows / column options (same layout as the PDF).
const single = (report, extraSheets = () => ({})) => (state, store, actor, chosen, { rows, described }) => ({ [report.title]: tableSheet({ title: report.title, description: described, headers: report.headers, rows, ...report.columns(report.headers) }), ...extraSheets(state, store, actor, chosen, rows) });
const cols = (headers, { totals = [], money = totals, formulas = {} }) => { const at = h => headers.indexOf(h); return { totals: totals.map(at), money: money.map(at), formulas: Object.fromEntries(Object.entries(formulas).map(([h, f]) => [at(h), n => f(n, x => colName(at(x)))])) }; };

const payrollCost = {
  title: 'Monthly payroll cost summary', category: 'Accounting', roles: ['admin', 'hr', 'payroll'], filters: ['month'], template: true,
  subtitle: () => 'Posted payroll cutoffs of the month',
  headers: ['Employee ID', 'Name', 'Department', 'Cutoffs', 'Gross pay', 'SSS (EE)', 'PhilHealth (EE)', 'Pag-IBIG (EE)', 'Withholding tax', 'Loans & other deductions', 'Total deductions', 'Net pay', 'Employer share', 'Total company cost'],
  columns: h => cols(h, { totals: ['Gross pay', 'SSS (EE)', 'PhilHealth (EE)', 'Pag-IBIG (EE)', 'Withholding tax', 'Loans & other deductions', 'Total deductions', 'Net pay', 'Employer share', 'Total company cost'], formulas: { 'Total company cost': (n, c) => `${c('Gross pay')}${n}+${c('Employer share')}${n}` } }),
  rows: (state, store, actor, chosen) => {
    const month = monthOf(chosen), by = new Map(), dept = new Map(state.employees.map(e => [e.id, e.department || '']));
    for (const run of state.runs.filter(r => r.status === 'posted' && r.start.startsWith(month))) for (const r of run.rows) {
      const t = by.get(r.employeeId) || { id: r.employeeId, name: r.employeeName, cutoffs: 0, gross: 0, sss: 0, ph: 0, pi: 0, tax: 0, other: 0, total: 0, net: 0, er: 0 };
      const d = r.deductions; t.cutoffs++; t.gross += r.gross; t.sss += d.SSS || 0; t.ph += d.PhilHealth || 0; t.pi += d['Pag-IBIG'] || 0; t.tax += d.tax || 0; t.total += r.totalDeductions; t.net += r.net; t.er += r.employerTotal || 0;
      t.other = t.total - t.sss - t.ph - t.pi - t.tax; by.set(r.employeeId, t);
    }
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name)).map(t => [t.id, t.name, dept.get(t.id) || '', t.cutoffs, r2(t.gross), r2(t.sss), r2(t.ph), r2(t.pi), r2(t.tax), r2(t.other), r2(t.total), r2(t.net), r2(t.er), r2(t.gross + t.er)]);
  },
};
payrollCost.workbook = single(payrollCost);

const attendanceSummary = {
  title: 'Monthly attendance summary', category: 'Operational', roles: ['admin', 'hr', 'hr_staff', 'maker', 'payroll', 'viewer'], filters: ['month'], template: true,
  subtitle: () => 'Recorded attendance of the month; late = time in after the scheduled time in',
  headers: ['Employee ID', 'Name', 'Department', 'Days recorded', 'Days present', 'Absences', 'Late arrivals', 'Late minutes', 'Approved leave days', 'On-time rate'],
  columns: h => ({ ...cols(h, { totals: ['Days recorded', 'Days present', 'Absences', 'Late arrivals', 'Late minutes', 'Approved leave days'], money: [], formulas: { 'On-time rate': (n, c) => `IF(${c('Days present')}${n}=0,0,(${c('Days present')}${n}-${c('Late arrivals')}${n})/${c('Days present')}${n})` } }) }),
  rows: (state, store, actor, chosen) => {
    const month = monthOf(chosen);
    return state.employees.filter(e => !e.draft && !e.archived).sort((a, b) => a.name.localeCompare(b.name)).map(e => {
      const recs = state.attendance.filter(a => a.employeeId === e.id && a.date.startsWith(month)), present = recs.filter(a => a.status === 'present');
      const late = present.map(a => (minutes(a.timeIn) ?? 0) - (minutes(a.scheduledIn) ?? 0)).filter(m => m > 0);
      const leave = state.leaves.filter(l => l.employeeId === e.id && l.status === 'approved').reduce((s, l) => s + (l.countedDates || []).filter(d => d.startsWith(month)).length, 0);
      return [e.id, e.name, e.department || '', recs.length, present.length, recs.filter(a => a.status === 'absent').length, late.length, late.reduce((s, m) => s + m, 0), leave, present.length ? Math.round(((present.length - late.length) / present.length) * 10000) / 10000 : 0];
    }).filter(r => r[3] || r[8]);
  },
};
attendanceSummary.workbook = (state, store, actor, chosen, { rows, described }) => {
  const spec = tableSheet({ title: attendanceSummary.title, description: described, headers: attendanceSummary.headers, rows, ...attendanceSummary.columns(attendanceSummary.headers) });
  const rate = attendanceSummary.headers.length - 1;
  spec.rows = spec.rows.map((r, i) => (i > spec.header && r[rate] && typeof r[rate] === 'object' && r[rate].f ? r.map((c, j) => (j === rate ? { ...c, pct: true } : c)) : r));
  return { [attendanceSummary.title]: spec };
};

const headcount = {
  title: 'Headcount by department', category: 'Administrative', roles: ['admin', 'hr', 'hr_staff', 'maker', 'payroll', 'viewer'], template: true,
  subtitle: () => `Employee master as of ${localToday()} (archived records excluded)`,
  headers: ['Employee ID', 'Name', 'Department', 'Position', 'Employment status', 'Status', 'Date hired', 'Years of service'],
  columns: h => cols(h, { formulas: { 'Years of service': (n, c) => `IF(${c('Date hired')}${n}="","",ROUND((TODAY()-DATEVALUE(${c('Date hired')}${n}))/365.25,1))` } }),
  rows: (state, store) => state.employees.filter(e => !e.archived && !e.draft).sort((a, b) => (a.department || '').localeCompare(b.department || '') || a.name.localeCompare(b.name)).map(e => {
    const job = profile(store, e.id, 'employment'), years = e.startDate ? Math.round(((Date.now() - Date.parse(e.startDate)) / (365.25 * 86400000)) * 10) / 10 : '';
    return [e.id, e.name, e.department || '', job.position || '', job.employeeStatus || '', activity(e, job), e.startDate || '', years];
  }),
};
headcount.workbook = single(headcount, (state, store, actor, chosen, rows) => {
  const depts = [...new Set(rows.map(r => r[2] || '(none)'))].sort(), first = 5, last = 4 + rows.length, list = `'${headcount.title.slice(0, 31)}'`;
  const body = depts.map((d, i) => { const n = 5 + i, active = rows.filter(r => (r[2] || '(none)') === d && r[5] === 'Active').length, all = rows.filter(r => (r[2] || '(none)') === d).length;
    return [d, { f: `COUNTIFS(${list}!C${first}:C${last},A${n},${list}!F${first}:F${last},"Active")`, v: active }, { f: `COUNTIF(${list}!C${first}:C${last},A${n})-B${n}`, v: all - active }, { f: `B${n}+C${n}`, v: all }]; });
  const t = 5 + depts.length;
  return { Summary: { rows: [[{ v: 'Headcount summary', bold: true }], [`As of ${localToday()}`], [], ['Department', 'Active', 'Not active', 'Total'], ...body, [{ v: 'TOTAL', bold: true }, { f: `SUM(B5:B${t - 1})`, v: body.reduce((s, r) => s + r[1].v, 0), bold: true }, { f: `SUM(C5:C${t - 1})`, v: body.reduce((s, r) => s + r[2].v, 0), bold: true }, { f: `SUM(D5:D${t - 1})`, v: rows.length, bold: true }]], header: 3, totalRows: 1, widths: [34, 12, 12, 12] } };
});

const dpCases = {
  title: 'Due process cases register', category: 'HR', roles: DP_VIEW, template: true, filters: ['caseStatus'],
  subtitle: () => 'Confidential: authorized HR personnel and management only',
  headers: ['Reference', 'Employee ID', 'Employee', 'Department', 'Position', 'Incident date', 'Offense', 'Severity', 'Status', 'Explanation due', 'Decision', 'Final outcome', 'Issuing officer', 'Opened', 'Last updated'],
  columns: h => cols(h, {}),
  rows: (state, store, actor, chosen) => listCases(store, actor, { status: ['pending', 'investigation', 'awaiting', 'evaluation', 'resolved', 'closed'].includes(chosen.caseStatus) ? chosen.caseStatus : '' }).map(c => [c.reference, c.employeeNumber, c.employeeName, c.department, c.position, c.incidentDate, c.offense, c.severity, c.statusLabel, c.deadline, c.sanction ? `${c.sanction} (${c.decisionStatus})` : '', c.outcome, c.issuingOfficer, c.createdAt.slice(0, 10), c.updatedAt.slice(0, 10)]),
};
dpCases.workbook = single(dpCases);
const dpRecords = {
  title: 'Disciplinary records', category: 'HR', roles: DP_VIEW, template: true,
  subtitle: () => 'Confidential: authorized HR personnel and management only',
  headers: ['Employee ID', 'Employee', 'Action', 'Date', 'Offense', 'Case / reference', 'Suspension days', 'Effective from', 'Effective to', 'Source', 'Remarks'],
  columns: h => cols(h, { totals: ['Suspension days'], money: [] }),
  rows: (state, store, actor) => listRecords(store, actor).map(r => [r.employeeId, r.employeeName, r.type, r.date, r.offense, r.reference || '', r.suspensionDays || 0, r.effectiveFrom || '', r.effectiveTo || '', r.source === 'case' ? 'Due process case' : 'Encoded from paper files', r.remarks || '']),
};
dpRecords.workbook = single(dpRecords, (state, store, actor, chosen, rows) => {
  const types = ['Verbal warning', 'Written warning', 'Final written warning', 'Suspension', 'Demotion', 'Dismissal'], people = [...new Map(rows.map(r => [r[0], r[1]])).entries()], last = 4 + rows.length, list = `'${dpRecords.title}'`;
  const body = people.map(([id, name], i) => { const n = 5 + i; return [id, name, ...types.map(t => ({ f: `COUNTIFS(${list}!A$5:A$${last},A${n},${list}!C$5:C$${last},"${t}")`, v: rows.filter(r => r[0] === id && r[2] === t).length })), { f: `SUM(C${n}:${colName(1 + types.length)}${n})`, v: rows.filter(r => r[0] === id).length }]; });
  return { 'Per employee': { rows: [[{ v: 'Disciplinary actions per employee', bold: true }], ['Counts by type of action'], [], ['Employee ID', 'Employee', ...types, 'Total'], ...body], header: 3, widths: [14, 30, ...types.map(() => 14), 10] } };
});

const bir = {
  title: 'BIR Form 1601-C (monthly)', category: 'Accounting', roles: BIR_ROLES, filters: ['month'], template: true,
  custom: (store, actor, chosen, format) => {
    const month = monthOf(chosen);
    if (format === 'xlsx') return export1601c(store, actor, month);
    const d = month1601c(store, actor, month), peso = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    store.log(actor, 'export', 'report', 'bir-1601c', null, { format, month });
    return { filename: `gds-hr-bir-1601c-${month}.pdf`, type: 'application/pdf', body: tablePdf({ title: `BIR Form 1601-C · ${d.monthName}`, subtitle: `${d.agent.name}${d.agent.tin ? ` · TIN ${d.agent.tin}` : ''} · ATC WW010 · Due ${d.dueDate} · ${d.return.status === 'filed' ? `Filed ${d.return.filedOn} (${d.return.confirmationNo})` : 'Not yet filed'}`, headers: ['Item', 'Description', 'Amount'], rows: Object.entries(d.items).map(([k, v]) => [k, d.itemLabels[k], peso(v)]), widths: [30, 520, 120], rightAlign: [false, false, true] }) };
  },
};

export const REPORTS_EXTRA = { 'payroll-cost': payrollCost, 'attendance-summary': attendanceSummary, headcount, 'bir-1601c': bir, 'discipline-cases': dpCases, 'discipline-records': dpRecords };
