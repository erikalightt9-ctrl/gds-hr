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
  // Nov 25, 2026 design: hero, four cards, month + Print, agency icons, initials, outlined buttons.
  const bi = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const BI = {
    people: bi('<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7.5 20c0-2.8 2-4.8 4.5-4.8s4.5 2 4.5 4.8M1.5 19c0-2.2 1.5-3.8 3.5-3.8M22.5 19c0-2.2-1.5-3.8-3.5-3.8"/>'),
    shield: bi('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
    db: bi('<ellipse cx="12" cy="6" rx="7" ry="2.6"/><path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6"/>'),
    layers: bi('<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>'),
    info: bi('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>'),
    print: bi('<path d="M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1"/>'),
    receipt: bi('<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>'),
    folder: bi('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3z"/><path d="M3 10h18l-2 9H5z"/>'),
    search: bi('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
    sss: bi('<path d="M4 15c4-1 6-6 12-8M6 19c4-1 7-6 13-9M3 11c4-1 5-5 10-7"/>'),
    philhealth: bi('<circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/><path d="M7 21v-9h4v9M13 21v-9h4v9"/>'),
    pagibig: bi('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><circle cx="12" cy="14" r="2.5"/>'),
  };
  const AG_TONE = { sss: 'blue', philhealth: 'green', pagibig: 'amber' };
  const bnIni = n => { const [last, first] = String(n).split(',').map(x => x.trim()); return `${(first || last || '?')[0]}${first ? (last || '')[0] : ''}`.toUpperCase(); };
  const bnTone = n => ['green', 'rose', 'blue', 'amber', 'violet'][[...String(n)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5];
  function remittanceTable() {
    return `<div class="table-wrap"><table><thead><tr><th>Agency</th><th class="num">Employee share</th><th class="num">Employer share</th><th class="num">Total</th><th>Status</th><th>Payment date</th><th>Reference no.</th><th>Proof</th><th>Recorded</th><th>Action</th></tr></thead><tbody>${data.remittances.map(r => {
      const p = r.payment;
      return `<tr><td><span class="bn-agency"><i class="bn-ag bn-${AG_TONE[r.agency] || 'blue'}">${BI[r.agency] || BI.db}</i><strong>${esc(r.agencyName)}</strong></span></td><td class="num">${money(r.employeeShare)}</td><td class="num">${money(r.employerShare)}</td><td class="num"><strong>${money(r.total)}</strong></td>
        <td>${p ? `<span class="bn-pill bn-paid">${p.status === 'verified' ? 'Verified' : 'Paid'}</span>` : `<span class="bn-pill bn-draft">${data.draft ? 'Draft Month' : 'Not recorded'}</span>`}</td><td>${esc(p?.paymentDate || '—')}</td><td>${esc(p?.reference || '—')}</td>
        <td>${p?.proof ? `<a href="/api/benefits/files/${esc(p.proof.id)}" target="_blank" rel="noopener">${esc(p.proof.name)}</a>` : '—'}</td>
        <td><small>${p ? `${esc(p.updatedBy)} · ${esc(stamp(p.updatedAt))}${p.verifiedBy ? `<br>Verified by ${esc(p.verifiedBy)}` : ''}` : ''}</small></td>
        <td>${data.canRecordPayments ? `<button class="bn-btn" data-bn-remit="${r.agency}">${BI.receipt}${p ? 'Edit' : 'Record Payment'}</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function peopleTable() {
    const q = search.trim().toLowerCase(), people = data.people.filter(p => !q || `${p.name} ${p.employeeId} ${p.department}`.toLowerCase().includes(q));
    return `<div class="table-wrap"><table><thead><tr><th>Employee</th><th>HMO</th><th>Allowances</th><th class="num">SSS (EE / ER)</th><th class="num">PhilHealth (EE / ER)</th><th class="num">Pag-IBIG (EE / ER)</th><th>Action</th></tr></thead><tbody>${people.map(p => {
      const c = p.contributions, pair = k => (c ? `${money(c[k][0])} / ${money(c[k][1])}` : '—');
      return `<tr><td><span class="bn-emp"><i class="bn-av bn-av-${bnTone(p.name)}">${esc(bnIni(p.name))}</i><span><button class="link-button" data-bn-open="${esc(p.employeeId)}"><strong>${esc(p.name)}</strong></button><small>${esc(p.employeeId)}${p.department ? ` · ${esc(p.department)}` : ''}</small></span></span></td>
        <td>${p.hmo ? `${esc(p.hmo.provider)} · ${esc(p.hmo.plan)}<br>${badge(p.hmo.status, STATUS_BADGE[p.hmo.status] || 'neutral')}${p.hmo.endDate ? ` <small>until ${esc(p.hmo.endDate)}</small>` : ''}` : '<span class="muted">None</span>'}</td>
        <td>${p.allowances.length ? p.allowances.map(a => `${esc(a.type)}: ${money(a.amount)} <small>${esc(a.frequency.toLowerCase())}</small>`).join('<br>') : '<span class="muted">None</span>'}</td>
        <td class="num">${pair('sss')}</td><td class="num">${pair('philhealth')}</td><td class="num">${pair('pagibig')}</td>
        <td><button class="bn-btn" data-bn-open="${esc(p.employeeId)}">${BI.folder}Open</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">No employees match.</td></tr>'}</tbody></table></div>`;
  }
  function draw() {
    const sum = k => data.remittances.reduce((n, r) => n + (r[k] || 0), 0), monthName = new Date(`${month}-15T00:00:00Z`).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const bnCard = (tone, icon, label, value, foot) => `<div class="bnh-card bnh-${tone}"><span>${icon}</span><div><b>${label}</b><strong>${value}</strong><small>${foot}</small></div></div>`;
    shell(`<section class="dp-hero bn-hero"><span class="bn-hero-art" aria-hidden="true"><svg viewBox="0 0 110 100"><path d="M55 46c-12-14-30-6-26 8 3 10 26 26 26 26s23-16 26-26c4-14-14-22-26-8Z" fill="#e3262b"/><path d="M10 50c6 0 12 8 18 18l14 14c3 3 8 3 10 0" fill="none" stroke="#2f6df0" stroke-width="10" stroke-linecap="round"/><path d="M100 50c-6 0-12 8-18 18L68 82c-3 3-8 3-10 0" fill="none" stroke="#2f6df0" stroke-width="10" stroke-linecap="round"/></svg></span><div class="dp-hello"><span>Payroll &amp; Attendance</span><h1>Benefits</h1><p>Government contributions, HMO and allowances.</p></div></section>
      <div class="bn-top"><div class="bnh-cards">${bnCard('blue', BI.people, 'Total Employees', data.people.length, 'Covered this month')}${bnCard('green', BI.shield, 'Total Employer Share', money(sum('employerShare')), 'All agencies')}${bnCard('amber', BI.people, 'Total Employee Share', money(sum('employeeShare')), 'All agencies')}${bnCard('red', BI.db, 'Total Contribution', money(sum('total')), 'Employer + Employee Share')}</div><div class="bn-month"><label class="field">Month<input type="month" value="${esc(month)}" data-bn-month></label><button class="bn-btn" data-bn-print>${BI.print}Print</button></div></div>
      <section class="panel bn-panel"><div class="panel-head"><h2 class="bn-title"><span class="bn-title-ico">${BI.layers}</span>Contribution Payments – ${esc(monthName)}</h2><span class="bnh-note">${BI.info}${data.draft ? 'Payroll for this month is not final yet; amounts can still change. ' : ''}${data.canRecordPayments ? 'Record each agency’s payment after remitting.' : 'Finance records the payments.'}</span></div>${remittanceTable()}</section>
      <section class="panel bn-panel"><div class="panel-head"><h2 class="bn-title"><span class="bn-title-ico">${BI.people}</span>Employees</h2><label class="bn-search">${BI.search}<input type="search" placeholder="Search name, ID or company…" value="${esc(search)}" data-bn-search aria-label="Search employees"></label></div>${peopleTable()}</section>`);
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
