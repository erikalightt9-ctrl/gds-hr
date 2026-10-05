// 13th Month Pay page: the annual ledger (posted payroll + salary encoded for months before the system),
// the encoding grid for those earlier months, and the final pay computation for separated employees.
export function createThirteenthPage({ api, esc, money, table, badge, toast, openDialog, dialog, shell, heading, today, downloads }) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const card = (label, value, foot, featured = false) => `<div class="card${featured ? ' featured' : ''}"><div class="card-label">${esc(label)}</div><div class="card-value">${value}</div><div class="card-foot">${esc(foot)}</div></div>`;
  let year = today().slice(0, 4), data = null, finalData = null, lastResult = null, lastInput = null;

  async function render() {
    shell(heading('13th month & final pay', 'Loading…') + '<div class="loading">Loading the ledger…</div>');
    [data, finalData] = await Promise.all([api(`/thirteenth?year=${year}`), api('/final-pay').catch(() => null)]);
    const L = data.ledger, editable = data.canEncode, lastMonth = year === today().slice(0, 4) ? Number(today().slice(5, 7)) : 12;
    const months = Array.from({ length: lastMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const prior = new Map(data.prior.map(p => [`${p.employeeId}:${p.month}`, p]));
    const years = [...new Set([today().slice(0, 4), ...data.years])].sort().reverse();
    const gridRow = r => [esc(r.name) + `<small>${esc(r.employeeId)}</small>`, ...months.map(m => {
      const posted = data.postedMonths[r.employeeId]?.includes(m), p = prior.get(`${r.employeeId}:${m}`);
      return posted ? '<span class="share-state">Payroll</span>' : `<input class="share-input" type="number" min="0" step="0.01" aria-label="${esc(r.name)} basic salary ${m}" data-prior="${esc(r.employeeId)}" data-month="${m}" value="${p ? p.basic : ''}"${editable ? '' : ' disabled'}>`;
    }), `<button class="small" data-prior-detail="${esc(r.employeeId)}">Details</button>`];
    shell(heading('13th month & final pay', 'PD 851: total basic salary earned in the calendar year ÷ 12. Months before the system went live are encoded below; months with posted payroll are counted from payroll.') +
      `<div class="actions"><label class="field">Calendar year<select id="th-year" aria-label="Calendar year">${years.map(y => `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select></label></div>
      <div class="cards">${card('Basic earned (all sources)', money(L.reduce((s, r) => s + r.totalBasic, 0)), `${money(L.reduce((s, r) => s + r.priorBasic, 0))} encoded before the system`)}${card('Accrued 13th month', money(L.reduce((s, r) => s + r.accrued, 0)), 'Basic earned ÷ 12 (covered employees)', true)}${card('Already paid', money(L.reduce((s, r) => s + r.paid, 0)), 'Payroll + encoded payments')}${card('Balance to pay', money(L.reduce((s, r) => s + r.balance, 0)), 'Release on or before December 24')}</div>
      <section class="panel"><div class="panel-head"><h2>Annual 13th month ledger</h2>${downloads('thirteenth')}<span class="legend">To pay out, choose “Pay accrued balance” when computing payroll.</span></div>${table(['Employee', 'From payroll', 'Encoded (months)', 'Total basic', 'Accrued ÷ 12', 'Paid', 'Balance', 'Coverage'], L.map(r => [esc(r.name), money(r.postedBasic), `${money(r.priorBasic)}<small>${r.priorMonths.length} month${r.priorMonths.length === 1 ? '' : 's'}</small>`, money(r.totalBasic), money(r.accrued), money(r.paid), `<strong>${money(r.balance)}</strong>`, badge(r.covered13th ? 'Covered' : 'Excluded', r.covered13th ? '' : 'neutral')]), 'No employees.')}</section>
      <section class="panel"><div class="panel-head"><h2>Salary records before the system</h2><span class="legend">Basic salary actually earned each month (after absences and unpaid leave; exclude overtime, holiday premiums and allowances). Leave blank to clear.</span></div>
        <div class="table-wrap">${table(['Employee', ...months.map(m => MONTHS[Number(m.slice(5)) - 1]), ''], L.map(gridRow), 'No employees.')}</div>
        ${editable ? '<div class="panel-foot"><span>Changes are recorded in the audit log.</span><button class="primary" id="th-save">Save salary records</button></div>' : ''}</section>
      ${finalPanel()}`);
    const content = document.querySelector('.content');
    content.querySelector('#th-year').onchange = e => { year = e.target.value; render().catch(err => toast(err.message)); };
    content.addEventListener('click', onClick);
    content.querySelector('#fp-form')?.addEventListener('submit', onCompute);
  }

  function finalPanel() {
    if (!finalData) return '';
    const emps = data.ledger.slice().sort((a, b) => a.name.localeCompare(b.name));
    return `<section class="panel"><div class="panel-head"><h2>Final pay</h2><span class="legend">Labor Advisory 06-2020: release within 30 days of separation; Certificate of Employment within 3 days of request.</span></div>
      <form id="fp-form" class="panel-body form-grid">
        <label class="field">Employee<select name="employeeId" required><option value="">Choose…</option>${emps.map(e => `<option value="${esc(e.employeeId)}">${esc(e.name)}</option>`).join('')}</select></label>
        <label class="field">Last day / separation date<input type="date" name="separationDate" required value="${today()}"></label>
        <label class="field">Unpaid days worked (optional)<input type="number" name="unpaidDays" min="0" step="0.5"><small>Blank: scheduled workdays after the last paid cutoff.</small></label>
        <label class="field">Separation pay<select name="separationCause"><option value="none">None (resignation, end of contract, just cause)</option><option value="redundancy">Redundancy / labor-saving devices (1 month per year)</option><option value="retrenchment">Retrenchment / closure / disease (½ month per year)</option></select></label>
        <fieldset class="field full"><legend>Convert unused leave to cash</legend>${finalData.leaveTypes.map(t => `<label class="check"><input type="checkbox" name="convertLeave" value="${esc(t.id)}"${/service incentive|\bsil\b/i.test(t.name) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('') || '<small>No leave types configured.</small>'}<small>Service Incentive Leave is convertible by law; other leave only if company policy says so.</small></fieldset>
        <label class="check"><input type="checkbox" name="deductLoans" checked> Deduct outstanding loans</label>
        <label class="field">Other earnings<input type="number" name="otherEarnings" min="0" step="0.01" value="0"></label>
        <label class="field">Other earnings note<input name="otherEarningsNote" maxlength="500"></label>
        <label class="field">Other deductions / accountabilities<input type="number" name="otherDeductions" min="0" step="0.01" value="0"></label>
        <label class="field">Deductions note<input name="otherDeductionsNote" maxlength="500"></label>
        <label class="field">Tax adjustment (+ due, − refund)<input type="number" name="taxAdjustment" step="0.01" value="0"></label>
        <label class="field">Notes<input name="notes" maxlength="2000"></label>
        <div class="full"><button class="primary">Compute final pay</button></div>
      </form><div id="fp-result"></div>
      ${table(['Employee', 'Separation', 'Net final pay', 'Release due', 'Computed by', ''], finalData.records.map(r => [esc(r.name), fmt(r.separationDate), `<strong>${money(r.net)}</strong>`, fmt(r.releaseDue), `${esc(r.computedBy)}<small>${fmt(r.computedAt)}</small>`, `<button class="small" data-final-view="${esc(r.id)}">View</button>`]), 'No saved final pay computations yet.')}</section>`;
  }

  const resultHtml = r => `<div class="panel-body"><h3>${esc(r.name)} · final pay as of ${fmt(r.separationDate)}</h3><p class="legend">Daily rate ${money(r.dailyRate)} · monthly ${money(r.monthlySalary)} · ${r.yearsOfService} year${r.yearsOfService === 1 ? '' : 's'} of service (counted) · release due ${fmt(r.releaseDue)}</p>
    ${table(['Item', 'Basis', 'Earnings', 'Deductions'], r.items.map(i => [esc(i.label), `<span class="wrap">${esc(i.basis)}</span>`, i.side === 'earnings' ? money(i.amount) : '', i.side === 'deductions' ? money(i.amount) : '']), 'Nothing due.')}
    <div class="bd-total"><span>Gross ${money(r.gross)} − deductions ${money(r.deductions)}</span><strong>Net ${money(r.net)}</strong></div></div>`;

  async function onCompute(event) {
    event.preventDefault(); const f = new FormData(event.target);
    lastInput = { employeeId: f.get('employeeId'), separationDate: f.get('separationDate'), unpaidDays: f.get('unpaidDays') === '' ? null : Number(f.get('unpaidDays')), separationCause: f.get('separationCause'), convertLeave: f.getAll('convertLeave'), deductLoans: f.get('deductLoans') === 'on', otherEarnings: Number(f.get('otherEarnings') || 0), otherEarningsNote: f.get('otherEarningsNote'), otherDeductions: Number(f.get('otherDeductions') || 0), otherDeductionsNote: f.get('otherDeductionsNote'), taxAdjustment: Number(f.get('taxAdjustment') || 0), notes: f.get('notes') };
    try {
      lastResult = await api('/final-pay/compute', lastInput);
      document.querySelector('#fp-result').innerHTML = resultHtml(lastResult) + '<div class="actions"><button class="primary" data-final-save>Save this computation</button><span class="legend">Saved computations are kept with who computed them and are recorded in the audit log.</span></div>';
    } catch (error) { toast(error.message); }
  }

  async function onClick(event) {
    const b = event.target.closest('button'); if (!b) return;
    try {
      if (b.id === 'th-save') {
        const entries = [...document.querySelectorAll('[data-prior]')].flatMap(input => {
          const p = data.prior.find(x => x.employeeId === input.dataset.prior && x.month === input.dataset.month), value = input.value.trim();
          if (value === '' && !p) return [];
          if (p && value !== '' && Number(value) === p.basic) return [];
          return [{ employeeId: input.dataset.prior, month: input.dataset.month, basic: value === '' ? null : Number(value), thirteenthPaid: p?.thirteenthPaid || 0, notes: p?.notes || '' }];
        });
        if (!entries.length) { toast('No changes to save.'); return; }
        const r = await api('/thirteenth/prior', { entries }); toast(`Saved ${r.saved} month${r.saved === 1 ? '' : 's'}${r.removed ? `, cleared ${r.removed}` : ''}. The 13th month was recalculated.`); await render();
      }
      if (b.dataset.priorDetail) detail(b.dataset.priorDetail);
      if (b.hasAttribute('data-final-save')) {
        await api('/final-pay/compute', { ...lastInput, save: true }); toast('Final pay computation saved.'); await render();
      }
      if (b.dataset.finalView) {
        const r = finalData.records.find(x => x.id === b.dataset.finalView);
        openDialog(`Final pay · ${r.name}`, `<div class="dialog-body">${resultHtml(r)}${r.notes ? `<p class="legend">Notes: ${esc(r.notes)}</p>` : ''}<p class="legend">Computed by ${esc(r.computedBy)} on ${fmt(r.computedAt)}.</p></div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
      }
    } catch (error) { toast(error.message); }
  }

  // Per-employee detail: basic, 13th month already paid and notes per month.
  function detail(employeeId) {
    const r = data.ledger.find(x => x.employeeId === employeeId), lastMonth = year === today().slice(0, 4) ? Number(today().slice(5, 7)) : 12;
    const rows = Array.from({ length: lastMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`).map(m => {
      const p = data.prior.find(x => x.employeeId === employeeId && x.month === m), posted = data.postedMonths[employeeId]?.includes(m);
      return [MONTHS[Number(m.slice(5)) - 1], posted ? '<span class="share-state">From posted payroll</span>' : `<input class="share-input" type="number" min="0" step="0.01" name="basic-${m}" value="${p ? p.basic : ''}" aria-label="Basic ${m}"${data.canEncode ? '' : ' disabled'}>`, posted ? '' : `<input class="share-input" type="number" min="0" step="0.01" name="paid-${m}" value="${p?.thirteenthPaid || ''}" aria-label="13th month paid ${m}"${data.canEncode ? '' : ' disabled'}>`, posted ? '' : `<input name="notes-${m}" maxlength="500" value="${esc(p?.notes || '')}" aria-label="Notes ${m}"${data.canEncode ? '' : ' disabled'}>`, p ? `<small>${esc(p.enteredBy)} · ${fmt(p.enteredAt)}</small>` : ''];
    });
    openDialog(`Salary records · ${r.name}`, `<form id="prior-detail"><div class="dialog-body"><p class="sub">Basic salary earned and any 13th month already paid (advance or partial) for each month before the system.</p>${table(['Month', 'Basic salary earned', '13th month paid', 'Notes', 'Encoded by'], rows)}</div>
      <div class="dialog-foot"><button type="button" data-close>Close</button>${data.canEncode ? '<button class="primary">Save</button>' : ''}</div></form>`);
    dialog.querySelector('#prior-detail').onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(ev.target), entries = [];
      for (const [key] of f.entries()) {
        if (!key.startsWith('basic-')) continue;
        const m = key.slice(6), basic = String(f.get(key)).trim(), p = data.prior.find(x => x.employeeId === employeeId && x.month === m);
        const paid = Number(f.get(`paid-${m}`) || 0), notes = String(f.get(`notes-${m}`) || '');
        if (basic === '' && !p) { if (paid) { toast(`Enter the basic salary for ${m} before the 13th month paid.`); return; } continue; }
        if (p && basic !== '' && Number(basic) === p.basic && paid === (p.thirteenthPaid || 0) && notes === (p.notes || '')) continue;
        entries.push({ employeeId, month: m, basic: basic === '' ? null : Number(basic), thirteenthPaid: paid, notes });
      }
      if (!entries.length) { dialog.close(); return; }
      try { await api('/thirteenth/prior', { entries }); dialog.close(); toast('Salary records saved.'); await render(); } catch (error) { toast(error.message); }
    };
  }
  return { render };
}
