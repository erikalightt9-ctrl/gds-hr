// BIR Form 1601-C: a year of monthly returns (status, totals, due dates) and the return of one taxable month, with
// employee lines that can be encoded or edited, the return items 14-36 calculated live, filing and Excel downloads.
import { fmtDate, fmtDateTime } from './hr-common.js';

const FIELDS = ['gross', 'mweBasic', 'mweOther', 'thirteenth', 'deMinimis', 'contributions', 'otherNonTaxable', 'notSubject', 'taxWithheld'];
const SHORT = { gross: 'Total comp.', mweBasic: 'MWE basic', mweOther: 'MWE hol/OT/NSD', thirteenth: '13th month & benefits', deMinimis: 'De minimis', contributions: 'SSS/PHIC/HDMF EE', otherNonTaxable: 'Other non-taxable', notSubject: 'Not subject to WT', taxWithheld: 'Tax withheld' };
const NON_TAXABLE = ['mweBasic', 'mweOther', 'thirteenth', 'deMinimis', 'contributions', 'otherNonTaxable'];
const ITEMS = { 14: 'Total amount of compensation', 15: 'Statutory minimum wage (MWEs)', 16: 'Holiday, overtime, night shift differential, hazard pay (MWEs)', 17: '13th month pay and other benefits', 18: 'De minimis benefits', 19: 'SSS, GSIS, PHIC, HDMF contributions & union dues (employee share)', 20: 'Other non-taxable compensation', 21: 'Total non-taxable compensation', 22: 'Total taxable compensation', 23: 'Less: taxable compensation not subject to withholding', 24: 'Net taxable compensation', 25: 'Total taxes withheld', 26: 'Add/(less): adjustment from previous month/s', 27: 'Taxes withheld for remittance', 28: 'Less: tax remitted in return previously filed (amended)', 29: 'Other remittances made', 30: 'Total tax remittances made', 31: 'Tax still due / (over-remittance)', 32: 'Surcharge', 33: 'Interest', 34: 'Compromise', 35: 'Total penalties', 36: 'Total amount still due / (over-remittance)' };
const TYPED = { 26: 'adjustment', 28: 'previouslyRemitted', 29: 'otherRemittances', 32: 'surcharge', 33: 'interest', 34: 'compromise' };
const r2 = v => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = m => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export function computeItems(lines, a = {}) {
  const sum = k => r2(lines.reduce((s, l) => s + (Number(l[k]) || 0), 0)), i = { 14: sum('gross'), 15: sum('mweBasic'), 16: sum('mweOther'), 17: sum('thirteenth'), 18: sum('deMinimis'), 19: sum('contributions'), 20: sum('otherNonTaxable') };
  i[21] = r2(i[15] + i[16] + i[17] + i[18] + i[19] + i[20]); i[22] = Math.max(0, r2(i[14] - i[21])); i[23] = sum('notSubject'); i[24] = Math.max(0, r2(i[22] - i[23])); i[25] = sum('taxWithheld');
  i[26] = r2(a.adjustment || 0); i[27] = r2(i[25] + i[26]); i[28] = r2(a.previouslyRemitted || 0); i[29] = r2(a.otherRemittances || 0); i[30] = r2(i[28] + i[29]); i[31] = r2(i[27] - i[30]);
  i[32] = r2(a.surcharge || 0); i[33] = r2(a.interest || 0); i[34] = r2(a.compromise || 0); i[35] = r2(i[32] + i[33] + i[34]); i[36] = r2(i[31] + i[35]);
  return i;
}

export function createBirPage({ api, esc, money, table, badge, toast, openDialog, dialog, shell, heading, today }) {
  let year = today().slice(0, 4), month = null, ret = null, people = null;
  const STATUS = { 'not started': ['Not started', 'neutral'], draft: ['Draft', 'pending'], filed: ['Filed', ''] };
  const amount = v => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = v => { const n = Number(String(v ?? '').replace(/[,₱\s]/g, '')); return Number.isFinite(n) ? n : NaN; };

  async function render() { if (month) return openMonth(month); return renderYear(); }
  async function renderYear() {
    shell(heading('BIR Form 1601-C', 'Loading…') + '<div class="loading">Loading…</div>');
    const y = await api(`/bir/1601c?year=${year}`);
    const rows = y.months.map(m => [`<button class="link-button" data-month="${m.month}">${esc(monthName(m.month))}</button>`, badge(...(STATUS[m.status] || [m.status, 'neutral'])) + (m.overdue ? ` ${badge('Overdue', 'rejected')}` : ''), m.employees || '—', money(m.compensation), money(m.taxable), money(m.taxWithheld), money(m.stillDue), m.differenceTax ? `<span class="danger-text">${money(m.differenceTax)}</span>` : '—', fmtDate(m.dueDate), m.dateFiled ? `${fmtDate(m.dateFiled)}<small>${esc(m.referenceNo)}</small>` : '—']);
    const total = k => money(y.months.reduce((s, m) => s + m[k], 0));
    shell(heading('BIR Form 1601-C', 'Monthly Remittance Return of Income Taxes Withheld on Compensation. Each month is prepared from posted payroll and can be encoded or edited before filing.', `<a class="button" href="/api/bir/1601c/year-${esc(year)}.xlsx" download>Download ${esc(year)} (Excel)</a>`) +
      `<section class="panel"><div class="panel-head"><div class="th-year-pick"><label class="field">Taxable year<input id="bir-year" inputmode="numeric" maxlength="4" value="${esc(year)}"></label><button data-year-go>Show</button></div><span class="legend">Due on the 10th of the following month; the December return on January 15.</span></div>
      ${table(['Taxable month', 'Status', 'Employees', 'Total compensation (14)', 'Taxable (22)', 'Tax withheld (25)', 'Still due (36)', 'Difference vs payroll', 'Due date', 'Filed'], [...rows, ['<strong>Total</strong>', '', '', `<strong>${total('compensation')}</strong>`, `<strong>${total('taxable')}</strong>`, `<strong>${total('taxWithheld')}</strong>`, `<strong>${total('stillDue')}</strong>`, '', '', '']])}</section>`);
    const content = document.querySelector('.content');
    content.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.month) openMonth(b.dataset.month);
      if (b.hasAttribute('data-year-go')) { const v = content.querySelector('#bir-year').value.trim(); if (!/^\d{4}$/.test(v)) { toast('Type the year as YYYY.'); return; } year = v; renderYear(); }
    };
  }

  async function openMonth(m) {
    month = m; ret = await api(`/bir/1601c/${m}`);
    drawMonth();
  }
  function lineRow(l, i, edit) {
    const box = k => edit ? `<input class="share-input bir-num" data-line="${i}" data-k="${k}" inputmode="decimal" value="${amount(l[k])}" aria-label="${esc(l.name)} ${esc(SHORT[k])}">` : amount(l[k]);
    const nonTax = r2(NON_TAXABLE.reduce((s, k) => s + (Number(l[k]) || 0), 0)), taxable = Math.max(0, r2(l.gross - nonTax));
    return [esc(l.name) + `<small>${esc(l.employeeId)}${l.edited ? ' · edited' : ''}${l.source === 'manual' ? ' · encoded' : ''}</small>`, edit ? `<input class="bir-tin" data-line="${i}" data-k="tin" maxlength="30" value="${esc(l.tin || '')}" aria-label="${esc(l.name)} TIN">` : esc(l.tin || '—'),
      box('gross'), ...NON_TAXABLE.map(box), `<span data-nontax="${i}">${amount(nonTax)}</span>`, `<span data-taxable="${i}">${amount(taxable)}</span>`, box('notSubject'), box('taxWithheld'), edit ? `<button class="small" data-remove="${i}" title="Remove this line">✕</button>` : ''];
  }
  function drawMonth() {
    const edit = ret.canEdit, h = ret.header, a = ret.amounts || {}, f = ret.filing || {};
    const items = computeItems(ret.lines, a);
    const itemRows = Object.keys(ITEMS).map(n => [n, esc(ITEMS[n]), TYPED[n] && edit ? `<input class="share-input bir-num" data-amount-key="${TYPED[n]}" inputmode="decimal" value="${amount(a[TYPED[n]] || 0)}" aria-label="Item ${n}">` : `<strong data-item="${n}">${amount(items[n])}</strong>`]);
    const rec = ret.reconciliation;
    shell(heading(`1601-C · ${monthName(ret.month)}`, '', `<button class="small" data-back>← All months</button><a class="button small" href="/api/bir/1601c/${ret.month}.xlsx" download>Download Excel</a>`) +
      `<div class="cards"><div class="card"><div class="card-label">Status</div><div class="card-value">${badge(...(STATUS[ret.status] || [ret.status, 'neutral']))}${h.amended ? ' ' + badge('Amended', 'neutral') : ''}</div><div class="card-foot">Due ${esc(fmtDate(ret.dueDate))}${ret.overdue && ret.lines.length ? ' · overdue' : ''}</div></div>
       <div class="card"><div class="card-label">Taxes withheld (25)</div><div class="card-value" data-card="25">${money(items[25])}</div><div class="card-foot">Payroll: ${money(rec.payrollTax)}</div></div>
       <div class="card featured"><div class="card-label">Amount still due (36)</div><div class="card-value" data-card="36">${money(items[36])}</div><div class="card-foot">${f.dateFiled ? `Filed ${esc(fmtDate(f.dateFiled))} · ${esc(f.referenceNo)}` : 'Not filed'}</div></div></div>
      ${rec.differenceTax || rec.differenceGross ? `<div class="notice">The return differs from posted payroll: compensation ${money(rec.differenceGross)}, tax withheld ${money(rec.differenceTax)}. ${edit ? 'Use “Copy from payroll again” to reset the lines.' : ''}</div>` : ''}
      ${!ret.saved && ret.lines.length ? '<div class="notice compact">Prepared from posted payroll and not yet saved. Review, then click Save draft.</div>' : ''}
      <section class="panel"><div class="panel-head"><h2>Withholding agent</h2></div><div class="panel-body form-grid">
        <label class="field">Registered name<input name="agentName" value="${esc(h.agentName)}" ${edit ? '' : 'disabled'}></label>
        <label class="field">TIN<input name="tin" value="${esc(h.tin)}" placeholder="000-000-000-0000" ${edit ? '' : 'disabled'}></label>
        <label class="field">RDO code<input name="rdoCode" value="${esc(h.rdoCode)}" maxlength="10" ${edit ? '' : 'disabled'}></label>
        <label class="field">Category of withholding agent<select name="category" ${edit ? '' : 'disabled'}>${['Private', 'Government'].map(c => `<option ${h.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Employee compensation and tax withheld</h2><p class="legend">From the posted payroll of cutoffs that start in ${esc(monthName(ret.month))}. Amounts in pesos.</p></div>${edit ? '<div class="actions"><button class="small" data-add>＋ Add employee</button><button class="small" data-refresh>Copy from payroll again</button></div>' : ''}</div>
        <div class="table-wrap bir-lines">${table(['Employee', 'TIN', SHORT.gross, ...NON_TAXABLE.map(k => SHORT[k]), 'Non-taxable', 'Taxable', SHORT.notSubject, SHORT.taxWithheld, ''], ret.lines.map((l, i) => lineRow(l, i, edit)), 'No posted payroll in this month. Add employees to encode the return.')}</div></section>
      <section class="panel"><div class="panel-head"><h2>Return items</h2><span class="legend">Items 14-25 add up the employee lines. Type adjustments, previous remittances and penalties where they apply.</span></div>${table(['Item', 'Description', 'Amount'], itemRows)}</section>
      ${(ret.history || []).length ? `<section class="panel"><div class="panel-head"><h2>History</h2></div>${table(['When', 'By', 'Action', 'Details'], ret.history.slice().reverse().map(x => [fmtDateTime(x.at), esc(x.by), esc(x.action), esc(x.detail || '')]))}</section>` : ''}
      <div class="actions">${edit ? '<button class="primary" data-save>Save draft</button>' : ''}${edit && ret.saved ? '<button data-file>Mark as filed…</button>' : ''}${ret.canReopen ? '<button data-reopen>Reopen for an amended return…</button>' : ''}</div>`);
    const content = document.querySelector('.content');
    content.oninput = e => {
      const t = e.target;
      if (t.dataset.line !== undefined) { const l = ret.lines[Number(t.dataset.line)]; if (t.dataset.k === 'tin') l.tin = t.value; else { const n = num(t.value); if (!Number.isNaN(n)) l[t.dataset.k] = n; } }
      if (t.dataset.amountKey) { const n = num(t.value); if (!Number.isNaN(n)) (ret.amounts ||= {})[t.dataset.amountKey] = n; }
      refreshTotals();
    };
    content.addEventListener('focusout', e => { if (e.target.classList.contains('bir-num')) { const n = num(e.target.value); if (!Number.isNaN(n)) e.target.value = amount(n); } });
    content.onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.hasAttribute('data-back')) { month = null; await renderYear(); }
        if (b.dataset.remove !== undefined) { ret.lines.splice(Number(b.dataset.remove), 1); drawMonth(); }
        if (b.hasAttribute('data-add')) await addLine();
        if (b.hasAttribute('data-refresh') && window.confirm('Replace the employee lines with the posted payroll of this month? Edits to the lines are lost; the header, amounts and filing details stay.')) { ret = await api(`/bir/1601c/${ret.month}/refresh`, {}); toast('Copied from payroll and saved.'); drawMonth(); }
        if (b.hasAttribute('data-save')) await saveDraft();
        if (b.hasAttribute('data-file')) fileDialog();
        if (b.hasAttribute('data-reopen')) { const reason = window.prompt('Why is this return reopened? (e.g. amended return to correct the tax withheld)'); if (!reason) return; ret = await api(`/bir/1601c/${ret.month}/reopen`, { reason }); toast('Reopened as an amended return.'); drawMonth(); }
      } catch (error) { toast(error.message); }
    };
  }
  function refreshTotals() {
    const items = computeItems(ret.lines, ret.amounts);
    for (const el of document.querySelectorAll('[data-item]')) el.textContent = amount(items[el.dataset.item]);
    for (const el of document.querySelectorAll('[data-card]')) el.textContent = money(items[el.dataset.card]);
    ret.lines.forEach((l, i) => { const nonTax = r2(NON_TAXABLE.reduce((s, k) => s + (Number(l[k]) || 0), 0)); const a = document.querySelector(`[data-nontax="${i}"]`), b = document.querySelector(`[data-taxable="${i}"]`); if (a) a.textContent = amount(nonTax); if (b) b.textContent = amount(Math.max(0, r2(l.gross - nonTax))); });
  }
  function readForm() {
    const c = document.querySelector('.content'), bad = [...c.querySelectorAll('.bir-num')].find(i => Number.isNaN(num(i.value)) || (num(i.value) < 0 && !i.dataset.amountKey?.startsWith('adjust')));
    if (bad) { bad.focus(); throw new Error(`Check the amount “${bad.value}”.`); }
    const val = n => c.querySelector(`[name=${n}]`).value;
    return { header: { agentName: val('agentName'), tin: val('tin'), rdoCode: val('rdoCode'), category: val('category'), amended: !!ret.header.amended }, lines: ret.lines.map(l => ({ employeeId: l.employeeId, name: l.name, tin: l.tin || '', ...Object.fromEntries(FIELDS.map(k => [k, Number(l[k]) || 0])) })), amounts: Object.fromEntries(Object.values(TYPED).map(k => [k, Number(ret.amounts?.[k]) || 0])), filing: { ...(ret.filing || {}) } };
  }
  async function saveDraft() { ret = await api(`/bir/1601c/${ret.month}`, readForm()); toast('Return saved as a draft.'); drawMonth(); }
  async function addLine() {
    people ||= await api('/hr/employees');
    const taken = new Set(ret.lines.map(l => l.employeeId)), choices = people.filter(p => !taken.has(p.id));
    openDialog('Add employee to the return', `<form id="bir-add"><div class="dialog-body"><label class="field">Employee<select name="id" required><option value="">Choose…</option>${choices.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.id)}</option>`).join('')}</select></label><p class="legend">Amounts start at zero; type them in the table, then save.</p></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Add</button></div></form>`);
    dialog.querySelector('#bir-add').onsubmit = ev => { ev.preventDefault(); const p = people.find(x => x.id === ev.target.elements.id.value); if (!p) return; ret.lines.push({ employeeId: p.id, name: p.name, tin: '', source: 'manual', ...Object.fromEntries(FIELDS.map(k => [k, 0])) }); dialog.close(); drawMonth(); };
  }
  function fileDialog() {
    const items = computeItems(ret.lines, ret.amounts);
    openDialog(`Mark ${monthName(ret.month)} as filed`, `<form id="bir-file"><div class="dialog-body form-grid">
      <p class="full">Amount still due (item 36): <strong>${money(items[36])}</strong>. Save any changes first; filing locks the return.</p>
      <label class="field">Date filed<input type="date" name="dateFiled" required value="${today()}"></label>
      <label class="field">eFPS / eBIRForms reference no.<input name="referenceNo" required minlength="3" maxlength="80"></label>
      <label class="field">Payment date<input type="date" name="paymentDate"></label>
      <label class="field">Amount paid<input name="amountPaid" inputmode="decimal" value="${amount(items[36])}"></label>
      <label class="field">Bank / payment channel<input name="bank" maxlength="120"></label>
      <label class="field full">Notes<input name="notes" maxlength="2000"></label></div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Mark as filed</button></div></form>`);
    dialog.querySelector('#bir-file').onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { ret = await api(`/bir/1601c/${ret.month}/file`, { dateFiled: f.get('dateFiled'), referenceNo: f.get('referenceNo'), paymentDate: f.get('paymentDate') || '', amountPaid: Math.max(0, num(f.get('amountPaid')) || 0), bank: f.get('bank') || '', notes: f.get('notes') || '' }); dialog.close(); toast('Return marked as filed and locked.'); drawMonth(); } catch (error) { toast(error.message); }
    };
  }
  return { render, reset: () => { month = null; } };
}
