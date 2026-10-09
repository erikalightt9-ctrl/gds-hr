// Government Contributions page (Payroll & Attendance): the month's SSS, PhilHealth and Pag-IBIG per employee
// (employee and employer shares), the remittance to the agencies and the employer share paid by GDS.
// Employee government ID numbers are not shown here or in the downloads.
// ratesPanel: the contribution rates, brackets and salary calculator (moved here from Rules & Rates).
export function createContributionsPage({ api, esc, money, table, toast, shell, heading, today, ratesPanel, editContribution, employees, canAdd, openDialog, dialog }) {
  // Title only: no breadcrumb or subtitle on this page.
  const plainHeading = title => heading(title, '').replace(/<div class="eyebrow">[\s\S]*?<\/div>/, '');
  let month = today().slice(0, 7);
  const card = (label, value, foot, featured = false) => `<div class="card${featured ? ' featured' : ''}"><div class="card-label">${esc(label)}</div><div class="card-value">${value}</div><div class="card-foot">${esc(foot)}</div></div>`;
  const lines = (rows, totalLabel, total) => `<dl class="contrib-summary">${rows.map(([label, amount]) => `<div><dt>${esc(label)}</dt><dd>${money(amount)}</dd></div>`).join('')}<div class="total"><dt>${esc(totalLabel)}</dt><dd>${money(total)}</dd></div></dl>`;

  async function render() {
    shell(plainHeading('Government contributions') + '<div class="loading">Loading contributions…</div>');
    const d = await api(`/contributions?month=${month}`), t = d.totals, s = d.summary;
    const employeeShare = d.people.reduce((sum, p) => sum + p.sssEE + p.phEE + p.piEE, 0);
    const files = ['xlsx', 'pdf'].map(f => `<a class="small download-link" href="/api/reports/gov-contributions.${f}?month=${month}" download>${f === 'xlsx' ? 'Excel' : 'PDF'}</a>`).join('');
    shell(plainHeading('Government contributions')
      + `<div class="actions contrib-tools"><input type="month" id="contrib-month" value="${esc(month)}" aria-label="Month">${canAdd() ? '<button class="primary" data-contrib-add>+ Add employee</button>' : ''}<button class="small" data-nav="payroll">← Payroll</button><span class="download-links">${files}</span></div>`
      + `<div class="cards">${card('Employee share', money(employeeShare), 'Deducted from salaries')}${card('Employer share', money(d.employer.total), 'Paid by GDS (SSS incl. EC)')}${card('Total remittance', money(s.total), `${d.monthName} · incl. loans and eGov fee`, true)}${card('Employees', d.people.length, 'In this month')}</div>`
      + `<section class="panel"><div class="panel-head"><h2>Per employee · ${esc(d.monthName)}</h2>${d.recorded ? '<span class="badge">Recorded from the remittance sheet</span>' : ''}</div><div class="table-wrap">${table(['Employee', 'Monthly compensation', 'SSS EE', 'SSS ER', 'PhilHealth declared salary', 'PhilHealth EE', 'PhilHealth ER', 'Pag-IBIG EE', 'Pag-IBIG ER', 'Loans', 'Employee deductions', ''],
        [...d.people.map(p => [esc(p.name), money(p.sssBasis), money(p.sssEE), money(p.sssER), money(p.phBasis), money(p.phEE), money(p.phER), money(p.piEE), money(p.piER), money(p.sssLoan + p.piLoan + (p.cashLoan || 0)), `<strong>${money(p.deductions)}</strong>`, p.employeeId && !d.recorded ? `<button class="small" data-contrib-edit="${esc(p.employeeId)}" title="Adjust ${esc(p.name)}'s contribution basis or premiums">Edit</button>` : '']),
          ['<strong>Total</strong>', money(t.basis), ...['sssEE', 'sssER', 'phBasis', 'phEE', 'phER', 'piEE', 'piER'].map(k => `<strong>${money(d.people.reduce((sum, p) => sum + p[k], 0))}</strong>`), `<strong>${money(t.sssLoan + t.piLoan + (t.cashLoan || 0))}</strong>`, `<strong>${money(t.deductions)}</strong>`, '']], 'No contributions for this month.')}</div></section>`
      + `<div class="grid2"><section class="panel"><div class="panel-head"><h2>Remittance</h2><span class="legend">Paid to SSS, PhilHealth and Pag-IBIG</span></div><div class="panel-body">${lines(s.remittance, 'Total remittance', s.total)}</div></section>`
      + `<section class="panel"><div class="panel-head"><h2>Employer share</h2><span class="legend">Paid by GDS, not deducted from pay</span></div><div class="panel-body">${lines(s.employer, 'Total employer share', s.employerTotal)}</div></section></div>`
      + ratesPanel());
    // Edit: the employee's contribution basis and fixed premiums (applied from the chosen cutoff, with a reason and history).
    const refresh = () => render().catch(err => toast(err.message));
    document.querySelector('.content').onclick = e => {
      const b = e.target.closest('[data-contrib-edit]'); if (b) editContribution(b.dataset.contribEdit, refresh);
      if (e.target.closest('[data-contrib-add]')) addDialog(d.people.map(p => p.employeeId), refresh);
    };
    document.querySelector('#contrib-month').onchange = e => { if (e.target.value) { month = e.target.value; render().catch(err => toast(err.message)); } };
  }
  // Add employee for manual encoding: a registered employee who is not in payroll, or a new person.
  function addDialog(listed, refresh) {
    const choices = employees().filter(e => e.draft && !e.archived && !listed.includes(e.id)).sort((a, b) => a.name.localeCompare(b.name));
    openDialog('Add employee for manual encoding', `<form class="dialog-body form-grid" id="contrib-add-form">
      <label class="field full">Employee<select name="employeeId"><option value="">New person (not registered)</option>${choices.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('')}</select><small>Only people who are not paid through payroll are listed. They are added as “Remittance only”.</small></label>
      <label class="field" data-new>Last name<input name="lastName" maxlength="120"></label>
      <label class="field" data-new>First name<input name="firstName" maxlength="120"></label>
      <label class="field" data-new>Middle name<input name="middleName" maxlength="120"></label>
      <label class="field" data-new>Employee ID (optional)<input name="employeeNumber" maxlength="40" placeholder="e.g. 2016-0101"></label>
      <label class="field">Declared monthly compensation<input name="monthlySalary" type="number" min="1" step="0.01" required></label>
      <label class="field">Contributions start<input name="startMonth" type="month" value="${esc(month)}" required></label>
      <p class="legend full">After adding, the contribution form opens so the premiums can be typed if they differ from the tables.</p>
      <p class="form-error full hidden" role="alert" data-add-error></p>
      <div class="full"><button class="primary">Add employee</button></div></form>`);
    const form = dialog.querySelector('#contrib-add-form');
    const toggle = () => form.querySelectorAll('[data-new]').forEach(el => el.classList.toggle('hidden', !!form.elements.employeeId.value));
    form.elements.employeeId.onchange = toggle; toggle();
    form.onsubmit = async event => {
      event.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      try {
        const added = await api('/contributions/employees', { ...f, monthlySalary: Number(f.monthlySalary) });
        dialog.close(); await render(); editContribution(added.id, refresh);
      } catch (error) { const box = form.querySelector('[data-add-error]'); box.textContent = error.message; box.classList.remove('hidden'); }
    };
  }
  return { render, setMonth: m => { if (/^\d{4}-\d{2}$/.test(m)) month = m; } };
}
