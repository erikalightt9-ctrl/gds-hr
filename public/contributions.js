// Government contribution reference for Rules & rates: the mandated percentages, the bracket
// tables payroll actually deducts, and a salary calculator. Employer shares are shown for
// remittance planning only; payroll deducts the employee share.
const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const round = v => Math.round((v + Number.EPSILON) * 100) / 100;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const MANDATES = [
  {
    key: 'SSS', name: 'SSS', basis: 'Monthly Salary Credit (MSC) bracket of monthly compensation',
    rate: '15% of MSC', employee: '5%', employer: '10% + EC (₱10 below ₱15,000 MSC, else ₱30)',
    floor: 'MSC ₱5,000 (compensation below ₱5,250)', ceiling: 'MSC ₱35,000 (₱34,750 and above)', maxEmployee: 1750,
    law: 'RA 11199 (Social Security Act of 2018); 2025 schedule, unchanged for 2026',
    source: 'https://www.sss.gov.ph/news-and-updates/sss-implements-contribution-hike/',
    shares(salary) {
      const msc = salary < 5250 ? 5000 : salary >= 34750 ? 35000 : 500 * Math.floor((salary + 250) / 500);
      return { base: msc, employee: msc * 0.05, employer: msc * 0.10 + (msc < 15000 ? 10 : 30) };
    },
  },
  {
    key: 'PhilHealth', name: 'PhilHealth', basis: 'Monthly basic salary',
    rate: '5% of monthly basic salary', employee: '2.5%', employer: '2.5%',
    floor: '₱10,000 (premium ₱500; employee ₱250)', ceiling: '₱100,000 (premium ₱5,000; employee ₱2,500)', maxEmployee: 2500,
    law: 'RA 11223 (Universal Health Care Act); 2026 premium rate',
    source: 'https://pia.gov.ph/news/philhealth-sets-5-premium-contribution-rate-for-2026/',
    shares(salary) {
      const base = clamp(salary, 10000, 100000);
      return { base, employee: base * 0.025, employer: base * 0.025 };
    },
  },
  {
    key: 'Pag-IBIG', name: 'Pag-IBIG (HDMF)', basis: 'Monthly compensation up to the Maximum Fund Salary',
    rate: 'Employee 1% (₱1,500 and below) or 2%; employer 2%', employee: '1% / 2%', employer: '2%',
    floor: 'None', ceiling: 'Maximum Fund Salary ₱10,000', maxEmployee: 200,
    law: 'RA 9679 (HDMF Law of 2009); HDMF Circular 460',
    source: 'https://talinohr.com/blog/pagibig-contribution-guide-2026',
    shares(salary) {
      const base = Math.min(salary, 10000);
      return { base, employee: base * (salary <= 1500 ? 0.01 : 0.02), employer: base * 0.02 };
    },
  },
];

// Same formula the payroll engine applies: fixed + rate × max(0, salary − excessOver).
export function bracketShare(brackets, salary) {
  const match = brackets.filter(b => salary >= b.from && (b.to === null || salary < b.to));
  if (match.length !== 1) return null;
  const b = match[0];
  return round(b.fixed + Math.max(0, salary - b.excessOver) * b.rate);
}

const percent = rate => `${round(rate * 100)}%`;
function computation(b) {
  if (!b.rate) return peso.format(b.fixed);
  const variable = `${percent(b.rate)} × (salary${b.excessOver ? ` − ${peso.format(b.excessOver)}` : ''})`;
  return b.fixed ? `${peso.format(b.fixed)} + ${variable}` : variable;
}
const range = b => b.to === null ? `${peso.format(b.from)} and above` : `${peso.format(b.from)} – ${peso.format(round(b.to - 0.01))}`;

function bracketTable(mandate, brackets, { table, badge }) {
  if (!brackets.length) return '<p class="panel-body legend">No brackets entered in this rules version.</p>';
  const rows = brackets.slice().sort((a, b) => a.from - b.from).map(b => {
    const probe = b.from, payroll = bracketShare(brackets, probe), mandated = mandate.shares(probe);
    const matches = payroll !== null && Math.abs(payroll - round(mandated.employee)) < 0.01;
    const employer = b.rate ? `${mandate.employer.split(' ')[0]} × ${mandate.key === 'SSS' ? 'MSC' : 'salary'}` : peso.format(round(mandated.employer));
    return [range(b), ...(mandate.key === 'SSS' ? [peso.format(mandated.base)] : []), computation(b), employer, badge(matches ? 'Matches mandate' : 'Check value', matches ? '' : 'pending')];
  });
  const head = ['Monthly salary', ...(mandate.key === 'SSS' ? ['MSC'] : []), 'Employee share (payroll deducts)', 'Employer share', 'Mandate check'];
  return `<div class="scroll-table">${table(head, rows)}</div>`;
}

export function contributionsSection(rule, helpers) {
  const { esc, table, badge } = helpers;
  const summary = table(['Contribution', 'Basis', 'Total rate', 'Employee', 'Employer', 'Floor', 'Ceiling', 'Max employee / month', 'Legal basis'],
    MANDATES.map(m => [`<strong>${esc(m.name)}</strong>`, esc(m.basis), esc(m.rate), esc(m.employee), esc(m.employer), esc(m.floor), esc(m.ceiling), peso.format(m.maxEmployee), `<a href="${m.source}" target="_blank" rel="noreferrer">${esc(m.law)} ↗</a>`]));
  const status = rule.approvedBy ? badge(`Approved by ${rule.approvedBy}`) : badge('Draft · pending approval', 'pending');
  const tables = MANDATES.map(m => `<details class="contribution-table"><summary>${esc(m.name)} computation table · ${rule.contributions[m.key].length} brackets</summary>${bracketTable(m, rule.contributions[m.key], helpers)}</details>`).join('');
  const factor = rule.cutoff === 'monthly' ? 1 : 0.5;
  return `<section class="panel contributions-panel" data-contribution-rule="${esc(rule.id)}"><div class="panel-head"><h2>Government contributions</h2><span>${status} <span class="legend">Rules effective ${esc(rule.effectiveDate)} · ${esc(rule.cutoff)}</span></span></div>
    <div class="panel-body"><p class="legend">Payroll deducts the employee share each cutoff (monthly share × ${factor}). Employer shares are shown for remittance planning and are not deducted from pay.</p></div>
    <div class="scroll-table">${summary}</div>
    <div class="panel-body"><h3>Try a monthly salary</h3><label class="field contribution-calc">Monthly salary (PHP)<input type="number" min="0" step="any" data-contribution-salary placeholder="e.g. 20000"></label><div data-contribution-result></div></div>
    <div class="panel-body">${tables}</div></section>`;
}

export function renderCalculation(rule, salary, { table }) {
  if (!(salary >= 0)) return '';
  const factor = rule.cutoff === 'monthly' ? 1 : 0.5;
  const rows = MANDATES.map(m => {
    const employee = bracketShare(rule.contributions[m.key], salary), employer = round(m.shares(salary).employer);
    return [m.name, employee === null ? 'No matching bracket' : peso.format(employee), employee === null ? '—' : peso.format(round(employee * factor)), peso.format(employer), employee === null ? '—' : peso.format(round(employee + employer))];
  });
  return table(['Contribution', 'Employee / month', `Employee / cutoff (× ${factor})`, 'Employer / month', 'Total remittance'], rows);
}
