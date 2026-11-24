// Employee Loans dashboard: applications awaiting a decision, every loan with amortization, repayments,
// outstanding balance, next deduction date and status, and each loan's repayment history.
export function createLoansPage({ api, esc, money, table, badge, toast, openDialog, dialog, shell, heading, canEdit, today }) {
  const fmt = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const STATUS = { pending: ['Pending', 'pending'], approved: ['Approved', ''], rejected: ['Rejected', 'rejected'], cancelled: ['Cancelled', 'neutral'] };
  let data = null;
  // Loans section tabs: Approved (loans still being repaid), Rejected (applications HR turned down), Fully paid.
  let loansView = 'approved';
  async function render() {
    shell(heading('Employee loans', 'Loading…') + '<div class="loading">Loading loans…</div>');
    data = await api('/loans/dashboard');
    const pending = data.applications.filter(a => a.status === 'pending'), canDecide = canEdit('loans') || canEdit('leaves');
    const active = data.loans.filter(l => l.status === 'Active');
    const ICON = { coins: '<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4"/>', doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>', repeat: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>', check: '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>', wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><rect x="4" y="8" width="16" height="11" rx="2"/><path d="M16 13.5h.01"/>', plus: '<path d="M12 5v14M5 12h14"/>', info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>', download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>', pencil: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>', xcircle: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>' };
    const ic = (k, cls = '') => `<svg class="ln-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
    const card = (k, label, value, foot) => `<div class="ln-card"><span class="ln-card-ico">${ic(k)}</span><div><span>${label}</span><strong>${value}</strong><small>${foot}</small></div></div>`;
    const empty = (k, title, text, action = '') => `<div class="ln-empty"><span class="ln-empty-ico">${ic(k)}</span><strong>${title}</strong><small>${text}</small>${action}</div>`;
    const canRecord = canEdit('loans');
    // The employee name opens the printable application form (PDF) in a new tab, ready to print or save.
    const pdfLink = a => `/api/loan-applications/${a.id}.pdf`;
    // Only applications waiting for a decision are listed; an approved one becomes a loan below (its form opens from the
    // loan's type), a rejected one stays in the employee's own history.
    const appRows = pending.map(a => `<tr><td><a class="ln-name" href="${pdfLink(a)}" target="_blank" rel="noopener" title="Open the loan application form">${esc(a.employeeName)}</a></td><td>${esc(a.type)}</td><td>${money(a.amount)}</td><td>${a.months}</td><td class="ln-wrap">${esc(a.purpose)}</td><td>${fmt(a.appliedAt)}</td><td>${badge(...STATUS[a.status])}${a.remarks ? `<small>${esc(a.remarks)}</small>` : ''}</td><td>${a.status === 'pending' && canDecide ? `<span class="row-actions"><button class="small primary" data-loan-approve="${a.id}">Approve</button><button class="small" data-loan-reject="${a.id}">Reject</button></span>` : ''}</td></tr>`).join('');
    const views = { approved: data.loans.filter(l => l.status !== 'Fully paid'), paid: data.loans.filter(l => l.status === 'Fully paid') };
    const rejected = data.applications.filter(a => a.status === 'rejected');
    const loanRows = (views[loansView] || []).map(l => `<tr><td><button class="ln-name" data-loan-history="${l.id}" title="Show payment history">${esc(l.employeeName)}</button></td><td>${l.applicationId ? `<a class="ln-name" href="/api/loan-applications/${l.applicationId}.pdf" target="_blank" rel="noopener" title="Open the loan application form">${esc(l.type)}</a>` : esc(l.type)}${(l.renewalOf || []).length ? `<small>Renewal of ${esc(l.renewalOf.map(r => r.reference).join(', '))}</small>` : ''}${l.renewedBy ? '<small>Closed by renewal</small>' : ''}</td><td>${l.loanDate ? fmt(l.loanDate) : '—'}</td><td>${money(l.original)}</td><td>${money(l.interestTotal || 0)}</td><td>${money(l.perPayroll)}${(l.skipCutoffs || []).length ? `<small>${l.skipCutoffs.length} cutoff${l.skipCutoffs.length === 1 ? '' : 's'} skipped</small>` : ''}</td><td>${money(l.totalRepaid)}</td><td><strong>${money(l.outstanding)}</strong></td><td>${fmt(l.nextDeduction)}</td><td>${badge(l.status, l.status === 'Active' ? '' : l.status === 'Awaiting release' ? 'pending' : 'neutral')}${l.release ? `<small>Released ${fmt(l.release.date)} · ${esc(l.release.reference)}</small>` : ''}${l.paymentConfirmed ? `<small>Paid / Confirmed ${fmt(l.paymentConfirmed.date)}</small>` : l.release && data.canRelease ? ` <button class="small" data-confirm-loan="${esc(l.id)}">Confirm paid</button>` : ''}</td><td>${l.awaitingRelease && data.canRelease ? `<button class="small primary" data-release-loan="${esc(l.id)}" data-label="${esc(`${l.employeeName} · ${l.type} ${money(l.original)}`)}">Record release</button> ` : ''}${l.status === 'Fully paid' || !canRecord ? '' : `<button class="ln-icon-btn" data-edit="loans" data-id="${esc(l.id)}" title="Review / edit" aria-label="Review / edit ${esc(l.employeeName)} ${esc(l.type)}">${ic('pencil')}</button>`}</td></tr>`).join('');
    shell(heading('Employee loans', 'Manage applications, balances, and payroll repayments.', canRecord ? `<button class="ln-primary" data-add="loans">${ic('plus')}Record a loan</button>` : '') +
      `<div class="ln-cards">${card('coins', 'Outstanding balance', money(active.reduce((s, l) => s + l.outstanding, 0)), `Principal + interest · ${active.length} active loan${active.length === 1 ? '' : 's'}`)}${card('doc', 'Applications to review', pending.length, 'Submitted from employee accounts')}${card('repeat', 'Repaid through payroll', money(data.loans.reduce((s, l) => s + l.totalRepaid, 0)), 'From posted payroll')}${card('check', 'Fully paid', data.loans.filter(l => l.status === 'Fully paid').length, 'Deductions completed')}</div>
      <section class="ln-panel"><div class="ln-panel-head"><h2>Loan applications <span class="ln-count">${pending.length}</span></h2><span class="ln-note">Employees apply through their portal.</span></div>
        <div class="ln-table-wrap"><table class="ln-table"><thead><tr><th>Employee</th><th>Type</th><th>Requested</th><th>Months</th><th>Purpose</th><th>Applied</th><th>Status</th><th></th></tr></thead><tbody>${appRows || `<tr><td colspan="8">${empty('doc', 'No applications to review', 'New loan applications from employee accounts appear here until HR approves or rejects them. Approved ones move to Loans.')}</td></tr>`}</tbody></table></div></section>
      <section class="ln-panel"><div class="ln-panel-head"><h2 class="ln-title"><button type="button" class="ln-title-card${loansView === 'approved' ? ' active' : ''}" data-loans-view="approved" aria-pressed="${loansView === 'approved'}" title="Show active loans">${ic('coins')}<span>Active loans</span><strong>${active.length}</strong></button></h2><nav class="ln-tabs" aria-label="Loans">${[['approved', 'Approved', views.approved.length, 'wallet'], ['rejected', 'Rejected', rejected.length, 'xcircle'], ['paid', 'Fully paid', views.paid.length, 'check']].map(([k, label, n, icon]) => `<button type="button" class="${loansView === k ? 'active' : ''}" data-loans-view="${k}" aria-pressed="${loansView === k}">${ic(icon)}${label} <span>${n}</span></button>`).join('')}</nav><span class="ln-tools"><span class="ln-note">Track balances and scheduled deductions.</span><a class="ln-btn" href="/api/reports/loans.xlsx" download>${ic('download')}Excel</a><a class="ln-btn" href="/api/reports/loans.pdf" download>${ic('download')}PDF</a></span></div>
        ${loansView === 'rejected'
          ? `<div class="ln-table-wrap"><table class="ln-table"><thead><tr><th>Employee</th><th>Type</th><th>Requested</th><th>Months</th><th>Purpose</th><th>Applied</th><th>Decided</th><th>Reason</th></tr></thead><tbody>${rejected.map(a => `<tr><td><a class="ln-name" href="${pdfLink(a)}" target="_blank" rel="noopener" title="Open the loan application form">${esc(a.employeeName)}</a></td><td>${esc(a.type)}</td><td>${money(a.amount)}</td><td>${a.months}</td><td class="ln-wrap">${esc(a.purpose)}</td><td>${fmt(a.appliedAt)}</td><td>${fmt(a.decidedAt)}</td><td class="ln-wrap">${esc(a.remarks || '—')}</td></tr>`).join('') || `<tr><td colspan="8">${empty('doc', 'No rejected applications', 'Applications HR does not approve are listed here with the reason.')}</td></tr>`}</tbody></table></div>
        <div class="ln-foot">${rejected.length} rejected application${rejected.length === 1 ? '' : 's'}</div></section>`
          : `<div class="ln-table-wrap"><table class="ln-table"><thead><tr><th>Employee</th><th>Loan</th><th>Loan date</th><th>Original</th><th>Interest</th><th>Per payroll</th><th>Repaid</th><th>Outstanding</th><th>Next deduction</th><th>Status</th><th></th></tr></thead><tbody>${loanRows || `<tr><td colspan="11">${loansView === 'paid' ? empty('check', 'No fully paid loans yet', 'Loans move here once the balance reaches zero.') : empty('wallet', 'No approved loans being repaid', 'Approve an application or record a loan to start tracking repayments.', canRecord ? `<button class="ln-btn" data-add="loans">${ic('plus')}Record a loan</button>` : '')}</td></tr>`}</tbody></table></div>
        <div class="ln-foot">${(views[loansView] || []).length} loan${(views[loansView] || []).length === 1 ? '' : 's'}</div></section>`}
      <p class="ln-info">${ic('info')}Repayments are deducted automatically. Balances update when payroll is posted.</p>`);
    document.querySelector('.content').addEventListener('click', onClick);
  }
  async function onClick(event) {
    const b = event.target.closest('button'); if (!b) return;
    if (b.dataset.loansView) { loansView = b.dataset.loansView; await render(); return; }
    // Finance / System Administrator: record that an approved loan was released (date + payment reference).
    if (b.dataset.confirmLoan) {
      const note = window.prompt('Confirm the loan payment to the employee.\n\nHow was it confirmed? (e.g. bank statement, signed acknowledgment)');
      if (!note || note.trim().length < 3) return;
      try { await api(`/loans/${b.dataset.confirmLoan}/confirm`, { date: today(), note: note.trim() }); toast('Loan payment confirmed.'); await render(); } catch (error) { toast(error.message); }
      return;
    }
    if (b.dataset.releaseLoan) {
      openDialog(`Record release · ${b.dataset.label}`, `<form id="loan-release" class="dialog-body"><p class="legend">Payroll deductions start once the release is recorded.</p><label class="field">Release date<input type="date" name="date" required value="${today()}"></label><label class="field">Payment reference<input name="reference" required minlength="2" maxlength="120" placeholder="Bank transfer / cheque number"></label><label class="field">Note<input name="note" maxlength="500"></label><button class="primary">Record release</button></form>`);
      dialog.querySelector('#loan-release').onsubmit = async ev => { ev.preventDefault(); const f = new FormData(ev.target); try { await api(`/loans/${b.dataset.releaseLoan}/release`, { date: f.get('date'), reference: String(f.get('reference')), note: String(f.get('note') || '') }); dialog.close(); toast('Release recorded. Deductions start from the next payroll.'); await render(); } catch (error) { toast(error.message); } };
      return;
    }
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
        openDialog(`Payment history · ${l.type}`, `<div class="dialog-body"><p class="sub">${esc(l.employeeName)} · original ${money(l.original)}${l.interestTotal ? ` + interest ${money(l.interestTotal)}` : ''}${l.loanDate ? ` · loan date ${fmt(l.loanDate)}` : ''} · repaid ${money(l.totalRepaid)}</p>${table(['Date paid', 'Deducted', 'Principal', 'Interest', 'Balance after'], l.history.map(h => [h.prior ? fmt(h.end) : h.paidOn ? fmt(h.paidOn) : `${fmt(h.start)} – ${fmt(h.end)}`, money(h.amount), money(h.principal), money(h.interest), (h.balanceAfter < 0 ? `Overpaid ${money(-h.balanceAfter)}` : money(h.balanceAfter))]), 'No posted repayments yet.')}<div class="bd-total"><span>Outstanding</span><strong>${money(l.outstanding)}</strong></div></div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
      }
      if (b.dataset.loanReject) {
        const remarks = window.prompt('Reason for not approving (the employee will see this):'); if (!remarks) return;
        await api(`/loan-applications/${b.dataset.loanReject}/decision`, { decision: 'reject', remarks }); toast('Application rejected; the employee was notified.'); await render();
      }
      if (b.dataset.loanApprove) {
        const a = data.applications.find(x => x.id === b.dataset.loanApprove);
        // The employee's active loans: a new loan only when each is below 20% left; below that HR may renew it
        // (pay the balance off from this loan) or keep it running as a separate loan.
        const current = data.loans.filter(l => l.employeeId === a.employeeId && l.status === 'Active' && l.outstanding > 0).map(l => ({ ...l, share: l.outstanding / ((l.original || 0) + (l.interestTotal || 0) || 1) }));
        const blocked = current.filter(l => l.share >= 0.2 - 1e-9);
        const pct = l => `${Math.round(l.share * 1000) / 10}%`;
        const renewBox = !current.length ? '' : blocked.length
          ? `<p class="form-error full">A new loan is possible only when less than 20% of the current loan is left. ${blocked.map(l => `${esc(l.type)} ${esc(l.reference)}: ${pct(l)} still owed (${money(l.outstanding)} of ${money((l.original || 0) + (l.interestTotal || 0))})`).join('; ')}. Reject this application or wait until it is paid down.</p>`
          : `<fieldset class="full ln-renew"><legend>Current loans (less than 20% left)</legend>${current.map(l => `<label class="field check"><input type="checkbox" name="renew" value="${esc(l.id)}" data-owed="${l.outstanding}" checked> Renew: pay off ${esc(l.type)} ${esc(l.reference)}, ${money(l.outstanding)} still owed (${pct(l)})</label>`).join('')}<small>Ticked loans are paid off from this loan and closed; the employee receives the rest. Untick to keep a loan running as a separate loan.</small></fieldset>`;
        openDialog(`Approve ${a.type} · ${a.employeeName}`, `<form id="loan-approve"><div class="dialog-body form-grid">
          <p class="notice full">Employee asked for <strong>${money(a.amount)}</strong> over <strong>${a.months} month${a.months === 1 ? '' : 's'}</strong>. HR decides the terms: change the amount, interest or months below. The loan and the employee's record follow what you approve, and the employee is told what changed.</p>
          ${renewBox}
          <label class="field">Approved amount (principal)<input type="number" name="approvedAmount" min="1" step="0.01" required value="${a.amount}"></label>
          <label class="field">Interest / fees (total, optional)<input type="number" name="interest" min="0" step="0.01" value="0"><small>Tracked separately; only the principal portion reduces the principal.</small></label>
          <label class="field">Repayment months<input type="number" name="months" min="1" max="120" required value="${a.months}"></label>
          <label class="field">First deduction from<input type="date" name="startDate" required value="${today()}"></label>
          <label class="field">Loan reference (optional)<input name="reference" maxlength="120"></label>
          <label class="field">Remarks to the employee (optional)<input name="remarks" maxlength="1000"></label>
          <p class="legend full" data-loan-preview></p>
          <p class="legend full">Payroll deducts the monthly amortization (split across cutoffs on semi-monthly payroll) starting from the first payroll period on or after this date.</p></div>
          <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary" ${blocked.length ? 'disabled title="The current loan must be below 20% left"' : ''}>Approve loan</button></div></form>`);
        // Live preview of the approved terms, and what differs from the request.
        const formEl = dialog.querySelector('#loan-approve'), preview = () => {
          const f = new FormData(formEl), amt = Number(f.get('approvedAmount')) || 0, intr = Number(f.get('interest')) || 0, months = Number(f.get('months')) || 0;
          const monthly = months ? Math.round((amt + intr) / months * 100) / 100 : 0, changed = [amt !== a.amount ? `amount ${money(a.amount)} → ${money(amt)}` : '', months !== a.months ? `${a.months} → ${months} months` : '', intr ? `interest / fees ${money(intr)}` : ''].filter(Boolean);
          const payoff = [...formEl.querySelectorAll('[name="renew"]:checked')].reduce((sum, c) => sum + Number(c.dataset.owed), 0);
          const renewal = payoff ? ` <strong>Renewal:</strong> ${money(payoff)} pays off the current loan; <strong>${money(amt - payoff)} released</strong> to the employee.${amt < payoff ? ' <span class="st-warn">The approved amount must cover the balance.</span>' : ''}` : '';
          formEl.querySelector('[data-loan-preview]').innerHTML = months ? `<strong>Approved terms:</strong> ${money(amt + intr)} over ${months} month${months === 1 ? '' : 's'} = ${money(monthly)} a month, <strong>${money(Math.round(monthly / 2 * 100) / 100)} per payroll</strong> (${months * 2} cutoffs).${changed.length ? ` <span class="st-warn">Changed from the request: ${changed.join('; ')}.</span>` : ' Same as requested.'}${renewal}` : '';
        };
        formEl.addEventListener('input', preview); preview();
        dialog.querySelector('#loan-approve').onsubmit = async ev => {
          ev.preventDefault(); const f = new FormData(ev.target);
          try { await api(`/loan-applications/${a.id}/decision`, { decision: 'approve', renewLoanIds: f.getAll('renew'), approvedAmount: Number(f.get('approvedAmount')), interest: Number(f.get('interest') || 0), months: Number(f.get('months')), startDate: f.get('startDate'), reference: f.get('reference'), remarks: f.get('remarks') }); dialog.close(); toast(f.getAll('renew').length ? 'Loan approved as a renewal: the old balance is paid off and the rest released.' : 'Loan approved. Payroll will deduct it automatically.'); await render(); } catch (error) { toast(error.message); }
        };
      }
    } catch (error) { toast(error.message); }
  }
  return { render };
}
