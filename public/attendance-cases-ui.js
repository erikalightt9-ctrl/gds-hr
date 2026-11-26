// Incomplete attendance (Nov 20, 2026): HR's case list (Attendance → Requests) and the employee's "Records to correct".
// The correction status (the time correction request) and the payment status (payroll adjustment) are shown apart.
const ISSUE_CLASS = { 'missing-in': 'att-chip-in', 'missing-out': 'att-chip-out', 'no-record': 'att-chip-none' };
const nice = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const CORR_TONE = { approved: '', rejected: 'rejected', pending: 'pending', 'not-requested': 'neutral' };
const PAY_TONE = { pending: 'pending', review: 'rejected', recover: 'pending', included: '', paid: '', waived: 'neutral', none: 'neutral' };

const AIC = (() => { const g = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`; return {
  cal: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17"/>'), calCheck: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4"/>'), calAlert: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M12 12.5v3M12 17.8v.01"/>'),
  person: g('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'), people: g('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'),
  clock: g('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), in: g('<path d="M10 17l5-5-5-5M15 12H3M14 4h5a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-5"/>'), out: g('<path d="M14 17l-5-5 5-5M9 12h12M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"/>'),
  bars: g('<path d="M5 20v-6M10 20V9M15 20v-8M20 20V5"/>'), hour: g('<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>'), shield: g('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m9 12 2 2 4-4"/>'),
  warn: g('<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.01"/>'), check: g('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>'), layers: g('<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>'), gear: g('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 13.7H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10.3 3V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  coins: g('<ellipse cx="9" cy="7" rx="6" ry="2.5"/><path d="M3 7v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7M3 11v4c0 1.4 2.7 2.5 6 2.5"/><ellipse cx="15" cy="15" rx="6" ry="2.5"/><path d="M9 15v3c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-3"/>'), list: g('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
  clip: g('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 13l2 2 4-4"/>'), clipAlert: g('<rect x="4" y="4" width="13" height="17" rx="2"/><path d="M8 3h5v3H8zM8 11h5M8 15h3"/><circle cx="18" cy="17" r="4"/><path d="M18 15v2M18 19v.01"/>'), calClock: g('<rect x="3" y="5" width="14" height="14" rx="2.5"/><path d="M7 3v4M13 3v4M3 10h14"/><circle cx="17.5" cy="17" r="4"/><path d="M17.5 15v2l1.4 1"/>'),
  bookmark: g('<path d="M6 3h12v18l-6-4-6 4Z"/>'), doc: g('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'), badge: g('<path d="M12 3l2.5 2H18v3.5l2 2.5-2 2.5V17h-3.5L12 19l-2.5-2H6v-3.5L4 11l2-2.5V5h3.5Z"/><path d="m10 11 1.5 1.5L14 10"/>'), send: g('<path d="M21 3 3 10.5l7 2.5 2.5 7Z"/><path d="m10 13 4-4"/>'),
  docClock: g('<path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M13 3v5h5v2"/><circle cx="16.5" cy="16.5" r="4.5"/><path d="M16.5 14.5v2l1.4 1"/>'), doorIn: g('<path d="M4 4h8v16H4zM14 12h7M18 9l3 3-3 3"/>'), undo: g('<path d="M4 4v6h6"/><path d="M5 10a8 8 0 1 1 1.6 6.4"/>'), clockX: g('<path d="M20.5 13A8.5 8.5 0 1 1 12 3.5"/><path d="M12 7v5l3 2M17 3l4 4M21 3l-4 4"/>'),
  monitor: g('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4M12 7.5l2.5 4.5h-5Z"/>'), info: g('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'), case: g('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18"/>'), chat: g('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>'), xCircle: g('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'), ban: g('<circle cx="12" cy="12" r="9"/><path d="m5.7 5.7 12.6 12.6"/>'),
}; })();
const ahd = (icon, title, sub, count = '') => `<header class="ahd"><span class="ahd-ico">${icon}</span><div class="ahd-text"><h2>${title}</h2><p>${sub}</p></div>${count}</header>`;
const th = (icon, label) => `<th><span class="th-i">${icon}${label}</span></th>`;
export function createHrCases({ api, esc, badge, openDialog, dialog, toast }) {
  let cases = [], view = 'open';
  const chip = c => `<span class="att-chip ${ISSUE_CLASS[c.issue]}">${esc(c.issueLabel)}</span>`;
  function html() {
    const shown = cases.filter(c => (view === 'open' ? c.status === 'open' : view === 'review' ? ['review', 'pending', 'recover'].includes(c.adjustment?.status) : true));
    const n = { open: cases.filter(c => c.status === 'open').length, overdue: cases.filter(c => c.overdue).length, pay: cases.filter(c => ['review', 'pending', 'recover'].includes(c.adjustment?.status)).length };
    return `<section class="iac">${ahd(AIC.clipAlert, 'Incomplete Attendance', 'Missing time-in, missing time-out and days with no time-in / time-out are found automatically; the employee is asked for a time correction request within 3 working days. Nothing is assumed: an open day needs your documented pay treatment before posting, and corrections of paid days settle only the difference.')}
      <div class="iac-cards"><button data-case-view="open" class="iac-card iac-open${view === 'open' ? ' active' : ''}"><span><strong>${n.open}</strong>Open${n.overdue ? ` · <b>${n.overdue} overdue</b>` : ''}</span><i>${AIC.calAlert}</i></button><button data-case-view="review" class="iac-card iac-pay${view === 'review' ? ' active' : ''}"><span><strong>${n.pay}</strong>Pay adjustments</span><i>${AIC.coins}</i></button><button data-case-view="all" class="iac-card iac-all${view === 'all' ? ' active' : ''}"><span><strong>${cases.length}</strong>All records</span><i>${AIC.list}</i></button></div>
      <div class="table-wrap rtable"><table><thead><tr>${th(AIC.person, 'Employee')}${th(AIC.cal, 'Date')}${th(AIC.warn, 'Issue')}${th(AIC.cal, 'Correction Due')}${th(AIC.check, 'Correction')}${th(AIC.layers, 'Payroll')}${th(AIC.gear, 'Actions')}</tr></thead><tbody>
      ${shown.map(c => `<tr><td>${esc(c.employeeName)}</td><td>${esc(nice(c.date))}${c.timeIn || c.timeOut ? `<br><small>${esc(c.timeIn || '—')} – ${esc(c.timeOut || '—')}</small>` : ''}</td><td>${chip(c)}</td>
        <td>${c.status === 'open' ? `${esc(nice(c.due))}${c.overdue ? `<br><strong class="att-overdue">Overdue${c.escalatedAt ? ' · escalated' : ''}</strong>` : ''}` : `<small>Resolved: ${esc(c.resolution || '')}</small>`}</td>
        <td>${badge(c.correction.label, CORR_TONE[c.correction.status])}${c.correction.reference ? `<br><small>${esc(c.correction.reference)}</small>` : ''}</td>
        <td>${badge(c.payment.label, PAY_TONE[c.payment.status] || 'neutral')}${c.treatment ? `<br><small>${esc(c.treatment.note)} (${esc(c.treatment.by)})</small>` : ''}</td>
        <td>${c.status === 'open' ? `<button class="small iac-act" data-case-treat="${esc(c.id)}">${c.treatment ? 'Change treatment' : 'Pay treatment'}</button>` : ''}${c.adjustment?.status === 'review' ? `<button class="small primary" data-case-over="${esc(c.id)}">Review overpayment</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nothing to show yet.</td></tr>'}
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
