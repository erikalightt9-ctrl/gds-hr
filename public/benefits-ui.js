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

  // Contribution payment window (Nov 26, 2026 design): agency badge and amount due, payment date / status / amount /
  // reference with icons, dashed receipt upload, notes, Reset / Cancel / Save Payment. Generic agency badges (no logos).
  const AG_FULL = { sss: 'Social Security System', philhealth: 'Philippine Health Insurance', pagibig: 'Home Development Mutual Fund' };
  function remitDialog(agency) {
    const r = data.remittances.find(x => x.agency === agency), p = r.payment;
    const g = q => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${q}</svg>`;
    const I = { cal: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01"/>'), check: g('<path d="m6 12.5 4 4 8-9"/>'), hash: g('<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>'), clip: g('<path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.3 3.3 0 0 1 4.7 4.7L10.2 18.7a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>'), cloud: g('<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19 10a4 4 0 0 1 0 8Z"/><path d="M12 11v7M9 14l3-3 3 3"/>'), doc: g('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'), reset: g('<path d="M4 4v6h6"/><path d="M5 10a8 8 0 1 1 1.6 6.4"/>'), x: g('<path d="M6 6l12 12M18 6 6 18"/>'), save: g('<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>') };
    openDialog(`${AGENCY_SHORT[agency]} Payment – ${month}`, `<form class="dialog-body brm" id="bn-remit">
      <p class="brm-sub">Record and manage ${AGENCY_SHORT[agency]} contribution payment details.</p>
      <div class="brm-due"><span class="brm-agency"><i class="bn-ag bn-${AG_TONE[agency] || 'blue'}">${BI[agency] || BI.db}</i><span><strong>${esc(r.agencyName)}</strong><small>${AG_FULL[agency] || ''}</small></span></span><span class="brm-amt"><small>Amount Due</small><strong>${money(r.total)}</strong><em>(Employee: ${money(r.employeeShare)} + Employer: ${money(r.employerShare)})</em></span></div>
      <div class="brm-grid">
        <label class="brm-field"><span class="brm-lab">Payment Date <b>*</b></span><span class="brm-in">${I.cal}<input type="date" name="paymentDate" required value="${esc(p?.paymentDate || today())}"></span></label>
        <label class="brm-field"><span class="brm-lab">Status <b>*</b></span><span class="brm-in brm-status">${I.check}<select name="status"><option value="paid" ${p?.status !== 'verified' ? 'selected' : ''}>Paid</option><option value="verified" ${p?.status === 'verified' ? 'selected' : ''}>Verified (checked against the agency)</option></select></span></label>
        <label class="brm-field"><span class="brm-lab">Amount Paid (₱)</span><span class="brm-in"><i class="brm-peso">₱</i><input type="number" name="amountPaid" min="0" step="0.01" value="${p?.amountPaid ?? r.total}"></span></label>
        <label class="brm-field"><span class="brm-lab">Payment Reference / Transaction No. <b>*</b></span><span class="brm-in">${I.hash}<input name="reference" required minlength="3" maxlength="80" placeholder="e.g. PR-2026-111234" value="${esc(p?.reference || '')}"></span></label>
      </div>
      <div class="brm-upload"><p>${I.clip}Official Receipt / Proof (PDF or Image, 5 MB)${p?.proof ? ` <small>current: ${esc(p.proof.name)}</small>` : ''}</p><label class="brm-drop"><span class="brm-drop-main">${I.cloud}<span><strong data-brm-file>Click to upload file</strong><small>or drag and drop</small></span></span><span class="brm-drop-types">${I.doc}PDF, JPG, PNG</span><input type="file" name="proof" accept="application/pdf,image/jpeg,image/png,image/webp"></label></div>
      <label class="brm-notes"><span>${I.doc}Notes</span><textarea name="note" maxlength="500" rows="2" placeholder="Add remarks or additional details…">${esc(p?.note || '')}</textarea></label>
      <p class="full error hidden" data-bn-error></p></form>`, `<div class="dialog-foot brm-foot"><button type="button" class="brm-reset" data-brm-reset>${I.reset}Reset</button><span><button type="button" class="brm-cancel" data-close>${I.x}Cancel</button><button type="submit" class="brm-save" form="bn-remit">${I.save}Save Payment</button></span></div>`);
    dialog.classList.add('brm-dialog');
    const fileIn = dialog.querySelector('#bn-remit [name="proof"]'), fileLabel = dialog.querySelector('[data-brm-file]');
    fileIn.addEventListener('change', () => { fileLabel.textContent = fileIn.files[0]?.name || 'Click to upload file'; });
    dialog.querySelector('[data-brm-reset]').addEventListener('click', () => { dialog.querySelector('#bn-remit').reset(); fileLabel.textContent = 'Click to upload file'; });
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
    // Employee benefits window (Nov 26, 2026 design): navy title with a person icon, HMO and Allowances cards with icons,
    // Contributions (final months) with a navy table header and status pills, History, 'Showing n records' and navy Close.
    const g = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const I = { cal: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01"/>'), bank: g('<path d="M3 10h18L12 4ZM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'), person: g('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'), people: g('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'), info: g('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'), doc: g('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'), plus: g('<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'), check: g('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>'), sync: g('<path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/>'), hist: g('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'), chart: g('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 17v-4M12 17V9M16 17v-6"/>') };
    const SHIELD = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 8 10v11c0 10 6.8 18.6 16 21 9.2-2.4 16-11 16-21V10Z" fill="#14306e"/><path d="M24 9 13 13v8c0 7.3 4.6 13.6 11 15.6 6.4-2 11-8.3 11-15.6v-8Z" fill="#fff"/><path d="m17.5 24 5 5 8.5-10" stroke="#14306e" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const HAND = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M4 33h7l9 3h9c2 0 2-3 0-3h-7" stroke="#14306e" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 30c4-3 8-3 11-1h6c3 0 3 4 0 4M29 33l10-5c3-1 4 2 2 3L28 40H11" stroke="#14306e" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 14c0-3 4-5 6-2 2-3 6-1 6 2 0 4-6 8-6 8s-6-4-6-8Z" fill="none" stroke="#14306e" stroke-width="3"/><path d="M28 9c0-2.6 3.4-4.3 5.2-1.7C35 4.7 38.4 6.4 38.4 9c0 3.5-5.2 7-5.2 7S28 12.5 28 9Z" fill="#e3262b"/></svg>';
    const pill = st => { const t = String(st || ''); const cls = /deducted/i.test(t) ? 'bne-ok' : /remitted/i.test(t) ? 'bne-rem' : /verified|paid/i.test(t) ? 'bne-paid' : 'bne-other'; return `<span class="bne-pill ${cls}">${cls === 'bne-rem' ? I.sync : I.check}${esc(t)}</span>`; };
    const th = (icon, label, cls = '') => `<th class="${cls}"><span>${icon}${label}</span></th>`;
    const hmoBlock = `<section class="bne-card"><span class="bne-card-ico">${SHIELD}</span><div class="bne-card-body"><h3>HMO</h3>${h ? `<p><strong>${esc(h.provider)}</strong> · ${esc(h.plan)} · member ${esc(h.memberNo)} ${badge(h.status, STATUS_BADGE[h.status] || 'neutral')}</p><p class="legend">${esc(h.startDate)} to ${esc(h.endDate || 'no end date')}${h.dependents?.length ? ` · dependents: ${h.dependents.map(x => `${esc(x.name)} (${esc(x.relationship)})`).join(', ')}` : ''}</p>${h.planId || h.rank || h.benefitLimit !== undefined && h.benefitLimit !== '' ? `<p class="legend">${[h.planId ? `Plan ID ${esc(h.planId)}` : '', h.rank ? esc(h.rank) : '', h.benefitLimit !== '' && h.benefitLimit !== undefined ? `${esc(h.benefitType || 'Limit')} ${money(h.benefitLimit)}` : ''].filter(Boolean).join(' · ')}</p>` : ''}${h.premium !== undefined && h.premium !== '' ? `<p class="legend">Billing: premium ${money(h.premium)} + VAT ${money(h.vat || 0)} = ${money(h.totalGross || 0)}${h.months !== '' && h.months !== undefined ? ` (${esc(String(h.months))} months)` : ''}${h.movementType ? ` · ${esc(h.movementType)}` : ''}${h.invoiceNo ? ` · invoice ${esc(h.invoiceNo)}${h.invoiceDate ? ` (${esc(h.invoiceDate)})` : ''}` : ''}${h.account ? ` · ${esc(h.account)}` : ''}</p>` : ''}<p class="legend">Updated by ${esc(h.updatedBy)} · ${esc(stamp(h.updatedAt))}</p>` : '<p class="bne-none">No HMO on record.</p>'}</div>${data.canManage ? `<button class="bne-add" data-bn-hmo>${I.plus}${h ? 'Edit HMO' : 'Add HMO'}</button>` : ''}</section>`;
    const allowanceBlock = `<section class="bne-card"><span class="bne-card-ico">${HAND}</span><div class="bne-card-body"><h3>Allowances</h3>${d.allowances.length ? d.allowances.map(a => `<div class="bn-admin-row"><div><strong>${esc(a.type)}</strong> ${money(a.amount)} · ${esc(a.frequency)} · from ${esc(a.effectiveDate)}${a.endDate ? ` to ${esc(a.endDate)}` : ''} ${badge(a.status, STATUS_BADGE[a.status] || 'neutral')}<br><small class="muted">${(a.payments || []).length} payment(s)${a.payments?.length ? `, last ${esc(a.payments.at(-1).date)} ${money(a.payments.at(-1).amount)}` : ''} · updated by ${esc(a.updatedBy)}</small></div><div class="bn-admin-actions">${data.canManage ? `<button class="small" data-bn-allowance="${esc(a.id)}">Edit</button>` : ''}${data.canRecordAllowancePayments ? `<button class="small" data-bn-pay="${esc(a.id)}">Record payment</button>` : ''}</div></div>`).join('') : '<p class="bne-none">No allowances.</p>'}</div>${data.canManage ? `<button class="bne-add" data-bn-allowance="">${I.plus}Add Allowance</button>` : ''}</section>`;
    const contribBlock = `<section class="bne-panel"><h3 class="bne-title">${I.cal}Contributions (Final Months)</h3>${d.contributions.length ? `<div class="bne-table"><table><thead><tr>${th(I.cal, 'Month')}${th(I.bank, 'Agency')}${th(I.person, 'EE', 'num')}${th(I.people, 'ER', 'num')}${th(I.info, 'Status')}${th(I.doc, 'Reference')}</tr></thead><tbody>${d.contributions.map(c => `<tr><td>${esc(c.month)}</td><td>${esc(c.agencyName)}</td><td class="num"><strong>${money(c.employeeShare)}</strong></td><td class="num"><strong>${money(c.employerShare)}</strong></td><td>${pill(c.status)}</td><td>${esc(c.reference || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="bne-none bne-pad">No final months yet.</p>'}</section>`;
    const historyBlock = `<section class="bne-panel"><h3 class="bne-title">${I.hist}History</h3>${d.history.length ? `<ol class="bn-timeline bne-pad">${d.history.map(x => `<li><span class="bn-tag bn-tag-${esc(x.category.toLowerCase())}">${esc(x.category)}</span><p>${esc(x.text)}</p><small>${esc(stamp(x.at))} · by ${esc(x.by)}</small></li>`).join('')}</ol>` : '<p class="bne-none bne-pad">Nothing recorded yet.</p>'}</section>`;
    const n = d.contributions.length;
    openDialog(`Benefits · ${person.name}`, `<div class="dialog-body bn-admin bne"><div class="bne-cards">${hmoBlock}${allowanceBlock}</div>${contribBlock}${historyBlock}</div>`, `<div class="dialog-foot bne-foot"><span>${I.chart}Showing ${n ? `1–${n}` : '0'} of ${n} contribution record${n === 1 ? '' : 's'}</span><button class="bne-close" data-close>Close</button></div>`);
    dialog.classList.add('bne-dialog');
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
      <label class="field">Plan ID<input name="planId" maxlength="60" value="${esc(h?.planId || '')}"></label>
      <label class="field">Rank classification<input name="rank" maxlength="80" list="bn-ranks" value="${esc(h?.rank || '')}"><datalist id="bn-ranks"><option value="EXECUTIVES"></option><option value="RANK AND FILE"></option></datalist></label>
      <label class="field">Shared benefit limit (₱, 1st layer)<input type="number" name="benefitLimit" min="0" step="0.01" value="${h?.benefitLimit ?? ''}"></label>
      <label class="field">Benefit type<input name="benefitType" maxlength="40" placeholder="e.g. MBL" value="${esc(h?.benefitType || '')}"></label>
      <label class="field full">Covered dependents <small>one per line: Name, Relationship, Member no. (optional)</small><textarea name="dependents" rows="3">${esc(deps.map(x => [x.name, x.relationship, x.memberNo].filter(Boolean).join(', ')).join('\n'))}</textarea></label>
      <p class="full bn-sec">Billing (HR / Finance only; not shown to the employee)</p>
      <label class="field full">Company account<input name="account" maxlength="160" placeholder="e.g. 9700788655 - PHILIPPINE DRAGON MEDIA NETWORK CORP." value="${esc(h?.account || '')}"></label>
      <label class="field">Movement type<input name="movementType" maxlength="60" list="bn-moves" value="${esc(h?.movementType || '')}"><datalist id="bn-moves"><option value="Renewal"></option><option value="Initial Enrollment"></option><option value="Add Member"></option><option value="Deletion"></option></datalist></label>
      <label class="field">Months billed<input type="number" name="months" min="0" max="36" step="1" value="${h?.months ?? ''}"></label>
      <label class="field">Premium (₱)<input type="number" name="premium" min="0" step="0.01" value="${h?.premium ?? ''}"></label>
      <label class="field">VAT amount (₱)<input type="number" name="vat" min="0" step="0.01" value="${h?.vat ?? ''}"></label>
      <label class="field">Total gross amount (₱)<input type="number" name="totalGross" min="0" step="0.01" value="${h?.totalGross ?? ''}"></label>
      <label class="field">Invoice number<input name="invoiceNo" maxlength="60" value="${esc(h?.invoiceNo || '')}"></label>
      <label class="field">Invoice date<input type="date" name="invoiceDate" value="${esc(h?.invoiceDate || '')}"></label>
      <p class="full error hidden" data-bn-error></p><button class="primary full">Save HMO</button></form>`, '<div class="dialog-foot"><button data-close>Cancel</button></div>');
    const form = dialog.querySelector('#bn-hmo');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = form.elements;
      const dependents = f.dependents.value.split('\n').map(l => l.split(',').map(x => x.trim())).filter(x => x[0]).map(([name, relationship = '', memberNo = '']) => ({ name, relationship: relationship || 'Dependent', memberNo }));
      try {
        const num = el => (el.value === '' ? '' : Number(el.value));
        await api('/benefits/hmo', { employeeId, provider: f.provider.value.trim(), memberNo: f.memberNo.value.trim(), plan: f.plan.value.trim(), status: f.status.value, startDate: f.startDate.value, endDate: f.endDate.value, coverage: f.coverage.value.trim(), dependents, planId: f.planId.value.trim(), rank: f.rank.value.trim(), benefitLimit: num(f.benefitLimit), benefitType: f.benefitType.value.trim(), account: f.account.value.trim(), movementType: f.movementType.value.trim(), months: num(f.months), premium: num(f.premium), vat: num(f.vat), totalGross: num(f.totalGross), invoiceNo: f.invoiceNo.value.trim(), invoiceDate: f.invoiceDate.value });
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
