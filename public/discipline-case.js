// One due process case, step by step: 1 incident, 2 Notice to Explain, 3 explanation, 4 hearing, 5 evaluation,
// 6 decision (management approval before issue), 7 closure; with files, internal notes and the timestamped history.
// The server checks every step; this screen only offers the step that is due.
export function createCaseView(ctx) {
  const { api, esc, badge, toast, openDialog, dialog, shell, heading, today, fmtDate, fmtDateTime, readFile, who } = ctx;
  let c = null;
  const STEPS = ['Incident', 'Notice to Explain', 'Receipt', 'Explanation', 'Hearing', 'Evaluation', 'Decision', 'Review / appeal', 'Closure'];
  const para = t => `<div class="dp-text">${esc(t || '').replace(/\n/g, '<br>')}</div>`;
  const pdf = kind => `<a class="small download-link" href="/api/discipline/cases/${c.id}/${kind}.pdf?view=1" target="_blank" rel="noopener">PDF</a>`;
  const opt = (list, chosen) => list.map(x => `<option ${x === chosen ? 'selected' : ''}>${esc(x)}</option>`).join('');
  const people = () => (ctx.employees() || []).filter(e => !e.archived && (e.status || 'Active') === 'Active').sort((a, b) => a.name.localeCompare(b.name));
  // Issued, viewed, served (HR-verified receipt) and acknowledged are kept apart: a portal view is not proof of receipt.
  const receiptRows = n => [['Viewed in the portal', n.viewedAt ? fmtDateTime(n.viewedAt) : badge('Not opened yet', 'neutral')], ['Service / HR-verified receipt', n.service ? `${esc(n.service.method)} · received ${fmtDate(n.service.receivedOn)}<br><small>${esc(n.service.details || '')} Recorded by ${esc(who(n.service.recordedBy))}${n.service.evidenceFileId ? ` · <a href="/api/discipline/files/${n.service.evidenceFileId}" target="_blank" rel="noopener">proof</a>` : ''}</small>` : badge('Not recorded', 'pending')], ['Employee acknowledged receipt', n.receivedAt ? fmtDateTime(n.receivedAt) : badge('Not yet acknowledged', 'pending')]];
  const serviceButton = (kind, manage) => (manage ? `<button class="small" data-dp-service="${kind}">Record service / receipt…</button>` : '');

  async function open(id) { c = await api(`/discipline/cases/${id}`); draw(); }
  function stepIndex() {
    if (c.status === 'closed') return 8;
    if (c.decision?.issuedAt) return c.review?.requestedAt && !c.review.issuedAt ? 7 : 8;
    if (c.decision || c.evaluation) return 6;
    if (c.status === 'evaluation') return c.explanation?.hearingRequested && !c.hearing?.record ? 4 : 5;
    if (c.status === 'awaiting') return !c.nte.service && !c.nte.receivedAt ? 2 : 3;
    return c.nte ? 1 : 0;
  }
  function draw() {
    const at = stepIndex(), manage = c.canManage && c.status !== 'closed';
    shell(heading(`${esc(c.reference)} · ${esc(c.employee.name)}`, `${esc(c.employee.position || '')}${c.employee.department ? ` · ${esc(c.employee.department)}` : ''} · ${esc(c.incident.offense)}`, `<button data-dp-back>← All cases</button>`) +
      `<ol class="dp-steps">${STEPS.map((s, i) => `<li class="${i < at ? 'done' : i === at ? 'current' : ''}"><span>${i + 1}</span>${esc(s)}</li>`).join('')}</ol>
      ${c.participants ? `<p class="legend">Case participants (only they and Administrators can see it): ${c.participants.map(u => esc(who(u))).join(', ')}${c.canManage ? ' <button class="small" data-dp-participants>Edit…</button>' : ''}</p>` : ''}<div class="notice dp-next"><strong>${esc(c.statusLabel)}</strong> · ${esc(c.nextStep)}</div>
      ${section(1, 'Incident documentation', incident(manage))}${section(2, 'Notice to Explain', nte(manage))}${section(3, 'Receipt of the notice', receipt(manage))}${section(4, 'Employee explanation', explanation(manage))}${section(5, 'Administrative hearing', hearing(manage))}${section(6, 'Evaluation', evaluation(manage))}${section(7, 'Decision and Notice of Decision', decision(manage))}${section(8, 'Review / appeal', review(manage))}${section(9, 'Case closure', closure(manage))}
      <section class="panel"><div class="panel-head"><h2>Internal notes and history</h2><span class="legend">Notes are never shown to the employee</span></div><div class="panel-body">${c.notes.map(n => `<p><small>${fmtDateTime(n.at)} · ${esc(who(n.by))}</small><br>${esc(n.text)}</p>`).join('')}${c.canManage ? '<form data-dp-form="notes" class="dp-inline"><input name="text" maxlength="4000" placeholder="Add an internal note" required><button class="small">Add note</button></form>' : ''}
      <details><summary>Case history (${c.history.length})</summary><ul class="dp-history">${c.history.map(h => `<li>${fmtDateTime(h.at)} · ${esc(who(h.by))} · ${esc(h.action)}${h.detail ? ` · ${esc(h.detail)}` : ''}</li>`).join('')}</ul></details></div></section>`);
    bind();
  }
  const section = (n, title, body) => `<section class="panel dp-step"><div class="panel-head"><h2><span class="dp-num">${n}</span> ${title}</h2></div><div class="panel-body">${body}</div></section>`;
  const dl = rows => `<dl class="details-grid">${rows.filter(([, v]) => v !== undefined).map(([k, v]) => `<div><dt>${k}</dt><dd>${v || '—'}</dd></div>`).join('')}</dl>`;
  const files = list => (list.length ? `<ul class="dp-files">${list.map(f => `<li><a href="/api/discipline/files/${f.id}" target="_blank" rel="noopener">${esc(f.name)}</a> <small>${esc(f.kind)} · ${esc(who(f.by))} · ${fmtDateTime(f.at)}${f.note ? ` · ${esc(f.note)}` : ''}</small></li>`).join('')}</ul>` : '<p class="legend">No files attached.</p>');

  function incident(manage) {
    const i = c.incident;
    return dl([['Employee', `${esc(c.employee.name)} (${esc(c.employee.number)})`], ['Date and time', `${fmtDate(i.date)}${i.time ? ` ${esc(i.time)}` : ''}`], ['Place', esc(i.place)], ['Offense', `${esc(i.offense)}${i.severity ? ` (${esc(i.severity)})` : ''}`], ['Reported by', esc(i.reportedBy)], ['Witnesses', esc(i.witnesses)], ['Issuing officer', esc(i.issuingOfficer)], ['Opened', `${fmtDateTime(c.createdAt)} by ${esc(who(c.createdBy))}`]]) + para(i.description) +
      `<h3>Evidence and files</h3>${files(c.files.filter(f => !f.byEmployee))}<div class="dp-actions">${pdf('incident')}${manage && !c.nte?.issuedAt ? '<button class="small" data-dp-edit-incident>Edit incident</button>' : ''}${manage ? '<button class="small" data-dp-file>＋ Attach evidence (PDF / JPG / PNG)</button>' : ''}</div>`;
  }
  function nte(manage) {
    const n = c.nte;
    if (!n) return manage ? nteForm({ responseDays: c.minResponseDays, possibleSanction: 'Written warning' }) : '<p class="legend">Not prepared yet.</p>';
    if (!n.issuedAt) return `${dl([['Company rule', esc(n.rules)], ['Possible sanction', esc(n.possibleSanction)], ['Days to answer', `${n.responseDays} calendar days from issue`]])}${manage ? `<form data-dp-form="nte"><input type="hidden" name="allegations" value="${esc(n.allegations)}"><input type="hidden" name="rules" value="${esc(n.rules)}"><input type="hidden" name="possibleSanction" value="${esc(n.possibleSanction)}"><input type="hidden" name="responseDays" value="${n.responseDays}"><label class="field full">Notice text (you may edit it; {{deadline}} is filled in when issued)<textarea name="body" rows="14" maxlength="12000">${esc(n.body)}</textarea></label><div class="dp-actions"><button class="small">Save text</button>${pdf('nte')}<button type="button" class="small" data-dp-redo-nte>Change allegations…</button><button type="button" class="primary" data-dp-do="issue-nte" data-confirm="Issue the Notice to Explain to ${esc(c.employee.name)}? The employee is notified and the text can no longer change.">Issue to employee</button></div></form>` : para(n.body)}`;
    return `${dl([['Reference', esc(n.reference)], ['Issued', `${fmtDate(n.issuedAt)} by ${esc(who(n.issuedBy))}`], ['Explanation due', `${fmtDate(n.deadline)}${c.deadlinePassed && c.status === 'awaiting' ? ` ${badge('Deadline passed', 'rejected')}` : ''}<br><small>${n.responseDays} calendar days from the ${esc(n.deadlineBasis || 'issue date')}</small>`]])}${para(n.body)}<div class="dp-actions">${pdf('nte')}</div>`;
  }
  // Receipt: viewed, served (HR-verified date), acknowledged; the explanation deadline runs from the documented receipt.
  function receipt(manage) {
    const n = c.nte;
    if (!n?.issuedAt) return '<p class="legend">Recorded once the Notice to Explain is issued.</p>';
    return `${dl([...receiptRows(n), ['Explanation due', `${fmtDate(n.deadline)}<br><small>${n.responseDays} calendar days from the ${esc(n.deadlineBasis || 'issue date')}</small>`]])}
      ${(n.deadlineHistory || []).length ? `<p class="legend">Deadline changes: ${n.deadlineHistory.map(h => `${fmtDate(h.from)} → ${fmtDate(h.to)} (${esc(h.reason)}; ${esc(who(h.by))}, ${fmtDateTime(h.at)})`).join(' · ')}</p>` : ''}
      ${(n.extensionRequests || []).map(r => `<div class="notice compact"><strong>Request for more time</strong> (${fmtDateTime(r.at)}): until ${fmtDate(r.until)} — ${esc(r.reason)} · ${r.status === 'pending' ? badge('Waiting for HR', 'pending') : `${badge(r.status === 'granted' ? 'Granted' : 'Declined', r.status === 'granted' ? '' : 'rejected')} ${esc(r.decisionReason || '')}`}${r.status === 'pending' && manage ? ` <button class="small primary" data-dp-extend="${r.id}" data-until="${r.until}">Grant…</button> <button class="small" data-dp-decline="${r.id}">Decline…</button>` : ''}</div>`).join('')}
      <div class="dp-actions">${serviceButton('nte', manage)}${manage && !c.decision?.issuedAt ? '<button class="small" data-dp-extend="">Give more time…</button>' : ''}</div>`;
  }
  function nteForm(n) {
    return `<form data-dp-form="nte" class="form-grid"><label class="field full">Specific facts and circumstances (allegations)<textarea name="allegations" rows="5" required maxlength="8000">${esc(n.allegations || c.incident.description)}</textarea></label>
      <label class="field">Company rule or policy concerned<input name="rules" required maxlength="1000" value="${esc(n.rules || '')}"></label>
      <label class="field">Possible sanction if proven<select name="possibleSanction">${opt(ctx.options().sanctions.filter(s => s !== 'No disciplinary action'), n.possibleSanction)}</select></label>
      <label class="field">Calendar days to answer<input type="number" name="responseDays" min="${c.minResponseDays}" max="30" value="${n.responseDays}"></label>
      <div class="full dp-actions"><button class="primary">Prepare Notice to Explain</button></div></form>`;
  }
  function explanation(manage) {
    const e = c.explanation;
    if (!c.nte?.issuedAt) return '<p class="legend">Asked for once the Notice to Explain is issued.</p>';
    if (!e) return `<p>Waiting for the employee's written explanation until <strong>${fmtDate(c.nte.deadline)}</strong>. The employee submits it in their portal (Official notices → Due process).</p>${manage ? `<div class="dp-actions">${c.deadlinePassed ? '<button class="small" data-dp-do="no-explanation" data-confirm="Record that no explanation was received by the deadline and move the case to evaluation?">No explanation by the deadline → evaluation</button>' : ''}<button class="small" data-dp-waiver>Employee waived in writing…</button></div>` : ''}`;
    if (e.none) return `<p>${e.waived ? 'The employee waived the written explanation.' : `No explanation was received by ${fmtDate(c.nte.deadline)}.`} ${e.note ? esc(e.note) : ''}</p><p class="legend">Recorded ${fmtDateTime(e.recordedAt)} by ${esc(who(e.recordedBy))}. A late explanation is still accepted until the decision is prepared.</p>`;
    return `${dl([['Submitted', `${fmtDateTime(e.submittedAt)}${e.late ? ` ${badge('After the deadline', 'pending')}` : ''}`], ['Hearing requested', e.hearingRequested ? badge('Yes', 'pending') : 'No']])}${para(e.text)}<h3>Employee's files</h3>${files(c.files.filter(f => f.byEmployee))}<div class="dp-actions">${pdf('explanation')}</div>`;
  }
  function hearing(manage) {
    const h = c.hearing, open = manage && c.nte?.issuedAt && !c.decision?.issuedAt && !h?.record;
    let out = c.explanation?.hearingRequested ? `<p>${badge('Requested by the employee', 'pending')} The hearing must be recorded before the evaluation.</p>` : '<p class="legend">Held when the employee asks for it or the circumstances require it (a dismissal needs one on record when the company setting is on).</p>';
    if (h?.scheduledAt) out += `${dl([['Scheduled', `${fmtDate(h.scheduledAt)} ${esc(h.scheduledAt.slice(11, 16))}`], ['Place', esc(h.place)], ['Notice issued', fmtDate(h.noticeIssuedAt)], ...receiptRows(h)])}<div class="dp-actions">${pdf('hearing')}${serviceButton('hearing', manage && !h.record)}</div>`;
    if (h?.record) { const r = h.record; out += `<h3>Proceedings</h3>${dl([['Outcome', esc({ held: 'Held', waived: 'Waived by the employee', 'no-show': 'Employee did not attend' }[r.outcome])], ['Date held', r.heldOn ? fmtDate(r.heldOn) : '—'], ['Attendees', esc(r.attendees)], ['Employee attended', r.employeeAttended ? 'Yes' : 'No'], ['Representative', esc(r.representative)]])}${r.statements ? `<h4>Statements</h4>${para(r.statements)}` : ''}${r.minutes ? `<h4>Minutes / notes</h4>${para(r.minutes)}` : ''}`; }
    if (open) out += `<div class="dp-actions"><button class="small" data-dp-schedule>${h?.scheduledAt ? 'Reschedule…' : 'Schedule hearing and issue notice…'}</button><button class="small" data-dp-record>Record proceedings…</button></div>`;
    return out;
  }
  function evaluation(manage) {
    const ev = c.evaluation, prior = c.prior || [];
    const history = `<p class="legend">Earlier disciplinary actions of this employee: ${prior.length ? prior.map(p => `${esc(p.type)} (${fmtDate(p.date)}, ${esc(p.offense)})`).join('; ') : 'none'}${c.sameOffense ? ` · ${c.sameOffense} for the same offense` : ''}. For reference only: the system does not choose a sanction.</p>`;
    if (ev) return `${history}${dl([['Recommendation', esc(ev.recommendation)], ['Evaluated', `${fmtDateTime(ev.at)} by ${esc(who(ev.by))}`]])}<h4>Findings</h4>${para(ev.findings)}${ev.evidence ? `<h4>Evidence considered</h4>${para(ev.evidence)}` : ''}`;
    if (!manage || c.status !== 'evaluation') return `${history}<p class="legend">Done after the explanation (or the deadline) and the hearing, where one is needed.</p>`;
    return `${history}<form data-dp-form="evaluation" class="form-grid"><label class="field full">Findings (facts established and the reasons)<textarea name="findings" rows="6" required maxlength="12000"></textarea></label><label class="field full">Evidence considered<textarea name="evidence" rows="3" maxlength="4000"></textarea></label><label class="field">Recommendation<select name="recommendation">${opt(ctx.options().sanctions, c.nte?.possibleSanction)}</select></label><div class="full dp-actions"><button class="primary">Save evaluation</button></div></form>`;
  }
  function decision(manage) {
    const d = c.decision;
    if (!c.evaluation) return '<p class="legend">Prepared after the evaluation.</p>';
    const STATUS = { draft: ['Draft', 'neutral'], 'for-approval': ['Waiting for management approval', 'pending'], approved: ['Approved', ''], returned: ['Returned for revision', 'rejected'], issued: ['Issued', ''] };
    const form = () => `<form data-dp-form="decision" class="form-grid"><label class="field">Decision<select name="sanction" data-dp-sanction>${opt(ctx.options().sanctions, d?.sanction || c.evaluation.recommendation)}</select></label>
      <label class="field">Effective from<input type="date" name="effectiveFrom" value="${esc(d?.effectiveFrom || '')}"></label><label class="field">Suspension days (1-30)<input type="number" name="suspensionDays" min="0" max="30" value="${d?.suspensionDays || 0}"></label>
      <label class="field full">Findings the decision is based on<textarea name="findings" rows="5" required maxlength="12000">${esc(d?.findings || c.evaluation.findings)}</textarea></label>
      ${d ? `<label class="field full">Notice of Decision text<textarea name="body" rows="12" maxlength="12000">${esc(d.body)}</textarea><small>Clear the box to rebuild it from the template.</small></label>` : ''}
      <div class="full dp-actions"><button class="primary">${d ? 'Save decision' : 'Prepare decision'}</button></div></form>`;
    if (!d) return manage ? form() : '<p class="legend">Not prepared yet.</p>';
    const approvals = d.approvals.length ? `<ul class="dp-history">${d.approvals.map(a => `<li>${fmtDateTime(a.at)} · ${esc(who(a.by))} · ${a.action === 'approve' ? 'Approved' : 'Returned'}${a.note ? ` · ${esc(a.note)}` : ''}</li>`).join('')}</ul>` : '';
    let out = `<p>${badge(...STATUS[d.status])} ${esc(d.sanction)}${d.sanction === 'Suspension' ? ` · ${d.suspensionDays} day(s), ${fmtDate(d.effectiveFrom)} – ${fmtDate(d.effectiveTo)}` : d.effectiveFrom ? ` · effective ${fmtDate(d.effectiveFrom)}` : ''}</p><p class="legend">Prepared by ${esc(who(d.draftedBy))} on ${fmtDateTime(d.draftedAt)}. Approvers: ${esc(c.approverRoles.join(', '))}${c.separateApprover ? ' (not the preparer)' : ''}.</p>${approvals}`;
    if (manage && ['draft', 'returned'].includes(d.status)) out += form() + `<div class="dp-actions">${pdf('decision')}<button class="primary" data-dp-do="submit-decision">Submit for management approval</button></div>`;
    else out += para(d.body) + `<div class="dp-actions">${pdf('decision')}</div>`;
    if (c.canApprove) out += `<form data-dp-review class="dp-inline"><input name="note" maxlength="2000" placeholder="Note (required to return)"><button type="button" class="small" data-dp-review-action="return">Return for revision</button><button type="button" class="primary" data-dp-review-action="approve">Approve decision</button></form>`;
    if (manage && d.status === 'approved') out += `<div class="dp-actions"><button class="primary" data-dp-do="issue-decision" data-confirm="Issue the Notice of Decision to ${esc(c.employee.name)}? The employee is notified.">Issue Notice of Decision</button></div>`;
    if (d.status === 'issued') {
      out += dl([['Issued', `${fmtDate(d.issuedAt)} by ${esc(who(d.issuedBy))}`], ...receiptRows(d)]) + `<div class="dp-actions">${serviceButton('decision', manage)}</div>`;
    }
    return out;
  }
  function review(manage) {
    const d = c.decision;
    if (!d?.issuedAt) return '<p class="legend">Available once the Notice of Decision is issued.</p>';
    let out = '';
    const r = c.review;
    if (!r) out += `<p class="legend">${d.sanction === 'No disciplinary action' ? 'No sanction: nothing to review.' : 'The employee may ask for a review within 5 calendar days of receiving the decision (in the portal). Statutory remedies and grievance procedures are not affected.'}</p>`;
    else {
      out += `${dl([['Asked for', fmtDateTime(r.requestedAt)]])}${para(r.grounds)}`;
      if (r.issuedAt) out += `${dl([['Outcome', `${esc(r.outcome)}${r.outcome === 'Modified' ? ` → ${esc(r.sanction)}` : ''}`], ['Issued', `${fmtDate(r.issuedAt)} by ${esc(who(r.issuedBy))}`], ...receiptRows(r)])}${para(r.body)}<div class="dp-actions">${pdf('review')}${serviceButton('review', manage)}</div>`;
      else if (manage) out += `<form data-dp-form="review-outcome" class="form-grid"><label class="field">Outcome<select name="outcome"><option>Affirmed</option><option>Modified</option><option>Reversed</option></select></label><label class="field">Modified sanction (only if Modified)<select name="sanction"><option value="">—</option>${opt(ctx.options().sanctions, '')}</select></label><label class="field full">Review / Appeal Outcome (reasons)<textarea name="body" rows="6" required minlength="20" maxlength="12000"></textarea></label><div class="full dp-actions"><button class="primary">Issue Review / Appeal Outcome</button></div></form>`;
    }
    return out;
  }
  function closure(manage) {
    if (c.closure) return dl([['Final outcome', esc(c.closure.outcome)], ['Closed', `${fmtDateTime(c.closure.closedAt)} by ${esc(who(c.closure.closedBy))}`], ['Remarks', esc(c.closure.remarks)]]);
    if (!manage) return '<p class="legend">Open.</p>';
    const ready = c.decision?.issuedAt || !c.nte?.issuedAt;
    return ready ? `<form data-dp-form="close" class="form-grid"><label class="field full">Closing remarks${c.nte?.issuedAt ? '' : ' (required: no notice was issued)'}<textarea name="remarks" rows="3" maxlength="4000"></textarea></label><div class="full dp-actions"><button class="primary" data-confirm-close>Close case${c.decision?.issuedAt && c.decision.sanction !== 'No disciplinary action' ? ` and record the ${esc(c.decision.sanction.toLowerCase())}` : ''}</button></div></form>` : '<p class="legend">Closed after the Notice of Decision is issued.</p>';
  }

  async function post(action, body = {}) {
    try { c = await api(`/discipline/cases/${c.id}/${action}`, body); toast('Saved.'); draw(); return true; }
    catch (error) { toast(error.message); return false; }
  }
  const formValue = form => Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, ['responseDays', 'suspensionDays'].includes(k) ? Number(v || 0) : v]));
  function bind() {
    const content = document.querySelector('.content');
    content.onclick = async event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-dp-back')) return ctx.back();
      if (b.hasAttribute('data-dp-participants')) { const list = window.prompt('Usernames who may work on this case (HR / Management / Admin), separated by commas:', (c.participants || []).slice(1).join(', ')); if (list !== null) post('participants', { participants: list.split(',').map(x => x.trim()).filter(Boolean) }); return; }
      if (b.dataset.dpDo) { if (b.dataset.confirm && !window.confirm(b.dataset.confirm)) return; return post(b.dataset.dpDo); }
      if (b.hasAttribute('data-dp-edit-incident')) return incidentForm(c, async value => { c = await api(`/discipline/cases/${c.id}/incident`, value); dialog.close(); toast('Incident updated.'); draw(); });
      if (b.hasAttribute('data-dp-file')) return fileDialog();
      if (b.hasAttribute('data-dp-redo-nte')) { const box = b.closest('.panel-body'); box.innerHTML = nteForm(c.nte); bindForms(box); return; }
      if (b.hasAttribute('data-dp-waiver')) return simpleDialog('Employee waived the explanation', '<label class="field">How and when the waiver was given<textarea name="note" rows="3" required></textarea></label>', f => post('no-explanation', { waived: true, note: f.note.value }));
      if (b.hasAttribute('data-dp-schedule')) return simpleDialog('Schedule the administrative hearing', `<label class="field">Date and time<input type="datetime-local" name="scheduledAt" required min="${today()}T00:00"></label><label class="field">Place or video-call link<input name="place" required maxlength="200"></label><p class="legend">The notice is issued to the employee at once (template from the settings).</p>`, f => post('hearing', { scheduledAt: f.scheduledAt.value, place: f.place.value }));
      if (b.hasAttribute('data-dp-record')) return simpleDialog('Record the hearing', `<label class="field">Outcome<select name="outcome"><option value="held">Held</option><option value="no-show">Employee did not attend</option><option value="waived">Waived by the employee</option></select></label><label class="field">Date held<input type="date" name="heldOn" max="${today()}"></label><label class="field">Attendees<input name="attendees" maxlength="1000"></label><label class="field check"><input type="checkbox" name="employeeAttended"> The employee attended</label><label class="field">Representative / counsel<input name="representative" maxlength="200"></label><label class="field">Statements made<textarea name="statements" rows="5" maxlength="12000"></textarea></label><label class="field">Minutes / notes (or how the waiver was given)<textarea name="minutes" rows="4" maxlength="12000"></textarea></label>`, f => post('hearing-record', { outcome: f.outcome.value, heldOn: f.heldOn.value, attendees: f.attendees.value, employeeAttended: f.employeeAttended.checked, representative: f.representative.value, statements: f.statements.value, minutes: f.minutes.value }));
      if (b.dataset.dpService) return simpleDialog('Record service / receipt', `<p class="legend">How the notice was served and the date the employee actually received it. For dismissal proceedings serve personally or at the last known address; a portal upload or read receipt alone is not proof of service.${b.dataset.dpService === 'nte' ? ' The explanation period is counted from this date (never shortened).' : ''}</p><label class="field">Method<select name="method">${['Personal service (hand delivery)', 'Courier / registered mail to the last known address', 'Email', 'GDS TimeHub portal', 'Other (describe)'].map(m => `<option>${m}</option>`).join('')}</select></label><label class="field">Date received<input type="date" name="receivedOn" required max="${today()}"></label><label class="field">Details (who served, address, courier tracking…)<input name="details" maxlength="1000"></label><label class="field">Proof (optional · signed copy, courier receipt · PDF/JPG/PNG)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"></label>`, async f => { const file = f.file.files[0]; return post('service', { notice: b.dataset.dpService, method: f.method.value, receivedOn: f.receivedOn.value, details: f.details.value, file: file ? { name: file.name, mime: file.type, data: await readFile(file) } : null }); });
      if (b.dataset.dpExtend !== undefined) return simpleDialog('Give more time to explain', `<label class="field">New deadline<input type="date" name="deadline" required min="${c.nte.deadline}" value="${b.dataset.until || ''}"></label><label class="field">Reason (shown to the employee)<textarea name="reason" rows="3" required minlength="5"></textarea></label><p class="legend">The earlier deadline and the reason stay in the record.</p>`, f => post('extension', { requestId: b.dataset.dpExtend, action: 'grant', deadline: f.deadline.value, reason: f.reason.value }));
      if (b.dataset.dpDecline) return simpleDialog('Decline the request for more time', '<label class="field">Reason (shown to the employee)<textarea name="reason" rows="3" required minlength="5"></textarea></label>', f => post('extension', { requestId: b.dataset.dpDecline, action: 'decline', reason: f.reason.value }));
      if (b.dataset.dpReviewAction) { const note = b.closest('form').elements.note.value; return post('review-decision', { action: b.dataset.dpReviewAction, note }); }
    };
    bindForms(content);
  }
  function bindForms(root) {
    root.querySelectorAll('[data-dp-form]').forEach(form => {
      form.onsubmit = event => {
        event.preventDefault();
        const action = form.dataset.dpForm, value = formValue(form);
        if (action === 'close' && !window.confirm('Close this case? The final outcome is recorded and the case can no longer change.')) return;
        post(action, value);
      };
    });
  }
  function simpleDialog(title, fields, onSubmit) {
    openDialog(title, `<form id="dp-simple"><div class="dialog-body"><div class="form-grid one">${fields}</div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div></form>`);
    const form = dialog.querySelector('#dp-simple');
    form.onsubmit = async event => { event.preventDefault(); if (await onSubmit(form.elements)) dialog.close(); };
  }
  function fileDialog() {
    simpleDialog('Attach evidence', '<label class="field">File (PDF, JPG or PNG up to 10 MB)<input type="file" name="file" required accept="application/pdf,image/png,image/jpeg"></label><label class="field">Kind<select name="kind"><option value="evidence">Evidence</option><option value="hearing">Hearing record</option><option value="other">Other</option></select></label><label class="field">Note<input name="note" maxlength="300"></label>', async f => {
      const file = f.file.files[0]; if (!file) return false;
      try { return post('files', { name: file.name, mime: file.type, data: await readFile(file), kind: f.kind.value, note: f.note.value }); } catch (error) { toast(error.message); return false; }
    });
  }
  // Also used by the case list for a new case.
  function incidentForm(existing, onSave) {
    const o = ctx.options(), i = existing?.incident || { date: today(), offenseId: o.offenses[0]?.id };
    openDialog(existing ? 'Edit incident' : 'New case · document the incident', `<form id="dp-incident"><div class="dialog-body"><div id="dp-incident-error" class="form-error hidden" role="alert"></div><section class="nc-card"><h3><span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg></span>Employee &amp; Incident</h3><div class="form-grid">
      <label class="field full">Employee<select name="employeeId" required ${existing ? 'disabled' : ''}><option value="">Choose…</option>${people().map(e => `<option value="${esc(e.id)}" ${e.id === existing?.employeeId ? 'selected' : ''}>${esc(e.name)} (${esc(e.id)})</option>`).join('')}</select><small>Name, department and position are taken from the 201 file.</small></label>
      <label class="field">Incident date<input type="date" name="date" required max="${today()}" value="${esc(i.date)}"></label><label class="field">Time<input type="time" name="time" value="${esc(i.time || '')}"></label>
      <label class="field full">Place<input name="place" maxlength="200" value="${esc(i.place || '')}"></label>
      </div></section><section class="nc-card"><h3><span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17v.01"/></svg></span>Offense &amp; Description</h3><div class="form-grid"><label class="field">Offense<select name="offenseId" data-dp-offense>${o.offenses.map(x => `<option value="${esc(x.id)}" ${x.id === i.offenseId ? 'selected' : ''}>${esc(x.name)} (${esc(x.severity)})</option>`).join('')}<option value="other" ${i.offenseId === 'other' ? 'selected' : ''}>Other…</option></select></label>
      <label class="field">Other offense (describe)<input name="offenseOther" maxlength="200" value="${esc(i.offenseOther || '')}"></label>
      <label class="field full">Description of the incident<textarea name="description" rows="6" required maxlength="10000">${esc(i.description || '')}</textarea></label>
      </div></section><section class="nc-card"><h3><span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/></svg></span>People Involved</h3><div class="form-grid"><label class="field">Reported by<input name="reportedBy" maxlength="200" value="${esc(i.reportedBy || '')}"></label><label class="field">Witnesses<input name="witnesses" maxlength="1000" value="${esc(i.witnesses || '')}"></label>
      <label class="field full">Issuing officer (name and position)<input name="issuingOfficer" required maxlength="200" value="${esc(i.issuingOfficer || '')}"></label>
      ${existing ? '' : '</div></section><section class="nc-card"><h3><span><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7L14 5.5a3.3 3.3 0 0 1 4.7 4.7L10.2 18.7a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/></svg></span>Evidence &amp; Access</h3><div class="form-grid"><label class="field full nc-drop">Evidence (optional · PDF, JPG or PNG, up to 5 files)<input type="file" name="evidence" multiple accept="application/pdf,image/png,image/jpeg"></label><label class="field full">Other people who may work on this case (usernames of HR / Management / Admin, comma-separated; you are included)<input name="participants" maxlength="400" placeholder="e.g. hr.manager, ops.head"></label>'}
    </div></section></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">${existing ? 'Save' : 'Open case'}</button></div></form>`);
    dialog.classList.add('nc-dialog');
    const form = dialog.querySelector('#dp-incident');
    form.onsubmit = async event => {
      event.preventDefault();
      const fields = formValue(form), names = fields.participants || ''; delete fields.evidence; delete fields.participants;
      const value = { ...fields, employeeId: existing?.employeeId || form.elements.employeeId.value, ...(existing ? {} : { participants: String(names).split(',').map(x => x.trim()).filter(Boolean) }) };
      const files = existing ? [] : await Promise.all([...(form.elements.evidence?.files || [])].slice(0, 5).map(async f => ({ name: f.name, mime: f.type, data: await readFile(f), kind: 'evidence', note: 'Attached when the case was opened' })));
      value.evidenceFiles = files;
      try { await onSave(value); } catch (error) { const err = form.querySelector('#dp-incident-error'); err.textContent = error.message; err.classList.remove('hidden'); err.scrollIntoView({ block: 'nearest' }); }
    };
  }
  return { open, incidentForm };
}
