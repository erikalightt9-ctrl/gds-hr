// Employee Loans dashboard: applications awaiting a decision, every loan with amortization, repayments,
// outstanding balance, next deduction date and status, and each loan's repayment history.
import { who } from './hr-common.js';
export function createLoansPage({ api, esc, money, table, badge, toast, openDialog, dialog, shell, heading, canEdit, today, editButton, addButton, downloads }) {
  const fmt = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const STATUS = { pending: ['Pending', 'pending'], approved: ['Approved', ''], rejected: ['Rejected', 'rejected'], cancelled: ['Cancelled', 'neutral'] };
  let data = null;
  async function render() {
    shell(heading('Employee loans', 'Loading…') + '<div class="loading">Loading loans…</div>');
    data = await api('/loans/dashboard');
    const pending = data.applications.filter(a => a.status === 'pending'), canDecide = canEdit('loans') || canEdit('leaves');
    const active = data.loans.filter(l => l.status === 'Active');
    shell(heading('Employee Loans', 'Applications, approved loans and repayments. Approved loans are deducted by payroll automatically; balances change only when payroll is posted.', addButton('loans', 'Record a loan')) +
      `<div class="cards"><div class="card featured"><div class="card-label">Outstanding (principal + interest)</div><div class="card-value">${money(active.reduce((s, l) => s + l.outstanding, 0))}</div><div class="card-foot">${active.length} active loan${active.length === 1 ? '' : 's'}</div></div><div class="card"><div class="card-label">Applications to review</div><div class="card-value">${pending.length}</div><div class="card-foot">From employee accounts</div></div><div class="card"><div class="card-label">Repaid through posted payroll</div><div class="card-value">${money(data.loans.reduce((s, l) => s + l.totalRepaid, 0))}</div><div class="card-foot">All loans</div></div><div class="card"><div class="card-label">Fully paid</div><div class="card-value">${data.loans.filter(l => l.status === 'Fully paid').length}</div><div class="card-foot">Deductions stopped</div></div></div>
      <section class="panel"><div class="panel-head"><h2>Loan applications</h2><span class="legend">Employees apply from their portal</span></div>${table(['Employee', 'Type', 'Requested', 'Months', 'Purpose', 'Applied', 'Status', ''], data.applications.map(a => [esc(a.employeeName), esc(a.type), money(a.amount), a.months, `<span class="wrap">${esc(a.purpose)}</span>`, fmt(a.appliedAt), badge(...STATUS[a.status]) + (a.remarks ? `<small>${esc(a.remarks)}</small>` : '') + (a.decidedBy ? `<small>by ${esc(who(a.decidedBy))}</small>` : ''), a.status === 'pending' && canDecide ? `<span class="row-actions"><button class="small primary" data-loan-approve="${a.id}">Approve</button><button class="small" data-loan-reject="${a.id}">Reject</button></span>` : '']), 'No loan applications yet.')}</section>
      <section class="panel"><div class="panel-head"><h2>Loans</h2>${downloads('loans')}</div>${table(['Employee', 'Loan', 'Original', 'Interest', 'Per payroll', 'Repaid', 'Outstanding', 'Next deduction', 'Status', ''], data.loans.map(l => [esc(l.employeeName), `${esc(l.type)}<small>${esc(l.reference)}${l.loanDate ? ` · loaned ${fmt(l.loanDate)}` : ''}</small>`, money(l.original), money(l.interestTotal || 0), `${money(l.perPayroll)}${(l.skipCutoffs || []).length ? `<small>${l.skipCutoffs.length} cutoff${l.skipCutoffs.length === 1 ? '' : 's'} skipped</small>` : ''}`, money(l.totalRepaid), `<strong>${money(l.outstanding)}</strong>`, fmt(l.nextDeduction), badge(l.status, l.status === 'Active' ? '' : 'neutral'), `<span class="row-actions"><button class="small" data-loan-history="${l.id}">History</button>${l.status === 'Active' && canEdit('loans') ? `<button class="small" data-loan-skip="${l.id}">Skip cutoffs</button>` : ''}${editButton('loans', l.id)}</span>`]), 'No loans recorded.')}</section>`);
    document.querySelector('.content').addEventListener('click', onClick);
  }
  async function onClick(event) {
    const b = event.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.loanSkip) {
        // Cutoffs the employee asked not to be deducted: the past one, the current one and the next eight.
        const l = data.loans.find(x => x.id === b.dataset.loanSkip), now = today(), list = [];
        const base = new Date(`${now.slice(0, 7)}-01T00:00:00Z`); base.setUTCMonth(base.getUTCMonth() - 1);
        for (let i = 0; i < 10; i++) { const d = new Date(base); d.setUTCMonth(base.getUTCMonth() + Math.floor(i / 2)); const ym = d.toISOString().slice(0, 7); list.push(`${ym}-${i % 2 ? '16' : '01'}`); }
        const label = c => { const ym = c.slice(0, 7), last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).getUTCDate(); return c.endsWith('-01') ? `${fmt(c)} – ${fmt(`${ym}-15`)}` : `${fmt(c)} – ${fmt(`${ym}-${last}`)}`; };
        openDialog(`Skip cutoffs · ${l.type} ${l.reference}`, `<form id="loan-skip"><div class="dialog-body"><p class="sub">${esc(l.employeeName)} · ${money(l.perPayroll)} per payroll. Tick the cutoffs where the employee asked <strong>not</strong> to be deducted; the loan simply runs longer.</p><div class="skip-list">${list.map(c => `<label class="field check"><input type="checkbox" name="cutoff" value="${c}" ${(l.skipCutoffs || []).includes(c) ? 'checked' : ''}> ${label(c)}</label>`).join('')}</div><p class="form-error hidden" role="alert" data-skip-error></p></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
        dialog.querySelector('#loan-skip').onsubmit = async ev => {
          ev.preventDefault();
          const shown = new Set(list), keep = (l.skipCutoffs || []).filter(c => !shown.has(c));
          const cutoffs = [...keep, ...new FormData(ev.target).getAll('cutoff')];
          try { await api(`/loans/${l.id}/skips`, { cutoffs }); dialog.close(); toast('Saved. Payroll will not deduct this loan on the ticked cutoffs.'); await render(); }
          catch (error) { const e = dialog.querySelector('[data-skip-error]'); e.textContent = error.message; e.classList.remove('hidden'); }
        };
        return;
      }
      if (b.dataset.loanHistory) {
        const l = data.loans.find(x => x.id === b.dataset.loanHistory);
        openDialog(`Repayments · ${l.type} ${l.reference}`, `<div class="dialog-body"><p class="sub">${esc(l.employeeName)} · original ${money(l.original)}${l.interestTotal ? ` + interest ${money(l.interestTotal)}` : ''} · ${fmt(l.startDate)} – ${fmt(l.endDate)}</p>${table(['Payroll period', 'Deducted', 'Principal', 'Interest', 'Balance after'], l.history.map(h => [`${fmt(h.start)} – ${fmt(h.end)}`, money(h.amount), money(h.principal), money(h.interest), money(h.balanceAfter)]), 'No posted repayments yet.')}<div class="bd-total"><span>Outstanding</span><strong>${money(l.outstanding)}</strong></div></div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
      }
      if (b.dataset.loanReject) {
        const remarks = window.prompt('Reason for not approving (the employee will see this):'); if (!remarks) return;
        await api(`/loan-applications/${b.dataset.loanReject}/decision`, { decision: 'reject', remarks }); toast('Application rejected; the employee was notified.'); await render();
      }
      if (b.dataset.loanApprove) {
        const a = data.applications.find(x => x.id === b.dataset.loanApprove);
        openDialog(`Approve ${a.type} · ${a.employeeName}`, `<form id="loan-approve"><div class="dialog-body form-grid">
          <label class="field">Approved amount (principal)<input type="number" name="approvedAmount" min="1" step="0.01" required value="${a.amount}"></label>
          <label class="field">Interest / fees (total, optional)<input type="number" name="interest" min="0" step="0.01" value="0"><small>Tracked separately; only the principal portion reduces the principal.</small></label>
          <label class="field">Repayment months<input type="number" name="months" min="1" max="120" required value="${a.months}"></label>
          <label class="field">First deduction from<input type="date" name="startDate" required value="${today()}"></label>
          <label class="field">Loan reference (optional)<input name="reference" maxlength="120"></label>
          <label class="field">Remarks to the employee (optional)<input name="remarks" maxlength="1000"></label>
          <p class="legend full">Payroll deducts the monthly amortization (split across cutoffs on semi-monthly payroll) starting from the first payroll period on or after this date.</p></div>
          <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Approve loan</button></div></form>`);
        dialog.querySelector('#loan-approve').onsubmit = async ev => {
          ev.preventDefault(); const f = new FormData(ev.target);
          try { await api(`/loan-applications/${a.id}/decision`, { decision: 'approve', approvedAmount: Number(f.get('approvedAmount')), interest: Number(f.get('interest') || 0), months: Number(f.get('months')), startDate: f.get('startDate'), reference: f.get('reference'), remarks: f.get('remarks') }); dialog.close(); toast('Loan approved. Payroll will deduct it automatically.'); await render(); } catch (error) { toast(error.message); }
        };
      }
    } catch (error) { toast(error.message); }
  }
  return { render };
}
