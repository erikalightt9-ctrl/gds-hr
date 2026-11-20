// Employee movements, offboarding and clearance (Nov 20, 2026): on the 201 Employment tab (one employee) and as a
// page (everyone). Requested with an effective date and reason, approved by a second person, applied on the date.
const TYPES = { promotion: 'Promotion', transfer: 'Transfer', regularization: 'Regularization', 'type-change': 'Change of employment type / classification', separation: 'Separation' };
const KINDS = ['Resignation', 'End of contract', 'Termination (just cause)', 'Termination (authorized cause)', 'Retirement'];
const STATUS = { pending: ['Waiting for a second approver', 'pending'], approved: ['Approved · applies on the effective date', 'pending'], applied: ['Applied', ''], rejected: ['Rejected', 'rejected'] };
const CLEAR = { pending: ['Pending', 'pending'], cleared: ['Cleared', ''], 'not-applicable': ['Not applicable', 'neutral'] };

function rowsHtml(list, esc, badge, withName) {
  const change = m => (m.type === 'separation' ? `${esc(m.changes.separationKind)} · last day ${esc(m.effectiveDate)}` : [m.changes.position && `Position: ${esc(m.before.position || '—')} → <strong>${esc(m.changes.position)}</strong>`, m.changes.department && `Department: ${esc(m.before.department || '—')} → <strong>${esc(m.changes.department)}</strong>`, m.changes.classification && `Classification: ${esc(m.before.classification || '—')} → <strong>${esc(m.changes.classification)}</strong>`, m.changes.employmentType && `Type: ${esc(m.before.employmentType || '—')} → <strong>${esc(m.changes.employmentType)}</strong>`].filter(Boolean).join('<br>'));
  const clearance = m => (m.clearance ? `<details ${m.clearanceCompleteAt ? '' : 'open'}><summary>Clearance ${m.clearanceCompleteAt ? badge('Complete', '') : badge(`${m.clearance.filter(i => i.status === 'pending').length} pending`, 'pending')}</summary><ul class="plain-list">${m.clearance.map(i => `<li>${badge(...CLEAR[i.status])} <strong>${esc(i.label)}</strong> <small>${esc(i.owner)}${i.note ? ` · ${esc(i.note)} (${esc(i.by)})` : ''}</small>${m.canClear && i.status === 'pending' ? ` <button class="small" data-clear="${esc(m.id)}" data-key="${esc(i.key)}" data-status="cleared">Clear…</button> <button class="small" data-clear="${esc(m.id)}" data-key="${esc(i.key)}" data-status="not-applicable">N/A…</button>` : ''}</li>`).join('')}</ul></details>` : '');
  return list.map(m => `<tr>${withName ? `<td><strong>${esc(m.employeeName)}</strong></td>` : ''}<td>${esc(m.typeLabel)}</td><td>${esc(m.effectiveDate)}</td><td class="wrap">${change(m)}${clearance(m)}</td><td class="wrap">${esc(m.reason)}</td><td>${badge(...(STATUS[m.status] || [m.status, 'neutral']))}<br><small>${esc(m.requestedBy)}${m.decidedBy ? ` → ${esc(m.decidedBy)}` : ''}</small></td><td>${m.canDecide ? `<button class="small primary" data-mv-approve="${esc(m.id)}">Approve</button> <button class="small" data-mv-reject="${esc(m.id)}">Reject</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="${withName ? 7 : 6}" class="empty">Nothing to show yet.</td></tr>`;
}
export async function mountMovements(box, ctx, employeeId = '') {
  if (!box) return;
  const { api, esc, badge, toast, openDialog, dialog, today } = ctx;
  let list;
  try { list = await api(`/movements${employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : ''}`); } catch { box.innerHTML = '<p class="legend">Movements are available after the HR server restarts.</p>'; return; }
  box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>🔁 Movements, offboarding &amp; clearance</h2><p class="legend">Promotion, transfer, regularization, change of type and separation: requested with a reason and effective date, approved by a second HR Manager / Admin, applied on the date. A separation starts the clearance checklist. Pay changes are requested separately (Compensation → Request salary change).</p></div>${employeeId ? '<button class="small primary" data-mv-new>New movement</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr>${employeeId ? '' : '<th>Employee</th>'}<th>Movement</th><th>Effective</th><th>Change / clearance</th><th>Reason</th><th>Status</th><th></th></tr></thead><tbody>${rowsHtml(list, esc, badge, !employeeId)}</tbody></table></div></section>`;
  const reload = () => mountMovements(box, ctx, employeeId);
  box.onclick = async event => {
    const b = event.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.mvApprove) { await api(`/movements/${b.dataset.mvApprove}/decision`, { decision: 'approve' }); toast('Movement approved.'); return reload(); }
      if (b.dataset.mvReject) { const note = window.prompt('Reason for rejecting:'); if (!note) return; await api(`/movements/${b.dataset.mvReject}/decision`, { decision: 'reject', note }); toast('Movement rejected.'); return reload(); }
      if (b.dataset.clear) { const note = window.prompt(b.dataset.status === 'cleared' ? 'Note (what was returned, settled or checked):' : 'Why is this item not applicable?'); if (!note) return; await api(`/movements/${b.dataset.clear}/clearance`, { key: b.dataset.key, status: b.dataset.status, note }); toast('Clearance updated.'); return reload(); }
    } catch (error) { toast(error.message); return; }
    if (!b.hasAttribute('data-mv-new')) return;
    openDialog('New movement', `<form id="mv-form"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid">
      <label class="field">Movement<select name="type" required>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
      <label class="field">Effective date (separation: last day)<input type="date" name="effectiveDate" required value="${esc(today())}"></label>
      <label class="field" data-mv="change">New position<input name="position" maxlength="200"></label><label class="field" data-mv="change">New department / company<input name="department" maxlength="200"></label>
      <label class="field" data-mv="change">New classification<input name="classification" maxlength="60" placeholder="e.g. Regular"></label>
      <label class="field" data-mv="change">Employment type<select name="employmentType"><option value="">Unchanged</option><option>Full-Time</option><option>Part-Time</option><option>Other</option></select></label>
      <label class="field hidden" data-mv="separation">Kind of separation<select name="separationKind"><option value="">Choose…</option>${KINDS.map(k => `<option>${esc(k)}</option>`).join('')}</select></label>
      <label class="field full">Reason / basis (e.g. performance review, approved resignation letter)<textarea name="reason" rows="3" required minlength="10" maxlength="2000"></textarea></label>
      <p class="legend full">A second HR Manager or Administrator approves it. Termination still follows Due Process &amp; Discipline (notice, explanation, decision) before it is recorded here.</p></div></div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Send for approval</button></div></form>`);
    const form = dialog.querySelector('#mv-form'), sync = () => { const sep = form.elements.type.value === 'separation'; form.querySelectorAll('[data-mv]').forEach(el => el.classList.toggle('hidden', (el.dataset.mv === 'separation') !== sep)); };
    form.elements.type.onchange = sync; sync();
    form.onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form)), err = form.querySelector('.form-error');
      try { await api('/movements', { ...f, employeeId }); dialog.close(); toast('Movement sent for approval.'); reload(); } catch (error) { err.textContent = error.message; err.classList.remove('hidden'); }
    };
  };
}
