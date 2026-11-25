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
    rate: 'Employee 1% (₱1,500 and below) or 2%; employer 2% (GDS applies the ₱200 + ₱200 cap)', employee: '1% / 2% (₱200 cap)', employer: '2% (₱200 cap)',
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

// Employer share from the rules table: employerFixed + employerRate x max(0, salary - excessOver) + ec.
export function bracketEmployerShare(brackets, salary) {
  const match = brackets.filter(b => salary >= b.from && (b.to === null || salary < b.to));
  if (match.length !== 1) return null;
  const b = match[0];
  return round((b.employerFixed || 0) + Math.max(0, salary - b.excessOver) * (b.employerRate || 0) + (b.ec || 0));
}
const percent = rate => `${round(rate * 100)}%`;
function computation(b) {
  if (!b.rate) return peso.format(b.fixed);
  const variable = `${percent(b.rate)} × (salary${b.excessOver ? ` − ${peso.format(b.excessOver)}` : ''})`;
  return b.fixed ? `${peso.format(b.fixed)} + ${variable}` : variable;
}
const range = b => b.to === null ? `${peso.format(b.from)} and above` : `${peso.format(b.from)} – ${peso.format(round(b.to - 0.01))}`;

function employerComputation(b) {
  const parts = [];
  if (b.employerRate) parts.push(`${percent(b.employerRate)} x (salary${b.excessOver ? ` - ${peso.format(b.excessOver)}` : ''})`);
  if (b.employerFixed || !b.employerRate) parts.push(peso.format(b.employerFixed || 0));
  if (b.ec) parts.push(`EC ${peso.format(b.ec)}`);
  return parts.join(' + ') || peso.format(0);
}
function bracketTable(mandate, brackets, { table, badge }) {
  if (!brackets.length) return '<p class="panel-body legend">No brackets entered in this rules version.</p>';
  const rows = brackets.slice().sort((a, b) => a.from - b.from).map(b => {
    // Probe inside the bracket; an open-ended bracket starting at 0 (e.g. a flat Pag-IBIG amount) is probed at a typical salary.
    const probe = b.to === null ? Math.max(b.from, 50000) : b.from, mandated = mandate.shares(probe);
    const ee = bracketShare(brackets, probe), er = bracketEmployerShare(brackets, probe);
    const matches = ee !== null && er !== null && Math.abs(ee - round(mandated.employee)) < 0.01 && Math.abs(er - round(mandated.employer)) < 0.01;
    return [range(b), ...(mandate.key === 'SSS' ? [peso.format(mandated.base)] : []), computation(b), employerComputation(b), badge(matches ? 'Matches mandate' : 'Differs from mandate', matches ? '' : 'pending')];
  });
  const head = ['Monthly salary', ...(mandate.key === 'SSS' ? ['MSC'] : []), 'Employee share (deducted)', 'Employer share (not deducted)', 'Mandate check'];
  return `<div class="scroll-table">${table(head, rows)}</div>`;
}

// Nov 25, 2026 design: info bar, three agency cards (open their computation table), rules table with agency icons,
// salary calculator with a Compute button, and the computation tables as a list.
const csIco = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const AGENCY = {
  SSS: ['blue', csIco('<path d="M4 15c4-1 6-6 12-8M6 19c4-1 7-6 13-9M3 11c4-1 5-5 10-7"/>'), 'Social Security System'],
  PhilHealth: ['green', csIco('<circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><path d="M7 21v-9h4v9M13 21v-9h4v9"/>'), 'Philippine Health Insurance Corporation'],
  'Pag-IBIG': ['amber', csIco('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><circle cx="12" cy="14" r="2.5"/>'), 'Home Development Mutual Fund'],
};
const CS = { info: csIco('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'), people: csIco('<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7.5 20c0-2.8 2-4.8 4.5-4.8s4.5 2 4.5 4.8M1.5 19c0-2.2 1.5-3.8 3.5-3.8M22.5 19c0-2.2-1.5-3.8-3.5-3.8"/>'), calc: csIco('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h4"/>'), list: csIco('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'), chev: csIco('<path d="m9 6 6 6-6 6"/>') };
export function contributionsSection(rule, helpers) {
  const { esc, table } = helpers;
  const agencyIcon = m => { const [tone, icon] = AGENCY[m.key] || ['blue', CS.info]; return `<i class="cs-ag cs-${tone}">${icon}</i>`; };
  const summary = table(['Contribution', 'Basis', 'Total rate', 'Employee share', 'Employer share', 'Floor / ceiling', 'Max employee / month'],
    MANDATES.map(m => [`<span class="cs-name">${agencyIcon(m)}<span><strong>${esc(m.name)}</strong><a href="${m.source}" target="_blank" rel="noreferrer">${esc(m.law)} ↗</a></span></span>`, esc(m.basis), esc(m.rate), esc(m.employee), esc(m.employer), `${esc(m.floor)}<small>Ceiling: ${esc(m.ceiling)}</small>`, peso.format(m.maxEmployee)]));
  const tables = MANDATES.map(m => `<details class="contribution-table" data-cs-table="${esc(m.key)}"><summary><span>${esc(m.name)} Computation Table · ${rule.contributions[m.key].length} Bracket${rule.contributions[m.key].length === 1 ? '' : 's'}</span><em>${rule.contributions[m.key].length} bracket${rule.contributions[m.key].length === 1 ? '' : 's'}</em></summary>${bracketTable(m, rule.contributions[m.key], helpers)}</details>`).join('');
  const factor = rule.cutoff === 'monthly' ? 1 : 0.5;
  return `<section class="contributions-panel cs" data-contribution-rule="${esc(rule.id)}">
    <div class="cs-info">${CS.info}<span>Payroll deducts the employee share each cutoff (monthly share × ${factor}). Employer shares are shown for remittance planning and are not deducted from pay.</span></div>
    <div class="cs-agencies">${MANDATES.map(m => { const [tone, icon, full] = AGENCY[m.key] || ['blue', CS.info, m.name]; return `<button type="button" class="cs-agency cs-card-${tone}" data-cs-open="${esc(m.key)}" title="Open the ${esc(m.name)} computation table"><i class="cs-ag cs-${tone}">${icon}</i><span><strong>${esc(m.name)}</strong><small>${esc(full)}</small></span>${CS.chev}</button>`; }).join('')}</div>
    <div class="cs-panel"><h2 class="cs-title"><span class="cs-title-ico">${CS.people}</span>Contribution Rules &amp; Rates</h2><div class="scroll-table cs-table">${summary}</div></div>
    <div class="cs-two"><div class="cs-panel"><h2 class="cs-title"><span class="cs-title-ico">${CS.calc}</span>Try a Monthly Salary</h2><p class="cs-sub">Enter a monthly salary to see the estimated contributions (employee and employer share).</p>
      <div class="cs-calc"><label class="field contribution-calc">Monthly Salary (PHP)<span class="cs-peso"><i>₱</i><input type="number" min="0" step="any" data-contribution-salary placeholder="e.g. 20,000"></span></label><button type="button" class="cs-compute" data-cs-compute>${CS.calc}Compute</button></div><div data-contribution-result></div></div>
      <div class="cs-panel"><h2 class="cs-title"><span class="cs-title-ico">${CS.list}</span>Computation Tables</h2><div class="cs-tables">${tables}</div></div></div></section>`;
}
// Agency cards open their computation table; Compute runs the calculator (it also updates while typing).
if (typeof document !== 'undefined') document.addEventListener('click', e => {
  const open = e.target.closest('[data-cs-open]');
  if (open) { const d = open.closest('.cs')?.querySelector(`[data-cs-table="${CSS.escape(open.dataset.csOpen)}"]`); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); } return; }
  const go = e.target.closest('[data-cs-compute]');
  if (go) { const input = go.closest('.cs')?.querySelector('[data-contribution-salary]'); if (input) { input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); } }
});

export function renderCalculation(rule, salary, { table }) {
  if (!(salary >= 0)) return '';
  const factor = rule.cutoff === 'monthly' ? 1 : 0.5;
  const rows = MANDATES.map(m => {
    const employee = bracketShare(rule.contributions[m.key], salary), employer = bracketEmployerShare(rule.contributions[m.key], salary) ?? 0;
    return [m.name, employee === null ? 'No matching bracket' : peso.format(employee), employee === null ? '—' : peso.format(round(employee * factor)), peso.format(employer), peso.format(round(employer * factor)), employee === null ? '—' : peso.format(round(employee + employer))];
  });
  return table(['Contribution', 'Employee / month', `Employee / cutoff (× ${factor})`, 'Employer / month', `Employer / cutoff (× ${factor})`, 'Total remittance / month'], rows);
}
