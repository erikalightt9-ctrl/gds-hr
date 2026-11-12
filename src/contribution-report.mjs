// Monthly government contributions report (SSS, PhilHealth, Pag-IBIG) in the company's remittance layout.
// Amounts come from payroll for the month: posted runs where they exist, otherwise the current draft computation,
// so manual changes made in payroll are included. Employer SSS includes EC.
import { calculatePayroll, ruleOn, contributionShares, activeContributionSetting } from './engine.mjs';
import { permit } from './service.mjs';
import { recordedMonth } from './contribution-history.mjs';
import { applyMonthEdits } from './contribution-month.mjs';

const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const lastDay = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
// First month rule: someone who starts during the month is remitted for it only with at least MIN_FIRST_MONTH_WORKDAYS
// workdays from the start date to the month end (their rest days skipped); otherwise remittance starts the next month.
export const MIN_FIRST_MONTH_WORKDAYS = 15;
export function firstMonthWorkdays(employee, month) {
  const start = employee?.startDate || '';
  if (!start.startsWith(month)) return null;   // not their first month
  const rest = employee.restDays || [0], end = Number(lastDay(month).slice(8));
  let n = 0;
  for (let day = Number(start.slice(8)); day <= end; day++) if (!rest.includes(new Date(`${month}-${String(day).padStart(2, '0')}T00:00:00Z`).getUTCDay())) n++;
  return n;
}
export const MONTH_NAME = month => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();

// A month recorded from its remittance sheet (before payroll moved into the system), shown exactly as remitted.
function fromRecorded(rec) {
  const people = rec.rows.map(r => ({ employeeId: r.employeeId, name: r.name, sssBasis: r.compensation, phBasis: r.phBasis, sssEE: r.sssEE, sssER: r.sssER, phEE: r.phEE, phER: r.phER, piEE: r.piEE, piER: r.piER, sssLoan: r.sssLoan, piLoan: r.piLoan, cashLoan: r.cashLoan, deductions: r.deductions, note: r.note }));
  const sum = key => r2(people.reduce((s, p) => s + (p[key] || 0), 0));
  const employer = { sss: sum('sssER'), ph: sum('phER'), pi: sum('piER') }; employer.total = r2(employer.sss + employer.ph + employer.pi);
  return { month: rec.month, draft: false, recorded: true, fee: rec.fee, people, employer, totals: { basis: sum('sssBasis'), sss: r2(sum('sssEE') + sum('sssER')), ph: r2(sum('phEE') + sum('phER')), pi: r2(sum('piEE') + sum('piER')), sssLoan: sum('sssLoan'), piLoan: sum('piLoan'), cashLoan: sum('cashLoan'), deductions: sum('deductions') } };
}
export function monthlyContributions(store, month) {
  const rec = recordedMonth(store, month);
  if (rec) return fromRecorded(rec);
  const state = store.read(), cutoff = (state.rules[0]?.cutoff) || 'semi-monthly';
  const periods = cutoff === 'monthly' ? [[`${month}-01`, lastDay(month)]] : [[`${month}-01`, `${month}-15`], [`${month}-16`, lastDay(month)]];
  const byEmployee = new Map();
  let draft = false;
  for (const [start, end] of periods) {
    const posted = state.runs.find(r => r.status === 'posted' && r.start === start && r.end === end);
    if (!posted) draft = true;
    const rows = posted ? posted.rows : calculatePayroll({ ...state, asOf: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()) }, start, end).rows;
    for (const row of rows) {
      const t = byEmployee.get(row.employeeId) || { employeeId: row.employeeId, name: row.employeeName, sssBasis: 0, phBasis: 0, sssEE: 0, sssER: 0, phEE: 0, phER: 0, piEE: 0, piER: 0, sssLoan: 0, piLoan: 0 };
      const d = row.deductions, er = row.employer || {};
      t.sssEE += d.SSS || 0; t.sssER += (er.SSS || 0) + (er['SSS EC'] || 0);
      t.phEE += d.PhilHealth || 0; t.phER += er.PhilHealth || 0;
      t.piEE += d['Pag-IBIG'] || 0; t.piER += er['Pag-IBIG'] || 0;
      if ((d.SSS || 0) + (d.PhilHealth || 0) + (d['Pag-IBIG'] || 0) > 0 || !t.sssBasis) { t.sssBasis = row.contributionBasis?.SSS ?? row.monthlySalary ?? 0; t.phBasis = row.contributionBasis?.PhilHealth ?? row.monthlySalary ?? 0; }
      t.sssLoan += d.sssLoan || 0; t.piLoan += d.pagibigLoan || 0;
      for (const l of row.loanDeductions || []) { if (/sss/i.test(l.type)) t.sssLoan += l.amount; else if (/pag-?ibig|hdmf/i.test(l.type)) t.piLoan += l.amount; }
      byEmployee.set(row.employeeId, t);
    }
  }
  for (const t of remittanceOnlyRows(state, month)) byEmployee.set(t.employeeId, t);
  // Started this month with fewer than 15 workdays: not in this month's remittance (listed apart on the page).
  const excluded = [];
  for (const [id, t] of byEmployee) {
    const e = state.employees.find(x => x.id === id), days = firstMonthWorkdays(e, month);
    if (days !== null && days < MIN_FIRST_MONTH_WORKDAYS) { excluded.push({ employeeId: id, name: t.name, startDate: e.startDate, workdays: days }); byEmployee.delete(id); }
  }
  // Month-only amounts typed on the Government Contributions page replace the computed ones.
  const people = applyMonthEdits(store, month, [...byEmployee.values()].sort((a, b) => a.name.localeCompare(b.name)).map(t => {
    const out = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]));
    return { ...out, deductions: r2(t.sssEE + t.phEE + t.piEE + t.sssLoan + t.piLoan) };
  }));
  const sum = key => r2(people.reduce((s, p) => s + p[key], 0));
  const employer = { sss: sum('sssER'), ph: sum('phER'), pi: sum('piER') };
  employer.total = r2(employer.sss + employer.ph + employer.pi);
  return { month, draft, people, excluded, employer, totals: { basis: sum('sssBasis'), sss: r2(sum('sssEE') + sum('sssER')), ph: r2(sum('phEE') + sum('phER')), pi: r2(sum('piEE') + sum('piER')), sssLoan: sum('sssLoan'), piLoan: sum('piLoan'), deductions: sum('deductions') } };
}

// Employees outside payroll whose contributions are still remitted (payroll status 'Remittance only'): full monthly
// shares from the contribution basis (approved contribution change, else the monthly salary on the record).
const SHARE_KEYS = { SSS: ['sssEmployee', 'sssEmployer', 'sssEc'], PhilHealth: ['philHealthEmployee', 'philHealthEmployer'], 'Pag-IBIG': ['pagIbigEmployee', 'pagIbigEmployer'] };
function remittanceOnlyRows(state, month) {
  const end = lastDay(month), rule = ruleOn(state, end);
  if (!rule) return [];
  const ids = new Set((state.employeeProfiles || []).filter(p => p.section === 'payroll' && p.status === 'Remittance only').map(p => p.employeeId));
  return state.employees.filter(e => ids.has(e.id) && !e.archived && (!e.startDate || e.startDate <= end) && (!e.endDate || e.endDate >= `${month}-01`)).map(e => {
    const setting = activeContributionSetting(state.contributionChanges, e.id, end), t = { employeeId: e.id, name: e.name, sssBasis: 0, phBasis: 0, sssEE: 0, sssER: 0, phEE: 0, phER: 0, piEE: 0, piER: 0, sssLoan: 0, piLoan: 0 };
    const share = name => {
      const basis = setting?.agencies?.[name]?.basis ?? e.monthlySalary;
      const a = setting?.agencies?.[name] || {}, [eeKey, erKey, ecKey] = SHARE_KEYS[name], override = { [eeKey]: a.employee, [erKey]: a.employer, ...(ecKey ? { [ecKey]: a.ec } : {}) };
      return basis ? { basis, ...contributionShares(name, rule.contributions[name], basis, name, [], override) } : { basis: 0, employee: 0, employer: 0, ec: 0 };
    };
    const sss = share('SSS'), ph = share('PhilHealth'), pi = share('Pag-IBIG');
    return { ...t, sssBasis: sss.basis, phBasis: ph.basis, sssEE: sss.employee, sssER: sss.employer + sss.ec, phEE: ph.employee, phER: ph.employer, piEE: pi.employee, piER: pi.employer };
  });
}

// Employee SSS / PhilHealth / Pag-IBIG numbers are not printed in this report.
export const CONTRIBUTION_HEADERS = ['#', 'Name', 'Monthly compensation', 'SSS ER', 'SSS EE', 'SSS Total', 'PhilHealth basic', 'PHIC ER', 'PHIC EE', 'PHIC Total', 'HDMF ER', 'HDMF EE', 'HDMF Total', 'SSS Loan', 'Pag-IBIG Loan', 'Cash loan', 'Adjustment from last deductions', 'Deductions'];
const LAST = CONTRIBUTION_HEADERS.length - 1;
const summaryRow = (label, amount) => ['', label, ...Array(LAST - 2).fill(''), amount];
// Remittance lines (what is paid to the agencies) and the employer share (paid by GDS on top of salaries; SSS incl. EC).
export function remittanceSummary(report, fee = 0) {
  const t = report.totals, er = report.employer;
  const withLoans = !report.recorded;   // recorded sheets list the agency contributions and the eGov fee only
  const remittance = [['SSS', t.sss], ['PhilHealth', t.ph], ['Pag-IBIG (HDMF)', t.pi], ...(withLoans && t.sssLoan ? [['SSS loan', t.sssLoan]] : []), ...(withLoans && t.piLoan ? [['Pag-IBIG loan', t.piLoan]] : []), ['AUB eGov payment fee', report.recorded ? report.fee ?? fee : fee]];
  const total = r2(remittance.reduce((sum, [, v]) => sum + v, 0));
  return { remittance, total, employer: [['SSS employer (incl. EC)', er.sss], ['PhilHealth employer', er.ph], ['Pag-IBIG employer', er.pi]], employerTotal: er.total };
}
// Rows in the report layout: one line per employee, the totals line, the remittance summary and the employer share.
export function contributionRows(report, fee = 0) {
  const blank = v => (v ? v : '');
  const rows = report.people.map((p, i) => [i + 1, p.name, p.sssBasis, p.sssER, p.sssEE, r2(p.sssER + p.sssEE), p.phBasis, p.phER, p.phEE, r2(p.phER + p.phEE), p.piER, p.piEE, r2(p.piER + p.piEE), blank(p.sssLoan), blank(p.piLoan), blank(p.cashLoan), '', p.deductions]);
  const t = report.totals, s = remittanceSummary(report, fee);
  rows.push(['', 'TOTAL', t.basis, '', '', t.sss, '', '', '', t.ph, '', '', t.pi, blank(t.sssLoan), blank(t.piLoan), blank(t.cashLoan), '', t.deductions]);
  rows.push([], summaryRow('REMITTANCE', ''));
  for (const [label, amount] of s.remittance) rows.push(summaryRow(label, amount));
  rows.push(summaryRow('TOTAL REMITTANCE', s.total));
  rows.push([], summaryRow('EMPLOYER SHARE (paid by GDS, not deducted from pay)', ''));
  for (const [label, amount] of s.employer) rows.push(summaryRow(label, amount));
  rows.push(summaryRow('TOTAL EMPLOYER SHARE', s.employerTotal));
  return rows;
}
// The Government Contributions page (Payroll & Attendance): the month's employee and employer shares and remittance.
export function contributionOverview(store, actor, month, fee = 0) {
  permit(actor, ['admin', 'hr', 'payroll']);
  const chosen = /^\d{4}-(0[1-9]|1[0-2])$/.test(month || '') ? month : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date()).slice(0, 7);
  const report = monthlyContributions(store, chosen);
  return { ...report, monthName: MONTH_NAME(chosen), summary: remittanceSummary(report, fee) };
}
