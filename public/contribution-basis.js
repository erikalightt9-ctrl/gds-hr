// Per-employee SSS / PhilHealth / Pag-IBIG review: contribution basis per agency (kept apart from the salary),
// optional fixed shares, a required reason and the full change history. HR and Admin changes apply on save.
import { who } from './hr-common.js';
const AGENCIES = ['SSS', 'PhilHealth', 'Pag-IBIG'];
// Agency badges in each agency's colours (official logo files can replace these: drop them in public/agency/).
const AGENCY_BADGE = { SSS: ['SSS', 'sss'], PhilHealth: ['PH', 'philhealth'], 'Pag-IBIG': ['PI', 'pagibig'] };
const agencyMark = name => `<span class="agency-mark agency-${AGENCY_BADGE[name][1]}" aria-hidden="true">${AGENCY_BADGE[name][0]}</span>`;
const STATUS = { pending: ['Awaiting approval', 'pending'], approved: ['Applied', ''], rejected: ['Rejected', 'rejected'], removed: ['Removed', 'neutral'] };

export function createContributionEditor({ api, esc, money, table, badge, toast, openDialog, dialog }) {
  let data = null, employeeId = '', done = null, saved = null, notice = '';   // notice: the green confirmation after a save   // saved: refresh the calling page after a change

  async function open(id, { onChanged = null, onSaved = null } = {}) {
    employeeId = id; done = onChanged; saved = onSaved; notice = '';
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
  function agencyRow(name) {
    const a = data.active?.agencies?.[name] || {}, salary = data.employee.monthlySalary || 0;
    manual[name] = Object.fromEntries(SHARES[name].map(k => [k, a[k] !== null && a[k] !== undefined ? a[k] : null]));
    const share = k => (SHARES[name].includes(k)
      ? `<span class="share-input"><span class="peso">₱</span><input type="number" min="0" step="0.01" name="${name}.${k}" data-share="${name}.${k}" aria-label="${name} ${SHARE_LABEL[k]}"></span><small class="share-state" data-state="${name}.${k}"></small>`
      : '—');
    return [`<span class="agency-name">${agencyMark(name)} ${name}</span>`,
      `<span class="share-input"><span class="peso">₱</span><input type="number" min="0" step="0.01" name="${name}.basis" value="${a.basis ?? salary}" data-cb-basis="${name}" required aria-label="${name} declared salary"></span>`,
      share('employee'), share('employer'), share('ec')];
  }
  // Shares follow the tables for the declared salary unless typed; a cleared box goes back to the table amount.
  function fill(name) {
    const r = calc[name];
    for (const k of SHARES[name]) {
      const input = dialog.querySelector(`[data-share="${name}.${k}"]`), state = dialog.querySelector(`[data-state="${name}.${k}"]`), m = manual[name][k];
      if (!input) continue;
      if (m !== null) { input.value = Number(m).toFixed(2); state.textContent = 'Typed'; state.className = 'share-state manual'; }
      else { input.value = r && !r.error ? Number(r[k]).toFixed(2) : ''; state.textContent = r?.error ? 'Not calculated' : ''; state.className = `share-state ${r?.error ? 'flag' : 'auto'}`; }
    }
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
    if (el.dataset.cbBasis) { const n = el.dataset.cbBasis; clearTimeout(timers[n]); timers[n] = setTimeout(() => recalc([n]), 300); }
    if (el.dataset.share) {
      const [n, k] = el.dataset.share.split('.');
      // A cleared box goes back to the calculated amount; it is never read as zero.
      manual[n][k] = el.value === '' ? null : Number(el.value);
      const r = calc[n]; if (r && !r.error && manual[n][k] !== null && Math.abs(r[k] - manual[n][k]) < 0.005) manual[n][k] = null;
      if (el.value !== '') { const keep = el.value; fill(n); el.value = keep; } else fill(n);
    }
  }
  function draw() {
    const d = data, e = d.employee;
    const history = table(['Effective', 'By', 'Change (monthly)', 'Status', ''], d.changes.map(ch => [
      ch.effectiveDate, `${esc(who(ch.requestedBy))}<small>${esc(ch.requestedAt.slice(0, 16).replace('T', ' '))}</small>`,
      `<span class="wrap">${AGENCIES.filter(n => JSON.stringify(ch.before[n]) !== JSON.stringify(ch.after[n])).map(n => `${n}: salary ${money(ch.before[n].basis)} → ${money(ch.after[n].basis)}, EE ${money(ch.before[n].employee)} → ${money(ch.after[n].employee)}, ER ${money(ch.before[n].employer)} → ${money(ch.after[n].employer)}`).join('<br>') || 'No amount change'}</span>`,
      badge(...STATUS[ch.status]),
      !d.canApprove ? '' : ch.status === 'pending' ? `<button class="small primary" data-cb-review="approve" data-id="${esc(ch.id)}">Apply</button> <button class="small" data-cb-review="reject" data-id="${esc(ch.id)}">Reject</button>` : ch.status === 'approved' ? `<button class="small" data-cb-review="remove" data-id="${esc(ch.id)}">Remove</button>` : '']), 'No adjustments yet.');
    openDialog(`Government contributions · ${e.name}`, `<div class="dialog-body cb-compact" id="cb-root">
      <p class="sub">${esc(e.id)} · Actual monthly salary <strong>${money(e.monthlySalary || 0)}</strong> · amounts are monthly</p>
      ${d.canSubmit ? `<form id="cb-form">
        ${table(['Agency', 'Declared salary', 'Employee share', 'Employer share', 'EC'], AGENCIES.map(agencyRow))}
        <div class="cb-save"><label class="field">Applies from cutoff<select name="effectiveDate">${cutoffStarts()}</select></label><button class="primary">Save</button>${notice ? `<p class="cb-saved" role="status">✓ ${esc(notice)}</p>` : ''}</div>
      </form>` : ''}
      <details class="cb-history"><summary>Change history (${d.changes.length})</summary>${history}</details></div>`, `<div class="dialog-foot">${done ? '<button data-cb-back>Back to payroll computation</button>' : ''}<button data-close>Close</button></div>`);
    const cbForm = dialog.querySelector('#cb-form');
    if (cbForm) {
      calc = {};
      cbForm.addEventListener('submit', submit);
      cbForm.addEventListener('input', onFormInput);
      cbForm.elements.effectiveDate.addEventListener('change', () => recalc(AGENCIES));
      recalc(AGENCIES);
    }
    dialog.querySelector('#cb-root').addEventListener('click', review);
    dialog.querySelector('[data-cb-back]')?.addEventListener('click', () => done?.());
  }
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.target), num = key => (form.get(key) === '' ? null : Number(form.get(key)));
    const errors = AGENCIES.filter(n => calc[n]?.error);
    if (errors.length) { toast(`Fix ${errors.join(', ')} first: ${calc[errors[0]].error}`); return; }
    const agencies = Object.fromEntries(AGENCIES.map(n => [n, { basis: num(`${n}.basis`), employee: manual[n].employee, employer: manual[n].employer, ec: n === 'SSS' ? manual.SSS.ec : null }]));
    try {
      const change = await api(`/employees/${encodeURIComponent(employeeId)}/contributions`, { effectiveDate: form.get('effectiveDate'), agencies });
      notice = change.status === 'approved' ? `Saved. Applies from the ${change.effectiveDate} cutoff; payroll and contributions now use these amounts.` : 'Saved.';
      await after();
    } catch (error) { toast(error.message); }
  }
  async function review(event) {
    const button = event.target.closest('[data-cb-review]'); if (!button) return;
    const decision = button.dataset.cbReview, note = window.prompt(decision === 'approve' ? 'Note (optional):' : `Reason for ${decision === 'remove' ? 'removing' : 'rejecting'} this change:`, '');
    if (note === null) return;
    try { await api(`/contribution-changes/${button.dataset.id}/review`, { decision, note }); notice = { approve: 'Change applied.', reject: 'Change rejected.', remove: 'Change removed. The previous amounts apply again.' }[decision]; await after(); }
    catch (error) { toast(error.message); }
  }
  async function after() {
    data = await api(`/employees/${encodeURIComponent(employeeId)}/contributions`); draw();
    saved?.();
  }
  return { open };
}
