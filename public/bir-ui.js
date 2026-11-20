// BIR Form 1601-C: one taxable month at a time (employee figures, Part II items 14-36, the return's entries and its
// filing), plus the year's monitoring table. Figures come from payroll; typed figures need a reason; filed months
// are frozen until an administrator reopens them.
import { fmtDate, fmtDateTime, who } from './hr-common.js';

export function createBirPage(ctx) {
  const { api, esc, money, table, badge, toast, openDialog, dialog, shell, heading, today } = ctx;
  let month = today().slice(0, 7), data = null, year = null;
  const STATUS = { filed: ['Filed', ''], overdue: ['Overdue', 'rejected'], open: ['Open', 'pending'], upcoming: ['Upcoming', 'neutral'] };
  const num = v => (v === '' || v === null || v === undefined ? null : Number(v));

  async function render() {
    shell(heading('BIR Form 1601-C', 'Loading…') + '<div class="loading">Loading…</div>');
    try { [data, year] = await Promise.all([api(`/bir1601c?month=${month}`), api(`/bir1601c/year?year=${month.slice(0, 4)}`)]); } catch (error) { shell(heading('BIR Form 1601-C', '') + `<div class="notice">${esc(error.message)}</div>`); return; }
    draw();
  }
  function draw() {
    const d = data, r = d.return, filed = r.status === 'filed', overdue = !filed && d.today > d.dueDate;
    const cards = [['Taxable month', esc(d.monthName), `Due ${fmtDate(d.dueDate)}`], ['Status', filed ? badge('Filed', '') : overdue ? badge('Overdue', 'rejected') : badge('Not yet filed', 'pending'), filed ? `${fmtDate(r.filedOn)} · ${esc(r.confirmationNo)}` : d.draft ? 'Includes unposted (draft) payroll' : 'From posted payroll'], ['Total taxes withheld (25)', money(d.items[25]), `${d.rows.length} employee${d.rows.length === 1 ? '' : 's'}`], ['Total amount still due (36)', money(d.items[36]), d.items[35] ? `Penalties ${money(d.items[35])}` : 'No penalties']];
    shell(heading('BIR Form 1601-C', 'Monthly Remittance Return of Income Taxes Withheld on Compensation (ATC WW010).', `<label class="bir-month">Taxable month<input type="month" data-bir-month value="${esc(month)}"></label><a class="small download-link" href="/api/bir1601c/${esc(month)}.xlsx" download>Excel</a><a class="small download-link" href="/api/reports/bir-1601c.pdf?month=${esc(month)}" download>PDF</a>`) +
      `<div class="bir-cards">${cards.map(([label, value, foot]) => `<div class="card"><div class="card-label">${label}</div><div class="card-value number">${value}</div><div class="card-foot">${foot}</div></div>`).join('')}</div>` +
      `<section class="panel"><div class="panel-head"><h2>Employees</h2><span class="legend">Per employee for the month · click Edit to type a figure (reason required)</span>${d.canEdit ? '<button class="small" data-bir-add>＋ Add employee</button>' : ''}</div>${table(['Employee', 'Compensation (14)', 'Non-taxable (21)', 'Taxable (22)', 'Not subject (23)', 'Net taxable (24)', 'Tax withheld (25)', ''], d.rows.map(x => [`<span class="name">${esc(x.name)}</span><small>${esc(x.employeeId)}${x.tin ? ` · TIN ${esc(x.tin)}` : ''}</small>${x.edited ? `<br>${badge('Typed figures', 'pending')}` : x.exempt ? `<br><small>Exempt from withholding</small>` : ''}${x.check ? `<br>${badge('Non-taxable is more than the pay: check', 'rejected')}` : ''}`, money(x.compensation), money(x.nonTaxable), money(x.taxable), money(x.notSubject), money(x.netTaxable), money(x.taxWithheld), d.canEdit ? `<button class="small" data-bir-edit="${esc(x.employeeId)}">Edit</button>` : '']), 'No compensation for this month yet.')}</section>` +
      `<div class="grid2"><section class="panel"><div class="panel-head"><h2>Part II · Computation of tax</h2></div>${table(['Item', 'Description', 'Amount'], Object.entries(d.items).map(([k, v]) => [k, esc(d.itemLabels[k]), [21, 22, 24, 27, 31, 35, 36].includes(Number(k)) ? `<strong>${money(v)}</strong>` : money(v)]))}</section>` +
      `<section class="panel"><div class="panel-head"><h2>${filed ? 'Filed return' : 'Return entries'}</h2></div><div class="panel-body">${filed ? filedView(r) : returnForm(d)}</div></section></div>` +
      `<section class="panel"><div class="panel-head"><h2>${esc(year.year)} monitoring</h2><span class="legend">Manual filing: 10th of the following month (eFPS by group; December by January 15)</span></div>${table(['Month', 'Due', 'Status', 'Filed', 'Reference', 'Compensation', 'Tax withheld', 'Amount due'], year.months.map(m => [`<button class="link-button" data-bir-open="${m.month}">${esc(m.name)}</button>`, fmtDate(m.due), badge(...STATUS[m.status]) + (m.amended ? ' ' + badge('Amended', 'neutral') : ''), m.filedOn ? fmtDate(m.filedOn) : '—', esc(m.confirmationNo || '—'), m.compensation === null ? '—' : money(m.compensation), m.taxWithheld === null ? '—' : money(m.taxWithheld), m.amountDue === null ? '—' : money(m.amountDue)]))}</section>`);
    bind();
  }
  const box = (name, label, value, attrs = '') => `<label class="field">${label}<input name="${name}" value="${esc(value ?? '')}" ${attrs}></label>`;
  function returnForm(d) {
    const r = d.return, a = d.agent, dis = d.canEdit ? '' : 'disabled';
    return `<form id="bir-return" class="form-grid"><div id="bir-error" class="form-error hidden full" role="alert"></div>
      <p class="legend full"><strong>Part I · Withholding agent</strong> (kept for the next months)</p>
      ${box('tin', 'TIN (6)', a.tin, `${dis} maxlength="20" inputmode="numeric"`)}${box('rdo', 'RDO code (7)', a.rdo, `${dis} maxlength="5"`)}
      <label class="field full">Withholding agent's name (8)<input name="name" value="${esc(a.name)}" ${dis} maxlength="200"></label>
      <label class="field full">Registered address (9)<input name="address" value="${esc(a.address)}" ${dis} maxlength="300"></label>
      ${box('zip', 'ZIP code (9A)', a.zip, `${dis} maxlength="10"`)}${box('contact', 'Contact number (10)', a.contact, `${dis} maxlength="40"`)}${box('email', 'Email address (12)', a.email, `${dis} type="email" maxlength="120"`)}
      <label class="field">Category (11)<select name="category" ${dis}>${['Private', 'Government'].map(x => `<option ${a.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field">eFPS filing group<select name="efpsGroup" ${dis}><option value="">Manual / eBIRForms (10th)</option>${['A', 'B', 'C', 'D', 'E'].map(g => `<option ${a.efpsGroup === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
      <label class="field check"><input type="checkbox" name="amended" ${r.amended ? 'checked' : ''} ${dis}> Amended return (2)</label><label class="field check"><input type="checkbox" name="taxRelief" ${r.taxRelief ? 'checked' : ''} ${dis}> Payees availing of tax relief (13)</label>
      ${box('sheets', 'Sheets attached (4)', r.sheets, `${dis} type="number" min="0" max="99"`)}
      <p class="legend full"><strong>Part II · Adjustments and penalties</strong></p>
      <label class="field">Adjustment from previous months (26)<span class="bir-adjust"><select name="adjustmentSign" ${dis}><option value="add" ${r.adjustmentSign !== 'less' ? 'selected' : ''}>Add</option><option value="less" ${r.adjustmentSign === 'less' ? 'selected' : ''}>Less</option></select><input name="adjustment" type="number" min="0" step="0.01" value="${esc(r.adjustment)}" ${dis}></span></label>
      ${box('previouslyRemitted', 'Remitted in the previous return (28, amended only)', r.previouslyRemitted, `${dis} type="number" min="0" step="0.01"`)}${box('otherRemittances', 'Other remittances made (29)', r.otherRemittances, `${dis} type="number" min="0" step="0.01"`)}${box('otherRemittancesNote', 'Other remittances: specify', r.otherRemittancesNote, `${dis} maxlength="200"`)}
      ${box('surcharge', 'Surcharge (32)', r.surcharge, `${dis} type="number" min="0" step="0.01"`)}${box('interest', 'Interest (33)', r.interest, `${dis} type="number" min="0" step="0.01"`)}${box('compromise', 'Compromise (34)', r.compromise, `${dis} type="number" min="0" step="0.01"`)}
      <label class="field full">Remarks<textarea name="remarks" rows="2" maxlength="1000" ${dis}>${esc(r.remarks)}</textarea></label>
      ${d.canEdit ? '<div class="full bir-actions"><button class="primary">Save return entries</button><button type="button" data-bir-file>Mark as filed…</button></div>' : ''}</form>`;
  }
  function filedView(r) {
    const rows = [['Date filed', fmtDate(r.filedOn)], ['Filing reference', esc(r.confirmationNo)], ['Payment date', r.paymentDate ? fmtDate(r.paymentDate) : '—'], ['Payment reference', esc(r.paymentRef || '—')], ['Payment channel', esc(r.paymentChannel || '—')], ['Filed by', esc(who(r.filedBy))], ['Recorded', fmtDateTime(r.filedAt)], ['Amended return', r.amended ? 'Yes' : 'No'], ['Remarks', esc(r.remarks || '—')]];
    return `<dl class="details-grid">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl><p class="legend">The figures above are the ones filed. Payroll changes made later do not alter them.</p>${(r.history || []).length ? `<p class="legend">${r.history.map(h => `${esc(h.action)} · ${fmtDateTime(h.at)} · ${esc(who(h.by))}${h.note ? ` · ${esc(h.note)}` : ''}`).join('<br>')}</p>` : ''}${data.canReopen ? '<button class="small" data-bir-reopen>Reopen (amended return)…</button>' : ''}`;
  }
  function bind() {
    const content = document.querySelector('.content');
    content.querySelector('[data-bir-month]').onchange = e => { if (e.target.value) { month = e.target.value; render(); } };
    content.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.dataset.birOpen) { month = b.dataset.birOpen; render(); }
      if (b.dataset.birEdit) rowEditor(b.dataset.birEdit);
      if (b.hasAttribute('data-bir-add')) addEmployee();
      if (b.hasAttribute('data-bir-file')) fileDialog();
      if (b.hasAttribute('data-bir-reopen')) reopenDialog();
    };
    const form = content.querySelector('#bir-return');
    if (form) form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements, err = form.querySelector('#bir-error');
      const body = { month, amended: f.amended.checked, taxRelief: f.taxRelief.checked, sheets: Number(f.sheets.value || 0), adjustment: Number(f.adjustment.value || 0), adjustmentSign: f.adjustmentSign.value, previouslyRemitted: Number(f.previouslyRemitted.value || 0), otherRemittances: Number(f.otherRemittances.value || 0), otherRemittancesNote: f.otherRemittancesNote.value, surcharge: Number(f.surcharge.value || 0), interest: Number(f.interest.value || 0), compromise: Number(f.compromise.value || 0), remarks: f.remarks.value,
        agent: { tin: f.tin.value, rdo: f.rdo.value, name: f.name.value, address: f.address.value, zip: f.zip.value, contact: f.contact.value, email: f.email.value, category: f.category.value, efpsGroup: f.efpsGroup.value } };
      try { await api('/bir1601c/return', body); toast('Return entries saved.'); render(); } catch (error) { err.textContent = error.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'nearest' }); }
    };
  }
  function rowEditor(employeeId, name = null) {
    const row = data.rows.find(r => r.employeeId === employeeId) || { employeeId, name, computed: {} };
    const value = k => (row.edited && row.computed && k in row.computed ? row[k] : ''), computed = k => (row.computed && k in row.computed ? row.computed[k] : row[k] ?? 0);
    openDialog(`${row.name || name} · ${data.monthName}`, `<form id="bir-row"><div class="dialog-body"><div id="bir-row-error" class="form-error hidden" role="alert"></div><p class="sub">Leave a box blank to use the payroll figure (shown in grey). Typed figures replace it for this month only.</p><div class="form-grid">
      ${data.fields.map(k => `<label class="field">${esc(data.labels[k])}<input type="number" step="0.01" min="0" name="${k}" value="${esc(value(k))}" placeholder="${esc(Number(computed(k)).toFixed(2))}"></label>`).join('')}
      <label class="field full">Reason for the typed figures<input name="reason" maxlength="500" value="${esc(row.edited?.reason || '')}" placeholder="e.g. de minimis benefits paid outside payroll"></label>
      ${row.edited ? `<p class="legend full">Typed by ${esc(who(row.edited.by))} on ${fmtDateTime(row.edited.at)}</p>` : ''}
    </div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button>${row.edited ? '<button type="button" data-bir-clear>Use payroll figures</button>' : ''}<button class="primary">Save</button></div></form>`);
    const form = dialog.querySelector('#bir-row'), err = form.querySelector('#bir-row-error');
    const save = async values => {
      try { await api('/bir1601c/row', { employeeId, month, values, reason: form.elements.reason.value }); dialog.close(); toast('Saved.'); render(); } catch (error) { err.textContent = error.message; err.classList.remove('hidden'); }
    };
    form.onsubmit = event => { event.preventDefault(); save(Object.fromEntries(data.fields.map(k => [k, num(form.elements[k].value)]).filter(([, v]) => v !== null))); };
    form.querySelector('[data-bir-clear]')?.addEventListener('click', () => save({}));
  }
  function addEmployee() {
    const listed = new Set(data.rows.map(r => r.employeeId)), people = (ctx.employees() || []).filter(e => !e.archived && !listed.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
    openDialog('Add employee to this month', `<form id="bir-add"><div class="dialog-body"><p class="sub">For compensation paid outside payroll (e.g. a remittance-only employee). You will type the figures next.</p><label class="field">Employee<select name="id" required><option value="">Choose…</option>${people.map(e => `<option value="${esc(e.id)}">${esc(e.name)} (${esc(e.id)})</option>`).join('')}</select></label></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Continue</button></div></form>`);
    const form = dialog.querySelector('#bir-add');
    form.onsubmit = event => { event.preventDefault(); const e = people.find(p => p.id === form.elements.id.value); if (e) rowEditor(e.id, e.name); };
  }
  function fileDialog() {
    openDialog(`Mark ${data.monthName} as filed`, `<form id="bir-file"><div class="dialog-body"><div id="bir-file-error" class="form-error hidden" role="alert"></div><p class="sub">Save the return entries first. Filing keeps the figures as they are now: tax withheld ${money(data.items[25])}, amount due ${money(data.items[36])}.</p><div class="form-grid">
      <label class="field">Date filed<input type="date" name="filedOn" required max="${today()}" value="${today()}"></label>
      <label class="field">Filing reference (eFPS / eBIRForms confirmation or TRA no.)<input name="confirmationNo" required maxlength="80"></label>
      <label class="field">Payment date<input type="date" name="paymentDate"></label><label class="field">Payment reference<input name="paymentRef" maxlength="80"></label>
      <label class="field full">Payment channel (bank, GCash, LandBank Link.BizPortal…)<input name="paymentChannel" maxlength="80"></label>
    </div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Mark as filed</button></div></form>`);
    const form = dialog.querySelector('#bir-file');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements;
      try { await api('/bir1601c/file', { month, filedOn: f.filedOn.value, confirmationNo: f.confirmationNo.value, paymentDate: f.paymentDate.value, paymentRef: f.paymentRef.value, paymentChannel: f.paymentChannel.value }); dialog.close(); toast('Recorded as filed.'); render(); }
      catch (error) { const err = form.querySelector('#bir-file-error'); err.textContent = error.message; err.classList.remove('hidden'); }
    };
  }
  function reopenDialog() {
    openDialog(`Reopen ${data.monthName}`, `<form id="bir-reopen"><div class="dialog-body"><div id="bir-reopen-error" class="form-error hidden" role="alert"></div><p class="sub">The filed figures stay on record as a previous filing. Use this for an amended return.</p><label class="field">Reason<textarea name="reason" rows="3" required minlength="5" maxlength="500"></textarea></label></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Reopen</button></div></form>`);
    const form = dialog.querySelector('#bir-reopen');
    form.onsubmit = async event => {
      event.preventDefault();
      try { await api('/bir1601c/reopen', { month, reason: form.elements.reason.value }); dialog.close(); toast('Reopened.'); render(); } catch (error) { const err = form.querySelector('#bir-reopen-error'); err.textContent = error.message; err.classList.remove('hidden'); }
    };
  }
  return { render, setMonth: m => { month = m; } };
}
