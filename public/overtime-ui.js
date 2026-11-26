// Attendance → Overtime applications (HR / Admin decide; Payroll reads): every application with filters, the hours
// attendance shows inside the filed period, flags to settle before posting, a review window and HR filing.
import { who, reasonPicker, bindReasonPickers, readReason, OVERTIME_REASONS } from './hr-common.js';
// Approved → Included (in a finalized payroll, before its salary day) → Paid (salary day reached).
const salaryDayOf = cut => { const [y, m, d] = String(cut || '').slice(0, 10).split('-').map(Number); if (!y) return ''; return d === 1 ? `${y}-${String(m).padStart(2, '0')}-22` : new Date(Date.UTC(y, m, 8)).toISOString().slice(0, 10); };
const manilaDay = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
export const payStage = o => { if (!o.paidRunId) return null; const day = o.paidPayDate || salaryDayOf(o.paidCutoff); return day && day <= manilaDay() ? { label: `Paid · ${day}`, tone: '' } : { label: `Included · ${o.paidCutoff} (salary day ${day})`, tone: 'pending' }; };

const STATUS = { pending: ['Pending', 'pending'], approved: ['Approved', ''], rejected: ['Rejected', 'rejected'], cancelled: ['Cancelled', 'neutral'] };
const fmtDay = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const period = o => (o.startTime ? `${o.startTime} – ${o.endTime}${o.endTime <= o.startTime ? ' (next day)' : ''}` : 'Hours only');
const stamp = iso => (iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '');

export function createOvertimeUi({ api, esc, toast, openDialog, dialog, badge, canDecide, employees, onChanged }) {
  let list = [], filters = { employee: '', from: '', to: '', status: 'pending' };
  // Carryover (Nov 20, 2026): paid filings show the payroll that paid them; filings whose cutoff is posted but are not
  // paid yet show that they are carried over to the next payroll.
  const statusBadge = o => { const s = typeof o === 'string' ? o : o.status, [label, tone] = STATUS[s] || [s, 'neutral']; if (typeof o === 'object' && o.paidRunId) { const p = payStage(o); return badge(p.label, p.tone); } if (typeof o === 'object' && o.carriedOver) return badge(s === 'pending' ? 'Pending Overtime · carried over' : 'Approved · paid in the next payroll', 'pending'); return badge(label, tone); };

  function rows() {
    return list.filter(o => (!filters.employee || o.employeeId === filters.employee) && (!filters.from || o.date >= filters.from) && (!filters.to || o.date <= filters.to) && (!filters.status || (filters.status === 'flagged' ? o.flags?.length && ['pending', 'approved'].includes(o.status) : o.status === filters.status)));
  }
  function counts() {
    const n = s => list.filter(o => o.status === s).length;
    return { pending: n('pending'), approved: n('approved'), rejected: n('rejected'), cancelled: n('cancelled'), flagged: list.filter(o => o.flags?.length && ['pending', 'approved'].includes(o.status)).length };
  }
  // Page (Nov 26, 2026 design): red stopwatch header with skyline and File Overtime, five status cards, employee / date
  // range / status filters with Clear and Export (CSV), status tabs, numbered table (date & requested time, hours,
  // remarks with the first flag, status, View / ⋯), 10 rows per page.
  const PER_PAGE = 10;
  const g = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const I = { watch: g('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 3h6M12 3v2"/>'), hour: g('<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>'), review: g('<rect x="4" y="3" width="13" height="17" rx="2"/><circle cx="15" cy="15" r="3.5"/><path d="m17.5 17.5 3 3M8 8h5M8 11h3"/>'), check: g('<path d="m6 12.5 4 4 8-9"/>'), x: g('<path d="M7 7l10 10M17 7 7 17"/>'), ban: g('<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>'), list: g('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'), search: g('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'), cal: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'), clock: g('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), arrow: g('<path d="M9 6l6 6-6 6"/>'), funnel: g('<path d="M3 5h18l-7 8v6l-4-2v-4Z"/>'), export: g('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'), eye: g('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'), dots: g('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'), left: g('<path d="M15 6l-6 6 6 6"/>'), warn: g('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.01"/>'), plus: g('<path d="M12 5v14M5 12h14"/>') };
  const initials = n => { const [last, first] = String(n).split(',').map(x => x.trim()); return `${(first || last || '?')[0]}${first ? last[0] : ''}`.toUpperCase(); };
  let page = 1;
  function render(box) {
    const people = [...new Map(list.map(o => [o.employeeId, o.name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const c = counts(), shown = rows(), pages = Math.max(1, Math.ceil(shown.length / PER_PAGE)); page = Math.min(page, pages);
    const from = (page - 1) * PER_PAGE, slice = shown.slice(from, from + PER_PAGE);
    const card = (key, cls, icon, n, label) => `<button class="ota-card ota-${cls}${filters.status === key ? ' active' : ''}" data-ot-status="${key}"><span class="ota-card-ico">${icon}</span><span><strong>${n}</strong><small>${label}</small></span><i>${I.arrow}</i></button>`;
    const tab = (key, icon, label, n) => `<button data-ot-status="${key}" class="${filters.status === key ? 'active' : ''}">${icon}${label} (${n})</button>`;
    const flag = o => (o.flags?.length && ['pending', 'approved'].includes(o.status) ? `<span class="ota-flag">${I.warn}${esc(o.flags[0])}${o.flags.length > 1 ? ` (+${o.flags.length - 1})` : ''}</span>` : '');
    const pageNums = () => { const nums = [...new Set([1, page - 1, page, page + 1, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b); return nums.map((n, i) => `${i && n - nums[i - 1] > 1 ? '<span class="crx-gap">…</span>' : ''}<button data-ot-page="${n}" class="${n === page ? 'active' : ''}">${n}</button>`).join(''); };
    box.innerHTML = `<section class="crx ota">
      <header class="crx-hero ota-hero"><span class="crx-hero-ico">${I.watch}</span><div><h2>Overtime Applications</h2><p>Manage, review, and approve employee overtime requests. Only approved hours worked inside the filed period are paid; settle flags before posting payroll.</p></div>${canDecide() ? `<button class="ota-new" data-ot-new>${I.plus}File Overtime</button>` : ''}</header>
      <div class="ota-cards">${card('pending', 'pending', I.hour, c.pending, 'Pending')}${card('flagged', 'review', I.review, c.flagged, 'Needs Review')}${card('approved', 'approved', I.check, c.approved, 'Approved')}${card('rejected', 'rejected', I.x, c.rejected, 'Rejected')}${card('cancelled', 'cancelled', I.ban, c.cancelled, 'Cancelled')}</div>
      <div class="ota-tools"><label class="ota-field">Employee<select data-ot-filter="employee"><option value="">All Employees</option>${people.map(([id, name]) => `<option value="${esc(id)}" ${id === filters.employee ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>
        <div class="ota-field">Date Range<span class="ota-range">${I.cal}<label>From<input type="date" data-ot-filter="from" value="${esc(filters.from)}"></label><label>To<input type="date" data-ot-filter="to" value="${esc(filters.to)}"></label></span></div>
        <label class="ota-field">Status<select data-ot-filter="status">${[['', 'All Status'], ['pending', 'Pending'], ['flagged', 'Needs review'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled']].map(([v, l]) => `<option value="${v}" ${v === filters.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <span class="crx-right"><button class="crx-filter" data-ot-clear title="Clear the employee, date and status filters">${I.funnel}Clear filters</button><button class="crx-export" data-ot-export>${I.export}Export</button></span></div>
      <section class="crx-panel"><nav class="crx-tabs">${tab('', I.list, 'All Applications', list.length)}${tab('pending', I.hour, 'Pending', c.pending)}${tab('flagged', I.search, 'Needs Review', c.flagged)}${tab('approved', I.check, 'Approved', c.approved)}${tab('rejected', I.x, 'Rejected', c.rejected)}${tab('cancelled', I.ban, 'Cancelled', c.cancelled)}</nav>
      <div class="crx-wrap"><table class="crx-table ota-table"><thead><tr><th>#</th><th>Employee</th><th>Date &amp; Time (Requested OT)</th><th>Hours</th><th>Remarks</th><th>Status</th><th class="crx-act">Actions</th></tr></thead><tbody>
      ${slice.map((o, i) => `<tr><td class="crx-n">${from + i + 1}</td><td><span class="crx-emp"><i>${esc(initials(o.name))}</i><span><strong>${esc(o.name)}</strong><small>${esc(o.employeeId)}</small></span></span></td>
        <td class="ota-when"><span>${I.cal}${esc(fmtDay(o.date))}</span><span>${I.clock}${esc(period(o))}${o.breakMinutes ? ` · ${o.breakMinutes} min break` : ''}</span></td>
        <td class="ota-hours"><strong>${o.status === 'approved' ? `${o.approvedHours} of ${o.hours} h` : `${o.hours} h`}</strong><small>worked ${o.workedInPeriod ?? 0} h in period</small></td>
        <td class="ota-rem">${esc(o.reason || '—')}</td>
        <td class="ota-state">${statusBadge(o)}${flag(o)}${o.locked ? '<small>Payroll posted</small>' : ''}</td>
        <td class="crx-act"><button class="crx-view" data-ot-review="${esc(o.id)}">${I.eye}View</button><details class="crx-more"><summary aria-label="More actions">${I.dots}</summary><div><button data-ot-review="${esc(o.id)}">${canDecide() && !o.locked && o.status !== 'cancelled' ? 'Review and decide' : 'View details'}</button></div></details></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing to show yet.</td></tr>'}
      </tbody></table></div>
      <div class="crx-foot"><span>Showing ${shown.length ? `${from + 1}–${from + slice.length}` : '0'} of ${shown.length} applications</span><span class="crx-pages"><button data-ot-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Previous page">${I.left}</button>${pageNums()}<button data-ot-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Next page" class="crx-next">${I.left}</button></span></div></section></section>`;
  }
  function exportCsv() {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Employee', 'ID', 'Date', 'Period', 'Break (min)', 'Hours filed', 'Hours approved', 'Worked in period', 'Reason', 'Status', 'Flags'].map(cell).join(',')].concat(rows().map(o => [o.name, o.employeeId, o.date, period(o), o.breakMinutes || 0, o.hours, o.status === 'approved' ? o.approvedHours : '', o.workedInPeriod ?? 0, o.reason || '', o.status, (o.flags || []).join('; ')].map(cell).join(',')));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' })); a.download = 'overtime-applications.csv'; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  async function fill(box) {
    try { list = await api('/overtime-requests'); render(box); } catch (error) { box.innerHTML = `<p class="muted">${esc(error.message)}</p>`; }
    box.oninput = box.onchange = event => {
      const f = event.target.dataset.otFilter; if (!f) return;
      filters = { ...filters, [f]: event.target.value }; page = 1; render(box);
    };
    box.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.dataset.otStatus !== undefined) { filters = { ...filters, status: b.dataset.otStatus }; page = 1; render(box); }
      if (b.dataset.otReview) { b.closest('details')?.removeAttribute('open'); review(list.find(o => o.id === b.dataset.otReview), box); }
      if (b.dataset.otPage) { page = Number(b.dataset.otPage); render(box); }
      if (b.hasAttribute('data-ot-clear')) { filters = { employee: '', from: '', to: '', status: '' }; page = 1; render(box); }
      if (b.hasAttribute('data-ot-export')) exportCsv();
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
        <div class="ot-review-top">${statusBadge(o)}<span class="legend">${esc(o.employeeId)} · filed by ${esc(who(o.filedBy))} on ${esc(stamp(o.filedAt))}</span></div>
        <div class="notice-rows">${facts.map(([k, v]) => `<div class="notice-row"><span>${k}</span><strong>${esc(v)}</strong></div>`).join('')}</div>
        <p class="ot-reason"><span>Work to be done</span>${esc(o.reason)}</p>
        ${o.documentId ? `<p><a class="button" href="/api/documents/${esc(o.documentId)}/content" target="_blank" rel="noopener">📎 View attachment</a></p>` : ''}
        ${o.flags?.length ? `<div class="ot-flags">${o.flags.map(f => `<p>⚠ ${esc(f)}</p>`).join('')}</div>` : ''}
        ${o.status === 'approved' && o.adjustReason ? `<p class="legend">Adjusted: ${esc(o.adjustReason)}</p>` : ''}${o.remarks ? `<p class="legend">Remarks: ${esc(o.remarks)}</p>` : ''}
        ${open ? `<fieldset class="ot-decide"><legend>${o.status === 'pending' ? 'Decision' : 'Change the decision'}</legend>
          <label class="field">Hours to approve<input type="number" name="hours" min="0.25" max="${o.hours}" step="0.25" value="${start}" required></label>
          <label class="field ot-adjust ${start === o.hours ? 'hidden' : ''}">Reason for approving different hours<input name="adjustReason" maxlength="500" value="${esc(o.adjustReason || '')}" placeholder="e.g. Only 2 h were authorised"></label>
          ${o.status !== 'pending' ? '<label class="field">Reason for changing the decision <small>(required)</small><input name="changeReason" maxlength="500" placeholder="Why the earlier decision is changed"></label>' : ''}
          ${(o.flags || []).some(f => /not approved|No attendance/.test(f)) || o.payableHours === 0 ? `<p class="legend">Approval needs approved or system-validated attendance and payable hours (now ${o.payableHours ?? 0} h). Approve the attendance first, or give an override reason.</p><label class="field">Override reason <small>(only to approve anyway)</small><input name="overrideReason" maxlength="500" placeholder="e.g. Supervisor confirms the work; time out to be corrected"></label>` : ''}
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
      if (o.status !== 'pending' && (form.elements.changeReason?.value.trim() || '').length < 5) { toast('Give the reason for changing the decision.'); form.elements.changeReason?.focus(); return; }
      if (decision === 'approve' && hours !== o.hours && adjustReason.length < 3) { toast('Give the reason for approving different hours.'); form.elements.adjustReason.focus(); return; }
      dialog.querySelectorAll('.dialog-foot button').forEach(b => { b.disabled = true; });
      try {
        const changeReason = form.elements.changeReason?.value.trim() || '', overrideReason = form.elements.overrideReason?.value.trim() || '';
        await api(`/overtime-requests/${o.id}/decision`, { decision, remarks, ...(decision === 'approve' ? { hours, adjustReason } : {}), ...(changeReason ? { changeReason } : {}), ...(decision === 'approve' && overrideReason ? { overrideReason } : {}) });
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
        ${reasonPicker(OVERTIME_REASONS, '', { detailsLabel: 'Work done / explanation' })}
        <p class="full legend">Recorded as approved. The employee is notified.</p></form>`,
      '<div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary" form="ot-hr-file">Record approved overtime</button></div>');
    const form = dialog.querySelector('#ot-hr-file');
    bindReasonPickers(form.parentElement);
    form.addEventListener('input', () => { form.querySelector('[data-ot-total]').textContent = describeTotal(form.elements.startTime.value, form.elements.endTime.value, form.elements.breakMinutes.value); });
    form.onsubmit = async event => {
      event.preventDefault(); const f = new FormData(form);
      try {
        await api('/overtime-requests', { employeeId: f.get('employeeId'), date: f.get('date'), startTime: f.get('startTime'), endTime: f.get('endTime'), breakMinutes: Number(f.get('breakMinutes') || 0), reason: readReason(form) });
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
