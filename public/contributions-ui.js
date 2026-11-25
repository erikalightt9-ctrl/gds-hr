// Government Contributions page (Payroll & Attendance): the month's SSS, PhilHealth and Pag-IBIG per employee
// (employee and employer shares), the remittance to the agencies and the employer share paid by GDS.
// Employee government ID numbers are not shown here or in the downloads.
// ratesPanel: the contribution rates, brackets and salary calculator (moved here from Rules & Rates).
export function createContributionsPage({ api, esc, money, table, toast, shell, heading, today, ratesPanel, editContribution, employees, canAdd, openDialog, dialog, context = () => null }) {
  // Per employee filters: Company (department) and employment status. The remittance and employer summaries stay for everyone.
  let fCompany = '', fStatus = '';
  const empOf = id => (employees() || []).find(e => e.id === id);
  // A draft profile in this report is a remittance-only person (e.g. the CEO): remitted every month, so counted as active.
  const isActive = e => !!e && !e.archived && (e.active !== false || !!e.draft);
  const companyList = () => [...new Set([...(context()?.departments || []), ...(employees() || []).filter(e => !e.archived && e.department).map(e => e.department)])].sort();
  const keep = p => { const e = empOf(p.employeeId); return (!fCompany || e?.department === fCompany) && (!fStatus || (fStatus === 'active') === isActive(e)); };
  // Title only: no breadcrumb or subtitle on this page.
  const plainHeading = title => heading(title, '').replace(/<div class="eyebrow">[\s\S]*?<\/div>/, '');
  let month = today().slice(0, 7);
  const lines = (rows, totalLabel, total) => `<dl class="contrib-summary">${rows.map(([label, amount]) => `<div><dt>${esc(label)}</dt><dd>${money(amount)}</dd></div>`).join('')}<div class="total"><dt>${esc(totalLabel)}</dt><dd>${money(total)}</dd></div></dl>`;

  async function render() {
    shell(plainHeading('Government contributions') + '<div class="loading">Loading contributions…</div>');
    const d = await api(`/contributions?month=${month}`), t = d.totals, s = d.summary;
    const people = d.people.filter(keep), filtered = people.length !== d.people.length;
    const tot = k => people.reduce((sum, p) => sum + (p[k] || 0), 0);
    const employeeShare = people.reduce((sum, p) => sum + p.sssEE + p.phEE + p.piEE, 0);
    const filters = `<div class="bal-filters contrib-filters"><label class="field">Company<select data-contrib-company><option value="">All companies</option>${companyList().map(c => `<option ${c === fCompany ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label><label class="field">Status<select data-contrib-status>${[['', 'All'], ['active', 'Active'], ['inactive', 'Not active']].map(([v, l]) => `<option value="${v}" ${v === fStatus ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`;
    const gi = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const GI = { wallet: gi('<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M16 13.5h.01"/>'), people: gi('<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7.5 20c0-2.8 2-4.8 4.5-4.8s4.5 2 4.5 4.8M1.5 19c0-2.2 1.5-3.8 3.5-3.8M22.5 19c0-2.2-1.5-3.8-3.5-3.8"/>'), db: gi('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>'), dl: gi('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'), plus: gi('<path d="M12 5v14M5 12h14"/>'), pen: gi('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>') };
    const gcCard = (tone, icon, label, value, foot) => `<div class="gc-card gc-${tone}"><span>${icon}</span><div><b>${label}</b><strong>${value}</strong><small>${foot}</small></div></div>`;
    const gcIni = n => { const [last, first] = String(n).split(',').map(x => x.trim()); return `${(first || last || '?')[0]}${first ? (last || '')[0] : ''}`.toUpperCase(); };
    const gcTone = n => ['green', 'amber', 'blue', 'violet', 'rose'][[...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5];
    shell(`<section class="dp-hero gc-hero"><span class="gc-hero-art" aria-hidden="true"><svg viewBox="0 0 110 100"><path d="M10 34 50 10l40 24Z" fill="#1f4fc8"/><rect x="14" y="34" width="72" height="8" rx="2" fill="#14306e"/><g fill="#2f6df0"><rect x="20" y="44" width="9" height="34" rx="2"/><rect x="36" y="44" width="9" height="34" rx="2"/><rect x="52" y="44" width="9" height="34" rx="2"/><rect x="68" y="44" width="9" height="34" rx="2"/></g><rect x="10" y="78" width="80" height="10" rx="3" fill="#14306e"/><circle cx="50" cy="26" r="5" fill="#fff"/><g fill="#f2b33d" stroke="#c98a12" stroke-width="2"><ellipse cx="90" cy="90" rx="16" ry="6"/><ellipse cx="90" cy="82" rx="16" ry="6"/><ellipse cx="90" cy="74" rx="16" ry="6"/></g></svg></span><div class="dp-hello"><span>Payroll &amp; Attendance</span><h1>Government Contributions</h1><p>Track SSS, PhilHealth, Pag-IBIG and other government remittances.</p></div></section>`
      + `<div class="gc-tools"><input type="month" id="contrib-month" value="${esc(month)}" aria-label="Month">${canAdd() ? `<button class="gc-add" data-contrib-add>${GI.plus}Add Employee</button>` : ''}<button class="gc-back" data-nav="payroll">← Payroll</button><span class="gc-files">${['xlsx', 'pdf'].map(f => `<a class="gc-file" href="/api/reports/gov-contributions.${f}?month=${month}" download>${GI.dl}${f === 'xlsx' ? 'Excel' : 'PDF'}</a>`).join('')}</span></div>`
      + `<div class="gc-cards">${gcCard('blue', GI.wallet, 'Employee Share', money(employeeShare), filtered ? 'Filtered employees' : 'Deducted from salaries')}${gcCard('green', GI.people, 'Employer Share', money(d.employer.total), 'Paid by GDS (SSS incl. EC)')}${gcCard('red', GI.db, 'Total Remittance', money(s.total), `${esc(d.monthName)} – incl. loans and eGov fee`)}${gcCard('amber', GI.people, 'Employees', people.length, filtered ? `Filtered · ${d.people.length} in this month` : 'In this month')}</div>`
      + `<section class="panel gc-panel"><div class="panel-head"><h2 class="gc-title"><span class="gc-title-ico">${GI.people}</span>Per Employee – ${esc(d.monthName)}</h2>${d.recorded ? '<span class="badge">Recorded from the remittance sheet</span>' : ''}${filters}</div><div class="table-wrap">${table(['Employee', 'Monthly compensation', 'SSS EE', 'SSS ER', 'PhilHealth declared salary', 'PhilHealth EE', 'PhilHealth ER', 'Pag-IBIG EE', 'Pag-IBIG ER', 'Loans', 'Employee deductions', 'Action'],
        [...people.map(p => [`<span class="gc-emp"><i class="gc-av gc-av-${gcTone(p.name)}">${esc(gcIni(p.name))}</i>${esc(p.name)}</span>`, money(p.sssBasis), money(p.sssEE), money(p.sssER), money(p.phBasis), money(p.phEE), money(p.phER), money(p.piEE), money(p.piER), money(p.sssLoan + p.piLoan + (p.cashLoan || 0)), `<strong>${money(p.deductions)}</strong>`, p.employeeId && !d.recorded ? `<button class="gc-edit" data-contrib-edit="${esc(p.employeeId)}" title="Adjust ${esc(p.name)}'s contribution basis or premiums">${GI.pen}Edit</button>` : '']),
          [`<strong>${filtered ? 'Total (filtered)' : 'Total'}</strong>`, money(filtered ? tot('sssBasis') : t.basis), ...['sssEE', 'sssER', 'phBasis', 'phEE', 'phER', 'piEE', 'piER'].map(k => `<strong>${money(tot(k))}</strong>`), `<strong>${money(filtered ? tot('sssLoan') + tot('piLoan') + tot('cashLoan') : t.sssLoan + t.piLoan + (t.cashLoan || 0))}</strong>`, `<strong>${money(filtered ? tot('deductions') : t.deductions)}</strong>`, '']], 'No contributions for this month.')}</div>${(d.excluded || []).length ? `<p class="contrib-excluded"><strong>Not included this month</strong> (started with fewer than 15 workdays; remitted from next month): ${d.excluded.map(x => `${esc(x.name)} · started ${esc(x.startDate)} · ${x.workdays} workday${x.workdays === 1 ? '' : 's'}`).join('; ')}</p>` : ''}</section>`
      + `<div class="grid2"><section class="panel"><div class="panel-head"><h2>Remittance</h2><span class="legend">Paid to SSS, PhilHealth and Pag-IBIG</span></div><div class="panel-body">${lines(s.remittance, 'Total remittance', s.total)}</div></section>`
      + `<section class="panel"><div class="panel-head"><h2>Employer share</h2><span class="legend">Paid by GDS, not deducted from pay</span></div><div class="panel-body">${lines(s.employer, 'Total employer share', s.employerTotal)}</div></section></div>`
      + ratesPanel());
    // Edit: the employee's contribution basis and fixed premiums (applied from the chosen cutoff, with a reason and history).
    const refresh = () => render().catch(err => toast(err.message));
    document.querySelector('.content').onclick = e => {
      const b = e.target.closest('[data-contrib-edit]'); if (b) monthDialog(d.people.find(p => p.employeeId === b.dataset.contribEdit), d, refresh);
      if (e.target.closest('[data-contrib-add]')) addDialog(d.people.map(p => p.employeeId), refresh);
    };
    document.querySelector('.content').onchange = e => {
      if (e.target.matches('[data-contrib-company]')) { fCompany = e.target.value; refresh(); }
      else if (e.target.matches('[data-contrib-status]')) { fStatus = e.target.value; refresh(); }
    };
    document.querySelector('#contrib-month').onchange = e => { if (e.target.value) { month = e.target.value; render().catch(err => toast(err.message)); } };
  }
  // Edit: every amount of the employee's row for the month shown (employee and employer shares included).
  // Blank = the computed amount. Payroll and payslips do not change; the cutoff-based basis editor stays one click away.
  function monthDialog(p, d, refresh) {
    if (!p) return;
    const box = (k, label) => `<label class="field">${label}<span class="share-input"><span class="peso">₱</span><input type="number" min="0" step="0.01" name="${k}" value="${(p[k] ?? 0).toFixed(2)}" data-computed="${p.computed?.[k] ?? p[k] ?? 0}"></span>${p.computed && k in p.computed ? `<small class="share-state manual">Typed · computed ${money(p.computed[k])}</small>` : ''}</label>`;
    openDialog(`${d.monthName} · ${p.name}`, `<form class="dialog-body form-grid" id="cm-form">
      <p class="full sub">Amounts for ${esc(d.monthName)} only, as remitted. Payroll and payslips are not changed. Clear a box to use the computed amount.</p>
      <h3 class="full">SSS</h3>${box('sssBasis', 'Monthly compensation')}${box('sssEE', 'Employee share')}${box('sssER', 'Employer share (incl. EC)')}
      <h3 class="full">PhilHealth</h3>${box('phBasis', 'Declared salary')}${box('phEE', 'Employee share')}${box('phER', 'Employer share')}
      <h3 class="full">Pag-IBIG</h3>${box('piEE', 'Employee share')}${box('piER', 'Employer share')}
      <label class="field full">Reason (optional)<input name="reason" maxlength="500" value="${esc(p.edited?.reason || '')}"></label>
      <p class="full cb-saved" data-cm-msg hidden></p>
      <div class="full actions"><button class="primary">Save</button>${p.edited ? '<button type="button" data-cm-reset>Use computed amounts</button>' : ''}<button type="button" data-cm-basis>Change contribution basis from a cutoff…</button></div>
    </form>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
    const form = dialog.querySelector('#cm-form');
    const send = async values => {
      try { await api('/contributions/month-edit', { employeeId: p.employeeId, month: d.month, values, reason: form.reason.value }); dialog.close?.(); toast(`Saved ${p.name} for ${d.monthName}.`); refresh(); }
      catch (error) { toast(error.message); }
    };
    form.addEventListener('submit', e => {
      e.preventDefault();
      // Only boxes that differ from the computed amount are stored; the rest keep following payroll.
      const values = {};
      for (const input of form.querySelectorAll('input[type=number]')) {
        if (input.value === '') continue;
        const v = Math.round(Number(input.value) * 100) / 100;
        if (Math.abs(v - Number(input.dataset.computed)) >= 0.005) values[input.name] = v;
      }
      send(values);
    });
    form.querySelector('[data-cm-reset]')?.addEventListener('click', () => send({}));
    form.querySelector('[data-cm-basis]').addEventListener('click', () => { dialog.close?.(); editContribution(p.employeeId, refresh); });
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
