// HR / Finance / Management: Benefits (Nov 24, 2026). One month at a time: the SSS / PhilHealth / Pag-IBIG remittance
// of the month (Finance records payment date, reference, status and proof) and every employee's HMO, allowances and
// contribution shares. HR keeps HMO and allowances; Finance and HR record allowance payments. Every change is audited.
import { readFile } from './hr-common.js';
const AGENCY_SHORT = { sss: 'SSS', philhealth: 'PhilHealth', pagibig: 'Pag-IBIG' };
const HMO_STATUSES = ['Active', 'Pending', 'Suspended', 'Expired', 'Cancelled'];
const FREQUENCIES = ['Monthly', 'Semi-monthly', 'Per cutoff', 'Weekly', 'Quarterly', 'Annual', 'One-time'];
const ALLOWANCE_STATUSES = ['Active', 'Suspended', 'Ended'];
const STATUS_BADGE = { Active: '', Verified: '', Paid: '', Pending: 'pending', Suspended: 'pending', Expired: 'rejected', Cancelled: 'rejected', Ended: 'neutral' };
const stamp = iso => new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function createBenefitsPage(ctx) {
  const { api, esc, money, badge, toast, openDialog, dialog, shell, heading, today } = ctx;
  let month = today().slice(0, 7), data = null, search = '';
  const options = (list, chosen) => list.map(x => `<option ${x === chosen ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const err = form => form.querySelector('[data-bn-error]');
  const showError = (form, error) => { const box = err(form); box.textContent = error.message; box.classList.remove('hidden'); box.scrollIntoView({ block: 'nearest' }); };

  async function render() {
    shell(heading('Benefits', 'Loading…') + '<div class="loading">Loading…</div>');
    try { data = await api(`/benefits?month=${month}`); } catch (error) { shell(heading('Benefits', '') + `<div class="notice">${esc(/not found/i.test(error.message) ? 'Benefits will be available after the HR server restarts.' : error.message)}</div>`); return; }
    draw();
  }
  function remittanceTable() {
    return `<div class="table-wrap"><table><thead><tr><th>Agency</th><th class="num">Employee share</th><th class="num">Employer share</th><th class="num">Total</th><th>Status</th><th>Payment date</th><th>Reference no.</th><th>Proof</th><th>Recorded</th><th></th></tr></thead><tbody>${data.remittances.map(r => {
      const p = r.payment;
      return `<tr><td><strong>${esc(r.agencyName)}</strong></td><td class="num">${money(r.employeeShare)}</td><td class="num">${money(r.employerShare)}</td><td class="num"><strong>${money(r.total)}</strong></td>
        <td>${p ? badge(p.status === 'verified' ? 'Verified' : 'Paid', '') : badge(data.draft ? 'Draft month' : 'Not recorded', 'pending')}</td><td>${esc(p?.paymentDate || '—')}</td><td>${esc(p?.reference || '—')}</td>
        <td>${p?.proof ? `<a href="/api/benefits/files/${esc(p.proof.id)}" target="_blank" rel="noopener">${esc(p.proof.name)}</a>` : '—'}</td>
        <td><small>${p ? `${esc(p.updatedBy)} · ${esc(stamp(p.updatedAt))}${p.verifiedBy ? `<br>Verified by ${esc(p.verifiedBy)}` : ''}` : ''}</small></td>
        <td>${data.canRecordPayments ? `<button class="small" data-bn-remit="${r.agency}">${p ? 'Edit' : 'Record payment'}</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function peopleTable() {
    const q = search.trim().toLowerCase(), people = data.people.filter(p => !q || `${p.name} ${p.employeeId} ${p.department}`.toLowerCase().includes(q));
    return `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>HMO</th><th>Allowances</th><th class="num">SSS (EE / ER)</th><th class="num">PhilHealth (EE / ER)</th><th class="num">Pag-IBIG (EE / ER)</th><th></th></tr></thead><tbody>${people.map(p => {
      const c = p.contributions, pair = k => (c ? `${money(c[k][0])} / ${money(c[k][1])}` : '—');
      return `<tr><td><button class="link-button" data-bn-open="${esc(p.employeeId)}"><strong>${esc(p.name)}</strong></button><br><small>${esc(p.employeeId)}${p.department ? ` · ${esc(p.department)}` : ''}</small></td>
        <td>${p.hmo ? `${esc(p.hmo.provider)} · ${esc(p.hmo.plan)}<br>${badge(p.hmo.status, STATUS_BADGE[p.hmo.status] || 'neutral')}${p.hmo.endDate ? ` <small>until ${esc(p.hmo.endDate)}</small>` : ''}` : '<span class="muted">None</span>'}</td>
        <td>${p.allowances.length ? p.allowances.map(a => `${esc(a.type)}: ${money(a.amount)} <small>${esc(a.frequency.toLowerCase())}</small>`).join('<br>') : '<span class="muted">None</span>'}</td>
        <td class="num">${pair('sss')}</td><td class="num">${pair('philhealth')}</td><td class="num">${pair('pagibig')}</td>
        <td><button class="small" data-bn-open="${esc(p.employeeId)}">Open</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">No employees match.</td></tr>'}</tbody></table></div>`;
  }
  function draw() {
    shell(`${heading('Benefits', 'Government contributions, HMO and allowances', `<label class="field inline">Month<input type="month" value="${esc(month)}" data-bn-month></label><button class="small" data-bn-print>Print</button>`)}
      <section class="panel"><div class="panel-head"><h2>Contribution payments · ${esc(new Date(`${month}-15T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</h2><span class="legend">${data.draft ? 'Payroll for this month is not final yet: amounts can still change. ' : ''}${data.canRecordPayments ? 'Record each agency’s payment after remitting.' : 'Finance records the payments.'}</span></div>${remittanceTable()}</section>
      <section class="panel"><div class="panel-head"><h2>Employees</h2><input type="search" placeholder="Search name, ID or company" value="${esc(search)}" data-bn-search aria-label="Search employees"></div>${peopleTable()}</section>`);
    bind();
  }
  function bind() {
    const content = document.querySelector('.content');
    content.querySelector('[data-bn-month]').onchange = e => { if (e.target.value) { month = e.target.value; render(); } };
    const box = content.querySelector('[data-bn-search]');
    box.oninput = () => { search = box.value; const at = box.selectionStart; draw(); const again = document.querySelector('[data-bn-search]'); again.focus(); again.setSelectionRange(at, at); };
    content.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-bn-print')) window.print();
      if (b.dataset.bnRemit) remitDialog(b.dataset.bnRemit);
      if (b.dataset.bnOpen) employeeDialog(b.dataset.bnOpen);
    };
  }

  function remitDialog(agency) {
    const r = data.remittances.find(x => x.agency === agency), p = r.payment;
    openDialog(`${AGENCY_SHORT[agency]} payment · ${month}`, `<form class="dialog-body form-grid" id="bn-remit">
      <p class="full legend">Amount due: <strong>${money(r.total)}</strong> (employee ${money(r.employeeShare)} + employer ${money(r.employerShare)}).</p>
      <label class="field">Status<select name="status"><option value="paid" ${p?.status !== 'verified' ? 'selected' : ''}>Paid</option><option value="verified" ${p?.status === 'verified' ? 'selected' : ''}>Verified (checked against the agency)</option></select></label>
      <label class="field">Payment date<input type="date" name="paymentDate" required value="${esc(p?.paymentDate || today())}"></label>
      <label class="field">Payment reference / transaction no.<input name="reference" required minlength="3" maxlength="80" value="${esc(p?.reference || '')}"></label>
      <label class="field">Amount paid (₱)<input type="number" name="amountPaid" min="0" step="0.01" value="${p?.amountPaid ?? r.total}"></label>
      <label class="field full">Official receipt / proof (PDF or image, 5 MB)${p?.proof ? ` <small>current: ${esc(p.proof.name)}</small>` : ''}<input type="file" name="proof" accept="application/pdf,image/jpeg,image/png,image/webp"></label>
      <label class="field full">Note<textarea name="note" maxlength="500" rows="2">${esc(p?.note || '')}</textarea></label>
      <p class="full error hidden" data-bn-error></p><button class="primary full">Save payment</button></form>`, '<div class="dialog-foot"><button data-close>Cancel</button></div>');
    const form = dialog.querySelector('#bn-remit');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements, file = f.proof.files[0];
      try {
        await api('/benefits/remittances', { month, agency, status: f.status.value, paymentDate: f.paymentDate.value, reference: f.reference.value.trim(), ...(f.amountPaid.value !== '' ? { amountPaid: Number(f.amountPaid.value) } : {}), note: f.note.value.trim(), ...(file ? { proof: { name: file.name, mime: file.type, data: await readFile(file) } } : {}) });
        dialog.close(); toast('Payment saved.'); render();
      } catch (error) { showError(form, error); }
    };
  }

  async function employeeDialog(employeeId) {
    let d;
    try { d = await api(`/benefits/employees/${encodeURIComponent(employeeId)}`); } catch (error) { toast(error.message); return; }
    const person = data.people.find(p => p.employeeId === employeeId) || { name: employeeId };
    const h = d.hmo;
    const hmoBlock = `<section class="bn-admin-block"><div class="bn-admin-head"><h3>HMO</h3>${data.canManage ? `<button class="small" data-bn-hmo>${h ? 'Edit HMO' : 'Add HMO'}</button>` : ''}</div>${h ? `<p><strong>${esc(h.provider)}</strong> · ${esc(h.plan)} · member ${esc(h.memberNo)} ${badge(h.status, STATUS_BADGE[h.status] || 'neutral')}</p><p class="legend">${esc(h.startDate)} to ${esc(h.endDate || 'no end date')}${h.dependents?.length ? ` · dependents: ${h.dependents.map(x => `${esc(x.name)} (${esc(x.relationship)})`).join(', ')}` : ''}</p><p class="legend">Updated by ${esc(h.updatedBy)} · ${esc(stamp(h.updatedAt))}</p>` : '<p class="muted">No HMO on record.</p>'}</section>`;
    const allowanceBlock = `<section class="bn-admin-block"><div class="bn-admin-head"><h3>Allowances</h3>${data.canManage ? '<button class="small" data-bn-allowance="">Add allowance</button>' : ''}</div>${d.allowances.length ? d.allowances.map(a => `<div class="bn-admin-row"><div><strong>${esc(a.type)}</strong> ${money(a.amount)} · ${esc(a.frequency)} · from ${esc(a.effectiveDate)}${a.endDate ? ` to ${esc(a.endDate)}` : ''} ${badge(a.status, STATUS_BADGE[a.status] || 'neutral')}<br><small class="muted">${(a.payments || []).length} payment(s)${a.payments?.length ? `, last ${esc(a.payments.at(-1).date)} ${money(a.payments.at(-1).amount)}` : ''} · updated by ${esc(a.updatedBy)}</small></div><div class="bn-admin-actions">${data.canManage ? `<button class="small" data-bn-allowance="${esc(a.id)}">Edit</button>` : ''}${data.canRecordAllowancePayments ? `<button class="small" data-bn-pay="${esc(a.id)}">Record payment</button>` : ''}</div></div>`).join('') : '<p class="muted">No allowances.</p>'}</section>`;
    const contribBlock = `<section class="bn-admin-block"><h3>Contributions (final months)</h3>${d.contributions.length ? `<div class="table-wrap"><table><thead><tr><th>Month</th><th>Agency</th><th class="num">EE</th><th class="num">ER</th><th>Status</th><th>Reference</th></tr></thead><tbody>${d.contributions.map(c => `<tr><td>${esc(c.month)}</td><td>${esc(c.agencyName)}</td><td class="num">${money(c.employeeShare)}</td><td class="num">${money(c.employerShare)}</td><td>${esc(c.status)}</td><td>${esc(c.reference || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No final months yet.</p>'}</section>`;
    const historyBlock = `<section class="bn-admin-block"><h3>History</h3>${d.history.length ? `<ol class="bn-timeline">${d.history.map(x => `<li><span class="bn-tag bn-tag-${esc(x.category.toLowerCase())}">${esc(x.category)}</span><p>${esc(x.text)}</p><small>${esc(stamp(x.at))} · by ${esc(x.by)}</small></li>`).join('')}</ol>` : '<p class="muted">Nothing recorded yet.</p>'}</section>`;
    openDialog(`Benefits · ${person.name}`, `<div class="dialog-body bn-admin">${hmoBlock}${allowanceBlock}${contribBlock}${historyBlock}</div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
    dialog.querySelector('.bn-admin').onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-bn-hmo')) hmoDialog(employeeId, h);
      if (b.dataset.bnAllowance !== undefined) allowanceDialog(employeeId, d.allowances.find(a => a.id === b.dataset.bnAllowance) || null);
      if (b.dataset.bnPay) paymentDialog(employeeId, d.allowances.find(a => a.id === b.dataset.bnPay));
    };
  }

  function hmoDialog(employeeId, h) {
    const deps = h?.dependents || [];
    openDialog(h ? 'Edit HMO' : 'Add HMO', `<form class="dialog-body form-grid" id="bn-hmo">
      <label class="field">HMO provider<input name="provider" required maxlength="120" value="${esc(h?.provider || '')}"></label>
      <label class="field">Membership no.<input name="memberNo" required maxlength="60" value="${esc(h?.memberNo || '')}"></label>
      <label class="field">Plan<input name="plan" required maxlength="120" value="${esc(h?.plan || '')}"></label>
      <label class="field">Status<select name="status">${options(HMO_STATUSES, h?.status || 'Active')}</select></label>
      <label class="field">Coverage start<input type="date" name="startDate" required value="${esc(h?.startDate || '')}"></label>
      <label class="field">Expiration<input type="date" name="endDate" value="${esc(h?.endDate || '')}"></label>
      <label class="field full">Coverage details<textarea name="coverage" rows="3" maxlength="1000">${esc(h?.coverage || '')}</textarea></label>
      <label class="field full">Covered dependents <small>one per line: Name, Relationship, Member no. (optional)</small><textarea name="dependents" rows="3">${esc(deps.map(x => [x.name, x.relationship, x.memberNo].filter(Boolean).join(', ')).join('\n'))}</textarea></label>
      <p class="full error hidden" data-bn-error></p><button class="primary full">Save HMO</button></form>`, '<div class="dialog-foot"><button data-close>Cancel</button></div>');
    const form = dialog.querySelector('#bn-hmo');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements;
      const dependents = f.dependents.value.split('\n').map(l => l.split(',').map(x => x.trim())).filter(x => x[0]).map(([name, relationship = '', memberNo = '']) => ({ name, relationship: relationship || 'Dependent', memberNo }));
      try {
        await api('/benefits/hmo', { employeeId, provider: f.provider.value.trim(), memberNo: f.memberNo.value.trim(), plan: f.plan.value.trim(), status: f.status.value, startDate: f.startDate.value, endDate: f.endDate.value, coverage: f.coverage.value.trim(), dependents });
        dialog.close(); toast('HMO saved.'); await render(); employeeDialog(employeeId);
      } catch (error) { showError(form, error); }
    };
  }

  function allowanceDialog(employeeId, a) {
    openDialog(a ? 'Edit allowance' : 'Add allowance', `<form class="dialog-body form-grid" id="bn-allowance">
      <label class="field">Allowance type<input name="type" required maxlength="80" placeholder="e.g. Rice, Transportation, Communication" value="${esc(a?.type || '')}"></label>
      <label class="field">Approved amount (₱)<input type="number" name="amount" required min="0.01" step="0.01" value="${a?.amount ?? ''}"></label>
      <label class="field">Payment frequency<select name="frequency">${options(FREQUENCIES, a?.frequency || 'Monthly')}</select></label>
      <label class="field">Status<select name="status">${options(ALLOWANCE_STATUSES, a?.status || 'Active')}</select></label>
      <label class="field">Effective date<input type="date" name="effectiveDate" required value="${esc(a?.effectiveDate || today())}"></label>
      <label class="field">End date<input type="date" name="endDate" value="${esc(a?.endDate || '')}"></label>
      <label class="field full">Eligibility / conditions<textarea name="eligibility" rows="2" maxlength="500">${esc(a?.eligibility || '')}</textarea></label>
      <p class="full error hidden" data-bn-error></p><button class="primary full">Save allowance</button></form>`, '<div class="dialog-foot"><button data-close>Cancel</button></div>');
    const form = dialog.querySelector('#bn-allowance');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements;
      try {
        await api('/benefits/allowances', { ...(a ? { id: a.id } : {}), employeeId, type: f.type.value.trim(), amount: Number(f.amount.value), frequency: f.frequency.value, status: f.status.value, effectiveDate: f.effectiveDate.value, endDate: f.endDate.value, eligibility: f.eligibility.value.trim() });
        dialog.close(); toast('Allowance saved.'); await render(); employeeDialog(employeeId);
      } catch (error) { showError(form, error); }
    };
  }

  function paymentDialog(employeeId, a) {
    openDialog(`Record payment · ${a.type}`, `<form class="dialog-body form-grid" id="bn-pay">
      <label class="field">Payment date<input type="date" name="date" required value="${esc(today())}"></label>
      <label class="field">Amount (₱)<input type="number" name="amount" required min="0.01" step="0.01" value="${a.amount}"></label>
      <label class="field">Reference no.<input name="reference" maxlength="80" placeholder="e.g. payroll run, bank reference"></label>
      <label class="field">Note<input name="note" maxlength="300"></label>
      <p class="full error hidden" data-bn-error></p><button class="primary full">Save payment</button></form>`, '<div class="dialog-foot"><button data-close>Cancel</button></div>');
    const form = dialog.querySelector('#bn-pay');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements;
      try {
        await api(`/benefits/allowances/${a.id}/payments`, { date: f.date.value, amount: Number(f.amount.value), reference: f.reference.value.trim(), note: f.note.value.trim() });
        dialog.close(); toast('Payment recorded.'); await render(); employeeDialog(employeeId);
      } catch (error) { showError(form, error); }
    };
  }
  return { render };
}
