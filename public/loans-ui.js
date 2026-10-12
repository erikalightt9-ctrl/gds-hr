// Employee Loans dashboard: applications awaiting a decision, every loan with amortization, repayments,
// outstanding balance, next deduction date and status, and each loan's repayment history.
import { who } from './hr-common.js';
export function createLoansPage({ api, esc, money, table, badge, toast, openDialog, dialog, shell, heading, canEdit, today, editButton }) {
  const fmt = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const STATUS = { pending: ['Pending', 'pending'], approved: ['Approved', ''], rejected: ['Rejected', 'rejected'], cancelled: ['Cancelled', 'neutral'] };
  let data = null;
  async function render() {
    shell(heading('Employee loans', 'Loading…') + '<div class="loading">Loading loans…</div>');
    data = await api('/loans/dashboard');
    const pending = data.applications.filter(a => a.status === 'pending'), canDecide = canEdit('loans') || canEdit('leaves');
    const active = data.loans.filter(l => l.status === 'Active');
    const ICON = { coins: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4"/>', doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>', repeat: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>', check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>', wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M16 13.5h.01"/>', plus: '<path d="M12 5v14M5 12h14"/>', info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>', download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>' };
    const ic = (k, cls = '') => `<svg class="ln-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
    const card = (k, label, value, foot) => `<div class="ln-card"><span class="ln-card-ico">${ic(k)}</span><div><span>${label}</span><strong>${value}</strong><small>${foot}</small></div></div>`;
    const empty = (k, title, text, action = '') => `<div class="ln-empty"><span class="ln-empty-ico">${ic(k)}</span><strong>${title}</strong><small>${text}</small>${action}</div>`;
    const canRecord = canEdit('loans');
    const appRows = data.applications.map(a => `<tr><td>${esc(a.employeeName)}</td><td>${esc(a.type)}</td><td>${money(a.amount)}</td><td>${a.months}</td><td class="ln-wrap">${esc(a.purpose)}</td><td>${fmt(a.appliedAt)}</td><td>${badge(...STATUS[a.status])}${a.remarks ? `<small>${esc(a.remarks)}</small>` : ''}${a.decidedBy ? `<small>by ${esc(who(a.decidedBy))}</small>` : ''}</td><td>${a.status === 'pending' && canDecide ? `<span class="row-actions"><button class="small primary" data-loan-approve="${a.id}">Approve</button><button class="small" data-loan-reject="${a.id}">Reject</button></span>` : ''}</td></tr>`).join('');
    const loanRows = data.loans.map(l => `<tr><td>${esc(l.employeeName)}</td><td>${esc(l.type)}<small>${esc(l.reference)}${l.loanDate ? ` · loaned ${fmt(l.loanDate)}` : ''}</small></td><td>${money(l.original)}</td><td>${money(l.interestTotal || 0)}</td><td>${money(l.perPayroll)}${(l.skipCutoffs || []).length ? `<small>${l.skipCutoffs.length} cutoff${l.skipCutoffs.length === 1 ? '' : 's'} skipped</small>` : ''}</td><td>${money(l.totalRepaid)}</td><td><strong>${money(l.outstanding)}</strong></td><td>${fmt(l.nextDeduction)}</td><td>${badge(l.status, l.status === 'Active' ? '' : 'neutral')}</td><td><span class="row-actions"><button class="small" data-loan-history="${l.id}">History</button>${l.status === 'Active' && canRecord ? `<button class="small" data-loan-skip="${l.id}">Skip cutoffs</button>` : ''}${editButton('loans', l.id)}</span></td></tr>`).join('');
    shell(heading('Employee loans', 'Manage applications, balances, and payroll repayments.', canRecord ? `<button class="ln-primary" data-add="loans">${ic('plus')}Record a loan</button>` : '') +
      `<div class="ln-cards">${card('coins', 'Outstanding balance', money(active.reduce((s, l) => s + l.outstanding, 0)), `Principal + interest · ${active.length} active loan${active.length === 1 ? '' : 's'}`)}${card('doc', 'Applications to review', pending.length, 'Submitted from employee accounts')}${card('repeat', 'Repaid through payroll', money(data.loans.reduce((s, l) => s + l.totalRepaid, 0)), 'From posted payroll')}${card('check', 'Fully paid', data.loans.filter(l => l.status === 'Fully paid').length, 'Deductions completed')}</div>
      <section class="ln-panel"><div class="ln-panel-head"><h2>Loan applications <span class="ln-count">${data.applications.length}</span></h2><span class="ln-note">Employees apply through their portal.</span></div>
        <div class="ln-table-wrap"><table class="ln-table"><thead><tr><th>Employee</th><th>Type</th><th>Requested</th><th>Months</th><th>Purpose</th><th>Applied</th><th>Status</th><th></th></tr></thead><tbody>${appRows || `<tr><td colspan="8">${empty('doc', 'No applications to review', 'Employee loan applications will appear here.')}</td></tr>`}</tbody></table></div></section>
      <section class="ln-panel"><div class="ln-panel-head"><h2>Loans <span class="ln-count">${data.loans.length}</span></h2><span class="ln-tools"><span class="ln-note">Track balances and scheduled deductions.</span><a class="ln-btn" href="/api/reports/loans.xlsx" download>${ic('download')}Excel</a><a class="ln-btn" href="/api/reports/loans.pdf" download>${ic('download')}PDF</a></span></div>
        <div class="ln-table-wrap"><table class="ln-table"><thead><tr><th>Employee</th><th>Loan</th><th>Original</th><th>Interest</th><th>Per payroll</th><th>Repaid</th><th>Outstanding</th><th>Next deduction</th><th>Status</th><th></th></tr></thead><tbody>${loanRows || `<tr><td colspan="10">${empty('wallet', 'No loans recorded yet', 'Record an approved loan to start tracking repayments.', canRecord ? `<button class="ln-btn" data-add="loans">${ic('plus')}Record a loan</button>` : '')}</td></tr>`}</tbody></table></div>
        <div class="ln-foot">${data.loans.length} loan${data.loans.length === 1 ? '' : 's'}</div></section>
      <p class="ln-info">${ic('info')}Repayments are deducted automatically. Balances update when payroll is posted.</p>`);
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
