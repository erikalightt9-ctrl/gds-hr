// Per-employee SSS / PhilHealth / Pag-IBIG review: contribution basis per agency (kept apart from the salary),
// optional fixed shares, a required reason and the full change history. HR and Admin changes apply on save.
const AGENCIES = ['SSS', 'PhilHealth', 'Pag-IBIG'];
const STATUS = { pending: ['Awaiting approval', 'pending'], approved: ['Applied', ''], rejected: ['Rejected', 'rejected'], removed: ['Removed', 'neutral'] };

export function createContributionEditor({ api, esc, money, table, badge, toast, openDialog, dialog }) {
  let data = null, employeeId = '', done = null;

  async function open(id, { onChanged = null } = {}) {
    employeeId = id; done = onChanged;
    try { data = await api(`/employees/${encodeURIComponent(id)}/contributions`); draw(); } catch (error) { toast(error.message); }
  }

  const amount = v => (v === null || v === undefined ? '' : String(v));
  const cutoffStarts = () => {
    const now = new Date(`${data.asOf}T00:00:00Z`), list = [];
    for (let m = -1; m <= 3; m++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1)), ym = d.toISOString().slice(0, 7);
      list.push(`${ym}-01`, `${ym}-16`);
    }
    const current = `${data.asOf.slice(0, 7)}-${Number(data.asOf.slice(8)) >= 16 ? '16' : '01'}`;
    return list.map(v => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}${v === current ? ' (current cutoff)' : ''}</option>`).join('');
  };
  function agencyFields(name) {
    const a = data.active?.agencies?.[name] || {}, salary = data.employee.monthlySalary || 0;
    return `<fieldset class="contribution-agency"><legend>${name}</legend>
      <label class="field">Contribution basis (monthly)<input type="number" min="0" step="0.01" name="${name}.basis" value="${amount(a.basis)}" placeholder="${salary}" data-cb-basis="${name}"><small data-cb-hint="${name}">Blank uses the actual salary, ${money(salary)}.</small></label>
      <label class="field">Employee share (monthly)<input type="number" min="0" step="0.01" name="${name}.employee" value="${amount(a.employee)}" placeholder="From the rates table"><small>Blank = calculated. 0 = no deduction.</small></label>
      <label class="field">Employer share (monthly)<input type="number" min="0" step="0.01" name="${name}.employer" value="${amount(a.employer)}" placeholder="From the rates table"></label>
      ${name === 'SSS' ? `<label class="field">Employees' Compensation (EC)<input type="number" min="0" step="0.01" name="SSS.ec" value="${amount(a.ec)}" placeholder="From the rates table"></label>` : ''}
    </fieldset>`;
  }
  function draw() {
    const d = data, e = d.employee, c = d.current;
    const summary = table(['Agency', 'Contribution basis', 'Employee share', 'Employer share', 'EC', 'Source'], AGENCIES.map(name => [
      name, money(c[name].basis) + (c[name].basisAdjusted ? `<small>Salary ${money(e.monthlySalary || 0)}</small>` : ''), money(c[name].employee), money(c[name].employer), name === 'SSS' ? money(c[name].ec) : '—',
      c[name].basisAdjusted || c[name].sharesAdjusted ? badge('Approved adjustment', 'pending') : badge('Salary and rules table', 'neutral')]));
    const history = table(['Effective', 'Requested', 'Change (monthly)', 'Reason', 'Status', ''], d.changes.map(ch => [
      ch.effectiveDate, `${esc(ch.requestedBy)}<small>${esc(ch.requestedAt.slice(0, 16).replace('T', ' '))}</small>`,
      `<span class="wrap">${AGENCIES.filter(n => JSON.stringify(ch.before[n]) !== JSON.stringify(ch.after[n])).map(n => `${n}: basis ${money(ch.before[n].basis)} → ${money(ch.after[n].basis)}, EE ${money(ch.before[n].employee)} → ${money(ch.after[n].employee)}, ER ${money(ch.before[n].employer)} → ${money(ch.after[n].employer)}`).join('<br>') || 'No amount change'}</span>`,
      `<span class="wrap">${esc(ch.reason)}</span>`,
      badge(...STATUS[ch.status]) + (ch.reviewedBy ? `<small>${esc(ch.reviewedBy)} · ${esc(ch.reviewedAt.slice(0, 16).replace('T', ' '))}${ch.reviewNote ? ` · ${esc(ch.reviewNote)}` : ''}</small>` : ''),
      !d.canApprove ? '' : ch.status === 'pending' ? `<button class="small primary" data-cb-review="approve" data-id="${esc(ch.id)}">Apply</button> <button class="small" data-cb-review="reject" data-id="${esc(ch.id)}">Reject</button>` : ch.status === 'approved' ? `<button class="small" data-cb-review="remove" data-id="${esc(ch.id)}">Remove</button>` : '']), 'No adjustments yet. This employee uses the actual salary and the Rules & rates table.');
    openDialog(`Government contributions · ${e.name}`, `<div class="dialog-body" id="cb-root">
      <p class="sub">${esc(e.id)} · Actual monthly salary <strong>${money(e.monthlySalary || 0)}</strong> (not changed here) · Rules version ${esc(d.ruleId || '—')} · as of ${d.asOf}</p>
      <h3>In force now</h3>${summary}
      ${d.canSubmit ? `<hr><h3>Adjust the contribution computation</h3>
      <p class="legend">Set any basis or monthly amount the company decides; leave a box blank to use the salary and the Rules &amp; rates table. The salary record is not changed. Your change applies from the chosen cutoff as soon as you save, and the previous amounts, your name and the date are kept below. Payroll still has its usual review before posting.</p>
      <form id="cb-form"><div class="form-grid">
        <label class="field">Applies from cutoff<select name="effectiveDate">${cutoffStarts()}</select><small>Posted payroll is never changed.</small></label>
        <div></div>
        ${AGENCIES.map(agencyFields).join('')}
        <label class="field full">Reason and supporting record<textarea name="reason" required minlength="10" maxlength="2000" placeholder="e.g. Sept 2026 DTR: 6 unpaid absence days; compensation actually paid ₱20,000 (payroll register ref.)"></textarea></label>
      </div><button class="primary">Save and apply</button></form>` : ''}
      <hr><h3>Change history</h3>${history}</div>`, `<div class="dialog-foot">${done ? '<button data-cb-back>Back to payroll computation</button>' : ''}<button data-close>Close</button></div>`);
    dialog.querySelector('#cb-form')?.addEventListener('submit', submit);
    dialog.querySelector('#cb-root').addEventListener('input', hint);
    dialog.querySelector('#cb-root').addEventListener('click', review);
    dialog.querySelector('[data-cb-back]')?.addEventListener('click', () => done?.());
  }
  function hint(event) {
    const name = event.target.dataset.cbBasis; if (!name) return;
    const salary = data.employee.monthlySalary || 0, v = event.target.value === '' ? null : Number(event.target.value);
    dialog.querySelector(`[data-cb-hint="${name}"]`).textContent = v === null || v === salary ? `Blank uses the actual salary, ${money(salary)}.` : `${v < salary ? 'Lower' : 'Higher'} than the actual salary by ${money(Math.abs(salary - v))}. The salary record stays ${money(salary)}.`;
  }
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.target), num = key => (form.get(key) === '' ? null : Number(form.get(key)));
    const agencies = Object.fromEntries(AGENCIES.map(n => [n, { basis: num(`${n}.basis`), employee: num(`${n}.employee`), employer: num(`${n}.employer`), ec: n === 'SSS' ? num('SSS.ec') : null }]));
    try {
      const change = await api(`/employees/${encodeURIComponent(employeeId)}/contributions`, { effectiveDate: form.get('effectiveDate'), reason: form.get('reason'), agencies });
      toast(change.status === 'approved' ? 'Saved and applied. Payroll previews and payslips now use it.' : 'Saved.');
      await after();
    } catch (error) { toast(error.message); }
  }
  async function review(event) {
    const button = event.target.closest('[data-cb-review]'); if (!button) return;
    const decision = button.dataset.cbReview, note = window.prompt(decision === 'approve' ? 'Note (optional):' : `Reason for ${decision === 'remove' ? 'removing' : 'rejecting'} this change:`, '');
    if (note === null) return;
    try { await api(`/contribution-changes/${button.dataset.id}/review`, { decision, note }); toast({ approve: 'Change applied.', reject: 'Change rejected.', remove: 'Change removed. Payroll goes back to the previous setting.' }[decision]); await after(); }
    catch (error) { toast(error.message); }
  }
  async function after() {
    data = await api(`/employees/${encodeURIComponent(employeeId)}/contributions`); draw();
  }
  return { open };
}
