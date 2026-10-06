// Per-employee SSS / PhilHealth / Pag-IBIG review: contribution basis per agency (kept apart from the salary),
// optional fixed shares, a required reason and the full change history. HR and Admin changes apply on save.
const AGENCIES = ['SSS', 'PhilHealth', 'Pag-IBIG'];
// Agency badges in each agency's colours (official logo files can replace these: drop them in public/agency/).
const AGENCY_BADGE = { SSS: ['SSS', 'sss'], PhilHealth: ['PH', 'philhealth'], 'Pag-IBIG': ['PI', 'pagibig'] };
const agencyMark = name => `<span class="agency-mark agency-${AGENCY_BADGE[name][1]}" aria-hidden="true">${AGENCY_BADGE[name][0]}</span>`;
const STATUS = { pending: ['Awaiting approval', 'pending'], approved: ['Applied', ''], rejected: ['Rejected', 'rejected'], removed: ['Removed', 'neutral'] };

export function createContributionEditor({ api, esc, money, table, badge, toast, openDialog, dialog }) {
  let data = null, employeeId = '', done = null, saved = null;   // saved: refresh the calling page after a change

  async function open(id, { onChanged = null, onSaved = null } = {}) {
    employeeId = id; done = onChanged; saved = onSaved;
    try { data = await api(`/employees/${encodeURIComponent(id)}/contributions`); draw(); } catch (error) { toast(error.message); }
  }

  const cutoffStarts = () => {
    const now = new Date(`${data.asOf}T00:00:00Z`), list = [];
    for (let m = -1; m <= 3; m++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1)), ym = d.toISOString().slice(0, 7);
      list.push(`${ym}-01`, `${ym}-16`);
    }
    const current = `${data.asOf.slice(0, 7)}-${Number(data.asOf.slice(8)) >= 16 ? '16' : '01'}`;
    return list.map(v => `<option value="${v}" ${v === current ? 'selected' : ''}>${v}${v === current ? ' (current cutoff)' : ''}</option>`).join('');
  };
  // ---------- Live amounts ----------
  // Each agency keeps: the basis, the calculated amounts from the approved tables, and which shares were set by hand.
  const SHARES = { SSS: ['employee', 'employer', 'ec'], PhilHealth: ['employee', 'employer'], 'Pag-IBIG': ['employee', 'employer'] };
  const SHARE_LABEL = { employee: 'Employee share (monthly)', employer: 'Employer share (monthly)', ec: "Employees' Compensation (EC)" };
  let calc = {}, manual = {}, timers = {};
  const peso = v => `₱${Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pct = v => `${Math.round(v * 10000) / 100}%`;
  function agencyFields(name) {
    const a = data.active?.agencies?.[name] || {}, salary = data.employee.monthlySalary || 0;
    manual[name] = Object.fromEntries(SHARES[name].map(k => [k, a[k] !== null && a[k] !== undefined ? a[k] : null]));
    const autoLabel = name === 'Pag-IBIG' ? 'Default' : 'Auto-calculated';
    return `<fieldset class="contribution-agency" data-agency="${name}"><legend>${agencyMark(name)} ${name}</legend>
      <label class="field">Contribution basis (monthly)<input type="number" min="0" step="0.01" name="${name}.basis" value="${a.basis ?? salary}" data-cb-basis="${name}" required><small data-cb-hint="${name}">Actual salary ${money(salary)}.</small></label>
      ${SHARES[name].map(k => `<label class="field">${SHARE_LABEL[k]}${k === 'employer' && name === 'SSS' ? ' <small class="inline-note">excludes EC</small>' : ''}<span class="share-input"><span class="peso">₱</span><input type="number" min="0" step="0.01" name="${name}.${k}" data-share="${name}.${k}" aria-describedby="st-${name}-${k}"></span><span class="share-state" id="st-${name}-${k}" data-state="${name}.${k}">${autoLabel}</span><button type="button" class="small link-button hidden" data-reset-share="${name}.${k}">Reset to ${name === 'Pag-IBIG' ? 'default' : 'automatic'}</button></label>`).join('')}
      <div class="calc-ref full" data-ref="${name}" aria-live="polite">Calculating…</div>
      <div class="full agency-actions"><button type="button" class="small" data-recalc="${name}">Recalculate</button></div>
    </fieldset>`;
  }
  function fill(name) {
    const r = calc[name], ref = dialog.querySelector(`[data-ref="${name}"]`); if (!ref) return;
    for (const k of SHARES[name]) {
      const input = dialog.querySelector(`[data-share="${name}.${k}"]`), state = dialog.querySelector(`[data-state="${name}.${k}"]`), reset = dialog.querySelector(`[data-reset-share="${name}.${k}"]`);
      const m = manual[name][k];
      if (m !== null) {
        input.value = Number(m).toFixed(2);
        const differs = r && !r.error && Math.abs(r[k] - m) > 0.004;
        state.textContent = differs ? `Manually adjusted · table amount ${peso(r[k])}, review` : 'Manually adjusted';
        state.className = `share-state ${differs ? 'flag' : 'manual'}`; reset.classList.remove('hidden');
      } else {
        input.value = r && !r.error ? Number(r[k]).toFixed(2) : '';
        state.textContent = r?.error ? 'Not calculated' : name === 'Pag-IBIG' ? 'Default' : 'Auto-calculated';
        state.className = `share-state ${r?.error ? 'flag' : 'auto'}`; reset.classList.add('hidden');
      }
    }
    if (!r) { ref.textContent = 'Calculating…'; return; }
    if (r.error) { ref.innerHTML = `<span class="calc-error">${esc(r.error)}</span>`; return; }
    const x = r.reference, range = `${peso(x.bracket.from)} – ${x.bracket.to === null ? 'and over' : peso(x.bracket.to - 0.01)}`;
    const employerTotal = (manual[name].employer ?? r.employer) + (name === 'SSS' ? (manual.SSS.ec ?? r.ec) : 0);
    const lines = name === 'SSS'
      ? [`Bracket ${range}`, x.msc !== undefined ? `Monthly Salary Credit ${peso(x.msc)}` : 'Single-bracket table (no Monthly Salary Credit ranges)', `Employer total incl. EC ${peso(employerTotal)} (EC counted once, never deducted from pay)`]
      : name === 'PhilHealth'
        ? [x.floor !== null ? `Basis applied ${peso(x.appliedBasis)} (floor ${peso(x.floor)}, ceiling ${peso(x.ceiling)})` : `Basis applied ${peso(x.appliedBasis)}`, `Total premium ${peso((manual.PhilHealth.employee ?? r.employee) + (manual.PhilHealth.employer ?? r.employer))}`, x.employeeRate || x.employerRate ? `Rate ${pct(x.employeeRate)} employee + ${pct(x.employerRate)} employer = ${pct(x.employeeRate + x.employerRate)}` : x.floor !== null ? `Fixed amounts at the ${x.appliedBasis === x.floor ? 'floor' : 'ceiling'}` : 'Fixed amounts from the table']
        : [`Table default ${peso(r.employee)} employee and ${peso(r.employer)} employer`];
    ref.innerHTML = `${lines.map(l => `<span>${esc(l)}</span>`).join('')}<span class="calc-source">Rules ${esc(x.ruleId)} · effective ${esc(x.effectiveDate)}</span>`;
  }
  async function recalc(names) {
    const form = dialog.querySelector('#cb-form'); if (!form) return;
    const bases = {};
    for (const n of names) {
      const v = form.elements[`${n}.basis`].value;
      if (v === '' || Number(v) < 0) { calc[n] = { error: 'Enter a monthly contribution basis.' }; fill(n); continue; }
      bases[n] = Number(v); calc[n] = null; fill(n);
    }
    if (!Object.keys(bases).length) return;
    try {
      const res = await api(`/employees/${encodeURIComponent(employeeId)}/contributions/calculate`, { effectiveDate: form.elements.effectiveDate.value, bases });
      for (const [n, r] of Object.entries(res.results)) { calc[n] = r; fill(n); }
    } catch (error) { for (const n of Object.keys(bases)) { calc[n] = { error: error.message }; fill(n); } }
  }
  function onFormInput(event) {
    const el = event.target;
    if (el.dataset.cbBasis) { hint(event); const n = el.dataset.cbBasis; clearTimeout(timers[n]); timers[n] = setTimeout(() => recalc([n]), 300); }
    if (el.dataset.share) {
      const [n, k] = el.dataset.share.split('.');
      // A cleared box goes back to the calculated amount; it is never read as zero.
      manual[n][k] = el.value === '' ? null : Number(el.value);
      const r = calc[n]; if (r && !r.error && manual[n][k] !== null && Math.abs(r[k] - manual[n][k]) < 0.005) manual[n][k] = null;
      if (el.value !== '') { const keep = el.value; fill(n); el.value = keep; } else fill(n);
    }
  }
  function onFormClick(event) {
    const b = event.target.closest('[data-reset-share],[data-recalc]'); if (!b) return;
    if (b.dataset.resetShare) { const [n, k] = b.dataset.resetShare.split('.'); manual[n][k] = null; fill(n); }
    if (b.dataset.recalc) {
      const n = b.dataset.recalc;
      if (Object.values(manual[n]).some(v => v !== null) && !window.confirm(`Replace the manually adjusted ${n} amounts with the calculated ones?`)) return;
      for (const k of SHARES[n]) manual[n][k] = null;
      recalc([n]);
    }
  }
  function draw() {
    const d = data, e = d.employee, c = d.current;
    const summary = table(['Agency', 'Contribution basis', 'Employee share', 'Employer share', 'EC', 'Source'], AGENCIES.map(name => [
      `<span class="agency-name">${agencyMark(name)} ${name}</span>`, money(c[name].basis) + (c[name].basisAdjusted ? `<small>Salary ${money(e.monthlySalary || 0)}</small>` : ''), money(c[name].employee), money(c[name].employer), name === 'SSS' ? money(c[name].ec) : '—',
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
      <p class="legend">Enter the monthly contribution basis; the shares fill in from the approved Rules &amp; rates tables for the chosen month. Type over a share only when an adjustment is needed (it is marked <em>Manually adjusted</em>). Amounts are monthly; payroll deducts them on the configured cutoff schedule. The salary record is not changed, and every change keeps the previous amounts, your name and the date.</p>
      <form id="cb-form"><div class="form-grid">
        <label class="field">Applies from cutoff<select name="effectiveDate">${cutoffStarts()}</select><small>Posted payroll is never changed.</small></label>
        <div></div>
        ${AGENCIES.map(agencyFields).join('')}
        <label class="field full">Reason and supporting record<textarea name="reason" required minlength="10" maxlength="2000" placeholder="e.g. Sept 2026 DTR: 6 unpaid absence days; compensation actually paid ₱20,000 (payroll register ref.)"></textarea></label>
      </div><button class="primary">Save and apply</button></form>` : ''}
      <hr><h3>Change history</h3>${history}</div>`, `<div class="dialog-foot">${done ? '<button data-cb-back>Back to payroll computation</button>' : ''}<button data-close>Close</button></div>`);
    const cbForm = dialog.querySelector('#cb-form');
    if (cbForm) {
      calc = {};
      cbForm.addEventListener('submit', submit);
      cbForm.addEventListener('input', onFormInput);
      cbForm.addEventListener('click', onFormClick);
      cbForm.elements.effectiveDate.addEventListener('change', () => recalc(AGENCIES));
      recalc(AGENCIES);
    }
    dialog.querySelector('#cb-root').addEventListener('click', review);
    dialog.querySelector('[data-cb-back]')?.addEventListener('click', () => done?.());
  }
  function hint(event) {
    const name = event.target.dataset.cbBasis; if (!name) return;
    const salary = data.employee.monthlySalary || 0, v = event.target.value === '' ? null : Number(event.target.value);
    dialog.querySelector(`[data-cb-hint="${name}"]`).textContent = v === null || v === salary ? `Same as the actual salary, ${money(salary)}.` : `${v < salary ? 'Lower' : 'Higher'} than the actual salary by ${money(Math.abs(salary - v))}. The salary record stays ${money(salary)}.`;
  }
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.target), num = key => (form.get(key) === '' ? null : Number(form.get(key)));
    const errors = AGENCIES.filter(n => calc[n]?.error);
    if (errors.length) { toast(`Fix ${errors.join(', ')} first: ${calc[errors[0]].error}`); return; }
    const agencies = Object.fromEntries(AGENCIES.map(n => [n, { basis: num(`${n}.basis`), employee: manual[n].employee, employer: manual[n].employer, ec: n === 'SSS' ? manual.SSS.ec : null }]));
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
    saved?.();
  }
  return { open };
}
