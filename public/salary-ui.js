// Salary history and changes on the 201 Compensation tab (Nov 20, 2026): request a change (new monthly salary and / or
// daily rate and pay basis, effective date, reason); a second person approves or rejects it; every change is listed.
const STATUS = { initial: ['Starting salary', 'neutral'], pending: ['Waiting for a second approver', 'pending'], approved: ['Approved · applies on the effective date', 'pending'], applied: ['Applied', ''], rejected: ['Rejected', 'rejected'] };
const peso = n => (n == null ? '—' : `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export async function mountSalary(box, { api, esc, toast, openDialog, dialog, today }, employeeId) {
  if (!box) return;
  let list;
  try { list = await api(`/salary-changes?employeeId=${encodeURIComponent(employeeId)}`); } catch { box.innerHTML = '<p class="legend">Salary history is available after the HR server restarts.</p>'; return; }
  const badge = s => { const [label, tone] = STATUS[s] || [s, 'neutral']; return `<span class="badge ${tone}">${esc(label)}</span>`; };
  const pay = x => [x.monthlySalary != null ? `${peso(x.monthlySalary)} / month` : '', x.dailyRate != null ? `${peso(x.dailyRate)} / day` : '', x.basis && x.basis !== 'monthly' ? x.basis : ''].filter(Boolean).join(' · ') || '—';
  box.innerHTML = `<section class="panel nv-panel nv-i-coins nv-red"><div class="panel-head"><div><h2>Salary history and changes</h2><p class="legend">A salary or rate is changed by request: reason and effective date, approved by a second person (not the requester). It applies on the effective date.</p></div><button class="small primary" data-salary-new>Request salary change</button></div>
    <div class="table-wrap"><table><thead><tr><th>Effective</th><th>From</th><th>To</th><th>Reason</th><th>Requested</th><th>Decision</th><th></th></tr></thead><tbody>
    ${list.map(c => `<tr><td>${esc(c.effectiveDate)}</td><td>${esc(pay(c.before))}</td><td><strong>${esc(pay(c.after))}</strong></td><td class="wrap">${esc(c.reason)}</td><td>${esc(c.requestedBy)}<br><small>${esc((c.requestedAt || '').slice(0, 10))}</small></td><td>${badge(c.status)}${c.decidedBy && c.status !== 'initial' ? `<br><small>${esc(c.decidedBy)} ${esc((c.decidedAt || '').slice(0, 10))}${c.decisionNote ? ` · ${esc(c.decisionNote)}` : ''}</small>` : ''}</td>
      <td>${c.canDecide ? `<button class="small primary" data-salary-approve="${esc(c.id)}">Approve</button> <button class="small" data-salary-reject="${esc(c.id)}">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing to show yet.</td></tr>'}
    </tbody></table></div></section>`;
  const reload = () => mountSalary(box, { api, esc, toast, openDialog, dialog, today }, employeeId);
  box.onclick = async event => {
    const b = event.target.closest('button'); if (!b) return;
    if (b.dataset.salaryApprove || b.dataset.salaryReject) {
      const reject = !!b.dataset.salaryReject, note = reject ? window.prompt('Reason for rejecting this salary change:') : '';
      if (reject && !note) return;
      try { await api(`/salary-changes/${b.dataset.salaryApprove || b.dataset.salaryReject}/decision`, { decision: reject ? 'reject' : 'approve', ...(note ? { note } : {}) }); toast(reject ? 'Salary change rejected.' : 'Salary change approved.'); reload(); } catch (error) { toast(error.message); }
      return;
    }
    if (!b.hasAttribute('data-salary-new')) return;
    openDialog('Request salary change', `<form id="salary-form"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid">
      <label class="field">New monthly salary (blank = unchanged)<input type="number" name="monthlySalary" min="1" step="0.01"></label>
      <label class="field">New daily rate (blank = unchanged)<input type="number" name="dailyRate" min="0.01" step="0.01"></label>
      <label class="field">Pay basis<select name="basis"><option value="">Unchanged</option><option value="monthly">Monthly</option><option value="daily">Daily-paid</option><option value="days-worked">Per day worked</option></select></label>
      <label class="field">Effective date<input type="date" name="effectiveDate" required value="${esc(today())}"></label>
      <label class="field full">Reason (e.g. regularization, promotion, annual increase)<textarea name="reason" rows="3" required minlength="10" maxlength="1000"></textarea></label>
      <p class="legend full">A second person (Admin or Payroll, not you) must approve it before it applies.</p></div></div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Send for approval</button></div></form>`);
    const form = dialog.querySelector('#salary-form');
    form.onsubmit = async e => {
      e.preventDefault();
      const f = form.elements, num = el => (el.value === '' ? null : Number(el.value)), err = form.querySelector('.form-error');
      try { await api('/salary-changes', { employeeId, monthlySalary: num(f.monthlySalary), dailyRate: num(f.dailyRate), basis: f.basis.value, effectiveDate: f.effectiveDate.value, reason: f.reason.value }); dialog.close(); toast('Salary change sent for approval.'); reload(); }
      catch (error) { err.textContent = error.message; err.classList.remove('hidden'); }
    };
  };
}
