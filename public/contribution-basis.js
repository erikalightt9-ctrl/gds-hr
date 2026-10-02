// Per-employee SSS / PhilHealth / Pag-IBIG review: contribution basis per agency (kept apart from the salary),
// optional fixed shares, a required reason, approval by an administrator, and the full change history.
const AGENCIES = ['SSS', 'PhilHealth', 'Pag-IBIG'];
const STATUS = { pending: ['Awaiting approval', 'pending'], approved: ['Approved', ''], rejected: ['Rejected', 'rejected'] };

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
    const a = data.active?.agencies?.[name] || {}, g = data.grounds[name], salary = data.employee.monthlySalary || 0;
    const options = [['', 'Same as actual salary — no ground needed'], ...Object.entries(g.lower).map(([k, v]) => [k, `Lower: ${v}`]), ...Object.entries(g.higher).map(([k, v]) => [k, `Higher: ${v}`])];
    return `<fieldset class="contribution-agency"><legend>${name}</legend>
      <label class="field">Contribution basis (monthly)<input type="number" min="0" step="0.01" name="${name}.basis" value="${amount(a.basis)}" placeholder="${salary}" data-cb-basis="${name}"><small data-cb-hint="${name}">Blank uses the actual salary, ${money(salary)}.</small></label>
      <label class="field">Permitted ground for a different basis<select name="${name}.ground">${options.map(([k, v]) => `<option value="${k}" ${a.ground === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select><small>${esc(g.rule)}</small></label>
      <label class="field">Employee share (monthly, optional)<input type="number" min="0" step="0.01" name="${name}.employee" value="${amount(a.employee)}" placeholder="From the rules table"></label>
      <label class="field">Employer share (monthly, optional)<input type="number" min="0" step="0.01" name="${name}.employer" value="${amount(a.employer)}" placeholder="From the rules table"></label>
      ${name === 'SSS' ? `<label class="field">Employees' Compensation (EC, optional)<input type="number" min="0" step="0.01" name="SSS.ec" value="${amount(a.ec)}" placeholder="From the rules table"></label>` : ''}
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
      ch.status === 'pending' && d.canApprove ? `<button class="small primary" data-cb-review="approve" data-id="${esc(ch.id)}">Approve</button> <button class="small" data-cb-review="reject" data-id="${esc(ch.id)}">Reject</button>` : '']), 'No adjustments yet. This employee uses the actual salary and the approved rules table.');
    openDialog(`Government contributions · ${e.name}`, `<div class="dialog-body" id="cb-root">
      <p class="sub">${esc(e.id)} · Actual monthly salary <strong>${money(e.monthlySalary || 0)}</strong> (not changed here) · Rules version ${esc(d.ruleId || '—')} · as of ${d.asOf}</p>
      <h3>In force now</h3>${summary}
      ${d.canSubmit ? `<hr><h3>Adjust the contribution computation</h3>
      <p class="legend">Set a basis only when the agency's rules allow it, and choose the ground that applies. A basis lower than the salary is refused without a permitted ground; declaring a lower salary is not one. Every change keeps the previous amounts, your name and the date. ${d.canApprove ? 'As an administrator your change applies once saved.' : 'An administrator must approve the change before payroll uses it.'} Payroll still needs its usual review and posting.</p>
      <form id="cb-form"><div class="form-grid">
        <label class="field">Applies from cutoff<select name="effectiveDate">${cutoffStarts()}</select><small>Posted payroll is never changed.</small></label>
        <div></div>
        ${AGENCIES.map(agencyFields).join('')}
        <label class="field full">Reason and supporting record<textarea name="reason" required minlength="10" maxlength="2000" placeholder="e.g. Sept 2026 DTR: 6 unpaid absence days; compensation actually paid ₱20,000 (payroll register ref.)"></textarea></label>
      </div><button class="primary">${d.canApprove ? 'Save and apply' : 'Submit for approval'}</button></form>` : ''}
      <hr><h3>Change history</h3>${history}</div>`, `<div class="dialog-foot">${done ? '<button data-cb-back>Back to payroll computation</button>' : ''}<button data-close>Close</button></div>`);
    dialog.querySelector('#cb-form')?.addEventListener('submit', submit);
    dialog.querySelector('#cb-root').addEventListener('input', hint);
    dialog.querySelector('#cb-root').addEventListener('click', review);
    dialog.querySelector('[data-cb-back]')?.addEventListener('click', () => done?.());
  }
  function hint(event) {
    const name = event.target.dataset.cbBasis; if (!name) return;
    const salary = data.employee.monthlySalary || 0, v = event.target.value === '' ? null : Number(event.target.value);
    dialog.querySelector(`[data-cb-hint="${name}"]`).textContent = v === null || v === salary ? `Blank uses the actual salary, ${money(salary)}.` : v < salary ? `Lower than the actual salary by ${money(salary - v)}: choose a permitted ground below.` : `Higher than the actual salary by ${money(v - salary)}${Object.keys(data.grounds[name].higher).length ? ': choose a permitted ground below.' : `: not permitted for ${name}.`}`;
  }
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.target), num = key => (form.get(key) === '' ? null : Number(form.get(key)));
    const agencies = Object.fromEntries(AGENCIES.map(n => [n, { basis: num(`${n}.basis`), ground: form.get(`${n}.ground`) || '', employee: num(`${n}.employee`), employer: num(`${n}.employer`), ec: n === 'SSS' ? num('SSS.ec') : null }]));
    try {
      const change = await api(`/employees/${encodeURIComponent(employeeId)}/contributions`, { effectiveDate: form.get('effectiveDate'), reason: form.get('reason'), agencies });
      toast(change.status === 'approved' ? 'Contribution change applied. Payroll previews and payslips now use it.' : 'Submitted for administrator approval.');
      await after();
    } catch (error) { toast(error.message); }
  }
  async function review(event) {
    const button = event.target.closest('[data-cb-review]'); if (!button) return;
    const decision = button.dataset.cbReview, note = decision === 'reject' ? window.prompt('Reason for rejecting this change:') : window.prompt('Approval note (optional):', '');
    if (note === null) return;
    try { await api(`/contribution-changes/${button.dataset.id}/review`, { decision, note }); toast(decision === 'approve' ? 'Change approved. Payroll previews and payslips now use it.' : 'Change rejected.'); await after(); }
    catch (error) { toast(error.message); }
  }
  async function after() {
    data = await api(`/employees/${encodeURIComponent(employeeId)}/contributions`); draw();
  }
  return { open };
}
