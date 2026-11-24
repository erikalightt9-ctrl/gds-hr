// Employee portal: Notices & due process. The employee reads each notice issued to them (Notice to Explain, hearing
// notice, Notice of Decision), acknowledges receipt, and submits a written explanation with supporting files and,
// if they wish, a request for a hearing. Internal HR notes, evidence review and approvals are never shown here.
import { fmtDate, fmtDateTime, readFile } from './hr-common.js';

export function createPortalCases({ api, esc, toast, confirm }) {
  const badge = (text, kind = '') => `<span class="badge ${kind}">${esc(text)}</span>`;
  const para = t => `<div class="dp-text">${esc(t || '').replace(/\n/g, '<br>')}</div>`;
  async function fill(box) {
    const list = await api('/hr/me/cases');
    box.innerHTML = `<section class="panel"><div class="panel-head"><h2>Due process notices</h2><span class="legend">${list.some(c => c.canExplain) ? 'You have a notice to answer' : 'Notices addressed to you'}</span></div><div class="panel-body">
      ${list.length ? list.map(c => `<article class="memo-card dp-case"><header><strong>${esc(c.reference)}</strong> · ${esc(c.offense)} ${badge(c.status, c.canExplain ? 'pending' : '')}<br><small>Incident on ${fmtDate(c.incidentDate)}</small></header>
        ${c.notices.map(n => `<details ${!n.receivedAt ? 'open' : ''}><summary>${esc(n.title)} · issued ${fmtDate(n.issuedAt)}${n.deadline ? ` · answer by ${fmtDate(n.deadline)}` : ''}${n.scheduledAt ? ` · ${fmtDate(n.scheduledAt)} ${esc(n.scheduledAt.slice(11, 16))}, ${esc(n.place)}` : ''}</summary>${para(n.body)}
          ${n.reviewDeadline && !c.review && c.canAskReview ? `<p class="legend">You may ask for an internal review of this decision until ${fmtDate(n.reviewDeadline)} (below). Your statutory remedies are not affected.</p>` : ''}${n.receivedAt ? '' : `<p class="dp-ack-wording">“${esc(n.ackWording)}”</p>`}
          <footer><a class="small download-link" href="/api/hr/me/cases/${c.id}/${n.kind}.pdf?view=1" target="_blank" rel="noopener">PDF</a>${n.receivedAt ? badge(`✅ Receipt acknowledged ${fmtDateTime(n.receivedAt)}`) : `${badge('🔔 Pending Acknowledgment', 'pending')} <button class="primary small" data-case-ack="${c.id}" data-kind="${n.kind}">Acknowledge receipt</button>`}</footer></details>`).join('')}
        ${c.canExplain && !c.explanation ? `<p>${badge('📝 Explanation Required', 'pending')} <span class="legend">Due ${fmtDate(c.deadline)}. You can submit it even before acknowledging receipt.</span></p>` : ''}
        ${(c.extensionRequests || []).map(r => `<p class="legend">Request for more time until ${fmtDate(r.until)} (${fmtDateTime(r.at)}): ${r.status === 'pending' ? 'waiting for HR' : r.status === 'granted' ? `granted${r.decisionReason ? ` — ${esc(r.decisionReason)}` : ''}` : `not granted — ${esc(r.decisionReason)}`}</p>`).join('')}
        ${c.canAskExtension ? `<details><summary>Ask for more time to explain</summary><form data-case-extend="${c.id}" class="form-grid one"><div class="form-error hidden" role="alert"></div><label class="field">Until<input type="date" name="until" required min="${c.deadline}"></label><label class="field">Why you need more time<textarea name="reason" rows="3" required minlength="10" maxlength="2000"></textarea></label><button class="small">Send request</button></form></details>` : ''}
        ${c.review ? `<p class="legend">You asked for a review on ${fmtDateTime(c.review.requestedAt)}${c.review.outcome ? ` · outcome: ${esc(c.review.outcome)}` : ' · waiting for the outcome'}.</p>` : ''}
        ${c.canAskReview ? `<details><summary>Ask for a review of the decision (until ${fmtDate(c.reviewDeadline)})</summary><form data-case-review="${c.id}" class="form-grid one"><div class="form-error hidden" role="alert"></div><label class="field">Grounds for the review<textarea name="grounds" rows="5" required minlength="20" maxlength="8000"></textarea></label><button class="small primary">Send review request</button></form></details>` : ''}
        ${c.explanation ? `<h3>Your written explanation</h3><p><small>Submitted ${fmtDateTime(c.explanation.submittedAt)}${c.explanation.late ? ' (after the deadline)' : ''}${c.explanation.hearingRequested ? ' · hearing requested' : ''}</small></p>${para(c.explanation.text)}${c.explanation.files.length ? `<p>${c.explanation.files.map(f => `<a href="/api/hr/me/cases/files/${f.id}" target="_blank" rel="noopener">${esc(f.name)}</a>`).join(' · ')}</p>` : ''}<a class="small download-link" href="/api/hr/me/cases/${c.id}/explanation.pdf?view=1" target="_blank" rel="noopener">PDF</a>` : ''}
        ${c.canExplain ? `<form data-case-explain="${c.id}" class="form-grid one"><div class="form-error hidden" role="alert"></div><label class="field">Your written explanation${c.deadline ? ` (please submit by ${fmtDate(c.deadline)})` : ''}<textarea name="text" rows="10" required minlength="20" maxlength="12000">${esc(c.explanationTemplate)}</textarea></label>
          <label class="field">Supporting documents (optional · PDF, JPG or PNG, up to 5 files)<input type="file" name="files" multiple accept="application/pdf,image/png,image/jpeg"></label>
          <label class="field check"><input type="checkbox" name="hearingRequested"> I ask for an administrative hearing / conference, where I may be assisted by a representative</label>
          <button class="primary">Submit explanation</button></form>` : ''}</article>`).join('') : '<p class="empty">Nothing to show yet.</p>'}</div></section>`;
    box.onclick = async event => {
      const b = event.target.closest('[data-case-ack]'); if (!b) return;
      b.disabled = true;
      try { await api(`/hr/me/cases/${b.dataset.caseAck}/acknowledge/${b.dataset.kind}`, {}); confirm('Receipt acknowledged', 'HR can see the date and time you received this notice. This is not an admission and does not end your time to explain.'); await fill(box); } catch (error) { toast(error.message); b.disabled = false; }
    };
    const send = (selector, path, value, title, message) => box.querySelectorAll(selector).forEach(form => {
      form.onsubmit = async event => {
        event.preventDefault();
        const err = form.querySelector('.form-error');
        try { await api(path(form), value(form.elements)); confirm(title, message); await fill(box); } catch (error) { err.textContent = error.message; err.classList.remove('hidden'); }
      };
    });
    send('[data-case-extend]', f => `/hr/me/cases/${f.dataset.caseExtend}/extension`, f => ({ until: f.until.value, reason: f.reason.value }), 'Request sent', 'HR will decide on your request for more time. Your current deadline stays until HR changes it.');
    send('[data-case-review]', f => `/hr/me/cases/${f.dataset.caseReview}/review`, f => ({ grounds: f.grounds.value }), 'Review requested', 'HR received your request for a review of the decision. You will be notified of the outcome.');
    box.querySelectorAll('[data-case-explain]').forEach(form => {
      form.onsubmit = async event => {
        event.preventDefault();
        const f = form.elements, button = form.querySelector('button.primary'), err = form.querySelector('.form-error');
        if (!window.confirm('Submit your explanation? It cannot be changed after it is sent.')) return;
        button.disabled = true;
        try {
          const files = await Promise.all([...f.files.files].slice(0, 5).map(async file => ({ name: file.name, mime: file.type, data: await readFile(file) })));
          await api(`/hr/me/cases/${form.dataset.caseExplain}/explanation`, { text: f.text.value, hearingRequested: f.hearingRequested.checked, files });
          confirm('Explanation submitted', 'HR received your written explanation. You will be notified of the next step.');
          await fill(box);
        } catch (error) { err.textContent = error.message; err.classList.remove('hidden'); button.disabled = false; }
      };
    });
  }
  return { fill };
}
