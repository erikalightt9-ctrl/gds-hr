// Government Contributions page (Payroll & Attendance): the month's SSS, PhilHealth and Pag-IBIG per employee
// (employee and employer shares), the remittance to the agencies and the employer share paid by GDS.
// Employee government ID numbers are not shown here or in the downloads.
// ratesPanel: the contribution rates, brackets and salary calculator (moved here from Rules & Rates).
export function createContributionsPage({ api, esc, money, table, badge, toast, shell, heading, today, ratesPanel }) {
  let month = today().slice(0, 7);
  const card = (label, value, foot, featured = false) => `<div class="card${featured ? ' featured' : ''}"><div class="card-label">${esc(label)}</div><div class="card-value">${value}</div><div class="card-foot">${esc(foot)}</div></div>`;
  const lines = (rows, totalLabel, total) => `<dl class="contrib-summary">${rows.map(([label, amount]) => `<div><dt>${esc(label)}</dt><dd>${money(amount)}</dd></div>`).join('')}<div class="total"><dt>${esc(totalLabel)}</dt><dd>${money(total)}</dd></div></dl>`;

  async function render() {
    shell(heading('Government contributions', 'Loading…') + '<div class="loading">Loading contributions…</div>');
    const d = await api(`/contributions?month=${month}`), t = d.totals, s = d.summary;
    const employeeShare = d.people.reduce((sum, p) => sum + p.sssEE + p.phEE + p.piEE, 0);
    const files = ['xlsx', 'pdf'].map(f => `<a class="small download-link" href="/api/reports/gov-contributions.${f}?month=${month}" download>${f === 'xlsx' ? 'Excel' : 'PDF'}</a>`).join('')
      + `<a class="small download-link" href="/api/reports/gov-contributions.pdf?month=${month}&view=1" target="_blank" rel="noopener">Print PDF</a>`;
    shell(heading('Government contributions', 'SSS, PhilHealth and Pag-IBIG for the month: what employees pay, what GDS pays, and the total remittance.')
      + `<div class="actions contrib-tools"><label class="field">Month<input type="month" id="contrib-month" value="${esc(month)}"></label>${badge(d.draft ? 'Includes draft payroll' : 'From finalized payroll', d.draft ? 'pending' : '')}<span class="download-links">${files}</span></div>`
      + `<div class="cards">${card('Employee share', money(employeeShare), 'Deducted from salaries')}${card('Employer share', money(d.employer.total), 'Paid by GDS (SSS incl. EC)')}${card('Total remittance', money(s.total), `${d.monthName} · incl. loans and eGov fee`, true)}${card('Employees', d.people.length, 'In this month')}</div>`
      + `<section class="panel"><div class="panel-head"><h2>Per employee · ${esc(d.monthName)}</h2></div><div class="table-wrap">${table(['Employee', 'Monthly compensation', 'SSS EE', 'SSS ER', 'PhilHealth EE', 'PhilHealth ER', 'Pag-IBIG EE', 'Pag-IBIG ER', 'Loans', 'Employee deductions'],
        [...d.people.map(p => [esc(p.name), money(p.sssBasis), money(p.sssEE), money(p.sssER), money(p.phEE), money(p.phER), money(p.piEE), money(p.piER), money(p.sssLoan + p.piLoan), `<strong>${money(p.deductions)}</strong>`]),
          ['<strong>Total</strong>', money(t.basis), ...['sssEE', 'sssER', 'phEE', 'phER', 'piEE', 'piER'].map(k => `<strong>${money(d.people.reduce((sum, p) => sum + p[k], 0))}</strong>`), `<strong>${money(t.sssLoan + t.piLoan)}</strong>`, `<strong>${money(t.deductions)}</strong>`]], 'No contributions for this month.')}</div></section>`
      + `<div class="grid2"><section class="panel"><div class="panel-head"><h2>Remittance</h2><span class="legend">Paid to SSS, PhilHealth and Pag-IBIG</span></div><div class="panel-body">${lines(s.remittance, 'Total remittance', s.total)}</div></section>`
      + `<section class="panel"><div class="panel-head"><h2>Employer share</h2><span class="legend">Paid by GDS, not deducted from pay</span></div><div class="panel-body">${lines(s.employer, 'Total employer share', s.employerTotal)}</div></section></div>`
      + ratesPanel());
    document.querySelector('#contrib-month').onchange = e => { if (e.target.value) { month = e.target.value; render().catch(err => toast(err.message)); } };
  }
  return { render, setMonth: m => { if (/^\d{4}-\d{2}$/.test(m)) month = m; } };
}
