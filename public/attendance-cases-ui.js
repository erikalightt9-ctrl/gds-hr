// Incomplete attendance (Nov 20, 2026): HR's case list (Attendance → Requests) and the employee's "Records to correct".
// The correction status (the time correction request) and the payment status (payroll adjustment) are shown apart.
const ISSUE_CLASS = { 'missing-in': 'att-chip-in', 'missing-out': 'att-chip-out', 'no-record': 'att-chip-none' };
const nice = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const CORR_TONE = { approved: '', rejected: 'rejected', pending: 'pending', 'not-requested': 'neutral' };
const PAY_TONE = { pending: 'pending', review: 'rejected', recover: 'pending', included: '', paid: '', waived: 'neutral', none: 'neutral' };

export function createHrCases({ api, esc, badge, openDialog, dialog, toast }) {
  let cases = [], view = 'open';
  const chip = c => `<span class="att-chip ${ISSUE_CLASS[c.issue]}">${esc(c.issueLabel)}</span>`;
  function html() {
    const shown = cases.filter(c => (view === 'open' ? c.status === 'open' : view === 'review' ? ['review', 'pending', 'recover'].includes(c.adjustment?.status) : true));
    const n = { open: cases.filter(c => c.status === 'open').length, overdue: cases.filter(c => c.overdue).length, pay: cases.filter(c => ['review', 'pending', 'recover'].includes(c.adjustment?.status)).length };
    return `<section class="panel"><div class="panel-head"><div><h2>Incomplete attendance</h2><p class="legend">Missing time-in, missing time-out and days with no time-in / time-out are found automatically; the employee is asked for a time correction request within 3 working days. Nothing is assumed: an open day needs your documented pay treatment before posting, and corrections of paid days settle only the difference.</p></div></div>
      <div class="ot-summary"><button data-case-view="open" class="${view === 'open' ? 'active' : ''}"><strong>${n.open}</strong>Open${n.overdue ? ` · ${n.overdue} overdue` : ''}</button><button data-case-view="review" class="${view === 'review' ? 'active' : ''}"><strong>${n.pay}</strong>Pay adjustments</button><button data-case-view="all" class="${view === 'all' ? 'active' : ''}"><strong>${cases.length}</strong>All</button></div>
      <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Date</th><th>Issue</th><th>Correction due</th><th>Correction</th><th>Payroll</th><th></th></tr></thead><tbody>
      ${shown.map(c => `<tr><td>${esc(c.employeeName)}</td><td>${esc(nice(c.date))}${c.timeIn || c.timeOut ? `<br><small>${esc(c.timeIn || '—')} – ${esc(c.timeOut || '—')}</small>` : ''}</td><td>${chip(c)}</td>
        <td>${c.status === 'open' ? `${esc(nice(c.due))}${c.overdue ? `<br><strong class="att-overdue">Overdue${c.escalatedAt ? ' · escalated' : ''}</strong>` : ''}` : `<small>Resolved: ${esc(c.resolution || '')}</small>`}</td>
        <td>${badge(c.correction.label, CORR_TONE[c.correction.status])}${c.correction.reference ? `<br><small>${esc(c.correction.reference)}</small>` : ''}</td>
        <td>${badge(c.payment.label, PAY_TONE[c.payment.status] || 'neutral')}${c.treatment ? `<br><small>${esc(c.treatment.note)} (${esc(c.treatment.by)})</small>` : ''}</td>
        <td>${c.status === 'open' ? `<button class="small" data-case-treat="${esc(c.id)}">${c.treatment ? 'Change treatment' : 'Pay treatment'}</button>` : ''}${c.adjustment?.status === 'review' ? `<button class="small primary" data-case-over="${esc(c.id)}">Review overpayment</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing to show yet.</td></tr>'}
      </tbody></table></div></section>`;
  }
  async function mount(box) {
    if (!box) return;
    try { cases = await api('/attendance-cases'); } catch (error) { box.innerHTML = `<p class="muted">${esc(error.message)}</p>`; return; }
    box.innerHTML = html();
    box.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.dataset.caseView) { view = b.dataset.caseView; box.innerHTML = html(); }
      if (b.dataset.caseTreat) treatment(cases.find(c => c.id === b.dataset.caseTreat), box);
      if (b.dataset.caseOver) overpayment(cases.find(c => c.id === b.dataset.caseOver), box);
    };
  }
  function form(title, intro, fields, path, done) {
    openDialog(title, `<form class="dialog-body form-grid" id="case-form"><p class="full legend">${intro}</p>${fields}<label class="field full">Reason / documentation (required)<textarea name="note" required minlength="5" maxlength="500"></textarea></label><p class="full oof-error" data-case-error hidden></p><button class="primary full" type="submit">Save</button></form>`);
    const f = dialog.querySelector('#case-form');
    f.onsubmit = async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(f)), err = f.querySelector('[data-case-error]');
      try { await api(path, data); dialog.close(); toast('Saved.'); done(); } catch (error) { err.textContent = error.message; err.hidden = false; }
    };
  }
  function treatment(c, box) {
    form(`${c.employeeName} · ${nice(c.date)}`, `${esc(c.issueLabel)}. Choose how this cutoff's payroll treats the day until it is corrected. The correction later replaces this treatment; if the payroll is already paid, only the difference is settled.`,
      `<label class="field full">Treatment<select name="mode"><option value="credit" ${c.treatment?.mode === 'credit' ? 'selected' : ''}>Credit the day as attended, pending verification</option><option value="hold" ${c.treatment?.mode === 'hold' ? 'selected' : ''}>Hold: do not credit the day until it is corrected</option></select></label>`,
      `/attendance-cases/${c.id}/treatment`, () => mount(box));
  }
  function overpayment(c, box) {
    form(`${c.employeeName} · ${nice(c.date)}`, `The correction shows ₱${c.adjustment.amount.toFixed(2)} paid too much in the ${esc(c.adjustment.paidCutoff)} payroll.`,
      '<label class="field full">Decision<select name="action"><option value="recover">Recover through the next payroll</option><option value="waive">Waive (do not recover)</option></select></label>',
      `/attendance-cases/${c.id}/overpayment`, () => mount(box));
  }
  return { mount };
}

// Employee: their open records with the due date and a button that opens the correction form for that day.
export async function mountMyCases(box, { api, esc, openForm }) {
  if (!box) return;
  let list;
  try { list = await api('/me/attendance-cases'); } catch { box.innerHTML = ''; return; }
  const open = list.filter(c => c.status === 'open'), done = list.filter(c => c.status !== 'open').slice(0, 10);
  const category = { 'missing-in': 'forgot-in', 'missing-out': 'forgot-out', 'no-record': 'other' };
  box.innerHTML = list.length ? `<section class="panel"><div class="panel-head"><div><h2>Records to correct</h2><p class="legend">These days are missing a time-in or time-out. Submit a time correction request with the actual time and the reason within 3 working days.</p></div></div><div class="ar-list">
    ${open.map(c => `<article class="ar-item"><header><strong>${esc(nice(c.date))}</strong><span class="att-chip ${ISSUE_CLASS[c.issue]}">${esc(c.issueLabel)}</span></header><p>${c.timeIn || c.timeOut ? `Recorded: ${esc(c.timeIn || '—')} – ${esc(c.timeOut || '—')} · ` : ''}Correction: <b>${esc(c.correction.label)}</b> · Payroll: ${esc(c.payment.label)}</p><p class="${c.overdue ? 'att-overdue' : 'legend'}">${c.overdue ? 'Overdue: ' : ''}please submit by ${esc(nice(c.due))}</p>${c.correction.status === 'pending' ? '' : `<div class="row-actions"><button class="small primary" data-case-fix="${esc(c.date)}" data-case-cat="${category[c.issue]}">Request correction</button></div>`}</article>`).join('') || '<p class="muted">No open records.</p>'}
    ${done.length ? `<details><summary>Corrected (${done.length})</summary>${done.map(c => `<p>${esc(nice(c.date))} · ${esc(c.issueLabel)} · correction ${esc(c.correction.label)} · payroll: ${esc(c.payment.label)}</p>`).join('')}</details>` : ''}</div></section>` : '';
  box.onclick = event => { const b = event.target.closest('[data-case-fix]'); if (b) openForm(b.dataset.caseCat, () => mountMyCases(box, { api, esc, openForm }), b.dataset.caseFix); };
}
