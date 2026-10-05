// Employee portal additions: my memos (acknowledge receipt), my trainings, my data sheet and my 201 documents.
import { DOC_BADGE, fmtDate, fmtDateTime, readFile } from './hr-common.js';

export function createPortalHr({ api, esc, table, toast }) {
  const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
  const SHEET = { new: 'Not started', draft: 'Draft (only you can see it)', submitted: 'Submitted to HR', 'under-review': 'HR is reviewing', returned: 'Returned for correction', approved: 'Approved', rejected: 'Rejected' };

  async function fill(tab, box) {
    try {
      if (tab === 'memos') return memos(box, await api('/hr/me/memos'));
      if (tab === 'trainings') return trainings(box, await api('/hr/me/trainings'));
      if (tab === 'datasheet') return datasheet(box, await api('/hr/me/datasheet'));
      if (tab === 'files201') return documents(box, await api('/hr/me/documents'));
    } catch (error) { box.innerHTML = `<div class="notice">${esc(error.message)}</div>`; }
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
      try { await api(`/hr/me/memos/${b.dataset.ack}/${b.dataset.version}/acknowledge`, {}); toast('Receipt acknowledged. HR can see the date and time.'); await fill('memos', box); } catch (error) { toast(error.message); b.disabled = false; }
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
      try { await api('/hr/me/datasheet', { fields: collect(), submit }); toast(submit ? 'Submitted. HR will review your data sheet.' : 'Draft saved.'); await fill('datasheet', box); } catch (error) { toast(error.message); }
    };
    box.querySelector('[data-sheet-save]')?.addEventListener('click', () => save(false));
    form.onsubmit = event => { event.preventDefault(); if (window.confirm('Submit your data sheet to HR for review?')) save(true); };
  }

  function documents(box, list) {
    box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>My 201 documents</h2><p>Upload what HR asked for. HR checks each file before it counts as complete.</p></div><span class="legend">${list.completeCount} of ${list.requiredCount} required documents verified</span></div>
      ${table(['Requirement', 'Status', 'Due / expiry', 'Your upload', ''], list.items.map(i => [`${esc(i.requirement.name)}${i.requirement.required ? '' : ' <small>optional</small>'}`, `${badge(i.status, DOC_BADGE[i.status])}${i.current?.reviewNote && i.status === 'Rejected' ? `<small>${esc(i.current.reviewNote)}</small>` : ''}`, i.current?.expiryDate ? `Expires ${fmtDate(i.current.expiryDate)}` : i.due ? `Due ${fmtDate(i.due)}` : '—', i.versions[0] ? `<a href="/api/hr/me/documents/${i.versions[0].id}/content" target="_blank" rel="noopener">${esc(i.versions[0].name)}</a>` : '—',
        ['Missing', 'Rejected', 'Expired'].includes(i.status) ? `<label class="small-file">Upload<input type="file" data-up="${esc(i.requirement.id)}" accept="application/pdf,image/png,image/jpeg" hidden></label>` : '']), 'No documents are required right now.')}
      <p class="panel-body legend">PDF, JPG or PNG. Sensitive documents (such as medical records) are handled directly by HR.</p></section>`;
    box.onchange = async event => {
      const input = event.target.closest('[data-up]'); if (!input) return;
      const file = input.files[0]; if (!file) return;
      try { await api('/hr/me/documents', { requirementId: input.dataset.up, name: file.name, mime: file.type, data: await readFile(file) }); toast('Uploaded. HR will review it.'); await fill('files201', box); } catch (error) { toast(error.message); }
    };
  }
  return { fill, tabs: [['memos', 'Memos', '📝'], ['trainings', 'Trainings', '🎓'], ['datasheet', 'My data sheet', '🗂️'], ['files201', 'My 201 documents', '📁']] };
}
