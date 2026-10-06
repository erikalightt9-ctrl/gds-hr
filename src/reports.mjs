// Downloadable reports (Excel and PDF) for every HR dataset.
// Each report declares who may download it; the rules mirror what each role can already see on screen.
import { AppError } from './service.mjs';
import { REPORTS_201, brandingLine } from './reports201.mjs';
import { leaveBalance, priorBasicFor } from './engine.mjs';
import { canReadSection, localToday, visibleAudit, auditChanges } from './profiles.mjs';
import { tablePdf, workbook } from './export.mjs';
import { monthlyContributions, contributionRows, CONTRIBUTION_HEADERS, MONTH_NAME } from './contribution-report.mjs';
import { readSettings } from './hr201.mjs';

const STAFF = ['admin', 'hr', 'payroll', 'viewer'];
const money = n => (n === null || n === undefined || n === '' ? '' : Math.round(Number(n) * 100) / 100);
const yesNo = v => (v ? 'Yes' : 'No');

function profile(store, id, section) {
  return JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');
}
const people = state => state.employees;
const nameOf = state => id => state.employees.find(e => e.id === id)?.name || id;
const typeName = state => id => state.leaveTypes.find(t => t.id === id)?.name || id;

export const REPORTS = {
  employees: {
    title: 'Employee directory', roles: STAFF,
    headers: ['Employee ID', 'Name', 'Position', 'Department', 'Monthly salary', 'Pay basis', 'Daily rate', 'Joined', 'End date', 'Status', 'Draft'],
    rows: (state, store) => state.employees.map(e => {
      const job = profile(store, e.id, 'employment'), pay = profile(store, e.id, 'payroll');
      return [e.id, e.name, job.position || '', e.department, money(e.monthlySalary), pay.basis === 'daily' ? 'Daily' : 'Monthly', money(pay.dailyRate), e.startDate, e.endDate, job.employeeStatus || (e.active ? 'Active' : 'Inactive'), yesNo(e.draft)];
    }),
  },
  'employee-details': {
    title: 'Employee personal details', roles: ['admin', 'hr'], section: 'personal',
    headers: ['Employee ID', 'Name', 'Sex', 'Birth date', 'Mobile', 'Personal email', 'Address', 'Emergency contact', 'Relationship', 'Emergency number'],
    rows: (state, store) => state.employees.map(e => {
      const p = profile(store, e.id, 'personal'), em = profile(store, e.id, 'emergency');
      return [e.id, e.name, p.sex || '', p.birthDate || '', p.mobile || '', p.personalEmail || '', p.address || '', em.name || '', em.relationship || '', [em.contact, em.alternateContact].filter(Boolean).join(' / ')];
    }),
  },
  'government-ids': {
    title: 'Government ID numbers', roles: ['admin', 'hr', 'payroll'], section: 'government',
    headers: ['Employee ID', 'Name', 'SSS', 'PhilHealth', 'Pag-IBIG', 'TIN'],
    rows: (state, store) => state.employees.map(e => { const g = profile(store, e.id, 'government'); return [e.id, e.name, g.sss || '', g.philHealth || '', g.pagIbig || '', g.tin || '']; }),
  },
  attendance: {
    title: 'Attendance records', roles: STAFF,
    headers: ['Date', 'Employee ID', 'Name', 'Status', 'Scheduled in', 'Time in', 'Time out', 'Next day', 'Unpaid breaks', 'Approved', 'Exception', 'Offset (min)', 'Explanation'],
    rows: state => { const name = nameOf(state); return state.attendance.slice().sort((a, b) => b.date.localeCompare(a.date) || a.employeeId.localeCompare(b.employeeId)).map(a => [a.date, a.employeeId, name(a.employeeId), a.status, a.scheduledIn, a.timeIn, a.timeOut, yesNo(a.endNextDay), a.breaks.length, yesNo(a.approved), yesNo(a.exception), a.offsetMinutes, a.explanation]); },
  },
  leaves: {
    title: 'Leave requests', roles: STAFF,
    headers: ['Employee ID', 'Name', 'Leave type', 'Start', 'End', 'Days', 'Status', 'Reason', 'Proof', 'Proof reviewed by'],
    rows: state => { const name = nameOf(state), type = typeName(state); return state.leaves.slice().sort((a, b) => b.startDate.localeCompare(a.startDate)).map(l => [l.employeeId, name(l.employeeId), type(l.typeId), l.startDate, l.endDate, l.days, l.status, l.reason, l.proofStatus || '', l.proofReviewedBy || '']); },
  },
  'leave-balances': {
    title: 'Leave balances', roles: STAFF,
    headers: ['Employee ID', 'Name', 'Leave type', 'Entitled', 'Carry-over', 'Used / reserved', 'Available'],
    rows: state => { const today = localToday(); return people(state).flatMap(e => state.leaveTypes.filter(t => e.leaveEligibility.includes(t.id)).map(t => { const b = leaveBalance(state, e, t, today); return [e.id, e.name, t.name, b.entitled, b.carry, b.used, b.available]; })); },
  },
  loans: {
    title: 'Employee loans', roles: STAFF,
    headers: ['Employee ID', 'Name', 'Type', 'Reference', 'Original', 'Balance', 'Monthly amortization', 'Per payroll', 'Start', 'End', 'Terms left', 'Authorized'],
    rows: state => { const name = nameOf(state); return state.loans.map(l => [l.employeeId, name(l.employeeId), l.type, l.reference, money(l.original), money(l.balance), money(l.monthlyAmortization), money(l.perPayroll), l.startDate, l.endDate, `${l.remainingTerms} / ${l.terms}`, yesNo(l.authorized)]); },
  },
  adjustments: {
    title: 'Additional earnings and deductions', roles: STAFF,
    headers: ['Date', 'Employee ID', 'Name', 'Kind', 'Amount', 'Reason', 'Approved'],
    rows: state => { const name = nameOf(state); return state.adjustments.map(a => [a.date, a.employeeId, name(a.employeeId), a.kind, money(a.amount), a.reason, yesNo(a.approved)]); },
  },
  'payroll-runs': {
    title: 'Posted payroll summary', roles: STAFF,
    headers: ['Cutoff start', 'Cutoff end', 'Employees', 'Gross', 'Deductions', 'Net', 'Posted by', 'Posted at'],
    rows: state => state.runs.slice().sort((a, b) => b.start.localeCompare(a.start)).map(r => [r.start, r.end, r.rows.length, money(r.totals.gross), money(r.totals.deductions), money(r.totals.net), r.postedBy || '', r.postedAt || '']),
  },
  'gov-contributions': {
    title: 'Government contributions (monthly)', roles: ['admin', 'hr', 'payroll'], filters: ['month'],
    // Custom layout: company header with employer numbers, one line per employee, totals and remittance summary.
    custom: (store, actor, chosen, format) => {
      const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(chosen.month || '') ? chosen.month : localToday().slice(0, 7);
      const c = readSettings(store).company, report = monthlyContributions(store, month), rows = contributionRows(report, c.egovFee ?? 15);
      const ids = `SSS ID NO. ${c.sssEmployerNo || '—'} | PHIC ID NO. ${c.philhealthEmployerNo || '—'} | HDMF ID NO. ${c.pagibigEmployerNo || '—'}`;
      const status = report.draft ? 'Includes unposted (draft) payroll' : 'From posted payroll';
      store.log(actor, 'export', 'report', 'gov-contributions', null, { format, month, rows: report.people.length });
      const filename = `gds-hr-government-contributions-${month}.${format}`;
      return format === 'xlsx'
        ? { filename, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: workbook({ [`Contributions ${month}`]: [[c.name], [MONTH_NAME(month)], [`SSS ID NO. ${c.sssEmployerNo || ''}`], [`PHIC ID NO. ${c.philhealthEmployerNo || ''}`], [`HDMF ID NO. ${c.pagibigEmployerNo || ''}`], [status], [], CONTRIBUTION_HEADERS, ...rows] }) }
        : { filename, type: 'application/pdf', body: tablePdf({ title: `${c.name} · ${MONTH_NAME(month)} · Government contributions`, subtitle: `${ids} | ${status} | Generated ${localToday()}`, headers: CONTRIBUTION_HEADERS, rows: rows.filter(r => r.length).map(r => r.map(v => (typeof v === 'number' ? money(v) : v))) }) };
    },
  },
  thirteenth: {
    title: '13th month ledger', roles: STAFF, subtitle: () => `Calendar year ${localToday().slice(0, 4)}`,
    headers: ['Employee ID', 'Name', 'Covered', 'Applicable basic (posted)', 'Encoded before the system', 'Total basic', 'Accrued (÷12)', 'Paid', 'Balance'],
    rows: state => {
      const year = localToday().slice(0, 4), rows = state.runs.filter(r => r.status === 'posted' && r.start.startsWith(year)).flatMap(r => r.rows);
      return people(state).map(e => {
        const own = rows.filter(r => r.employeeId === e.id), prior = priorBasicFor(state, e.id, year), posted = own.reduce((s, r) => s + r.applicableBasic, 0), basic = posted + prior.basic, paid = own.reduce((s, r) => s + r.earnings.thirteenth, 0) + prior.thirteenthPaid;
        const accrued = e.covered13th ? basic / 12 : 0;
        return [e.id, e.name, yesNo(e.covered13th), money(posted), money(prior.basic), money(basic), money(accrued), money(paid), money(Math.max(0, accrued - paid))];
      });
    },
  },
  deductions: {
    title: 'Company deductions', roles: STAFF,
    headers: ['Employee ID', 'Name', 'Deduction', 'Amount', 'When', 'Start', 'Until', 'Status', 'Notes'],
    rows: state => { const name = nameOf(state), when = { 'every-cutoff': 'Every cutoff', 'second-cutoff': 'Monthly, 2nd cutoff', 'first-cutoff': 'Monthly, 1st cutoff', once: 'One time' }; return (state.deductions || []).map(d => [d.employeeId, name(d.employeeId), d.name, money(d.amount), when[d.schedule], d.startDate, d.endDate, d.active ? 'Active' : 'Paused', d.notes]); },
  },
  contributions: {
    title: 'Government contributions remittance', roles: ['admin', 'hr', 'payroll'], subtitle: () => 'Posted payroll - employee shares deducted, employer shares paid by the company',
    headers: ['Cutoff', 'Employee ID', 'Name', 'Monthly salary', 'SSS basis', 'PhilHealth basis', 'Pag-IBIG basis', 'SSS EE', 'SSS ER', 'SSS EC', 'PhilHealth EE', 'PhilHealth ER', 'Pag-IBIG EE', 'Pag-IBIG ER', 'Total EE', 'Total ER', 'Total remittance'],
    rows: state => state.runs.filter(r => r.status === 'posted').sort((a, b) => b.start.localeCompare(a.start)).flatMap(run => run.rows.map(r => {
      const er = r.employer || {}, ee = r.deductions, totalEE = ee.SSS + ee.PhilHealth + ee['Pag-IBIG'], totalER = r.employerTotal || 0;
      const basis = name => money(r.contributionBasis?.[name] ?? r.monthlySalary ?? 0);
      return [`${run.start} to ${run.end}`, r.employeeId, r.employeeName, money(r.monthlySalary ?? 0), basis('SSS'), basis('PhilHealth'), basis('Pag-IBIG'), money(ee.SSS), money(er.SSS || 0), money(er['SSS EC'] || 0), money(ee.PhilHealth), money(er.PhilHealth || 0), money(ee['Pag-IBIG']), money(er['Pag-IBIG'] || 0), money(totalEE), money(totalER), money(totalEE + totalER)];
    })),
  },
  holidays: {
    title: 'Holiday calendar', roles: STAFF,
    headers: ['Date', 'Holiday', 'Classification', 'Basis'],
    rows: state => state.holidays.slice().sort((a, b) => a.date.localeCompare(b.date)).map(h => [h.date, h.name, h.kind, h.basis]),
  },
  audit: {
    title: 'Audit trail', roles: ['admin', 'hr', 'payroll', 'viewer', 'maker'], subtitle: () => 'Latest 1,000 events visible to your role',
    headers: ['Time', 'User', 'Action', 'Record type', 'Affected record', 'Changes (previous → updated)'],
    rows: (state, store, actor) => visibleAudit(store, actor).map(a => [new Date(a.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }), a.actor, a.action, a.kind, a.recordId, auditChanges(a).map(c => `${c.field}: ${c.before} → ${c.after}`).join('; ')]),
  },
  // Employee self-service: only the signed-in employee's own records.
  'my-attendance': {
    title: 'My attendance records', roles: ['employee'], own: true,
    headers: ['Date', 'Status', 'Scheduled in', 'Time in', 'Time out', 'Approved', 'Explanation'],
    rows: (state, store, actor) => state.attendance.filter(a => a.employeeId === actor.employeeId).sort((a, b) => b.date.localeCompare(a.date)).map(a => [a.date, a.status, a.scheduledIn, a.timeIn, a.timeOut, a.approved ? 'Approved' : 'Pending HR review', a.explanation]),
  },
  'my-leaves': {
    title: 'My leave applications', roles: ['employee'], own: true,
    headers: ['Leave type', 'Start', 'End', 'Days', 'Status', 'Reason', 'Proof'],
    rows: (state, store, actor) => { const type = typeName(state); return state.leaves.filter(l => l.employeeId === actor.employeeId).sort((a, b) => b.startDate.localeCompare(a.startDate)).map(l => [type(l.typeId), l.startDate, l.endDate, l.days, l.status, l.reason, l.proofStatus || '']); },
  },
};

Object.assign(REPORTS, REPORTS_201);
export function availableReports(actor) {
  return Object.entries(REPORTS).filter(([, r]) => r.roles.includes(actor.role) && (!r.section || canReadSection(actor, r.section))).map(([key, r]) => ({ key, title: r.title, filters: r.filters || [], hr201: key in REPORTS_201 }));
}

const FILTER_LABELS = { department: 'Department', status: 'Status', from: 'From', to: 'To', month: 'Month' };
export function buildReport(store, actor, key, format, filters = {}) {
  const report = REPORTS[key];
  if (!report || !['xlsx', 'pdf'].includes(format)) throw new AppError('Report not found.', 404);
  if (!report.roles.includes(actor.role) || (report.section && !canReadSection(actor, report.section))) throw new AppError('You cannot download this report.', 403);
  const chosen = Object.fromEntries(Object.entries(filters).filter(([k, v]) => (report.filters || []).includes(k) && typeof v === 'string' && v.length <= 120 && v));
  if (report.custom) return report.custom(store, actor, chosen, format);
  const state = store.read(), rows = report.rows(state, store, actor, chosen);
  const subtitle = report.own ? `${state.employees.find(e => e.id === actor.employeeId)?.name || actor.employeeId}` : report.subtitle?.() || `${rows.length} record${rows.length === 1 ? '' : 's'}`;
  const described = [subtitle, ...Object.entries(chosen).map(([k, v]) => `${FILTER_LABELS[k]}: ${v}`), `Generated ${localToday()}`, brandingLine(store)].join(' | ');
  store.log(actor, 'export', 'report', key, null, { format, rows: rows.length, filters: chosen });
  const filename = `gds-hr-${key}-${localToday()}.${format}`;
  return format === 'xlsx'
    ? { filename, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: workbook({ [report.title]: [[report.title], [described], [], report.headers, ...rows] }) }
    : { filename, type: 'application/pdf', body: tablePdf({ title: report.title, subtitle: described, headers: report.headers, rows }) };
}

// One posted payroll run as a PDF register (the Excel version already exists).
export function payrollRunPdf(run) {
  // Figures as 1,000.00, right-aligned; two-line headings so every column stays readable.
  const peso = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const headers = ['Employee\nID', 'Name', 'Days\ncredited', 'Basic', 'OT &\npremiums', 'Gross', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Tax', 'Undertime', 'Loans', 'Other', 'Total\ndeductions', 'Net', 'Employer\nshare*'];
  const premiums = e => Object.entries(e).filter(([k]) => !['basic', 'thirteenth', 'additional', 'allowance'].includes(k)).reduce((s, [, v]) => s + v, 0);
  const loans = d => (d.loans || 0) + (d.sssLoan || 0) + (d.pagibigLoan || 0), other = d => (d.other || 0) + (d.salaryDeduction || 0) + (d.absence || 0);
  const values = r => [r.earnings.basic, premiums(r.earnings), r.gross, r.deductions.SSS, r.deductions.PhilHealth, r.deductions['Pag-IBIG'], r.deductions.tax, r.deductions.undertime, loans(r.deductions), other(r.deductions), r.totalDeductions, r.net, r.employerTotal ?? 0];
  const sorted = run.rows.slice().sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'en', { sensitivity: 'base' }));
  const rows = sorted.map(r => [r.employeeId, r.employeeName, Number(r.creditedDays ?? r.daysPresent).toLocaleString('en-US', { maximumFractionDigits: 4 }), ...values(r).map(peso)]);
  const sums = sorted.reduce((tot, r) => values(r).map((v, i) => tot[i] + (v || 0)), Array(13).fill(0));
  rows.push(['', 'TOTAL', '', ...sums.map(peso)]);
  return tablePdf({ title: `Payroll register ${run.start} to ${run.end}`, subtitle: `${run.status === 'posted' ? `Posted by ${run.postedBy || ''}` : 'Preview'} - ${run.rows.length} employees`, headers, rows, totalRows: 1,
    widths: [44, 128, 36, 50, 48, 54, 44, 46, 42, 34, 44, 42, 44, 54, 54, 50], note: '* Employer SSS, EC, PhilHealth and Pag-IBIG: paid by the company, not deducted from pay.' });
}
