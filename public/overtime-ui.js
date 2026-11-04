// Attendance → Overtime applications (HR / Admin decide; Payroll reads): every application with filters, the hours
// attendance shows inside the filed period, flags to settle before posting, a review window and HR filing.
import { who } from './hr-common.js';

const STATUS = { pending: ['Pending', 'pending'], approved: ['Approved', ''], rejected: ['Rejected', 'rejected'], cancelled: ['Cancelled', 'neutral'] };
const fmtDay = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const period = o => (o.startTime ? `${o.startTime} – ${o.endTime}${o.endTime <= o.startTime ? ' (next day)' : ''}` : 'Hours only');
const stamp = iso => (iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '');

export function createOvertimeUi({ api, esc, toast, openDialog, dialog, badge, canDecide, employees, onChanged }) {
  let list = [], filters = { employee: '', from: '', to: '', status: 'pending' };
  const statusBadge = s => { const [label, tone] = STATUS[s] || [s, 'neutral']; return badge(label, tone); };

  function rows() {
    return list.filter(o => (!filters.employee || o.employeeId === filters.employee) && (!filters.from || o.date >= filters.from) && (!filters.to || o.date <= filters.to) && (!filters.status || (filters.status === 'flagged' ? o.flags?.length && ['pending', 'approved'].includes(o.status) : o.status === filters.status)));
  }
  function counts() {
    const n = s => list.filter(o => o.status === s).length;
    return { pending: n('pending'), approved: n('approved'), flagged: list.filter(o => o.flags?.length && ['pending', 'approved'].includes(o.status)).length };
  }
  function render(box) {
    const people = [...new Map(list.map(o => [o.employeeId, o.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const c = counts(), shown = rows();
    box.innerHTML = `<section class="panel ot-panel"><div class="panel-head"><div><h2>Overtime applications</h2><p class="legend">Only approved hours worked inside the filed period are paid. Settle flags before posting payroll.</p></div>${canDecide() ? '<button class="primary" data-ot-new>+ File overtime</button>' : ''}</div>
      <div class="ot-summary"><button data-ot-status="pending" class="${filters.status === 'pending' ? 'active' : ''}"><strong>${c.pending}</strong>Pending</button><button data-ot-status="flagged" class="${filters.status === 'flagged' ? 'active' : ''}"><strong>${c.flagged}</strong>Needs review</button><button data-ot-status="approved" class="${filters.status === 'approved' ? 'active' : ''}"><strong>${c.approved}</strong>Approved</button><button data-ot-status="" class="${filters.status === '' ? 'active' : ''}"><strong>${list.length}</strong>All</button></div>
      <div class="ot-filters"><label class="field">Employee<select data-ot-filter="employee"><option value="">All employees</option>${people.map(([id, name]) => `<option value="${esc(id)}" ${id === filters.employee ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
        <label class="field">From<input type="date" data-ot-filter="from" value="${esc(filters.from)}"></label><label class="field">To<input type="date" data-ot-filter="to" value="${esc(filters.to)}"></label>
        <label class="field">Status<select data-ot-filter="status">${[['', 'All'], ['pending', 'Pending'], ['flagged', 'Needs review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']].map(([v, l]) => `<option value="${v}" ${v === filters.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div class="ot-list">${shown.map(o => `<button class="ot-item" data-ot-review="${esc(o.id)}">
          <span class="ot-who"><strong>${esc(o.name)}</strong><small>${esc(o.employeeId)}</small></span>
          <span class="ot-when"><strong>${esc(fmtDay(o.date))}</strong><small>${esc(period(o))}${o.breakMinutes ? ` · ${o.breakMinutes} min break` : ''}</small></span>
          <span class="ot-hours"><strong>${o.status === 'approved' ? `${o.approvedHours} of ${o.hours} h` : `${o.hours} h`}</strong><small>${o.status === 'approved' ? 'approved' : 'filed'} · worked ${o.workedInPeriod ?? 0} h in period</small></span>
          <span class="ot-state">${statusBadge(o.status)}${o.flags?.length && ['pending', 'approved'].includes(o.status) ? `<small class="ot-flag">⚠ ${esc(o.flags[0])}${o.flags.length > 1 ? ` (+${o.flags.length - 1})` : ''}</small>` : ''}${o.locked ? '<small>Payroll posted</small>' : ''}</span>
        </button>`).join('') || '<p class="muted ot-empty">Nothing to show yet.</p>'}</div></section>`;
  }
  async function fill(box) {
    try { list = await api('/overtime-requests'); render(box); } catch (error) { box.innerHTML = `<p class="muted">${esc(error.message)}</p>`; }
    box.oninput = box.onchange = event => {
      const f = event.target.dataset.otFilter; if (!f) return;
      filters = { ...filters, [f]: event.target.value }; render(box);
    };
    box.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.dataset.otStatus !== undefined) { filters = { ...filters, status: b.dataset.otStatus }; render(box); }
      if (b.dataset.otReview) review(list.find(o => o.id === b.dataset.otReview), box);
      if (b.hasAttribute('data-ot-new')) fileForEmployee(box);
    };
  }

  function review(o, box) {
    if (!o) return;
    const open = canDecide() && !o.locked && o.status !== 'cancelled';
    const facts = [['Date', fmtDay(o.date)], ['Period', period(o)], ['Unpaid break', o.breakMinutes ? `${o.breakMinutes} min` : 'None'], ['Hours filed', `${o.hours} h`], ...(o.status === 'approved' ? [['Hours approved', `${o.approvedHours} h`]] : []), ['Worked in the period', `${o.workedInPeriod ?? 0} h`], ['Payable (estimate)', `${o.payableHours ?? 0} h`], ...(o.nightHours ? [['Night hours (10 PM – 6 AM)', `${o.nightHours} h`]] : [])];
    const history = (o.history || []).map(h => `<li><strong>${esc(h.action[0].toUpperCase() + h.action.slice(1))}</strong> · ${esc(who(h.by))} · ${esc(stamp(h.at))}${h.note ? `<small>${esc(h.note)}</small>` : ''}</li>`).join('') || `<li><strong>Submitted</strong> · ${esc(who(o.filedBy))} · ${esc(stamp(o.filedAt))}</li>`;
    const start = o.status === 'approved' ? o.approvedHours : Math.min(o.hours, Math.max(o.payableHours || 0, 0) || o.hours);
    openDialog(`Overtime · ${o.name}`, `<form id="ot-review" class="dialog-body ot-review">
        <div class="ot-review-top">${statusBadge(o.status)}<span class="legend">${esc(o.employeeId)} · filed by ${esc(who(o.filedBy))} on ${esc(stamp(o.filedAt))}</span></div>
        <div class="notice-rows">${facts.map(([k, v]) => `<div class="notice-row"><span>${k}</span><strong>${esc(v)}</strong></div>`).join('')}</div>
        <p class="ot-reason"><span>Work to be done</span>${esc(o.reason)}</p>
        ${o.documentId ? `<p><a class="button" href="/api/documents/${esc(o.documentId)}/content" target="_blank" rel="noopener">📎 View attachment</a></p>` : ''}
        ${o.flags?.length ? `<div class="ot-flags">${o.flags.map(f => `<p>⚠ ${esc(f)}</p>`).join('')}</div>` : ''}
        ${o.status === 'approved' && o.adjustReason ? `<p class="legend">Adjusted: ${esc(o.adjustReason)}</p>` : ''}${o.remarks ? `<p class="legend">Remarks: ${esc(o.remarks)}</p>` : ''}
        ${open ? `<fieldset class="ot-decide"><legend>${o.status === 'pending' ? 'Decision' : 'Change the decision'}</legend>
          <label class="field">Hours to approve<input type="number" name="hours" min="0.25" max="${o.hours}" step="0.25" value="${start}" required></label>
          <label class="field ot-adjust ${start === o.hours ? 'hidden' : ''}">Reason for approving different hours<input name="adjustReason" maxlength="500" value="${esc(o.adjustReason || '')}" placeholder="e.g. Only 2 h were authorised"></label>
          <label class="field">Remarks to the employee <small>(required to reject)</small><textarea name="remarks" rows="2" maxlength="500">${esc(o.remarks || '')}</textarea></label></fieldset>` : o.locked ? '<p class="legend">Payroll for this date is posted; the decision is locked.</p>' : ''}
        <details class="ot-history"><summary>History</summary><ul>${history}</ul></details></form>`,
      `<div class="dialog-foot"><button type="button" data-close>Close</button>${open ? `<button type="button" class="danger" data-ot-reject>✕ Reject</button><button type="button" class="primary" data-ot-approve>✓ Approve ${start} h</button>` : ''}</div>`);
    if (!open) return;
    const form = dialog.querySelector('#ot-review'), approveBtn = dialog.querySelector('[data-ot-approve]');
    form.elements.hours.addEventListener('input', () => {
      const h = Number(form.elements.hours.value || 0);
      approveBtn.textContent = `✓ Approve ${h} h`;
      form.querySelector('.ot-adjust').classList.toggle('hidden', h === o.hours);
    });
    const decide = async decision => {
      const hours = Number(form.elements.hours.value), remarks = form.elements.remarks.value.trim(), adjustReason = form.elements.adjustReason.value.trim();
      if (decision === 'reject' && remarks.length < 3) { toast('Write the reason for rejecting in Remarks.'); form.elements.remarks.focus(); return; }
      if (decision === 'approve' && !(hours > 0)) { toast('Enter the hours to approve.'); return; }
      if (decision === 'approve' && hours !== o.hours && adjustReason.length < 3) { toast('Give the reason for approving different hours.'); form.elements.adjustReason.focus(); return; }
      dialog.querySelectorAll('.dialog-foot button').forEach(b => { b.disabled = true; });
      try {
        await api(`/overtime-requests/${o.id}/decision`, { decision, remarks, ...(decision === 'approve' ? { hours, adjustReason } : {}) });
        await fill(box); onChanged?.();
        openDialog(decision === 'approve' ? 'Overtime approved' : 'Overtime rejected', `<div class="dialog-body confirm-box"><p class="confirm-icon" aria-hidden="true">${decision === 'approve' ? '✅' : '❌'}</p><p>${esc(decision === 'approve' ? `${hours} h approved for ${o.name} on ${fmtDay(o.date)}. Payroll pays the time worked inside the period, up to ${hours} h.` : `Overtime for ${o.name} on ${fmtDay(o.date)} was rejected.`)} The employee has been notified.</p></div>`, '<div class="dialog-foot"><button class="primary" data-close>OK</button></div>');
      } catch (error) { dialog.querySelectorAll('.dialog-foot button').forEach(b => { b.disabled = false; }); toast(error.message); }
    };
    approveBtn.onclick = () => decide('approve');
    dialog.querySelector('[data-ot-reject]').onclick = () => decide('reject');
  }

  // HR records overtime for an employee (approved at once), e.g. someone without a portal account.
  function fileForEmployee(box) {
    const people = employees().filter(e => e.coveredOT && !e.archived && !e.draft && e.active !== false).sort((a, b) => a.name.localeCompare(b.name));
    openDialog('File overtime for an employee', `<form id="ot-hr-file" class="dialog-body form-grid">
        <label class="field full">Employee<select name="employeeId" required><option value="">Choose…</option>${people.map(e => `<option value="${esc(e.id)}">${esc(e.name)} · ${esc(e.id)}</option>`).join('')}</select></label>
        <label class="field">Date<input type="date" name="date" required></label><label class="field">Unpaid break (minutes)<input type="number" name="breakMinutes" min="0" max="480" step="5" value="0"></label>
        <label class="field">Start<input type="time" name="startTime" required></label><label class="field">End<input type="time" name="endTime" required></label>
        <p class="full ot-total" data-ot-total>—</p>
        <label class="field full">Work done / reason<textarea name="reason" rows="2" required minlength="3" maxlength="1000"></textarea></label>
        <p class="full legend">Recorded as approved. The employee is notified.</p></form>`,
      '<div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary" form="ot-hr-file">Record approved overtime</button></div>');
    const form = dialog.querySelector('#ot-hr-file');
    form.addEventListener('input', () => { form.querySelector('[data-ot-total]').textContent = describeTotal(form.elements.startTime.value, form.elements.endTime.value, form.elements.breakMinutes.value); });
    form.onsubmit = async event => {
      event.preventDefault(); const f = new FormData(form);
      try {
        await api('/overtime-requests', { employeeId: f.get('employeeId'), date: f.get('date'), startTime: f.get('startTime'), endTime: f.get('endTime'), breakMinutes: Number(f.get('breakMinutes') || 0), reason: String(f.get('reason')).trim() });
        dialog.close(); await fill(box); onChanged?.(); toast('Overtime recorded as approved.');
      } catch (error) { toast(error.message); }
    };
  }
  return { panel: () => '<div data-overtime-apps><div class="loading">Loading overtime applications…</div></div>', fill };
}

// "2 h 30 min (ends next day)" from a start, end and unpaid break; shared with the employee form.
export function describeTotal(start, end, breakMinutes = 0) {
  if (!start || !end) return '—';
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  let span = toMin(end) - toMin(start); if (span <= 0) span += 1440;
  const minutes = span - Number(breakMinutes || 0);
  if (minutes <= 0) return 'The break must be shorter than the overtime period.';
  return `Total overtime: ${Math.round(minutes / 60 * 100) / 100} h (${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''})${end <= start ? ' · ends the next day' : ''}${Number(breakMinutes) ? ` · ${breakMinutes} min unpaid break excluded` : ''}`;
}
