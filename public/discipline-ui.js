// Due process: disciplinary cases from the incident to closure (procedural due process under the Labor Code and
// DOLE D.O. 147-15). HR documents and evaluates; a proposed decision is issued only after management approval.
import { fmtDate, fmtDateTime, readFile, who } from './hr-common.js';

const STEPS = [['incident', 'Incident'], ['nte', 'Notice to Explain'], ['explanation', 'Explanation'], ['hearing', 'Hearing'], ['evaluation', 'Evaluation'], ['decision', 'Decision'], ['closed', 'Closure']];
const STATUS_TONE = { Pending: 'neutral', 'Under Investigation': 'pending', 'Awaiting Explanation': 'pending', 'For Evaluation': 'pending', Resolved: '', Closed: 'neutral' };

export function createDiscipline(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  let meta = null, cases = [], filter = { status: '', q: '' }, people = null;
  const today = () => ctx.today();

  async function render(openId = null) {
    shell(heading('Due process', 'Loading…') + '<div class="loading">Loading cases…</div>');
    meta = await api('/hr/discipline/meta');
    if (openId) return openCase(openId);
    await drawList();
  }
  async function drawList() {
    cases = await api(`/hr/discipline/cases?${new URLSearchParams(filter)}`);
    const count = s => cases.filter(c => c.status === s).length;
    shell(heading('Due process', 'Incident reports, Notices to Explain, explanations, hearings, evaluation and decisions. Confidential: HR and management only.', meta.canManage ? '<button class="primary" data-new>＋ Document an incident</button>' : '') +
      `<div class="tabs rect-tabs"><button data-status="" class="${filter.status ? '' : 'active'}">All</button>${meta.statuses.map(s => `<button data-status="${esc(s)}" class="${filter.status === s ? 'active' : ''}">${esc(s)}${filter.status ? '' : ` <small>${count(s)}</small>`}</button>`).join('')}</div>
      <section class="panel"><div class="panel-head"><form class="dp-search" data-search><input type="search" name="q" value="${esc(filter.q)}" placeholder="Search case no., employee, offense or department" aria-label="Search cases"><button>Search</button></form>${meta.settings && ctx.context().can.settings ? '<button class="small" data-settings>Due process policy</button>' : ''}</div>
      ${table(['Case no.', 'Employee', 'Offense / rule', 'Incident', 'Status', 'Next step', ''], cases.map(c => [esc(c.reference), `${esc(c.employeeName)}<small>${esc(c.position || '')}${c.department ? ` · ${esc(c.department)}` : ''}</small>`, esc(c.offense), fmtDate(c.incidentDate), badge(c.status, STATUS_TONE[c.status]) + (c.overdueExplanation ? ` ${badge('Answer overdue', 'rejected')}` : '') + (c.awaitingApproval ? ` ${badge('For approval', 'pending')}` : ''), esc(nextStep(c)), `<button class="small" data-open="${c.id}">Open</button>`]), 'No cases.')}</section>`);
    const content = document.querySelector('.content');
    content.onclick = async e => {
      const b = e.target.closest('button'); if (!b || b.closest('[data-search]')) return;
      if (b.dataset.status !== undefined) { filter.status = b.dataset.status; await drawList(); }
      if (b.hasAttribute('data-new')) newCase();
      if (b.dataset.open) openCase(b.dataset.open);
      if (b.hasAttribute('data-settings')) settingsDialog();
    };
    content.querySelector('[data-search]').onsubmit = async e => { e.preventDefault(); filter.q = e.target.elements.q.value.trim(); await drawList(); };
  }
  const nextStep = c => ({ Pending: 'Investigate or issue a Notice to Explain', 'Under Investigation': 'Issue a Notice to Explain', 'Awaiting Explanation': `Employee answers by ${fmtDate(c.responseDeadline)}`, 'For Evaluation': c.awaitingApproval ? 'Management approval' : 'Evaluate and propose a decision', Resolved: 'Close the case', Closed: '—' })[c.status];

  async function newCase(values = null) {
    people ||= await api('/hr/employees');
    const v = values || { employeeId: '', incidentDate: today(), incidentTime: '', place: '', offense: '', description: '', reportedBy: '', witnesses: '' };
    openDialog(values ? 'Edit incident' : 'Document an incident', `<form id="dp-incident"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid">
      ${values ? `<p class="full">Employee: <strong>${esc(values.employeeName)}</strong></p>` : `<label class="field full">Employee concerned<select name="employeeId" required><option value="">Choose…</option>${people.filter(p => !p.archived).map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.position || p.department || '')}</option>`).join('')}</select></label>`}
      <label class="field">Incident date<input type="date" name="incidentDate" required max="${today()}" value="${esc(v.incidentDate)}"></label>
      <label class="field">Time (optional)<input type="time" name="incidentTime" value="${esc(v.incidentTime)}"></label>
      <label class="field">Place<input name="place" maxlength="200" value="${esc(v.place)}"></label>
      <label class="field">Offense / rule concerned<select name="offense" required><option value="">Choose…</option>${meta.settings.offenses.map(o => `<option ${o === v.offense ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <label class="field full">What happened<textarea name="description" rows="6" required minlength="20" maxlength="8000">${esc(v.description)}</textarea><small>Facts only: what was done or not done, when, where, who was involved. The employee will see the charge in the Notice to Explain.</small></label>
      <label class="field">Reported by<input name="reportedBy" required maxlength="200" value="${esc(v.reportedBy)}"></label>
      <label class="field">Witnesses (optional)<input name="witnesses" maxlength="1000" value="${esc(v.witnesses)}"></label>
      ${values ? '' : '<label class="field full">Supporting evidence (optional · PDF, JPG or PNG up to 10 MB)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"></label>'}
    </div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">${values ? 'Save' : 'Open case'}</button></div></form>`);
    const form = dialog.querySelector('#dp-incident');
    form.onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(form), body = Object.fromEntries(['incidentDate', 'incidentTime', 'place', 'offense', 'description', 'reportedBy', 'witnesses'].map(k => [k, String(f.get(k) || '')]));
      try {
        let c;
        if (values) c = await api(`/hr/discipline/cases/${values.id}/incident`, body);
        else {
          c = await api('/hr/discipline/cases', { ...body, employeeId: f.get('employeeId') });
          const file = form.elements.file?.files[0];
          if (file) await api(`/hr/discipline/cases/${c.id}/files`, { name: file.name, mime: file.type, data: await readFile(file), kind: 'evidence', description: 'Submitted with the incident report' });
        }
        dialog.close(); toast(values ? 'Incident updated.' : `Case ${c.reference} opened.`); openCase(c.id);
      } catch (error) { const box = form.querySelector('.form-error'); box.textContent = error.message; box.classList.remove('hidden'); }
    };
  }

  async function openCase(id) {
    const c = await api(`/hr/discipline/cases/${id}`);
    const done = { incident: true, nte: !!c.nte, explanation: !!(c.explanation || c.noExplanation), hearing: !!c.hearing?.recordedAt, evaluation: !!c.evaluation, decision: !!c.decision, closed: c.status === 'Closed' };
    const current = c.stage === 'approval' ? 'decision' : c.stage === 'investigation' ? 'nte' : c.stage;
    const stepper = `<ol class="dp-steps">${STEPS.map(([k, label], i) => `<li class="${done[k] ? 'done' : ''} ${k === current ? 'current' : ''} ${k === 'hearing' && !c.hearing ? 'optional' : ''}"><span>${done[k] ? '✓' : i + 1}</span>${esc(label)}${k === 'hearing' && !c.hearing ? '<small>when requested</small>' : ''}</li>`).join('')}</ol>`;
    const kv = rows => `<dl class="dp-kv">${rows.filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
    const block = (title, body, extra = '') => `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2>${extra}</div><div class="panel-body">${body}</div></section>`;
    const fileLink = f => `<a href="/api/hr/discipline/files/${f.id}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a> <small>${esc(f.kind)}${f.description ? ` · ${esc(f.description)}` : ''} · ${esc(who(f.uploadedBy))} · ${fmtDateTime(f.uploadedAt)}</small>`;
    const i = c.incident;
    const sections = [
      block('Incident', kv([['Employee', `${esc(c.employee.name)} (${esc(c.employeeId)})`], ['Position', esc(c.employee.position)], ['Department', esc(c.employee.department)], ['Incident date', `${fmtDate(i.incidentDate)}${i.incidentTime ? ` ${esc(i.incidentTime)}` : ''}`], ['Place', esc(i.place)], ['Offense / rule', esc(i.offense)], ['Reported by', esc(i.reportedBy)], ['Witnesses', esc(i.witnesses)], ['Opened', `${fmtDateTime(c.openedAt)} by ${esc(who(c.openedBy))}`]]) + `<div class="memo-body">${esc(i.description)}</div>`, c.canManage && ['Pending', 'Under Investigation'].includes(c.status) ? '<button class="small" data-act="edit">Edit</button>' : ''),
      c.nte ? block('Notice to Explain', kv([['Issued', `${fmtDateTime(c.nte.issuedAt)} by ${esc(who(c.nte.issuedBy))} · memo ${esc(c.nte.memoReference)}`], ['Answer by', fmtDate(c.nte.responseDeadline)], ['Rule / policy', esc(c.nte.rules)], ['Possible penalty', esc(c.nte.possibleSanction)]]) + `<div class="memo-body">${esc(c.nte.allegations)}</div>`) : '',
      c.explanation ? block('Employee explanation', kv([['Received', `${fmtDateTime(c.explanation.submittedAt)} · ${c.explanation.by === 'employee' ? 'submitted by the employee' : `recorded by ${esc(who(c.explanation.submittedBy))}`}${c.explanation.late ? ' · after the deadline' : ''}`], ['Hearing requested', c.explanation.requestsHearing ? 'Yes' : 'No']]) + `<div class="memo-body">${esc(c.explanation.text)}</div>`) : c.noExplanation ? block('Employee explanation', `<p>No written explanation was received by the deadline (recorded ${fmtDateTime(c.noExplanation.recordedAt)} by ${esc(who(c.noExplanation.recordedBy))}). ${esc(c.noExplanation.note || '')}</p>`) : '',
      c.hearing ? block('Administrative hearing / conference', kv([['Schedule', `${fmtDate(c.hearing.date)} ${esc(c.hearing.time)} · ${esc(c.hearing.place)}`], ['Panel', esc(c.hearing.panel)], ['Notice', c.hearing.memoReference ? `memo ${esc(c.hearing.memoReference)}` : 'No notice memo'], ['Held', c.hearing.recordedAt ? (c.hearing.held ? `Yes${c.hearing.employeeAttended ? ', employee attended' : ', employee did not attend'}` : 'No') : 'Not yet recorded'], ['Attendees', esc(c.hearing.attendees || '')], ['Statements', esc(c.hearing.statements || '')]]) + (c.hearing.minutes ? `<div class="memo-body">${esc(c.hearing.minutes)}</div>` : '')) : '',
      c.evaluation ? block('Evaluation', kv([['Result', c.evaluation.substantiated ? 'Charge substantiated' : 'Charge not substantiated'], ['By', `${esc(who(c.evaluation.by))} · ${fmtDateTime(c.evaluation.at)}`]]) + `<div class="memo-body">${esc(c.evaluation.findings)}</div>`) : '',
      c.proposal ? block('Proposed decision · waiting for management approval', kv([['Action', esc(c.proposal.action === 'Other' ? c.proposal.otherAction : c.proposal.action)], ['Suspension', c.proposal.action === 'Suspension' ? `${c.proposal.suspensionDays} days, ${fmtDate(c.proposal.effectiveFrom)} to ${fmtDate(c.proposal.effectiveTo)}` : ''], ['Proposed by', `${esc(who(c.proposal.by))} · ${fmtDateTime(c.proposal.at)}`]]) + `<div class="memo-body">${esc(c.proposal.rationale)}</div><p class="legend">Nothing is issued to the employee until an authorised manager other than the proposer approves.</p>`) : '',
      c.decision ? block('Decision', kv([['Decision', esc(c.decision.label)], ['Notice of Decision', `memo ${esc(c.decision.memoReference)} · ${fmtDate(c.decision.decisionDate)}`], ['Approved by', `${esc(who(c.decision.approvedBy))} · ${fmtDateTime(c.decision.approvedAt)}`], ['Proposed by', esc(who(c.decision.proposedBy))]])) : '',
      c.closure ? block('Closure', `<p>${esc(c.closure.outcome)}</p><p class="legend">${c.closure.dropped ? 'Dropped before a Notice to Explain. ' : ''}Closed ${fmtDateTime(c.closure.at)} by ${esc(who(c.closure.by))}.</p>`) : '',
      (c.returned || []).length ? block('Returned proposals', table(['Returned', 'By', 'Proposed action', 'Note'], c.returned.map(r => [fmtDateTime(r.returnedAt), esc(who(r.returnedBy)), esc(r.action), esc(r.note)]))) : '',
      block('Evidence and documents', c.files.length ? `<ul class="dp-files">${c.files.map(f => `<li>${fileLink(f)}</li>`).join('')}</ul>` : '<p class="muted">No files yet.</p>', c.canManage && c.status !== 'Closed' ? '<button class="small" data-act="file">＋ Attach file</button>' : ''),
      block('Case history', table(['When', 'By', 'Action', 'Details'], c.history.slice().reverse().map(h => [fmtDateTime(h.at), esc(who(h.by)), esc(h.action), esc(h.detail || '')])), c.canManage && c.status !== 'Closed' ? '<button class="small" data-act="note">＋ Add note</button>' : ''),
    ];
    shell(heading(`${c.reference} · ${c.employee.name}`, `${c.incident.offense} · ${c.status}`, '<button class="small" data-back>← All cases</button>') + stepper + actionsPanel(c) + sections.join(''));
    document.querySelector('.content').onclick = async e => {
      const b = e.target.closest('[data-act], [data-back]'); if (!b) return;
      if (b.hasAttribute('data-back')) { await drawList(); return; }
      act(b.dataset.act, c);
    };
  }
  // What can be done next, by whom.
  function actionsPanel(c) {
    const m = c.canManage, deadlinePassed = c.nte && today() > c.nte.responseDeadline, buttons = [];
    if (m && c.status === 'Pending') buttons.push('<button data-act="investigate">Start investigation</button>');
    if (m && ['Pending', 'Under Investigation'].includes(c.status)) buttons.push('<button class="primary" data-act="nte">Issue Notice to Explain…</button>', '<button data-act="drop">Drop and close…</button>');
    if (m && c.status === 'Awaiting Explanation') buttons.push('<button data-act="record-explanation">Record a written explanation…</button>', `<button data-act="no-explanation" ${deadlinePassed ? '' : 'disabled title="Available after the deadline"'}>No explanation received</button>`);
    if (m && ['Awaiting Explanation', 'For Evaluation'].includes(c.status) && !c.proposal) buttons.push(c.hearing && !c.hearing.recordedAt ? '<button data-act="hearing-record">Record hearing proceedings…</button>' : c.hearing ? '' : `<button ${c.explanation?.requestsHearing ? 'class="primary"' : ''} data-act="hearing">Schedule hearing…</button>`);
    if (m && c.status === 'For Evaluation' && !c.evaluation && !c.proposal) buttons.push('<button class="primary" data-act="evaluate">Record evaluation…</button>');
    if (m && c.status === 'For Evaluation' && c.evaluation && !c.proposal) buttons.push('<button class="primary" data-act="propose">Propose decision…</button>');
    if (c.canApprove) buttons.push('<button class="primary" data-act="approve">Approve and issue decision…</button>', '<button data-act="return">Return for re-evaluation…</button>');
    if (m && c.status === 'Resolved') buttons.push('<button class="primary" data-act="close">Close case…</button>');
    const hint = c.status === 'Awaiting Explanation' ? `<p class="legend">The employee answers in their account by ${fmtDate(c.nte.responseDeadline)}. ${deadlinePassed ? 'The deadline has passed.' : ''}</p>` : c.proposal && !c.canApprove ? '<p class="legend">Waiting for approval by an authorised manager (not the proposer).</p>' : '';
    return buttons.length || hint ? `<section class="panel dp-actions"><div class="panel-body"><div class="actions">${buttons.join('')}</div>${hint}</div></section>` : '';
  }
  const form = (title, fields, submit, onSubmit) => {
    openDialog(title, `<form id="dp-form"><div class="dialog-body"><div class="form-error hidden" role="alert"></div><div class="form-grid">${fields}</div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">${submit}</button></div></form>`);
    const f = dialog.querySelector('#dp-form');
    f.onsubmit = async ev => { ev.preventDefault(); try { await onSubmit(new FormData(f), f); } catch (error) { const box = f.querySelector('.form-error'); box.textContent = error.message; box.classList.remove('hidden'); } };
    return f;
  };
  const done = async (c, message) => { dialog.close(); toast(message); await openCase(c.id); };
  const post = (c, action, body) => api(`/hr/discipline/cases/${c.id}/${action}`, body);
  async function act(action, c) {
    const s = c.settings;
    if (action === 'edit') return newCase({ ...c.incident, id: c.id, employeeName: c.employee.name });
    if (action === 'investigate') { await post(c, 'investigate', { note: '' }); toast('Case placed under investigation.'); return openCase(c.id); }
    if (action === 'note') return form('Add a note', '<label class="field full">Note<textarea name="note" rows="5" required minlength="3" maxlength="4000"></textarea></label>', 'Add note', async f => { await post(c, 'note', { note: f.get('note') }); await done(c, 'Note added.'); });
    if (action === 'file') return form('Attach a file', '<label class="field full">File (PDF, JPG or PNG up to 10 MB)<input type="file" name="file" required accept="application/pdf,image/png,image/jpeg"></label><label class="field">Type<select name="kind"><option value="evidence">Evidence</option><option value="hearing">Hearing record</option><option value="explanation">Employee explanation (paper)</option><option value="other">Other</option></select></label><label class="field">Description<input name="description" maxlength="500"></label>', 'Attach', async (f, el) => { const file = el.elements.file.files[0]; await post(c, 'files', { name: file.name, mime: file.type, data: await readFile(file), kind: f.get('kind'), description: f.get('description') || '' }); await done(c, 'File attached.'); });
    if (action === 'drop') return form('Drop and close the case', '<label class="field full">Reason / outcome<textarea name="outcome" rows="4" required minlength="5"></textarea><small>For example: insufficient basis, complaint withdrawn. No penalty is recorded.</small></label>', 'Close case', async f => { await post(c, 'close', { outcome: f.get('outcome') }); await done(c, 'Case closed.'); });
    if (action === 'nte') return form('Issue a Notice to Explain', `<p class="full legend">Issued to the employee as a memo on the company letterhead (with a PDF), acknowledgement required. The charge cannot be edited after issue.</p>
      <label class="field full">Specific acts or omissions charged<textarea name="allegations" rows="6" required minlength="20">${esc(c.incident.description)}</textarea></label>
      <label class="field full">Company rule / policy concerned<input name="rules" required maxlength="2000" value="${esc(c.incident.offense)}"></label>
      <label class="field">Penalty that may be imposed<input name="possibleSanction" required maxlength="300" placeholder="e.g. written warning up to suspension"></label>
      <label class="field">Answer by<input type="date" name="responseDeadline" required min="${s.earliestDeadline}" value="${s.earliestDeadline}"><small>At least ${s.minResponseDays} calendar days (DOLE D.O. 147-15).</small></label>
      <label class="check full"><input type="checkbox" name="hearingOffered" checked> Tell the employee they may request a hearing or conference</label>`, 'Issue notice', async f => { if (!window.confirm('Issue the Notice to Explain now? The employee receives it immediately.')) return; await post(c, 'nte', { allegations: f.get('allegations'), rules: f.get('rules'), possibleSanction: f.get('possibleSanction'), responseDeadline: f.get('responseDeadline'), hearingOffered: f.get('hearingOffered') === 'on' }); await done(c, 'Notice to Explain issued.'); });
    if (action === 'record-explanation') return form('Record a written explanation received on paper', '<label class="field full">Explanation (as written by the employee)<textarea name="text" rows="8" required minlength="10"></textarea></label><label class="check full"><input type="checkbox" name="requestsHearing"> The employee requests a hearing or conference</label><label class="field full">Scanned copy (optional)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"></label>', 'Record', async (f, el) => { const file = el.elements.file.files[0]; await post(c, 'explanation', { text: f.get('text'), requestsHearing: f.get('requestsHearing') === 'on', files: file ? [{ name: file.name, mime: file.type, data: await readFile(file), description: 'Paper explanation' }] : [] }); await done(c, 'Explanation recorded.'); });
    if (action === 'no-explanation') { if (!window.confirm('Record that no written explanation was received by the deadline? The case moves to evaluation on the available evidence.')) return; await post(c, 'no-explanation', { note: '' }); toast('Recorded.'); return openCase(c.id); }
    if (action === 'hearing') return form('Schedule an administrative hearing / conference', `<label class="field">Date<input type="date" name="date" required min="${today()}"></label><label class="field">Time<input type="time" name="time" required value="10:00"></label><label class="field full">Venue or meeting link<input name="place" required maxlength="200"></label><label class="field full">Panel / HR officers (optional)<input name="panel" maxlength="500"></label><label class="check full"><input type="checkbox" name="sendNotice" checked> Send a notice of hearing to the employee (memo with PDF)</label>`, 'Schedule', async f => { await post(c, 'hearing', { date: f.get('date'), time: f.get('time'), place: f.get('place'), panel: f.get('panel') || '', sendNotice: f.get('sendNotice') === 'on' }); await done(c, 'Hearing scheduled.'); });
    if (action === 'hearing-record') return form('Record the hearing proceedings', '<label class="check"><input type="checkbox" name="held" checked> The hearing took place</label><label class="check"><input type="checkbox" name="employeeAttended" checked> The employee attended</label><label class="field full">Attendance<input name="attendees" required maxlength="1000" placeholder="Names and roles"></label><label class="field full">Statements (summary)<textarea name="statements" rows="4" maxlength="20000"></textarea></label><label class="field full">Minutes of the proceedings<textarea name="minutes" rows="8" required minlength="10"></textarea></label>', 'Save record', async f => { await post(c, 'hearing-record', { held: f.get('held') === 'on', employeeAttended: f.get('employeeAttended') === 'on', attendees: f.get('attendees'), statements: f.get('statements') || '', minutes: f.get('minutes') }); await done(c, 'Hearing record saved.'); });
    if (action === 'evaluate') return form('Evaluation', '<p class="full legend">Weigh the evidence, the employee\'s explanation and the hearing record. Only authorised HR records the evaluation; it is not shown to the employee.</p><label class="field full">Result<select name="substantiated"><option value="yes">The charge is substantiated</option><option value="no">The charge is not substantiated</option></select></label><label class="field full">Findings<textarea name="findings" rows="8" required minlength="20"></textarea></label>', 'Save evaluation', async f => { await post(c, 'evaluate', { substantiated: f.get('substantiated') === 'yes', findings: f.get('findings') }); await done(c, 'Evaluation saved.'); });
    if (action === 'propose') {
      const el = form('Propose a decision', `<p class="full legend">This is a proposal only. It is issued to the employee after an authorised manager (not you) approves it.</p>
        <label class="field">Action<select name="action">${meta.actions.filter(a => c.evaluation.substantiated || a === 'No disciplinary action').map(a => `<option>${esc(a)}</option>`).join('')}</select></label>
        <label class="field hidden" data-other>Describe the action<input name="otherAction" maxlength="200"></label>
        <label class="field hidden" data-susp>Suspension days (1-${s.maxSuspensionDays})<input type="number" name="suspensionDays" min="1" max="${s.maxSuspensionDays}" value="1"></label>
        <label class="field hidden" data-susp>From<input type="date" name="effectiveFrom"></label><label class="field hidden" data-susp>To<input type="date" name="effectiveTo"></label>
        <label class="field full">Basis of the decision<textarea name="rationale" rows="6" required minlength="20"></textarea><small>Refer to the findings, the rule violated and the penalty it provides (consider the employee's record and the proportionality of the penalty).</small></label>`, 'Send for approval', async f => { await post(c, 'propose', { action: f.get('action'), otherAction: f.get('otherAction') || '', suspensionDays: Number(f.get('suspensionDays') || 0), effectiveFrom: f.get('effectiveFrom') || '', effectiveTo: f.get('effectiveTo') || '', rationale: f.get('rationale') }); await done(c, 'Decision proposed. Waiting for management approval.'); });
      const sync = () => { const a = el.elements.action.value; el.querySelectorAll('[data-susp]').forEach(x => x.classList.toggle('hidden', a !== 'Suspension')); el.querySelector('[data-other]').classList.toggle('hidden', a !== 'Other'); };
      el.elements.action.onchange = sync; sync(); return;
    }
    if (action === 'approve') return form('Approve and issue the decision', `<p class="full">Proposed: <strong>${esc(c.proposal.action === 'Other' ? c.proposal.otherAction : c.proposal.action)}</strong>${c.proposal.action === 'Suspension' ? ` · ${c.proposal.suspensionDays} days` : ''}. Approving issues the Notice of Decision to the employee (memo with PDF) and records the decision on their disciplinary record.</p><label class="field full">Approval note (optional)<textarea name="note" rows="3" maxlength="4000"></textarea></label>`, 'Approve and issue', async f => { await post(c, 'review', { decision: 'approve', note: f.get('note') || '' }); await done(c, 'Decision approved and issued to the employee.'); });
    if (action === 'return') return form('Return for re-evaluation', '<label class="field full">What should be reconsidered<textarea name="note" rows="4" required minlength="5"></textarea></label>', 'Return', async f => { await post(c, 'review', { decision: 'return', note: f.get('note') }); await done(c, 'Returned to HR for re-evaluation.'); });
    if (action === 'close') return form('Close the case', `<label class="field full">Final outcome<textarea name="outcome" rows="4" required minlength="5">${esc(c.decision?.label || '')}: Notice of Decision ${esc(c.decision?.memoReference || '')} served.</textarea></label>`, 'Close case', async f => { await post(c, 'close', { outcome: f.get('outcome') }); await done(c, 'Case closed.'); });
  }
  function settingsDialog() {
    const s = meta.settings;
    form('Due process policy', `<p class="full legend">Applies to new steps. Follow the company Code of Conduct and the Labor Code; DOLE D.O. 147-15 requires at least five calendar days to answer a Notice to Explain.</p>
      <label class="field">Days to answer an NTE (minimum 5)<input type="number" name="minResponseDays" min="5" max="30" value="${s.minResponseDays}"></label>
      <label class="field">Longest suspension (days)<input type="number" name="maxSuspensionDays" min="1" max="60" value="${s.maxSuspensionDays}"></label>
      <fieldset class="field full"><legend>Who may approve decisions (never the proposer)</legend>${[['admin', 'System Administrator'], ['viewer', 'Management'], ['hr', 'HR Manager']].map(([r, l]) => `<label class="check"><input type="checkbox" name="approverRoles" value="${r}" ${s.approverRoles.includes(r) ? 'checked' : ''}> ${l}</label>`).join('')}</fieldset>
      <label class="check full"><input type="checkbox" name="hearingForTermination" ${s.hearingForTermination ? 'checked' : ''}> Require a hearing or conference before a termination decision</label>
      <label class="field full">Offenses / rules (one per line, from the Code of Conduct)<textarea name="offenses" rows="8">${esc(s.offenses.join('\n'))}</textarea></label>`, 'Save policy', async f => { meta.settings = await api('/hr/discipline/settings', { minResponseDays: Number(f.get('minResponseDays')), maxSuspensionDays: Number(f.get('maxSuspensionDays')), approverRoles: f.getAll('approverRoles'), hearingForTermination: f.get('hearingForTermination') === 'on', offenses: String(f.get('offenses')).split('\n').map(x => x.trim()).filter(Boolean) }); dialog.close(); toast('Policy saved.'); });
  }
  return { render };
}
