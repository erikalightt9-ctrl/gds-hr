// Monthly government contributions report (SSS, PhilHealth, Pag-IBIG) in the company's remittance layout.
// Amounts come from payroll for the month: posted runs where they exist, otherwise the current draft computation,
// so manual changes made in payroll are included. Employer SSS includes EC.
import { calculatePayroll, ruleOn, contributionShares, activeContributionSetting } from './engine.mjs';

const r2 = v => Math.round((v + Number.EPSILON) * 100) / 100;
const lastDay = month => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
export const MONTH_NAME = month => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).toUpperCase();
const profileOf = (store, id, section) => JSON.parse(store.db.prepare('SELECT data FROM employee_profiles WHERE employee_id=? AND section=?').get(id, section)?.data ?? '{}');

export function monthlyContributions(store, month) {
  const state = store.read(), cutoff = (state.rules[0]?.cutoff) || 'semi-monthly';
  const periods = cutoff === 'monthly' ? [[`${month}-01`, lastDay(month)]] : [[`${month}-01`, `${month}-15`], [`${month}-16`, lastDay(month)]];
  const byEmployee = new Map();
  let draft = false;
  for (const [start, end] of periods) {
    const posted = state.runs.find(r => r.status === 'posted' && r.start === start && r.end === end);
    if (!posted) draft = true;
    const rows = posted ? posted.rows : calculatePayroll(state, start, end).rows;
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
  const people = [...byEmployee.values()].sort((a, b) => a.name.localeCompare(b.name)).map(t => {
    const gov = profileOf(store, t.employeeId, 'government');
    const out = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v]));
    return { ...out, sssNo: gov.sss || '', phNo: gov.philHealth || '', piNo: gov.pagIbig || '', deductions: r2(t.sssEE + t.phEE + t.piEE + t.sssLoan + t.piLoan) };
  });
  const sum = key => r2(people.reduce((s, p) => s + p[key], 0));
  return { month, draft, people, totals: { basis: sum('sssBasis'), sss: r2(sum('sssEE') + sum('sssER')), ph: r2(sum('phEE') + sum('phER')), pi: r2(sum('piEE') + sum('piER')), sssLoan: sum('sssLoan'), piLoan: sum('piLoan'), deductions: sum('deductions') } };
}

// Employees outside payroll whose contributions are still remitted (payroll status 'Remittance only'): full monthly
// shares from the contribution basis (approved contribution change, else the monthly salary on the record).
function remittanceOnlyRows(state, month) {
  const end = lastDay(month), rule = ruleOn(state, end);
  if (!rule) return [];
  const ids = new Set((state.employeeProfiles || []).filter(p => p.section === 'payroll' && p.status === 'Remittance only').map(p => p.employeeId));
  return state.employees.filter(e => ids.has(e.id) && !e.archived && (!e.startDate || e.startDate <= end) && (!e.endDate || e.endDate >= `${month}-01`)).map(e => {
    const setting = activeContributionSetting(state.contributionChanges, e.id, end), t = { employeeId: e.id, name: e.name, sssBasis: 0, phBasis: 0, sssEE: 0, sssER: 0, phEE: 0, phER: 0, piEE: 0, piER: 0, sssLoan: 0, piLoan: 0 };
    const share = name => {
      const basis = setting?.agencies?.[name]?.basis ?? e.monthlySalary;
      return basis ? { basis, ...contributionShares(name, rule.contributions[name], basis, name, []) } : { basis: 0, employee: 0, employer: 0, ec: 0 };
    };
    const sss = share('SSS'), ph = share('PhilHealth'), pi = share('Pag-IBIG');
    return { ...t, sssBasis: sss.basis, phBasis: ph.basis, sssEE: sss.employee, sssER: sss.employer + sss.ec, phEE: ph.employee, phER: ph.employer, piEE: pi.employee, piER: pi.employer };
  });
}

export const CONTRIBUTION_HEADERS = ['#', 'Name', 'SSS No.', 'Monthly compensation', 'SSS ER', 'SSS EE', 'SSS Total', 'PhilHealth No.', 'Basic', 'PHIC ER', 'PHIC EE', 'PHIC Total', 'Pag-IBIG No.', 'HDMF ER', 'HDMF EE', 'HDMF Total', 'SSS Loan', 'Pag-IBIG Loan', 'Adjustment from last deductions', 'Deductions'];
// Rows in the report layout: one line per employee, the totals line and the remittance summary.
export function contributionRows(report, fee = 0) {
  const blank = v => (v ? v : '');
  const rows = report.people.map((p, i) => [i + 1, p.name, p.sssNo, p.sssBasis, p.sssER, p.sssEE, r2(p.sssER + p.sssEE), p.phNo, p.phBasis, p.phER, p.phEE, r2(p.phER + p.phEE), p.piNo, p.piER, p.piEE, r2(p.piER + p.piEE), blank(p.sssLoan), blank(p.piLoan), '', p.deductions]);
  const t = report.totals;
  rows.push(['', 'TOTAL', '', t.basis, '', '', t.sss, '', '', '', '', t.ph, '', '', '', t.pi, blank(t.sssLoan), blank(t.piLoan), '', t.deductions]);
  rows.push([]);
  const grand = r2(t.sss + t.ph + t.pi + t.sssLoan + t.piLoan + fee);
  for (const [label, amount] of [['SSS', t.sss], ['PHILHEALTH', t.ph], ['HDMF', t.pi], ...(t.sssLoan ? [['SSS LOAN', t.sssLoan]] : []), ...(t.piLoan ? [['PAG-IBIG LOAN', t.piLoan]] : []), ['AUB eGov payment fee', fee], ['TOTAL REMITTANCE', grand]]) rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', label, '', amount]);
  return rows;
}
