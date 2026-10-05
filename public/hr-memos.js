// Memos: drafts, issuing to all / departments / named employees, revisions, archive, and acknowledgement tracking.
import { fmtDate, fmtDateTime, readFile } from './hr-common.js';

export function createMemos(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  let view = 'issued', memos = [], people = [];
  const STATUS = { draft: ['Draft', 'neutral'], published: ['Issued', ''], archived: ['Archived', 'neutral'] };

  async function render(openId = null) {
    shell(heading('Memos', 'Loading…') + '<div class="loading">Loading memos…</div>');
    [memos, people] = await Promise.all([api('/hr/memos'), ctx.context().can.manage ? api('/hr/employees') : Promise.resolve([])]);
    draw();
    if (openId) detail(openId);
  }
  function draw() {
    const can = ctx.context().can, list = memos.filter(m => (view === 'issued' ? m.status === 'published' : m.status === view));
    shell(heading('Memos', 'Issue memos to everyone, a department or chosen employees, and track who has acknowledged receipt.', can.manage ? '<button class="primary" data-new>＋ Create memo</button>' : '') +
      `<div class="tabs">${['issued', ...(can.manage ? ['draft'] : []), 'archived'].map(v => `<button data-view="${v}" class="${v === view ? 'active' : ''}">${{ issued: 'Issued', draft: 'Drafts', archived: 'Archived' }[v]} (${memos.filter(m => (v === 'issued' ? m.status === 'published' : m.status === v)).length})</button>`).join('')}</div>
      <section class="panel">${table(['Reference', 'Title', 'Category', 'Issued', 'Version', 'Recipients', 'Acknowledged', 'Deadline', ''], list.map(m => [esc(m.reference || '—'), `<button class="link-button" data-open="${m.id}">${esc(m.title)}</button>${m.revisionInProgress ? '<small>revision in progress</small>' : ''}`, esc(m.category || '—'), fmtDate(m.issueDate), m.version ? `v${m.version}` : '—', m.recipients || '—', m.status === 'draft' ? '—' : m.ackRequired ? `${m.acknowledged} / ${m.recipients}${m.pending ? ` · ${badge(`${m.pending} pending`, 'pending')}` : ''}` : 'Not required', m.ackDeadline ? fmtDate(m.ackDeadline) : '—', `<button class="small" data-open="${m.id}">Open</button>`]), view === 'draft' ? 'No drafts.' : 'No memos here yet.')}</section>`);
    document.querySelector('.content').addEventListener('click', onClick);
  }
  async function onClick(event) {
    const b = event.target.closest('button'); if (!b) return;
    if (b.dataset.view) { view = b.dataset.view; draw(); }
    if (b.hasAttribute('data-new')) editor(null);
    if (b.dataset.open) detail(b.dataset.open);
  }
  function editor(memo, { revision = false } = {}) {
    const d = memo?.draft || { title: '', category: 'General', reference: '', issueDate: ctx.today(), body: '', recipients: { mode: 'all', departments: [], employees: [] }, ackRequired: true, ackDeadline: '' };
    const depts = ctx.context().departments, active = people.filter(p => !p.archived && p.status === 'Active');
    openDialog(revision ? `Revise memo (new version)` : memo ? 'Edit memo draft' : 'Create memo', `<form id="memo-form"><div class="dialog-body"><div id="memo-error" class="form-error hidden" role="alert"></div><div class="form-grid">
      <label class="field full">Title<input name="title" required maxlength="200" value="${esc(d.title)}"></label>
      <label class="field">Category<input name="category" list="memo-cats" maxlength="80" value="${esc(d.category)}"><datalist id="memo-cats">${['General', 'Policy', 'Announcement', 'Advisory', 'Notice to explain', 'Schedule', 'Benefits'].map(c => `<option value="${c}">`).join('')}</datalist></label>
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
    form.onsubmit = async event => {
      event.preventDefault();
      const value = { title: form.elements.title.value, category: form.elements.category.value, reference: form.elements.reference.value, issueDate: form.elements.issueDate.value, body: form.elements.body.value, ackRequired: form.elements.ackRequired.checked, ackDeadline: form.elements.ackDeadline.value, recipients: { mode: form.elements.mode.value, departments: [...form.elements.departments.selectedOptions].map(o => o.value), employees: [...form.elements.employees.selectedOptions].map(o => o.value) } };
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
