// Memos: drafts, issuing to all / departments / named employees, revisions, archive, and acknowledgement tracking.
import { fmtDate, fmtDateTime, readFile } from './hr-common.js';
// The five memo categories offered when writing a memo (older memos keep their original category).
const MEMO_CATEGORIES = ['General Announcement', 'Policy / Guidelines', 'Advisory / Reminder', 'Notice to Explain / Disciplinary', 'Office Order / Schedule', 'Incident Report', 'Written Warning', 'Notice'];
// Templates for a memo about one employee. A written warning is a sanction: it can only follow a due process case whose
// approved decision is a warning (checked again when the memo is issued).
const TEMPLATES = {
  'incident-report': { label: 'Incident report', category: 'Incident Report', title: d => `Incident report · ${d.employeeName}`, body: d => `INCIDENT REPORT\n\nEmployee: ${d.employeeName}\nPosition: ${d.position}\nDepartment: ${d.department}\nDate of incident: ${d.incidentDate}\n\nDescription of the incident:\n${d.description}\n\nReported by: ${d.issuingOfficer}\n\nThis report documents the incident. It is not a finding and imposes no penalty. Any disciplinary matter follows due process (Notice to Explain, explanation, and evaluation).` },
  'explanation-letter': { label: 'Explanation letter (request for explanation)', category: 'Notice to Explain / Disciplinary', title: d => `Request for written explanation · ${d.employeeName}`, body: d => `Dear ${d.employeeName},\n\nYou are requested to explain in writing the following matter of ${d.incidentDate}:\n\n${d.description}\n\nPlease submit your written explanation within five (5) calendar days from receipt of this memo. You may attach supporting documents.\n\nThis memo is not a finding and imposes no penalty. For a formal disciplinary charge, HR issues a Notice to Explain through Due Process.\n\n${d.issuingOfficer}` },
  'written-warning': { label: 'Written warning (after an approved due process decision)', category: 'Written Warning', title: d => `Written warning · ${d.employeeName}`, body: d => `Dear ${d.employeeName},\n\nFollowing due process, the decision in the case concerning the incident of ${d.incidentDate} was approved by management.\n\n${d.description}\n\nThis written warning forms part of your employment record. A repetition may result in a heavier penalty under the Code of Conduct.\n\n${d.issuingOfficer}` },
  notice: { label: 'Notice to an employee', category: 'Notice', title: d => `Notice · ${d.employeeName}`, body: d => `Dear ${d.employeeName},\n\n${d.description}\n\n${d.issuingOfficer}` },
};

export function createMemos(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  let view = 'issued', memos = [], people = [];
  const STATUS = { draft: ['Draft', 'neutral'], published: ['Issued', ''], archived: ['Archived', 'neutral'] };

  async function render(openId = null) {
    shell(heading('Memos', 'Loading…') + '<div class="loading">Loading memos…</div>');
    [memos, people] = await Promise.all([api('/hr/memos'), ctx.context().can.manage ? api('/hr/employees') : Promise.resolve([])]);
    // Servers started before the names were added to the list: read them from each issued memo's details instead.
    memos = await Promise.all(memos.map(async m => {
      if (m.recipientNames || !m.version) return m;
      try { const v = (await api(`/hr/memos/${m.id}`)).versions.at(-1), rows = v?.assignments || [], name = a => a.name || a.employeeId; return { ...m, recipientNames: rows.map(name), pendingNames: m.ackRequired ? rows.filter(a => !a.acknowledgedAt).map(name) : [] }; }
      catch { return m; }
    }));
    draw();
    if (openId) detail(openId);
  }
  function draw() {
    const can = ctx.context().can, list = memos.filter(m => (view === 'issued' ? m.status === 'published' : m.status === view));
    shell(heading('Memos', 'Issue memos to everyone, a department or chosen employees, and track who has acknowledged receipt.', can.manage ? '<button class="primary" data-new>＋ Create memo</button>' : '') +
      `<div class="tabs rect-tabs">${['issued', ...(can.manage ? ['draft'] : []), 'archived'].map(v => `<button data-view="${v}" class="${v === view ? 'active' : ''}" aria-pressed="${v === view}"><svg class="rect-tab-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${{ issued: '<path d="M21 3 3 10.5l7 2.5 2.5 7L21 3Z"/><path d="m10 13 4.5-4.5"/>', draft: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>', archived: '<rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>' }[v]}</svg>${{ issued: 'Issued', draft: 'Drafts', archived: 'Archived' }[v]} <span>${memos.filter(m => (v === 'issued' ? m.status === 'published' : m.status === v)).length}</span></button>`).join('')}</div>
      <section class="panel">${table(['Reference', 'Employee', 'Title', 'Category', 'Issued', 'Recipients', 'Acknowledged', 'Deadline', ''], list.map(m => [esc(m.reference || '—'), recipientCell(m), `<button class="link-button" data-open="${m.id}">${esc(m.title)}</button>${m.revisionInProgress ? '<small>revision in progress</small>' : ''}`, esc(m.category || '—'), fmtDate(m.issueDate), m.recipients || '—', m.status === 'draft' ? '—' : m.ackRequired ? `${m.acknowledged} / ${m.recipients}${m.pending ? ` · ${badge(`${m.pending} pending`, 'pending')}` : ''}` : 'Not required', m.ackDeadline ? fmtDate(m.ackDeadline) : '—', `<button class="small" data-open="${m.id}">Open</button>`]), view === 'draft' ? 'No drafts.' : 'No memos here yet.')}</section>`);
    document.querySelector('.content').addEventListener('click', onClick);
  }
  async function onClick(event) {
    const b = event.target.closest('button'); if (!b) return;
    if (b.dataset.view) { view = b.dataset.view; draw(); }
    if (b.hasAttribute('data-new')) editor(null);
    if (b.dataset.open) detail(b.dataset.open);
  }
  function editor(memo, { revision = false } = {}) {
    const d = memo?.draft || { title: '', category: 'General Announcement', reference: '', issueDate: ctx.today(), body: '', recipients: { mode: 'all', departments: [], employees: [] }, ackRequired: true, ackDeadline: '' };
    const depts = ctx.context().departments, active = people.filter(p => !p.archived && p.status === 'Active');
    const det = d.details || null;
    openDialog(revision ? `Revise memo (new version)` : memo ? 'Edit memo draft' : 'Create memo', `<form id="memo-form"><div class="dialog-body"><div id="memo-error" class="form-error hidden" role="alert"></div><div class="form-grid">
      <label class="field full">Template<select name="template" ${revision ? 'disabled' : ''}><option value="">Blank memo</option>${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}" ${det?.template === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select><small>A template fills the title and text for one employee. You can edit everything before saving.</small></label>
      <fieldset class="field full memo-details ${det ? '' : 'hidden'}" data-details><legend>Employee concerned</legend><div class="form-grid">
        <label class="field">Employee<select name="detEmployee">${active.map(p => `<option value="${esc(p.id)}" data-name="${esc(p.name)}" data-dept="${esc(p.department || '')}" data-pos="${esc(p.position || '')}" ${det?.employeeId === p.id ? 'selected' : ''}>${esc(p.name)} · ${esc(p.position || p.department || '')}</option>`).join('')}</select></label>
        <label class="field">Incident / reference date<input type="date" name="detDate" value="${esc(det?.incidentDate || ctx.today())}"></label>
        <label class="field">Issuing officer<input name="detOfficer" maxlength="200" value="${esc(det?.issuingOfficer || '')}" placeholder="Name and position"></label>
        <label class="field hidden" data-case>Due process case (approved warning)<select name="detCase"><option value="">Choose…</option></select></label>
        <label class="field full">Description<textarea name="detDescription" rows="4" maxlength="8000">${esc(det?.description || '')}</textarea></label>
        <div class="full"><button type="button" class="small" data-fill>Fill title and text from the template</button></div></div></fieldset>
      <label class="field full">Title<input name="title" required maxlength="200" value="${esc(d.title)}"></label>
      <label class="field">Category<select name="category" required>${[...MEMO_CATEGORIES, ...(d.category && !MEMO_CATEGORIES.includes(d.category) ? [d.category] : [])].map(c => `<option${c === (d.category || 'General Announcement') ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label class="field">Reference number<input name="reference" maxlength="60" value="${esc(d.reference)}" placeholder="Assigned on issue if blank"></label>
      <label class="field">Issue date<input type="date" name="issueDate" required value="${esc(d.issueDate)}"></label>
      <label class="field">Recipients<select name="mode"><option value="all" ${d.recipients.mode === 'all' ? 'selected' : ''}>All active employees</option><option value="departments" ${d.recipients.mode === 'departments' ? 'selected' : ''}>Selected departments</option><option value="employees" ${d.recipients.mode === 'employees' ? 'selected' : ''}>Selected employees</option></select></label>
      <label class="field full ${d.recipients.mode === 'departments' ? '' : 'hidden'}" data-pick="departments">Departments (Ctrl/⌘-click for several)<select name="departments" multiple size="5">${depts.map(x => `<option ${d.recipients.departments.includes(x) ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="field full ${d.recipients.mode === 'employees' ? '' : 'hidden'}" data-pick="employees">Employees (Ctrl/⌘-click for several)<select name="employees" multiple size="8">${active.map(p => `<option value="${esc(p.id)}" ${d.recipients.employees.includes(p.id) ? 'selected' : ''}>${esc(p.name)} · ${esc(p.department || '')}</option>`).join('')}</select></label>
      <label class="field check"><input type="checkbox" name="ackRequired" ${d.ackRequired ? 'checked' : ''}> Ask recipients to acknowledge receipt</label>
      <label class="field">Acknowledge by (optional)<input type="date" name="ackDeadline" value="${esc(d.ackDeadline)}"></label>
      <label class="field full">Memo text<textarea name="body" rows="12" required maxlength="20000">${esc(d.body)}</textarea></label>
      <label class="field full">Attachment (optional · PDF, JPG or PNG up to 10 MB)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"><small>${memo?.attachments?.filter(a => !a.version || revision).length ? `Attached: ${memo.attachments.filter(a => !a.version).map(a => esc(a.name)).join(', ') || 'none for this version yet'}` : 'Attachments become part of the issued version.'}</small></label>
      ${revision ? '<p class="legend full">Issuing the revision creates a new version. The earlier version and its acknowledgements stay on record; recipients are asked to acknowledge the new version.</p>' : ''}
    </div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">${revision ? 'Save revision draft' : 'Save draft'}</button></div></form>`);
    const form = dialog.querySelector('#memo-form');
    form.elements.mode.onchange = () => form.querySelectorAll('[data-pick]').forEach(el => el.classList.toggle('hidden', el.dataset.pick !== form.elements.mode.value));
    const tpl = form.elements.template, caseBox = form.querySelector('[data-case]');
    const loadCases = async () => {
      if (tpl.value !== 'written-warning') { caseBox.classList.add('hidden'); return; }
      caseBox.classList.remove('hidden');
      try {
        const list = (await api('/hr/discipline/cases?status=Resolved')).concat(await api('/hr/discipline/cases?status=Closed')).filter(c => /warning/i.test(c.action));
        form.elements.detCase.innerHTML = `<option value="">Choose…</option>${list.map(c => `<option value="${esc(c.id)}" data-emp="${esc(c.employeeId)}" data-date="${esc(c.incidentDate)}" data-action="${esc(c.action)}" ${det?.caseId === c.id ? 'selected' : ''}>${esc(c.reference)} · ${esc(c.employeeName)} · ${esc(c.action)}</option>`).join('')}`;
      } catch { form.elements.detCase.innerHTML = '<option value="">Only HR managers can link a case</option>'; }
    };
    form.elements.detCase.onchange = () => { const o = form.elements.detCase.selectedOptions[0]; if (o?.dataset.emp) { form.elements.detEmployee.value = o.dataset.emp; form.elements.detDate.value = o.dataset.date; if (!form.elements.detDescription.value) form.elements.detDescription.value = `Decision: ${o.dataset.action}.`; } };
    tpl.onchange = () => { form.querySelector('[data-details]').classList.toggle('hidden', !tpl.value); loadCases(); };
    loadCases();
    const detailsValue = () => { if (!tpl.value) return null; const o = form.elements.detEmployee.selectedOptions[0]; return { template: tpl.value, employeeId: form.elements.detEmployee.value, employeeName: o?.dataset.name || '', department: o?.dataset.dept || '', position: o?.dataset.pos || '', incidentDate: form.elements.detDate.value, description: form.elements.detDescription.value, issuingOfficer: form.elements.detOfficer.value, caseId: tpl.value === 'written-warning' ? form.elements.detCase.value : '' }; };
    form.querySelector('[data-fill]').onclick = () => {
      const x = detailsValue(); if (!x) return; const t = TEMPLATES[x.template];
      if (!x.issuingOfficer) { toast('Enter the issuing officer first.'); return; }
      form.elements.title.value = t.title(x); form.elements.category.value = t.category; form.elements.body.value = t.body(x);
      form.elements.mode.value = 'employees'; form.elements.mode.onchange();
      [...form.elements.employees.options].forEach(op => { op.selected = op.value === x.employeeId; });
    };
    form.onsubmit = async event => {
      event.preventDefault();
      const value = { title: form.elements.title.value, category: form.elements.category.value, reference: form.elements.reference.value, issueDate: form.elements.issueDate.value, body: form.elements.body.value, ackRequired: form.elements.ackRequired.checked, ackDeadline: form.elements.ackDeadline.value, details: revision ? (det || null) : detailsValue(), recipients: { mode: form.elements.mode.value, departments: [...form.elements.departments.selectedOptions].map(o => o.value), employees: [...form.elements.employees.selectedOptions].map(o => o.value) } };
      try {
        const saved = revision ? await api(`/hr/memos/${memo.id}/revision`, value) : await api(memo ? `/hr/memos/${memo.id}` : '/hr/memos', value);
        const id = saved.id || memo.id, file = form.elements.file.files[0];
        if (file) await api(`/hr/memos/${id}/attachments`, { name: file.name, mime: file.type, data: await readFile(file) });
        toast('Draft saved. Open it to issue.'); await render(id);
      } catch (error) { const box = form.querySelector('#memo-error'); box.textContent = error.message; box.classList.remove('hidden'); }
    };
  }
  async function detail(id) {
    try {
      const memo = await api(`/hr/memos/${id}`), latest = memo.versions.at(-1), draft = memo.draft;
      const attachments = list => list?.length ? `<p>${list.map(a => `<a href="/api/hr/memo-attachments/${a.id}" target="_blank" rel="noopener">📎 ${esc(a.name)}</a>`).join(' ')}</p>` : '';
      const body = draft && memo.status === 'draft' ? draft : latest;
      openDialog(`${body.title}`, `<div class="dialog-body">
        <p class="sub">${badge(...STATUS[memo.status])} ${esc(body.reference || 'Reference assigned on issue')} · ${esc(body.category || '')} · Issue date ${fmtDate(body.issueDate)}${latest ? ` · version ${memo.version}` : ''}</p>
        ${memo.status === 'published' && draft ? '<div class="notice compact">A revision draft is in progress. Issue it to create the next version.</div>' : ''}
        ${body.details ? `<p class="memo-details-line"><strong>Employee:</strong> ${esc(body.details.employeeName)}${body.details.position ? ` · ${esc(body.details.position)}` : ''}${body.details.department ? ` · ${esc(body.details.department)}` : ''} · <strong>Date:</strong> ${fmtDate(body.details.incidentDate)} · <strong>Issuing officer:</strong> ${esc(body.details.issuingOfficer)}</p>` : ''}
        <div class="memo-body">${esc(body.body)}</div>${attachments(latest ? latest.attachments : memo.attachments)}
        ${memo.versions.map(v => `<details class="memo-version" ${v.version === memo.version ? 'open' : ''}><summary>Version ${v.version} · issued ${fmtDateTime(v.publishedAt)} by ${esc(v.publishedBy)}${v.changeNote ? ` · ${esc(v.changeNote)}` : ''} · ${v.assignments.filter(a => a.acknowledgedAt).length}/${v.assignments.length} acknowledged</summary>
          ${table(['Employee', 'Department', 'Received', 'Acknowledged receipt'], v.assignments.map(a => [esc(a.name), esc(a.department || '—'), fmtDateTime(a.assignedAt), a.acknowledgedAt ? badge(fmtDateTime(a.acknowledgedAt)) : v.ackRequired ? badge(v.ackDeadline && v.ackDeadline < ctx.today() ? 'Overdue' : 'Pending', v.ackDeadline && v.ackDeadline < ctx.today() ? 'rejected' : 'pending') : 'Not required']))}</details>`).join('')}
        <p class="legend">Acknowledgement records that the employee received the memo. It does not mean they agree with its contents.</p></div>`,
        `<div class="dialog-foot">${memo.canEdit && memo.status === 'draft' ? '<button data-act="edit">Edit draft</button><button class="danger" data-act="delete">Delete draft</button>' : ''}${memo.canPublish && memo.status === 'published' && !draft ? '<button data-act="revise">Revise (new version)</button>' : ''}${memo.canPublish && memo.status === 'published' && draft ? '<button data-act="edit-revision">Edit revision</button>' : ''}${memo.canPublish && memo.status === 'published' ? '<button data-act="archive">Archive</button>' : ''}${memo.canPublish && (memo.status === 'draft' || draft) ? `<button class="primary" data-act="publish">${memo.version ? 'Issue revised version' : 'Issue memo'}</button>` : ''}${memo.canEdit && !memo.canPublish && memo.status === 'draft' ? '<span class="legend">An HR Manager issues the memo.</span>' : ''}<button data-close>Close</button></div>`);
      dialog.querySelector('.dialog-foot').onclick = async event => {
        const act = event.target.closest('[data-act]')?.dataset.act; if (!act) return;
        try {
          if (act === 'edit') editor(memo);
          if (act === 'edit-revision') editor(memo, { revision: true });
          if (act === 'revise') { const updated = await api(`/hr/memos/${id}/revise`, {}); editor(updated, { revision: true }); }
          if (act === 'publish') {
            const changeNote = memo.version ? window.prompt('What changed in this version? (shown to recipients)') : '';
            if (memo.version && !changeNote) return;
            if (!memo.version && !window.confirm('Issue this memo now? Recipients will see it and the issued text cannot be edited afterwards.')) return;
            await api(`/hr/memos/${id}/publish`, { changeNote: changeNote || '' }); toast('Memo issued to its recipients.'); await render(id);
          }
          if (act === 'archive' && window.confirm('Archive this memo? It stays on record and recipients can still read it.')) { await api(`/hr/memos/${id}/archive`, {}); toast('Memo archived.'); dialog.close(); await render(); }
          if (act === 'delete' && window.confirm('Delete this unissued draft?')) { await api(`/hr/memos/${id}`, null, 'DELETE'); toast('Draft deleted.'); dialog.close(); await render(); }
        } catch (error) { toast(error.message); }
      };
    } catch (error) { toast(error.message); }
  }
  return { render, create: () => { if (!people.length) api('/hr/employees').then(p => { people = p; editor(null); }).catch(e => toast(e.message)); else editor(null); } };
}

// Memo list: the recipient's name (one employee) or the count, with the names still to acknowledge.
function recipientCell(m) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const names = m.recipientNames || [], pending = m.pendingNames || [];
  if (!names.length) return '—';
  if (names.length === 1) return `<span class="memo-who">${esc(names[0])}</span>${pending.length ? '<small class="danger-text">Not yet acknowledged</small>' : ''}`;
  return `<span class="memo-who">${names.length} employees</span>${pending.length ? `<small class="danger-text">Not yet acknowledged: ${pending.map(esc).join('; ')}</small>` : ''}`;
}
