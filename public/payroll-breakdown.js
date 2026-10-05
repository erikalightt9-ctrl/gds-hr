// Focused payroll breakdowns: clicking an amount shows ONLY that item — its source entries, the computation saved
// with this payroll run (trace), and the resulting amount. Totals list their parts, each opening its own breakdown.
// Uses the run's own saved trace, rates and rules version, so posted payroll is never recalculated.
const LABELS = {
  basic: 'Basic Pay', regularOT: 'Regular Overtime', restDay: 'Rest Day Pay', restOT: 'Rest Day Overtime', nsd: 'Night Differential',
  specialHoliday: 'Special Holiday Pay', specialOT: 'Special Holiday Overtime', regularHoliday: 'Regular Holiday Pay', regularHolidayOT: 'Regular Holiday Overtime',
  otherHoliday: 'Other Holiday Pay', otherOT: 'Other Holiday Overtime', allowance: 'Allowance', additional: 'Additional Pay', thirteenth: '13th Month Pay',
  undertime: 'Undertime Deduction', absence: 'Absence / Unpaid Leave Deduction', SSS: 'SSS Contribution', PhilHealth: 'PhilHealth Contribution', 'Pag-IBIG': 'Pag-IBIG Contribution',
  tax: 'Withholding Tax', loans: 'Loan Deductions', other: 'Other Deductions',
};
// Table columns that combine several components.
const GROUPS = {
  overtime: { title: 'Overtime Calculation', parts: ['regularOT', 'restOT', 'specialOT', 'regularHolidayOT', 'otherOT'] },
  adjustment: { title: 'Adjustment Breakdown', parts: ['additional', 'allowance'] },
};
const SOURCE = { attendance: 'Attendance record', 'payroll-inputs': 'Manual entry', adjustments: 'Adjustment', deductions: 'Company deduction', leaves: 'Leave', employees: 'Salary record', rules: 'Payroll rules' };
const CONTRIB = ['SSS', 'PhilHealth', 'Pag-IBIG'];

export function createBreakdown({ esc, money, table, openDialog, dialog, actions }) {
  let run = null, row = null;
  const fmtDate = d => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const box = (label, value, strong = false) => `<div class="bd-fact ${strong ? 'strong' : ''}"><span>${esc(label)}</span><strong>${value}</strong></div>`;
  const amountOf = key => (key in (row.earnings || {}) ? row.earnings[key] : row.deductions?.[key] ?? 0);
  const entries = key => (row.trace || []).filter(t => t.component === key && (t.side === 'earnings' || t.side === 'deductions') && t.amount !== 0);
  const unavailable = '<p class="bd-missing">Calculation basis unavailable for this amount.</p>';
  const header = () => `<div class="bd-context"><div><strong>${esc(row.employeeName)}</strong><small>${esc(row.employeeId)}</small></div><div><span>Payroll period</span><strong>${fmtDate(run.start)} – ${fmtDate(run.end)}</strong></div><div><span>Status</span><strong>${run.id ? 'Posted (saved figures)' : 'Draft preview'}</strong></div></div>`;
  const total = (label, value) => `<div class="bd-total"><span>${esc(label)}</span><strong>${money(value)}</strong></div>`;
  const rateFacts = () => `<div class="bd-facts">${box(row.payBasis === 'daily' ? 'Daily rate' : 'Monthly salary', money(row.payBasis === 'daily' ? row.dailyRate : row.monthlySalary))}${box('Daily rate used', money(row.dailyRate))}${box('Hourly rate used', money(row.hourlyRate))}${box('Rules version', esc(run.ruleId || '—'))}</div>`;
  const entryTable = list => table(['Date', 'Source', 'Hours / qty', 'Rate', 'Computation', 'Amount'], list.map(t => [fmtDate(t.date), esc(SOURCE[t.sourceKind] || t.sourceKind || '—'), t.quantity ?? '—', t.multiplier ? `× ${Math.round(t.multiplier * 10000) / 10000}` : '—', `<span class="wrap">${esc(t.formula || '')}</span>`, `<strong>${money(t.amount)}</strong>`]));
  const editButton = (label, key) => (actions.can(key) ? `<button class="small" data-bd-edit="${key}">${esc(label)}</button>` : '');

  function show(title, body, editKey = '', editLabel = '') {
    openDialog(title, `<div class="dialog-body bd">${header()}${body}</div>`, `<div class="dialog-foot">${editKey ? editButton(editLabel, editKey) : ''}<button data-close>Close</button></div>`);
    dialog.classList.add('bd-dialog');
    dialog.querySelector('.bd')?.addEventListener('click', event => { const b = event.target.closest('[data-bd-open]'); if (b) open(run, row, b.dataset.bdOpen); });
    dialog.querySelector('[data-bd-edit]')?.addEventListener('click', event => { dialog.classList.remove('bd-dialog'); actions.edit(event.target.dataset.bdEdit, row); });
    dialog.addEventListener('close', () => dialog.classList.remove('bd-dialog'), { once: true });
  }

  // One earnings or deduction component (overtime categories, holidays, basic pay, absence, tax, other …).
  function component(key) {
    const amount = amountOf(key), list = entries(key), title = LABELS[key] || key;
    const body = `${['basic', 'regularOT', 'restDay', 'restOT', 'nsd', 'specialHoliday', 'specialOT', 'regularHoliday', 'regularHolidayOT', 'otherHoliday', 'otherOT', 'undertime', 'absence'].includes(key) ? rateFacts() : ''}
      ${list.length ? entryTable(list) : amount ? unavailable : '<p class="bd-none">No amount for this item in this payroll period.</p>'}${total(title, amount)}`;
    const edit = { regularOT: 'manual', restDay: 'manual', restOT: 'manual', nsd: 'manual', specialHoliday: 'manual', specialOT: 'manual', regularHoliday: 'manual', regularHolidayOT: 'manual', otherHoliday: 'manual', otherOT: 'manual', undertime: 'manual', absence: 'manual', other: 'deductions' }[key];
    show(key === 'basic' ? 'Basic Pay Calculation' : `${title} Calculation`, body, edit || '', edit === 'manual' ? 'Edit manual time & pay entry' : 'Manage company deductions');
  }
  function grouped(key) {
    const g = GROUPS[key], parts = g.parts.filter(p => amountOf(p) || entries(p).length);
    const sum = Math.round(g.parts.reduce((s, p) => s + amountOf(p), 0) * 100) / 100;
    if (key === 'adjustment') {
      const list = g.parts.flatMap(p => entries(p).map(t => ({ ...t, part: p })));
      const body = list.length ? table(['Entry', 'Type', 'Date', 'Basis', 'Amount'], list.map(t => [esc(LABELS[t.part]), 'Addition (fixed amount)', fmtDate(t.date), `<span class="wrap">${esc(t.formula || 'No reason recorded')}</span>`, `<strong>+${money(t.amount)}</strong>`])) : sum ? unavailable : '<p class="bd-none">No adjustments in this payroll period.</p>';
      show(g.title, body + total('Total adjustments', sum) + '<p class="legend">Adjustments are fixed amounts approved by HR; deductions entered as adjustments appear under Total Deductions.</p>', 'adjustment', 'Add or review adjustments');
      return;
    }
    const body = `${rateFacts()}${parts.length ? parts.map(p => `<h3 class="bd-sub">${esc(LABELS[p])}</h3>${entries(p).length ? entryTable(entries(p)) : unavailable}<div class="bd-subtotal"><span>Subtotal</span><strong>${money(amountOf(p))}</strong></div>`).join('') : '<p class="bd-none">No overtime in this payroll period.</p>'}${total('Total overtime', sum)}`;
    show(g.title, body, 'manual', 'Edit manual time & pay entry');
  }
  function contribution(name) {
    const deduction = row.deductions?.[name] ?? 0, employer = row.employer?.[name] ?? 0, ec = name === 'SSS' ? row.employer?.['SSS EC'] ?? 0 : null;
    const eeTrace = entries(name), erTrace = (row.trace || []).filter(t => t.side === 'employer' && (t.component === name || (name === 'SSS' && t.component === 'SSS EC')));
    const basis = row.contributionBasis?.[name] ?? row.monthlySalary;
    const body = `<div class="bd-facts">${box('Contribution basis (monthly)', money(basis))}${box('Actual monthly salary', money(row.monthlySalary))}${box('Rules version', esc(run.ruleId || '—'))}</div>
      <h3 class="bd-sub">Employee share (deducted from pay)</h3>${eeTrace.length ? entryTable(eeTrace) : deduction ? unavailable : '<p class="bd-none">Nothing deducted this cutoff.</p>'}${total(`${name} employee share`, deduction)}
      <h3 class="bd-sub">Employer share (paid by the company, not deducted)</h3>${erTrace.length ? table(['Item', 'Computation', 'Amount'], erTrace.map(t => [esc(t.component), `<span class="wrap">${esc(t.formula || '')}</span>`, money(t.amount)])) : '<p class="bd-none">No employer share this cutoff.</p>'}
      <div class="bd-subtotal"><span>Employer share${ec !== null ? ' incl. EC' : ''}</span><strong>${money(employer + (ec || 0))}</strong></div>`;
    show(`${name} Contribution`, body, 'contribution', 'Review contribution basis');
  }
  function loans() {
    const list = row.loanDeductions || [];
    const body = list.length ? table(['Loan', 'Reference', 'Balance before', 'Applied this period', 'Balance after', 'Terms left'], list.map(l => [esc(l.type), esc(l.reference || '—'), money(l.previousBalance), `<strong>${money(l.amount)}</strong>`, money(l.remainingBalance), `${l.remainingTerms ?? '—'} / ${l.terms ?? '—'}`])) : row.deductions?.loans ? unavailable : '<p class="bd-none">No loan deductions this period.</p>';
    show('Loan Deductions', body + total('Total loan deductions', row.deductions?.loans ?? 0), 'loans', 'Open employee loans');
  }
  // Totals: list only the parts that make them up; each part opens its own breakdown.
  function totals(key) {
    const link = (k, label, value, sign = '') => `<tr><td><button class="link-button" data-bd-open="${k}">${esc(label)}</button></td><td class="num">${sign}${money(value)}</td></tr>`;
    let rows, result, title;
    if (key === 'gross') {
      title = 'Gross Pay';
      const groupsUsed = new Set([...GROUPS.overtime.parts, ...GROUPS.adjustment.parts]);
      rows = Object.entries(row.earnings).filter(([k, v]) => v && !groupsUsed.has(k)).map(([k, v]) => link(k, LABELS[k] || k, v)).join('')
        + (GROUPS.overtime.parts.some(p => row.earnings[p]) ? link('overtime', 'Overtime (all categories)', GROUPS.overtime.parts.reduce((s, p) => s + row.earnings[p], 0)) : '')
        + (GROUPS.adjustment.parts.some(p => row.earnings[p]) ? link('adjustment', 'Adjustments', GROUPS.adjustment.parts.reduce((s, p) => s + row.earnings[p], 0)) : '');
      result = row.gross;
    } else if (key === 'deductions') {
      title = 'Total Deductions';
      rows = Object.entries(row.deductions).filter(([, v]) => v).map(([k, v]) => link(k, LABELS[k] || k, v)).join('');
      result = row.totalDeductions;
    } else {
      title = 'Net Pay';
      rows = link('gross', 'Gross pay', row.gross) + link('deductions', 'Less: total deductions', row.totalDeductions, '− ');
      result = row.net;
    }
    show(`${title} Breakdown`, `<table class="bd-sum"><tbody>${rows || '<tr><td colspan="2" class="bd-none">No amounts in this period.</td></tr>'}</tbody></table>${total(title, result)}<p class="legend">Select an item to see how it was calculated.</p>`);
  }

  function open(currentRun, currentRow, key) {
    run = currentRun; row = currentRow;
    if (GROUPS[key]) return grouped(key);
    if (CONTRIB.includes(key)) return contribution(key);
    if (key === 'loans') return loans();
    if (['gross', 'deductions', 'net'].includes(key)) return totals(key);
    return component(key);
  }
  return { open };
}
