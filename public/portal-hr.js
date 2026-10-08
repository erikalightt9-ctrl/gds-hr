// Employee portal additions: my memos (acknowledge receipt), my trainings, my data sheet and my 201 documents.
import { DOC_BADGE, fmtDate, fmtDateTime, readFile, fieldBoxes, sectionCard, celebrationsHtml, bindCelebrationPhotos } from './hr-common.js';

export function createPortalHr({ api, esc, table, toast, confirm = (title, message) => toast(message) }) {
  const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
  const SHEET = { new: 'Not started', draft: 'Draft (only you can see it)', submitted: 'Submitted to HR', 'under-review': 'HR is reviewing', returned: 'Returned for correction', approved: 'Approved', rejected: 'Rejected' };

  async function fill(tab, box) {
    try {
      if (tab === 'profile201') return profile(box, await api('/hr/me/profile'));
      if (tab === 'loans201') return loans(box, await api('/hr/me/loans'));
      if (tab === 'overtime201') return overtime(box, await api('/hr/me/overtime'));
      if (tab === 'memos') return memos(box, await api('/hr/me/memos'));
      if (tab === 'trainings') return trainings(box, await api('/hr/me/trainings'));
      if (tab === 'datasheet') return datasheet(box, await api('/hr/me/datasheet'));
      if (tab === 'files201') return documents(box, await api('/hr/me/documents'));
    } catch (error) { box.innerHTML = `<div class="notice">${esc(error.message)}</div>`; }
  }

  function profile(box, r) {
    const f = r.form;
    box.innerHTML = sectionCard(esc, '👤', 'Personal Information', fieldBoxes(esc, [['First name', f.personal.firstName], ['Middle name', f.personal.middleName], ['Last name', f.personal.lastName], ['Suffix', f.personal.suffix], ['Preferred name', f.personal.preferredName], ['Sex', f.personal.sex], ['Date of birth', f.personal.birthDate && fmtDate(f.personal.birthDate)], ['Place of birth', f.personal.birthPlace], ['Civil status', f.personal.civilStatus], ['Nationality', f.personal.nationality], ['Mobile', f.contact.mobile], ['Work email', f.contact.workEmail], ['Personal email', f.contact.personalEmail], ['Current address', f.contact.currentAddress], ['Permanent address', f.contact.permanentAddress]]))
      + sectionCard(esc, '📞', 'Emergency Contact', fieldBoxes(esc, [['Contact person', f.emergency.name], ['Relationship', f.emergency.relationship], ['Contact number', f.emergency.contact]]))
      + sectionCard(esc, '💼', 'Employment', fieldBoxes(esc, [['Employee number', r.number], ['Department', f.employment.department], ['Position', f.employment.position], ['Employment type', f.employment.employmentType], ['Classification', f.employment.classification], ['Immediate supervisor', f.employment.supervisor], ['Date hired', fmtDate(f.employment.dateHired)]]))
      + sectionCard(esc, '🪪', 'Government IDs', fieldBoxes(esc, [['TIN', f.government.tin], ['SSS number', f.government.sss], ['PhilHealth number', f.government.philHealth], ['Pag-IBIG MID', f.government.pagIbig]]))
      + '<p class="legend">This is read-only. To update your details, use <strong>My data sheet</strong>; HR reviews the change before it is saved.</p>';
  }
  function overtime(box, list) {
    const STATUS = { pending: 'Pending HR approval', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled' };
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>File overtime</h2><span class="legend">Clocking out late is not overtime by itself. File the extra hours you actually worked; only approved hours are paid.</span></div>
      <form id="ot-file" class="panel-body form-grid">
        <label class="field">Date<input type="date" name="date" required></label>
        <label class="field">Start of overtime<input type="time" name="startTime" required></label>
        <label class="field">End of overtime<input type="time" name="endTime" required></label>
        <div class="field ot-total">Total overtime<strong data-ot-hours>—</strong><span class="ot-night" data-ot-night></span><small>Computed from start and end. An end time earlier than the start counts as the next day.</small></div>
        <label class="field full">Work done / reason<input name="reason" required minlength="3" maxlength="1000"></label>
        <div><button class="primary">Submit for approval</button></div></form>
      ${(() => { const approved = list.filter(o => o.status === 'approved'); const nh = approved.reduce((s, o) => s + (o.approvedNightHours || 0), 0), np = approved.reduce((s, o) => s + (o.nightPay || 0), 0); return nh ? `<div class="cards"><div class="card featured"><div class="card-label">Approved night differential</div><div class="card-value">${Math.round(nh * 100) / 100} h</div><div class="card-foot">≈ ₱${np.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · final amount in your payslip</div></div></div>` : ''; })()}
      ${table(['Date', 'Time', 'Hours filed', 'Night diff', 'Reason', 'Status', 'HR remarks', ''], list.map(o => [fmtDate(o.date), o.startTime ? `${esc(o.startTime)} – ${esc(o.endTime)}` : '—', `${o.hours} h`, o.nightHours ? `${o.nightHours} h${o.nightPay ? `<small>≈ ₱${Number(o.nightPay).toFixed(2)}</small>` : ''}` : '—', esc(o.reason), esc(STATUS[o.status] || o.status) + (o.status === 'approved' ? ` (${o.approvedHours} h)` : ''), esc(o.remarks || '—'), o.status === 'pending' ? `<button class="small" data-ot-cancel="${o.id}">Cancel</button>` : '']), 'No overtime filed yet.')}</section>`;
    const form = box.querySelector('#ot-file'), total = form.querySelector('[data-ot-hours]');
    const compute = () => {
      const s = form.elements.startTime.value, e = form.elements.endTime.value;
      if (!s || !e) { total.textContent = '—'; return null; }
      let minutes = (Number(e.slice(0, 2)) * 60 + Number(e.slice(3))) - (Number(s.slice(0, 2)) * 60 + Number(s.slice(3))); if (minutes <= 0) minutes += 1440;
      const h = Math.round(minutes / 60 * 100) / 100, hh = Math.floor(minutes / 60), mm = minutes % 60;
      total.textContent = `${h} h (${hh} h${mm ? ` ${mm} min` : ''})${minutes <= 0 || e <= s ? ' · ends next day' : ''}`;
      const start = Number(s.slice(0, 2)) * 60 + Number(s.slice(3)); let night = 0;
      for (let m = start; m < start + minutes; m++) { const hr = Math.floor((m % 1440) / 60); if (hr >= 22 || hr < 6) night++; }
      form.querySelector('[data-ot-night]').textContent = night ? `🌙 ${Math.round(night / 60 * 100) / 100} h night differential (10 PM – 6 AM): +10% of your hourly rate, computed automatically` : '';
      return h;
    };
    form.addEventListener('input', compute);
    form.onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.target);
      try { await api('/hr/me/overtime', { date: f.get('date'), startTime: f.get('startTime'), endTime: f.get('endTime'), reason: f.get('reason') }); confirm('Overtime submitted', `Your overtime for <strong>${esc(f.get('date'))}</strong> (${esc(f.get('startTime'))} – ${esc(f.get('endTime'))}) was sent to HR.<br>Status: <strong>Pending HR approval</strong>.`); await fill('overtime201', box); } catch (error) { toast(error.message); }
    };
    box.onclick = async event => {
      const b = event.target.closest('[data-ot-cancel]'); if (!b) return;
      try { await api(`/hr/me/overtime/${b.dataset.otCancel}/cancel`, {}); confirm('Overtime cancelled', 'Your overtime filing was cancelled.'); await fill('overtime201', box); } catch (error) { toast(error.message); }
    };
  }
  function loans(box, data) {
    const money = n => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const STATUS = { pending: 'Pending HR review', approved: 'Approved', rejected: 'Not approved', cancelled: 'Cancelled' };
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>My loans</h2><span class="legend">Approved loans are deducted from payroll automatically</span></div>
      ${table(['Loan', 'Original', 'Per payroll', 'Repaid', 'Outstanding', 'Next deduction', 'Status'], data.loans.map(l => [`${esc(l.type)}<small>${esc(l.reference)}</small>`, money(l.original) + (l.interestTotal ? `<small>+ ${money(l.interestTotal)} interest</small>` : ''), money(l.perPayroll), money(l.totalRepaid), `<strong>${money(l.outstanding)}</strong>`, l.nextDeduction ? fmtDate(l.nextDeduction) : '—', esc(l.status)]), 'No loans yet.')}</section>
      <section class="panel"><div class="panel-head"><h2>Apply for a loan</h2></div><form id="loan-apply" class="panel-body form-grid">
        <label class="field">Loan type<select name="type"><option>Salary Loan</option><option>Emergency Loan</option><option>Medical Loan</option><option>Educational Loan</option><option>Housing Loan</option><option>Vehicle Loan</option><option>Calamity Loan</option><option>SSS Loan</option><option>Pag-IBIG Loan</option><option>Other Company Loan</option></select></label>
        <label class="field">Amount requested<input type="number" name="amount" min="1" step="0.01" required></label>
        <label class="field">Repayment months<input type="number" name="months" min="1" max="120" required value="6"></label>
        <label class="field full">Purpose<input name="purpose" required minlength="3" maxlength="1000"></label>
        <div><button class="primary">Submit application</button></div></form>
        ${table(['Applied', 'Type', 'Amount', 'Months', 'Status', 'HR remarks', ''], data.applications.map(a => [fmtDate(a.appliedAt.slice(0, 10)), esc(a.type), money(a.amount), a.months, esc(STATUS[a.status] || a.status), esc(a.remarks || '—'), a.status === 'pending' ? `<button class="small" data-loan-cancel="${a.id}">Cancel</button>` : '']), 'No applications yet.')}</section>`;
    box.querySelector('#loan-apply').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.target);
      try { await api('/hr/me/loans', { type: f.get('type'), amount: Number(f.get('amount')), months: Number(f.get('months')), purpose: f.get('purpose') }); confirm('Loan application submitted', `Your <strong>${esc(f.get('type'))}</strong> application was sent to HR.<br>Status: <strong>Pending HR review</strong>.`); await fill('loans201', box); } catch (error) { toast(error.message); }
    };
    box.onclick = async event => {
      const b = event.target.closest('[data-loan-cancel]'); if (!b) return;
      try { await api(`/hr/me/loans/${b.dataset.loanCancel}/cancel`, {}); confirm('Loan application cancelled', 'Your loan application was cancelled.'); await fill('loans201', box); } catch (error) { toast(error.message); }
    };
  }
  function memos(box, list) {
    const pending = list.filter(m => m.ackRequired && !m.acknowledgedAt);
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>My memos</h2><span class="legend">${pending.length ? `${pending.length} waiting for your acknowledgement` : 'All caught up'}</span></div><div class="panel-body memo-cards">
      ${list.map(m => `<article class="memo-card ${m.ackRequired && !m.acknowledgedAt ? 'unread' : ''}"><header><strong>${esc(m.title)}</strong><small>${esc(m.reference)} · ${fmtDate(m.issueDate)} · version ${m.version}${m.latest ? '' : ' (replaced by a newer version)'}</small></header>
        ${m.changeNote ? `<p class="legend">What changed: ${esc(m.changeNote)}</p>` : ''}<details ${m.ackRequired && !m.acknowledgedAt ? 'open' : ''}><summary>Read memo</summary><div class="memo-body">${esc(m.body)}</div>${m.attachments.map(a => `<a href="/api/hr/me/memo-attachments/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`).join(' ')}</details>
        <footer>${m.acknowledgedAt ? badge(`Receipt acknowledged ${fmtDateTime(m.acknowledgedAt)}`) : m.ackRequired ? `${m.overdue ? badge('Overdue', 'rejected') : m.ackDeadline ? badge(`Please acknowledge by ${fmtDate(m.ackDeadline)}`, 'pending') : ''}<button class="primary small" data-ack="${m.memoId}" data-version="${m.version}">I have received and read this memo</button>` : badge('No acknowledgement needed', 'neutral')}</footer></article>`).join('') || '<p class="muted">No memos addressed to you yet.</p>'}
      <p class="legend">Acknowledging confirms that you received and read the memo. It does not mean you agree with it.</p></div></section>`;
    box.onclick = async event => {
      const b = event.target.closest('[data-ack]'); if (!b) return;
      b.disabled = true;
      try { await api(`/hr/me/memos/${b.dataset.ack}/${b.dataset.version}/acknowledge`, {}); confirm('Memo acknowledged', 'Your acknowledgement was recorded. HR can see the date and time.'); await fill('memos', box); } catch (error) { toast(error.message); b.disabled = false; }
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

  const field = (name, label, value, type = 'text', extra = '') => `<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  function datasheet(box, data) {
    const s = data.current, f = s.fields, locked = ['submitted', 'under-review'].includes(s.status);
    box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>My data sheet</h2><p>Update your personal information. HR reviews it before it changes your record.</p></div>${badge(SHEET[s.status] || s.status, s.status === 'returned' ? 'rejected' : ['submitted', 'under-review'].includes(s.status) ? 'pending' : 'neutral')}</div>
      ${s.status === 'returned' ? `<div class="notice compact">HR returned your data sheet: <strong>${esc(s.reviewNote || '')}</strong> Please correct it and submit again.</div>` : ''}
      <form id="my-sheet" class="panel-body"><fieldset ${locked ? 'disabled' : ''} class="plain-fieldset">
        <fieldset class="form-section-box"><legend>Personal information</legend><div class="form-grid">${field('personal.firstName', 'First name *', f.personal.firstName, 'text', 'required maxlength="120"')}${field('personal.middleName', 'Middle name', f.personal.middleName)}${field('personal.lastName', 'Last name *', f.personal.lastName, 'text', 'required maxlength="120"')}${field('personal.suffix', 'Suffix', f.personal.suffix)}${field('personal.preferredName', 'Preferred name', f.personal.preferredName)}<label class="field">Sex<select name="personal.sex">${['', 'Female', 'Male', 'Other'].map(o => `<option ${o === f.personal.sex ? 'selected' : ''} value="${o}">${o || '—'}</option>`).join('')}</select></label>${field('personal.birthDate', 'Date of birth', f.personal.birthDate, 'date')}${field('personal.birthPlace', 'Place of birth', f.personal.birthPlace)}${field('personal.civilStatus', 'Civil status', f.personal.civilStatus)}${field('personal.nationality', 'Nationality', f.personal.nationality)}</div></fieldset>
        <fieldset class="form-section-box"><legend>Contact</legend><div class="form-grid">${field('contact.mobile', 'Mobile number *', f.contact.mobile, 'tel', 'required maxlength="40"')}${field('contact.personalEmail', 'Personal email', f.contact.personalEmail, 'email')}${field('contact.currentAddress', 'Current address', f.contact.currentAddress)}${field('contact.permanentAddress', 'Permanent address', f.contact.permanentAddress)}</div></fieldset>
        <fieldset class="form-section-box"><legend>Emergency contact</legend><div class="form-grid">${field('emergency.name', 'Contact person *', f.emergency.name, 'text', 'required')}${field('emergency.relationship', 'Relationship', f.emergency.relationship)}${field('emergency.contact', 'Contact number', f.emergency.contact, 'tel')}</div></fieldset>
        <fieldset class="form-section-box"><legend>Government numbers (only if new or changed)</legend><div class="form-grid">${field('government.tin', 'TIN', f.government.tin)}${field('government.sss', 'SSS', f.government.sss)}${field('government.philHealth', 'PhilHealth', f.government.philHealth)}${field('government.pagIbig', 'Pag-IBIG MID', f.government.pagIbig)}</div><p class="legend">For your privacy, numbers already on file are not shown here.</p></fieldset>
        <div class="actions"><button type="button" data-sheet-save>Save draft</button><button class="primary" type="submit">Submit to HR</button></div></fieldset></form>
      ${data.past.length ? `<div class="panel-body"><h3>Earlier submissions</h3>${table(['Submitted', 'Result', 'HR note'], data.past.map(p => [fmtDateTime(p.submittedAt), esc(SHEET[p.status] || p.status), esc(p.reviewNote || '—')]))}</div>` : ''}</section>`;
    const form = box.querySelector('#my-sheet');
    const collect = () => { const out = { personal: {}, contact: {}, emergency: {}, government: {} }; for (const el of form.querySelectorAll('[name]')) { const [g, k] = el.name.split('.'); out[g][k] = el.value.trim(); } return out; };
    const save = async submit => {
      try { await api('/hr/me/datasheet', { fields: collect(), submit }); confirm(submit ? 'Data sheet submitted' : 'Draft saved', submit ? 'Your data sheet was sent to HR.<br>Status: <strong>Waiting for HR review</strong>.' : 'Your data sheet draft was saved. Submit it when you are ready.'); await fill('datasheet', box); } catch (error) { toast(error.message); }
    };
    box.querySelector('[data-sheet-save]')?.addEventListener('click', () => save(false));
    form.onsubmit = event => { event.preventDefault(); if (window.confirm('Submit your data sheet to HR for review?')) save(true); };
  }

  // Required items the employee still has to upload (missing, rejected or expired). Uploading lifts the signal;
  // a file HR rejects, or one that expires, raises it again.
  const toComply = list => list.items.filter(i => i.requirement.required && ['Missing', 'Rejected', 'Expired'].includes(i.status));
  const statusText = i => (i.numberOnly ? (i.status === 'Verified' ? 'Complied — number on file' : 'Not complied — enter the number in My data sheet') : STATUS_TEXT[i.status] || i.status);
  const STATUS_TEXT = { Missing: 'Not complied — upload required', Rejected: 'Rejected — upload again', Expired: 'Expired — upload a renewed copy', Submitted: 'Submitted — waiting for HR review', 'Under Review': 'Under HR review', Verified: 'Complied', 'Not Applicable': 'Not applicable' };
  async function compliance(app, onDashboard) {
    try {
      const list = await api('/hr/me/documents'), due = toComply(list);
      const tabButton = app.querySelector('[data-portal-tab="files201"]');
      if (tabButton && due.length && !tabButton.querySelector('.nav-flag')) tabButton.insertAdjacentHTML('beforeend', `<span class="nav-flag" aria-label="${due.length} requirement${due.length === 1 ? '' : 's'} to upload">${due.length}</span>`);
      const main = app.querySelector('.employee-main');
      if (!onDashboard || !due.length || !main || main.querySelector('.compliance-alert')) return;
      const box = document.createElement('section'); box.className = 'compliance-alert'; box.setAttribute('role', 'alert');
      box.innerHTML = `<div><strong>⚠️ Not complied: ${due.length} 201 file requirement${due.length === 1 ? '' : 's'} to upload</strong><ol class="comply-list">${due.map(i => `<li>${esc(i.requirement.name)}${i.numberOnly ? ' <small>(enter the number in My data sheet)</small>' : i.status === 'Missing' ? '' : ` <small>(${esc(STATUS_TEXT[i.status])})</small>`}</li>`).join('')}</ol><p class="legend">Upload ${due.length === 1 ? 'it' : 'them'} in My 201 documents. This notice is lifted once every required file is uploaded.</p></div><button class="primary" data-portal-tab="files201">Upload now</button>`;
      // Below the welcome and the time-in card, above the menu cards.
      const anchor = main.querySelector('.clock-block') || main.querySelector('.employee-welcome');
      if (anchor) anchor.after(box); else main.prepend(box);
    } catch { /* the checklist is optional on the dashboard */ }
  }
  function documents(box, list) {
    const due = toComply(list);
    box.innerHTML = `${due.length ? `<div class="compliance-alert" role="alert"><div><strong>⚠️ ${due.length} required document${due.length === 1 ? ' is' : 's are'} not yet complied</strong><ol class="comply-list">${due.map(i => `<li>${esc(i.requirement.name)}${i.numberOnly ? ' <small>(enter the number in My data sheet)</small>' : i.status === 'Missing' ? '' : ` <small>(${esc(STATUS_TEXT[i.status])})</small>`}</li>`).join('')}</ol><p class="legend">Upload ${due.length === 1 ? 'it' : 'each one'} below. The notice is lifted as soon as the file is uploaded; HR then reviews it.</p></div></div>` : `<div class="notice success">All required documents are uploaded${list.completeCount < list.requiredCount ? '; HR is reviewing the rest' : ' and verified'}.</div>`}<section class="panel"><div class="panel-head"><div><h2>My 201 documents</h2><p>Upload what HR asked for. HR checks each file before it counts as complete.</p></div><span class="legend">${list.completeCount} of ${list.requiredCount} required documents verified</span></div>
      <div class="doc-cards">${list.items.length ? list.items.map(i => {
        // One card per requirement so the upload button is always on screen (phones included).
        const upload = i.numberOnly
          ? (i.status === 'Missing' ? '<button class="primary doc-upload" data-portal-tab="datasheet">Enter number</button>' : '')
          : ['Missing', 'Rejected', 'Expired'].includes(i.status) ? `<label class="doc-upload button-like primary-like">📤 Upload file<input type="file" data-up="${esc(i.requirement.id)}" accept="application/pdf,image/png,image/jpeg" hidden></label>` : '';
        const when = i.current?.expiryDate ? `Expires ${fmtDate(i.current.expiryDate)}` : i.due ? `Due ${fmtDate(i.due)}` : '';
        const file = i.versions[0] ? `<a href="/api/hr/me/documents/${i.versions[0].id}/content" target="_blank" rel="noopener">${esc(i.versions[0].name)}</a>` : '';
        return `<article class="doc-card${['Missing', 'Rejected', 'Expired'].includes(i.status) ? ' due' : ''}"><div class="doc-card-head"><strong>${esc(i.requirement.name)}${i.requirement.required ? '' : ' <small>optional</small>'}</strong>${badge(statusText(i), DOC_BADGE[i.status])}</div>${i.current?.reviewNote && i.status === 'Rejected' ? `<p class="doc-note">${esc(i.current.reviewNote)}</p>` : ''}${when || file ? `<p class="doc-meta">${[when, file && `Your upload: ${file}`].filter(Boolean).join(' · ')}</p>` : ''}${upload}</article>`;
      }).join('') : '<p class="muted">No documents are required right now.</p>'}</div>
      <p class="panel-body legend">PDF, JPG or PNG. Sensitive documents (such as medical records) are handled directly by HR.</p></section>`;
    box.onchange = async event => {
      const input = event.target.closest('[data-up]'); if (!input) return;
      const file = input.files[0]; if (!file) return;
      try { await api('/hr/me/documents', { requirementId: input.dataset.up, name: file.name, mime: file.type, data: await readFile(file) }); confirm('Document uploaded', `<strong>${esc(file.name)}</strong> was uploaded to your 201 file.<br>Status: <strong>Waiting for HR review</strong>.`); await fill('files201', box); } catch (error) { toast(error.message); }
    };
  }
  // Shown at the top of the employee's dashboard on celebration days.
  async function celebrations(main) {
    if (!main) return;
    try {
      const html = celebrationsHtml(esc, await api('/hr/celebrations'));
      if (!html) return;
      const box = document.createElement('div'); box.innerHTML = html;
      const section = box.firstElementChild, anchor = main.querySelector('.employee-welcome');
      if (anchor) anchor.after(section); else main.prepend(section);
      bindCelebrationPhotos(section);
    } catch { /* greetings are optional */ }
  }
  return { fill, celebrations, compliance, tabs: [['profile201', 'My profile', '👤'], ['loans201', 'My loans', '💳'], ['overtime201', 'My overtime', '⏱️'], ['memos', 'Memos', '📝'], ['trainings', 'Trainings', '🎓'], ['datasheet', 'My data sheet', '🗂️'], ['files201', 'My 201 documents', '📁']] };
}
