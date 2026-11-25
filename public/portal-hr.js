// Employee portal additions: my memos (acknowledge receipt), my trainings, my data sheet and my 201 documents.
import { DOC_BADGE, fmtDate, fmtDateTime, readFile, bindCelebrationPhotos, reasonPicker, bindReasonPickers, readReason, OVERTIME_REASONS, idTypeSelect } from './hr-common.js';
import { describeTotal } from './overtime-ui.js';
// Loaded on demand, never at start-up: if the file cannot be loaded the rest of the app keeps working.
let viewer = null;
const loadViewer = () => (viewer ? Promise.resolve(viewer) : import('./memo-viewer.js').then(m => (viewer = m)).catch(() => null));

export function createPortalHr({ api, esc, table, toast, confirm = (title, message) => toast(message), openDialog, dialog }) {
  const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;

  // My 201 file: documents and the data sheet under one menu item, one sub-tab at a time.
  let fileView = 'profile';
  const showProfile = () => { fileView = 'profile'; };
  async function file201(box) {
    box.innerHTML = `<div class="tabs sub-tabs"><button data-file-view="profile" class="${fileView === 'profile' ? 'active' : ''}">👤 Profile</button><button data-file-view="employment" class="${fileView === 'employment' ? 'active' : ''}">💼 Employment</button><button data-file-view="documents" class="${fileView === 'documents' ? 'active' : ''}">📁 Documents</button></div><div id="file201-view"><div class="loading">Loading…</div></div>`;
    box.querySelector('.sub-tabs').onclick = e => { const b = e.target.closest('[data-file-view]'); if (b && b.dataset.fileView !== fileView) { fileView = b.dataset.fileView; file201(box); } };
    const view = box.querySelector('#file201-view');
    if (fileView === 'employment') {
      // Employment information (live from the HR records; loaded on first use).
      try { const [{ renderEmployment }, data] = await Promise.all([import('./portal-employment.js'), api('/me/employment')]); return renderEmployment(view, data, esc); } catch (error) { view.innerHTML = `<div class="notice">${esc(/not found|import|module/i.test(error.message) ? 'Employment information will be available after the HR server restarts.' : error.message)}</div>`; return; }
    }
    return fileView === 'profile' ? profile(view, await api('/hr/me/profile')) : documents(view, await api('/hr/me/documents'));
  }
  let noticeView = 'memos';
  const loadMemos = async view => { const [list] = await Promise.all([api('/hr/me/memos'), loadViewer()]); return memos(view, list); };
  async function notices(box) {
    box.innerHTML = `<div class="tabs sub-tabs"><button data-notice-view="memos" class="${noticeView === 'memos' ? 'active' : ''}">📝 Memos</button><button data-notice-view="cases" class="${noticeView === 'cases' ? 'active' : ''}">⚖️ Due process</button></div><div id="notice-view"><div class="loading">Loading…</div></div>`;
    box.querySelector('.sub-tabs').onclick = e => { const b = e.target.closest('[data-notice-view]'); if (b && b.dataset.noticeView !== noticeView) { noticeView = b.dataset.noticeView; notices(box); } };
    const view = box.querySelector('#notice-view');
    return noticeView === 'cases' ? (await import('./portal-cases.js')).createPortalCases({ api, esc, toast, confirm }).fill(view) : loadMemos(view);
  }
  async function fill(tab, box) {
    try {
      if (tab === 'profile201') return file201(box);
      if (tab === 'loans201') return loans(box, await api('/hr/me/loans'));
      if (tab === 'overtime201') return overtime(box, await api('/hr/me/overtime'));
      if (tab === 'memos') return notices(box);
      if (tab === 'trainings') return trainings(box, await api('/hr/me/trainings'));
      // My Benefits (loaded on first use).
      if (tab === 'benefits') { try { return (await import('./portal-benefits.js')).createPortalBenefits({ api, esc }).fill(box); } catch { box.innerHTML = '<div class="notice">My Benefits will be available after the HR server restarts.</div>'; return; } }
      // Loaded on first use (Notices & due process).
      if (tab === 'cases') { noticeView = 'cases'; return notices(box); }
    } catch (error) { box.innerHTML = `<div class="notice">${esc(error.message)}</div>`; }
  }

  const MP_ICON = {
    all: '<path d="M16 11a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm-8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3Zm0 2c-2.7 0-6 1.3-6 3.5V19h12v-2.5C14 14.3 10.7 13 8 13Zm8 0c-.3 0-.7 0-1.1.1A4.4 4.4 0 0 1 16 16.5V19h6v-2.5c0-2.2-3.3-3.5-6-3.5Z"/>',
    active: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 4.5V21h10.3a6 6 0 0 1-.3-2 6 6 0 0 1 .6-2.6A13 13 0 0 0 12 14Zm8.3 1.3-3.6 3.6-1.6-1.6-1.1 1.1 2.7 2.7 4.7-4.7Z"/>',
    inactive: '<path d="M10 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm0 2c-3.3 0-8 1.7-8 4.5V21h16v-2.5c0-2.8-4.7-4.5-8-4.5Zm12.3-5.9-1.4-1.4-1.9 1.9-1.9-1.9-1.4 1.4 1.9 1.9-1.9 1.9 1.4 1.4 1.9-1.9 1.9 1.9 1.4-1.4-1.9-1.9Z"/>',
    search: '<path d="M10 3a7 7 0 1 0 4.2 12.6l5.1 5.1 1.4-1.4-5.1-5.1A7 7 0 0 0 10 3Zm0 2a5 5 0 1 1-5 5 5 5 0 0 1 5-5Z"/>',
    export: '<path d="M12 3 7 8l1.4 1.4L11 6.8V15h2V6.8l2.6 2.6L17 8Zm-7 13v4h14v-4h-2v2H7v-2Z"/>',
    plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6Z"/>',
    check: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm-1.4 14.6-4.2-4.2 1.4-1.4 2.8 2.8 5.8-5.8 1.4 1.4Z"/>',
    minus: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm5 11H7v-2h10Z"/>',
    pen: '<path d="m15.2 4.2 4.6 4.6L8.6 20H4v-4.6Zm2.1-2.1 1-1a1.5 1.5 0 0 1 2.1 0l2.5 2.5a1.5 1.5 0 0 1 0 2.1l-1 1Z"/>',
    building: '<path d="M4 21V5l8-3v19Zm2-2h4V5L6 6.5ZM14 21V9h6v12Zm2-2h2v-8h-2Z"/>',
    bag: '<path d="M20 7h-4V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Zm-10-2h4v2h-4Zm10 14H4v-5h6v2h4v-2h6Zm0-7H4V9h16Z"/>',
    calendar: '<path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3Zm12 8H5v9h14ZM5 8h14V6H5Z"/>',
    doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 2.4L17.6 8H14ZM8 12h8v1.6H8Zm0 3.4h8V17H8Z"/>',
    pin: '<path d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 14.5 9 2.5 2.5 0 0 1 12 11.5Z"/>',
    people: '<path d="M9 11a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm8 0a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM9 13c-2.7 0-8 1.3-8 4v3h16v-3c0-2.7-5.3-4-8-4Zm8 0h-.8a5 5 0 0 1 2.8 4v3h4v-3c0-2.5-3.6-3.8-6-4Z"/>',
    mail: '<path d="M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 2.4V17h16V7.4l-8 5.3Zm.9-.4L12 11.7 19.1 7Z"/>',
    phone: '<path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.2 11.4 11.4 0 0 0 3.6.6 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11.4 11.4 0 0 0 .6 3.6 1 1 0 0 1-.3 1Z"/>',
    user: '<path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Zm0 2c-4 0-9 2-9 5v2h18v-2c0-3-5-5-9-5Z"/>',
    chevron: '<path d="m9 6 6 6-6 6-1.4-1.4L12.2 12 7.6 7.4Z"/>',
    left: '<path d="m15 6-6 6 6 6 1.4-1.4L11.8 12l4.6-4.6Z"/>',
  };
  // My profile: the same layout as the HR masterlist profile (photo header, status, icon-labelled sections), read-only.
  function profile(box, r) {
    const f = r.form, svg = name => `<svg class="ml-ico" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${MP_ICON[name] || MP_ICON.doc}</svg>`;
    const info = (ic, label, value) => `<div class="ml-info">${svg(ic)}<span><small>${esc(label)}</small><strong>${esc(value || 'Not set')}</strong></span></div>`;
    const block = (title, items) => `<section class="ml-block"><h3>${title}</h3><div class="ml-grid">${items.join('')}</div></section>`;
    const name = [f.personal.firstName, f.personal.middleName, f.personal.lastName, f.personal.suffix].filter(Boolean).join(' ');
    const ini = `${(f.personal.firstName || '').charAt(0)}${(f.personal.lastName || '').charAt(0)}`.toUpperCase();
    box.innerHTML = `<section class="ml-preview mp-profile">
      <div class="ml-pv-head"><span class="ml-avatar ml-active ml-avatar-lg" aria-hidden="true"><img src="/api/hr/me/photo" alt="" data-mp-photo>${esc(ini)}</span><div><strong class="ml-pv-name">${esc(name)}</strong><span>${esc(f.employment.position || '—')}</span><span>${esc(r.number || '')}</span><span class="ml-pill ml-active">${svg('check')}Active</span></div></div>
      <div class="mp-cols">
        ${block('Work information', [info('building', 'Subsidiary', f.employment.department), info('bag', 'Position', f.employment.position), info('calendar', 'Date hired', f.employment.dateHired && fmtDate(f.employment.dateHired)), info('doc', 'Employment type', f.employment.employmentType || f.employment.classification), info('people', 'Reporting manager', f.employment.supervisor), info('doc', 'Employee number', r.number)])}
        ${block('Contact information', [info('mail', 'Work email', f.personal.workEmail || f.employment.businessEmail), info('phone', 'Mobile', f.personal.mobile), info('mail', 'Personal email', f.personal.personalEmail), info('pin', 'Address', f.personal.address)])}
        ${block('Personal information', [info('user', 'Preferred name', f.personal.preferredName), info('user', 'Sex', f.personal.sex), info('calendar', 'Date of birth', f.personal.birthDate && fmtDate(f.personal.birthDate)), info('pin', 'Place of birth', f.personal.birthPlace), info('user', 'Civil status', f.personal.civilStatus), info('user', 'Nationality', f.personal.nationality)])}
        ${block('Emergency contact', [info('people', 'Contact person', f.emergency.name), info('people', 'Relationship', f.emergency.relationship), info('phone', 'Contact number', f.emergency.contact)])}
        ${block('Government IDs', [info('doc', 'TIN', f.government.tin), info('doc', 'SSS number', f.government.sss), info('doc', 'PhilHealth number', f.government.philHealth), info('doc', 'Pag-IBIG MID', f.government.pagIbig)])}
      </div>
      <p class="legend">Only HR can change these details. If something is wrong or out of date, tell HR.</p></section>`;
    box.querySelector('[data-mp-photo]')?.addEventListener('error', event => event.target.remove());
  }
  // My overtime: apply (period, unpaid break, work to be done, optional attachment), edit or cancel while pending,
  // and see every application with its status, HR's decision and history.
  function overtime(box, list, editing = null) {
    const STATUS = { pending: ['Pending', 'pending'], approved: ['Approved', 'approved'], rejected: ['Rejected', 'rejected'], cancelled: ['Cancelled', 'cancelled'] };
    const pill = s => { const [label, tone] = STATUS[s] || [s, 'cancelled']; return `<span class="ot-pill ot-${tone}">${label}</span>`; };
    const period = o => (o.startTime ? `${o.startTime} – ${o.endTime}${o.endTime <= o.startTime ? ' (next day)' : ''}` : '—');
    const e = editing || {};
    const nightSummary = (() => { const approved = list.filter(o => o.status === 'approved'); const nh = approved.reduce((s, o) => s + (o.approvedNightHours || 0), 0), np = approved.reduce((s, o) => s + (o.nightPay || 0), 0); return nh ? `<div class="cards"><div class="card featured"><div class="card-label">Approved night differential</div><div class="card-value">${Math.round(nh * 100) / 100} h</div><div class="card-foot">≈ ₱${np.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · final amount in your payslip</div></div></div>` : ''; })();
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>${editing ? 'Edit overtime application' : 'Apply for overtime'}</h2><span class="legend">Clocking out late is not overtime by itself. Apply for the period you will work or worked; only approved time actually worked inside it is paid.</span></div>
      <form id="ot-file" class="panel-body form-grid">
        <label class="field">Date<input type="date" name="date" required value="${esc(e.date || '')}"></label>
        <label class="field">Unpaid break (minutes)<input type="number" name="breakMinutes" min="0" max="480" step="5" value="${e.breakMinutes || 0}"></label>
        <label class="field">Start of overtime<input type="time" name="startTime" required value="${esc(e.startTime || '')}"></label>
        <label class="field">End of overtime<input type="time" name="endTime" required value="${esc(e.endTime || '')}"></label>
        <div class="field full ot-total"><strong data-ot-hours>—</strong><span class="ot-night" data-ot-night></span><small>An end time earlier than the start counts as the next day.</small></div>
        ${reasonPicker(OVERTIME_REASONS, e.reason || '', { detailsLabel: 'Work to be done / explanation' })}
        <label class="field full">Supporting attachment (optional)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"><small>${e.documentId ? 'An attachment is already on file; choose a file only to replace it. ' : ''}PDF, PNG or JPEG · up to 5 MB</small></label>
        <div class="full ot-form-actions"><button class="primary">${editing ? 'Save changes' : 'Submit for approval'}</button>${editing ? '<button type="button" data-ot-edit-cancel>Discard changes</button>' : ''}</div></form>
      ${nightSummary}</section>
      <section class="panel"><div class="panel-head"><h2>My applications</h2></div><div class="ot-mine">${list.map(o => `<article class="ot-card">
        <div class="ot-card-head"><strong>${fmtDate(o.date)}</strong>${o.paidRunId ? `<span class="ot-pill ${(o.paidPayDate || '') <= new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) && o.paidPayDate ? 'ot-approved' : 'ot-pending'}">${o.paidPayDate && o.paidPayDate <= new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10) ? `Paid · ${esc(o.paidPayDate)}` : `Included · ${esc(o.paidCutoff || '')}${o.paidPayDate ? ` (salary day ${esc(o.paidPayDate)})` : ''}`}</span>` : o.carriedOver ? `<span class="ot-pill ot-pending">${o.status === 'pending' ? 'Pending Overtime · carried over' : 'Approved · paid in the next payroll'}</span>` : pill(o.status)}</div>
        <p class="ot-card-time">${esc(period(o))}${o.breakMinutes ? ` · ${o.breakMinutes} min break` : ''} · <strong>${o.hours} h</strong>${o.status === 'approved' ? ` · approved <strong>${o.approvedHours} h</strong>` : ''}${o.nightHours ? ` · 🌙 ${o.nightHours} h night` : ''}</p>
        <p class="ot-card-reason">${esc(o.reason)}</p>
        ${o.adjustReason ? `<p class="legend">HR approved ${o.approvedHours} of ${o.hours} h: ${esc(o.adjustReason)}</p>` : ''}${o.remarks ? `<p class="legend">HR remarks: ${esc(o.remarks)}</p>` : ''}
        <div class="ot-card-actions">${o.documentId ? `<a class="small" href="/api/me/documents/${esc(o.documentId)}/content" target="_blank" rel="noopener">📎 Attachment</a>` : ''}${o.history?.length ? `<details><summary>History</summary><ul>${o.history.map(h => `<li>${esc(h.action)} · ${esc(new Date(h.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }))}${h.note ? ` · ${esc(h.note)}` : ''}</li>`).join('')}</ul></details>` : ''}
          ${o.status === 'pending' ? `<button class="small" data-ot-edit="${esc(o.id)}">Edit</button><button class="small" data-ot-cancel="${esc(o.id)}">Cancel</button>` : ''}</div></article>`).join('') || '<p class="muted">Nothing to show yet.</p>'}</div></section>`;
    const form = box.querySelector('#ot-file');
    const compute = () => {
      const s = form.elements.startTime.value, en = form.elements.endTime.value, br = Number(form.elements.breakMinutes.value || 0);
      form.querySelector('[data-ot-hours]').textContent = describeTotal(s, en, br);
      if (!s || !en) { form.querySelector('[data-ot-night]').textContent = ''; return; }
      const start = Number(s.slice(0, 2)) * 60 + Number(s.slice(3)); let span = Number(en.slice(0, 2)) * 60 + Number(en.slice(3)) - start; if (span <= 0) span += 1440;
      let night = 0; for (let m = start; m < start + span; m++) { const hr = Math.floor((m % 1440) / 60); if (hr >= 22 || hr < 6) night++; }
      form.querySelector('[data-ot-night]').textContent = night ? `🌙 Up to ${Math.round(night / 60 * 100) / 100} h night differential (10 PM – 6 AM), computed automatically` : '';
    };
    form.addEventListener('input', compute); compute(); bindReasonPickers(box);
    form.onsubmit = async event => {
      event.preventDefault(); const f = new FormData(form), file = form.elements.file.files[0], submit = form.querySelector('button.primary');
      submit.disabled = true;
      try {
        let documentId = e.documentId || '';
        if (file) {
          if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a PDF, PNG or JPEG up to 5 MB.');
          const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read the file.')); reader.readAsDataURL(file); });
          documentId = (await api('/me/documents', { type: 'Leave Supporting', name: file.name, mime: file.type, data, expiry: '', remarks: 'Overtime support' })).id;
        }
        const body = { date: f.get('date'), startTime: f.get('startTime'), endTime: f.get('endTime'), breakMinutes: Number(f.get('breakMinutes') || 0), reason: readReason(form), documentId };
        const saved = await api(editing ? `/hr/me/overtime/${editing.id}` : '/hr/me/overtime', body);
        confirm(editing ? 'Overtime application updated' : 'Overtime submitted', `Your overtime for <strong>${esc(saved.date)}</strong> (${esc(period(saved))}, ${saved.hours} h) was ${editing ? 'updated' : 'sent to HR'}.<br>Status: <strong>Pending HR approval</strong>.`);
        await fill('overtime201', box);
      } catch (error) { submit.disabled = false; toast(error.message); }
    };
    box.onclick = async event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.dataset.otEdit) { overtime(box, list, list.find(o => o.id === b.dataset.otEdit)); box.scrollIntoView({ behavior: 'smooth' }); return; }
      if (b.hasAttribute('data-ot-edit-cancel')) { overtime(box, list); return; }
      if (b.dataset.otCancel) {
        if (!window.confirm('Cancel this overtime application?')) return;
        try { await api(`/hr/me/overtime/${b.dataset.otCancel}/cancel`, {}); confirm('Overtime cancelled', 'Your overtime application was cancelled. It stays in your history.'); await fill('overtime201', box); } catch (error) { toast(error.message); }
      }
    };
  }
  function loans(box, data) {
    const money = n => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const STATUS = { pending: 'Pending HR review', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled' };
    // What HR approved (HR may change the amount, interest or months); the loan above follows these terms.
    const approvedTerms = a => {
      if (a.status !== 'approved') return '—';
      const total = (Number(a.approvedAmount) || 0) + (Number(a.interest) || 0), months = a.approvedMonths || a.months, monthly = months ? Math.round(total / months * 100) / 100 : 0;
      const changed = a.approvedAmount !== a.amount || months !== a.months || Number(a.interest) > 0;
      return `<strong>${money(a.approvedAmount)}</strong>${a.interest ? ` + ${money(a.interest)} interest` : ''} · ${months} month${months === 1 ? '' : 's'}<small>${money(Math.round(monthly / 2 * 100) / 100)} per payroll from ${a.startDate ? fmtDate(a.startDate) : '—'}${changed ? ' · <strong>changed by HR</strong>' : ''}${a.payoff ? `<br>Renewal: ${money(a.payoff)} paid off your previous loan · <strong>${money(a.netRelease)} released to you</strong>` : ''}</small>`;
    };
    // A new loan only when every current loan is below 20% left (then HR may renew it: pay it off from the new loan).
    // While a loan is at 20% or more, the form is shown disabled and cannot be sent (the server refuses it too).
    const openLoans = data.loans.filter(l => l.status === 'Active' && l.outstanding > 0).map(l => ({ ...l, share: l.outstanding / ((l.original || 0) + (l.interestTotal || 0) || 1) }));
    const overLimit = openLoans.filter(l => l.share >= 0.2 - 1e-9);
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>My loans</h2><span class="legend">Approved loans are deducted from payroll automatically</span></div>
      ${table(['Loan', 'Loan date', 'Original', 'Per payroll', 'Repaid', 'Outstanding', 'Next deduction', 'Status'], data.loans.map(l => [esc(l.type), l.loanDate ? fmtDate(l.loanDate) : '—', money(l.original) + (l.interestTotal ? `<small>+ ${money(l.interestTotal)} interest</small>` : ''), money(l.perPayroll), money(l.totalRepaid), `<strong>${money(l.outstanding)}</strong>`, l.nextDeduction ? fmtDate(l.nextDeduction) : '—', esc(l.status)]), 'No loans yet.')}</section>
      ${(() => { const paid = data.loans.flatMap(l => (l.history || []).map(h => ({ ...h, type: l.type }))).sort((a, b) => String(b.paidOn || b.end).localeCompare(String(a.paidOn || a.end))); return paid.length ? `<section class="panel"><div class="panel-head"><h2>Payment history</h2><span class="legend">Balance after each payment</span></div>${table(['Date paid', 'Loan', 'Amount', 'Balance after'], paid.map(h => [h.prior ? fmtDate(h.end) : h.paidOn ? fmtDate(h.paidOn) : `${fmtDate(h.start)} – ${fmtDate(h.end)}`, esc(h.type), money(h.amount), `<strong>${(h.balanceAfter < 0 ? `Overpaid ${money(-h.balanceAfter)}` : money(h.balanceAfter))}</strong>`]))}</section>` : ''; })()}
      <section class="panel"><div class="panel-head"><h2>Apply for a loan</h2></div>${overLimit.length ? `<p class="notice">You can apply for a new loan once less than 20% of your current loan is left. ${overLimit.map(l => `${esc(l.type)}: ${Math.round(l.share * 1000) / 10}% still owed (${money(l.outstanding)})`).join('; ')}.</p>`
          : openLoans.length ? '<p class="legend">Less than 20% of your current loan is left, so you may apply. HR may renew it: the remaining balance is paid from the new loan and you receive the rest.</p>' : ''}<form id="loan-apply" class="panel-body form-grid"><fieldset class="form-grid full" style="border:0;padding:0;margin:0" ${overLimit.length ? 'disabled' : ''}>
        <label class="field">Loan type<select name="type"><option>Salary Loan</option><option>Emergency Loan</option><option>Medical Loan</option><option>Educational Loan</option><option>Housing Loan</option><option>Vehicle Loan</option><option>Calamity Loan</option><option>SSS Loan</option><option>Pag-IBIG Loan</option><option>Other Company Loan</option></select></label>
        <label class="field">Amount requested<input type="number" name="amount" min="1" step="0.01" required></label>
        <label class="field">Repayment months<input type="number" name="months" min="1" max="120" required value="6"></label>
        <label class="field full">Purpose<input name="purpose" required minlength="3" maxlength="1000"></label>
        <div><button class="primary">${overLimit.length ? 'Not available yet' : 'Submit application'}</button></div></fieldset></form>
        ${table(['Applied', 'Type', 'Requested', 'Approved terms', 'Status', 'HR remarks', ''], data.applications.map(a => [fmtDate(a.appliedAt.slice(0, 10)), esc(a.type), `${money(a.amount)}<small>${a.months} month${a.months === 1 ? '' : 's'}</small>`, approvedTerms(a), esc(STATUS[a.status] || a.status), esc(a.remarks || '—'), a.status === 'pending' ? `<button class="small" data-loan-cancel="${a.id}">Cancel</button>` : '']), 'No applications yet.')}</section>`;
    box.querySelector('#loan-apply').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.target);
      if (overLimit.length) { toast('You can apply for a new loan once less than 20% of your current loan is left.'); return; }
      try { await api('/hr/me/loans', { type: f.get('type'), amount: Number(f.get('amount')), months: Number(f.get('months')), purpose: f.get('purpose') }); confirm('Loan application submitted', `Your <strong>${esc(f.get('type'))}</strong> application was sent to HR.<br>Status: <strong>Pending HR review</strong>.`); await fill('loans201', box); } catch (error) { toast(error.message); }
    };
    box.onclick = async event => {
      const b = event.target.closest('[data-loan-cancel]'); if (!b) return;
      try { await api(`/hr/me/loans/${b.dataset.loanCancel}/cancel`, {}); confirm('Loan application cancelled', 'Your loan application was cancelled.'); await fill('loans201', box); } catch (error) { toast(error.message); }
    };
  }
  function memos(box, list) {
    const statusChip = viewer ? viewer.statusChip : (_esc, status, label) => badge(label || (status === 'acknowledged' ? 'Acknowledged' : 'Pending Acknowledgment'), status === 'acknowledged' ? '' : 'pending');
    const open = list.filter(m => m.ackRequired && !m.acknowledgedAt && m.latest && !m.archived);
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>My memos</h2><span class="legend">${open.length ? `${open.length} waiting for your action` : 'All caught up'}</span></div><div class="panel-body memo-cards">
      ${list.map((m, i) => `<article class="memo-card ${m.ackRequired && !m.acknowledgedAt && m.latest ? 'unread' : ''}"><header><strong>${esc(m.title)}</strong><small>${esc(m.reference)} · ${esc(m.category || '')} · ${fmtDate(m.issueDate)} · version ${m.version}${m.latest ? '' : ' (replaced by a newer version)'}</small></header>
        ${m.changeNote ? `<p class="legend">What changed: ${esc(m.changeNote)}</p>` : ''}
        <p>${statusChip(esc, m.status, m.statusLabel)}${m.ackRequired && !m.acknowledgedAt && m.latest ? ` <span class="legend">Acknowledge by ${fmtDate(m.ackDeadline)}</span>` : ''}${m.acknowledgedAt ? ` <span class="legend">${fmtDateTime(m.acknowledgedAt)}</span>` : ''}</p>
        ${viewer && m.statusLabel ? '' : `<details><summary>Read memo</summary><div class="memo-body">${esc(m.body)}</div></details>`}<footer class="memo-card-actions">${viewer && m.statusLabel ? `<button class="${m.ackRequired && !m.acknowledgedAt && m.latest ? 'primary' : ''} small" data-memo-open="${i}">📄 Open memo</button>` : m.ackRequired && !m.acknowledgedAt ? `<button class="primary small" data-ack="${m.memoId}" data-version="${m.version}">I have received and read this memo</button>` : ''}</footer></article>`).join('') || '<p class="muted">No memos addressed to you yet.</p>'}
      <p class="legend">Open a memo to read the official PDF, then acknowledge it (received, read and understood) or ask HR for clarification. Opening, downloading or printing does not acknowledge it. Acknowledging is not an admission of wrongdoing and does not waive your rights.</p></div></section>`;
    box.onclick = event => {
      const ack = event.target.closest('[data-ack]');
      if (ack) { ack.disabled = true; api(`/hr/me/memos/${ack.dataset.ack}/${ack.dataset.version}/acknowledge`, {}).then(() => { confirm('Memo acknowledged', 'Your acknowledgement was recorded. HR can see the date and time.'); return fill('memos', box); }).then(() => memoNotice(document, false)).catch(error => { toast(error.message); ack.disabled = false; }); return; }
      const b = event.target.closest('[data-memo-open]'); if (!b) return;
      const refresh = async () => { await loadMemos(box); memoNotice(document, false).catch(() => {}); };
      if (openDialog && viewer && list[Number(b.dataset.memoOpen)].statusLabel) viewer.openMyMemo({ api, esc, toast, openDialog, dialog }, list[Number(b.dataset.memoOpen)], refresh);
      else window.open(`/api/hr/me/memos/${list[Number(b.dataset.memoOpen)].memoId}/${list[Number(b.dataset.memoOpen)].version}.pdf`, '_blank', 'noopener');
    };
  }

  function trainings(box, list) {
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>My trainings</h2><span class="legend">Times are Philippine time</span></div>${table(['Training', 'When', 'Where', 'Registration', 'Attendance', 'Completion'], list.map(t => [`${esc(t.title)}${t.required ? ' <small>required</small>' : ''}${t.facilitator ? `<small>${esc(t.facilitator)}</small>` : ''}`, `${fmtDate(t.date)}${t.startTime ? `<small>${t.startTime}${t.endTime ? `–${t.endTime}` : ''}</small>` : ''}`, `${esc(t.venue || '')}${t.meetingLink ? ` <a href="${esc(t.meetingLink)}" target="_blank" rel="noopener noreferrer">Join link</a>` : ''}` || '—',
      t.status === 'scheduled' && t.attendance === 'pending' ? `${esc(t.registration)}<span class="row-actions">${t.registration !== 'confirmed' ? `<button class="small primary" data-reg="${t.trainingId}" data-v="confirmed">Confirm</button>` : ''}${t.registration !== 'declined' && !t.required ? `<button class="small" data-reg="${t.trainingId}" data-v="declined">Decline</button>` : ''}</span>` : esc(t.registration),
      esc(t.attendance), t.completion === 'completed' ? badge('Completed') : esc(t.completion)]), 'No trainings assigned to you.')}</section>`;
    box.onclick = async event => {
      const b = event.target.closest('[data-reg]'); if (!b) return;
      try { await api(`/hr/me/trainings/${b.dataset.reg}/registration`, { registration: b.dataset.v }); toast(b.dataset.v === 'confirmed' ? 'Attendance confirmed.' : 'Declined. HR will see this.'); await fill('trainings', box); } catch (error) { toast(error.message); }
    };
  }


  // Required items the employee still has to upload (missing, rejected or expired). Uploading lifts the signal;
  // a file HR rejects, or one that expires, raises it again.
  const toComply = list => list.items.filter(i => i.requirement.required && ['Missing', 'Rejected', 'Expired'].includes(i.status));
  const statusText = i => (i.numberOnly ? (i.status === 'Verified' ? 'Complied — number on file' : 'Not complied — HR will record the number') : STATUS_TEXT[i.status] || i.status);
  const STATUS_TEXT = { Missing: 'Not complied — upload required', Rejected: 'Rejected — upload again', Expired: 'Expired — upload a renewed copy', Submitted: 'Submitted — waiting for HR review', 'Under Review': 'Under HR review', Verified: 'Complied', 'Not Applicable': 'Not applicable' };
  // Memos waiting for acknowledgement: a count on the Memos menu item and a red notice on the dashboard that stay
  // until the employee acknowledges each memo (the bell notice alone can be cleared by opening the bell).
  // Outstanding actions: memos to acknowledge (pending / overdue / clarification) and due process notices (receipt and
  // explanation tracked separately). A count on the Memos menu item, the bell and a red notice on the dashboard stay
  // until each action is done; opening the bell or a reminder never lifts them.
  async function memoNotice(app, onDashboard) {
    const [memoList, cases] = await Promise.all([api('/hr/me/memos'), api('/hr/me/cases').catch(() => [])]);
    const pending = memoList.filter(m => m.ackRequired && !m.acknowledgedAt && m.latest !== false && !m.archived);
    const dp = cases.flatMap(c => [...c.notices.filter(n => !n.receivedAt).map(n => ({ text: `${n.title} ${n.reference || c.reference}`, label: '🔔 Pending Acknowledgment' })), ...(c.canExplain && !c.explanation ? [{ text: `Notice to Explain ${c.reference} — due ${fmtDate(c.deadline)}`, label: '📝 Explanation Required' }] : [])]);
    const total = pending.length + dp.length;
    const flag = (selector, count, label) => { const el = app.querySelector(selector); el?.querySelector('.nav-flag')?.remove(); if (el && count) el.insertAdjacentHTML('beforeend', `<span class="nav-flag" aria-label="${count} ${label}">${count}</span>`); };
    flag('.employee-sidebar nav [data-portal-tab="memos"]', total, `notice${total === 1 ? '' : 's'} waiting for your action`);
    const bell = app.querySelector('[data-portal-bell]');
    bell?.querySelector('.bell-pending')?.remove();
    if (bell && total) bell.insertAdjacentHTML('beforeend', `<span class="bell-pending" title="${total} action${total === 1 ? '' : 's'} waiting for you" aria-label="${total} actions waiting">${total}</span>`);
    const main = app.querySelector('.employee-main');
    main?.querySelector('.memo-ack-alert')?.remove();
    if (!onDashboard || !total || !main) return;
    const box = document.createElement('section'); box.className = 'compliance-alert memo-ack-alert'; box.setAttribute('role', 'alert');
    const items = [...pending.map(m => `<li>${m.status === 'overdue' ? '⚠️ Overdue Acknowledgment' : m.status === 'clarification' ? '❓ Clarification Requested' : '🔔 Pending Acknowledgment'}: ${esc(m.reference || '')} ${esc(m.title)} <small>(by ${fmtDate(m.ackDeadline)})</small></li>`), ...dp.map(d => `<li>${d.label}: ${esc(d.text)}</li>`)];
    box.innerHTML = `<div><strong>${total} item${total === 1 ? '' : 's'} waiting for your action</strong><ol class="comply-list">${items.join('')}</ol><p class="legend">This notice stays until each item is done. It does not stop you from timing in, viewing your pay or submitting an explanation.</p></div><div class="row-actions">${pending.length ? '<button class="primary" data-portal-tab="memos">Open memos</button>' : ''}${dp.length ? '<button data-portal-tab="cases">Notices &amp; due process</button>' : ''}</div>`;
    const anchor = main.querySelector('.compliance-alert') || main.querySelector('.clock-block') || main.querySelector('.employee-welcome');
    if (anchor) anchor.after(box); else main.prepend(box);
  }
  async function compliance(app, onDashboard) {
    memoNotice(app, onDashboard).catch(() => {});
    try {
      const list = await api('/hr/me/documents'), due = toComply(list);
      const tabButton = app.querySelector('.employee-sidebar nav [data-portal-tab="profile201"]');
      if (tabButton && due.length && !tabButton.querySelector('.nav-flag')) tabButton.insertAdjacentHTML('beforeend', `<span class="nav-flag" aria-label="${due.length} requirement${due.length === 1 ? '' : 's'} to upload">${due.length}</span>`);
      const main = app.querySelector('.employee-main');
      if (!onDashboard || !due.length || !main || main.querySelector('.compliance-alert')) return;
      const box = document.createElement('section'); box.className = 'compliance-alert'; box.setAttribute('role', 'alert');
      box.innerHTML = `<div><strong>⚠️ Not complied: ${due.length} 201 file requirement${due.length === 1 ? '' : 's'} to upload</strong><ol class="comply-list">${due.map(i => `<li>${esc(i.requirement.name)}${i.numberOnly ? ' <small>(HR will record the number)</small>' : i.status === 'Missing' ? '' : ` <small>(${esc(STATUS_TEXT[i.status])})</small>`}</li>`).join('')}</ol><p class="legend">Upload ${due.length === 1 ? 'it' : 'them'} in My 201 documents. This notice is lifted once every required file is uploaded.</p></div><button class="primary" data-portal-tab="files201">Upload now</button>`;
      // Below the welcome and the time-in card, above the menu cards.
      const anchor = main.querySelector('.clock-block') || main.querySelector('.employee-welcome');
      if (anchor) anchor.after(box); else main.prepend(box);
    } catch { /* the checklist is optional on the dashboard */ }
  }
  function documents(box, list) {
    const due = toComply(list);
    box.innerHTML = `${due.length ? `<div class="compliance-alert" role="alert"><div><strong>⚠️ ${due.length} required document${due.length === 1 ? ' is' : 's are'} not yet complied</strong><ol class="comply-list">${due.map(i => `<li>${esc(i.requirement.name)}${i.numberOnly ? ' <small>(HR will record the number)</small>' : i.status === 'Missing' ? '' : ` <small>(${esc(STATUS_TEXT[i.status])})</small>`}</li>`).join('')}</ol><p class="legend">Upload ${due.length === 1 ? 'it' : 'each one'} below. The notice is lifted as soon as the file is uploaded; HR then reviews it.</p></div></div>` : `<div class="notice success">All required documents are uploaded${list.completeCount < list.requiredCount ? '; HR is reviewing the rest' : ' and verified'}.</div>`}<section class="panel"><div class="panel-head"><div><h2>My 201 documents</h2><p>Upload what HR asked for. HR checks each file before it counts as complete.</p></div><span class="legend">${list.completeCount} of ${list.requiredCount} required documents verified</span></div>
      <div class="doc-cards">${list.items.some(i => !(i.numberOnly && i.status === 'Verified')) ? list.items.filter(i => !(i.numberOnly && i.status === 'Verified')).map(i => {
        // One card per requirement so the upload button is always on screen (phones included).
        const upload = i.numberOnly
          ? ''
          : ['Missing', 'Rejected', 'Expired'].includes(i.status) ? `${i.requirement.id === 'valid-id' ? `<label class="doc-idtype">Which ID will you upload?${idTypeSelect(esc, 'idType', 'data-idtype')}</label>` : ''}<label class="doc-upload button-like primary-like">📤 Upload file<input type="file" data-up="${esc(i.requirement.id)}" accept="application/pdf,image/png,image/jpeg" hidden></label>` : '';
        const when = i.current?.expiryDate ? `Expires ${fmtDate(i.current.expiryDate)}` : i.due ? `Due ${fmtDate(i.due)}` : '';
        const file = i.versions[0] ? `<a href="/api/hr/me/documents/${i.versions[0].id}/content" target="_blank" rel="noopener">${esc(i.versions[0].name)}</a>` : '';
        return `<article class="doc-card${['Missing', 'Rejected', 'Expired'].includes(i.status) ? ' due' : ''}"><div class="doc-card-head"><strong>${esc(i.requirement.name)}</strong>${!i.requirement.required && i.status === 'Missing' ? '' : badge(statusText(i), DOC_BADGE[i.status])}</div>${i.current?.reviewNote && i.status === 'Rejected' ? `<p class="doc-note">${esc(i.current.reviewNote)}</p>` : ''}${when || file ? `<p class="doc-meta">${[when, i.current?.idType && `ID: ${esc(i.current.idType)}`, file && `Your upload: ${file}`].filter(Boolean).join(' · ')}</p>` : ''}${upload}</article>`;
      }).join('') : '<p class="muted">No documents are required right now.</p>'}</div>
      <p class="panel-body legend">PDF, JPG or PNG. Sensitive documents (such as medical records) are handled directly by HR.</p></section>`;
    box.onchange = async event => {
      const input = event.target.closest('[data-up]'); if (!input) return;
      const file = input.files[0]; if (!file) return;
      // Government-issued ID: the employee first says which ID it is (Passport, UMID, TIN ID, ...).
      const idType = input.dataset.up === 'valid-id' ? box.querySelector('[data-idtype]')?.value || '' : '';
      if (input.dataset.up === 'valid-id' && !idType) { input.value = ''; toast('Choose which ID you are uploading first.'); box.querySelector('[data-idtype]')?.focus(); return; }
      try { await api('/hr/me/documents', { requirementId: input.dataset.up, name: file.name, mime: file.type, data: await readFile(file), ...(idType ? { idType } : {}) }); confirm('Document uploaded', `<strong>${esc(file.name)}</strong> was uploaded to your 201 file.<br>Status: <strong>Waiting for HR review</strong>.`); documents(box, await api('/hr/me/documents')); } catch (error) { toast(error.message); }
    };
  }
  // Shown at the top of the employee's dashboard on celebration days.
  async function celebrations(main) {
    if (!main) return;
    try {
      // Congratulations stay up for the whole month, with each celebrant's photo.
      const month = await api('/hr/celebrations/month'), list = month.celebrations || [];
      if (!list.length) return;
      const MONTH = new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
      const day = md => `${MONTH.slice(0, 3)} ${Number(md.slice(3))}`;
      const ini = n => String(n).split(/\s+/).filter(Boolean).map(s => s[0]).slice(0, 1).concat(String(n).split(/\s+/).filter(Boolean).slice(-1).map(s => s[0])).join('').toUpperCase();
      const html = `<section class="pm-card cg" aria-labelledby="cg-title"><div class="cg-head"><h2 id="cg-title">🎉 Congratulations this ${esc(MONTH)}</h2><button type="button" class="pm-chip pm-ok cg-toggle" data-cg-toggle aria-expanded="false">${list.length}<span class="cg-word"> celebration${list.length === 1 ? '' : 's'}</span> <span aria-hidden="true">›</span></button></div>
        <div class="cg-list">${list.map(c => `<article class="cg-item${c.today ? ' today' : ''}"><span class="cg-photo"><span>${esc(ini(c.name))}</span><img src="/api/hr/celebrations/${encodeURIComponent(c.employeeId)}/photo" alt="" loading="lazy" data-celebrant-photo></span><div><b class="cg-first">${esc(String(c.name).split(/\s+/)[0])}</b><strong>${esc(c.name)}</strong>${c.position ? `<small>${esc(c.position)}</small>` : ''}<p>${c.occasion === 'birthday' ? `🎂 Happy Birthday!` : `🏆 Happy ${c.years}-year work anniversary!`}</p><em>${c.today ? 'Today' : esc(day(c.day))}</em></div></article>`).join('')}</div></section>`;
      const box = document.createElement('div'); box.innerHTML = html;
      // Home screen order (Nov 24, 2026): welcome, clock, attendance, quick actions, then greetings.
      box.firstElementChild.querySelector('[data-cg-toggle]')?.addEventListener('click', e => { const sec = e.currentTarget.closest('.cg'), open = sec.classList.toggle('cg-open'); e.currentTarget.setAttribute('aria-expanded', String(open)); });
      const section = box.firstElementChild, anchor = main.querySelector('#portal-content') || main.querySelector('.employee-welcome');
      // Home screen: right after Today's attendance, inside the same block, so the second screen shows My attendance,
      // Today's attendance and the celebrations together (Nov 24, 2026).
      // Home screen: right under the Welcome card (Nov 25, 2026).
      const block = main.querySelector('.clock-block'), welcome = main.querySelector('.sc-welcome');
      if (welcome) welcome.after(section); else if (block) block.append(section); else if (anchor?.id === 'portal-content') anchor.before(section); else if (anchor) anchor.after(section); else main.prepend(section);
      bindCelebrationPhotos(section);
    } catch { /* greetings are optional */ }
  }
  return { fill, celebrations, compliance, tabs: [['profile201', 'My profile &amp; 201 file', '👤'], ['loans201', 'My loans', '💳'], ['benefits', 'My benefits', '🎁'], ['overtime201', 'My overtime', '⏱️'], ['memos', 'Official notices', '📝'], ['trainings', 'Trainings', '🎓']], showProfile, showMemos: () => { noticeView = 'memos'; }, showCases: () => { noticeView = 'cases'; }, showDocuments: () => { fileView = 'documents'; } };
}
