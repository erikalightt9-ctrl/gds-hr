// Employee 201 Files: directory (search, filters, sort, pagination) and the tabbed employee profile with the
// digital 201 document checklist.
import { DOC_BADGE, fmtDate, fmtDateTime, progress, initials, readFile, openEmployeeForm } from './hr-common.js';

const PAGE_SIZE = 15;
const TABS = [['overview', 'Overview'], ['personal', 'Personal information'], ['employment', 'Employment details'], ['documents', '201 documents'], ['memos', 'Memos & acknowledgements'], ['trainings', 'Training records'], ['activity', 'Activity history']];

export function createFiles(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  let people = [], query = { q: '', department: '', position: '', status: '', classification: '', docs: '' }, sort = { key: 'name', dir: 1 }, pageNo = 1;
  let profileId = null, tab = 'overview';

  const statusBadge = s => badge(s, s === 'Active' ? '' : s === 'Archived' ? 'neutral' : 'rejected');
  const can = () => ctx.context().can;

  // ---------- Directory ----------
  function filtered() {
    const q = query.q.toLowerCase();
    let list = people.filter(p => (query.status === 'Archived' ? p.archived : !p.archived) && (!q || [p.number, p.name, p.department, p.position, p.workEmail].join(' ').toLowerCase().includes(q))
      && (!query.department || p.department === query.department) && (!query.position || p.position === query.position)
      && (!query.status || query.status === 'Archived' || p.status === query.status) && (!query.classification || p.classification === query.classification)
      && (!query.docs || (query.docs === 'missing' ? p.documents?.missing : query.docs === 'review' ? p.documents?.review : query.docs === 'expired' ? p.documents?.expired : query.docs === 'newhires' ? p.dateHired >= ctx.daysAgo(30) : true)));
    list = [...list].sort((a, b) => String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), undefined, { numeric: true }) * sort.dir);
    return list;
  }
  const options = (values, chosen, all) => `<option value="">${all}</option>${[...new Set(values.filter(Boolean))].sort().map(v => `<option ${v === chosen ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
  function directoryHtml() {
    const list = filtered(), pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE)); pageNo = Math.min(pageNo, pages);
    const rows = list.slice((pageNo - 1) * PAGE_SIZE, pageNo * PAGE_SIZE);
    const head = (key, text) => `<button class="sort-head" data-sort="${key}" aria-label="Sort by ${text}">${text}${sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button>`;
    const docFilterLabel = { missing: 'with missing requirements', review: 'with documents to review', expired: 'with expired documents', newhires: 'hired in the last 30 days' }[query.docs];
    return heading('Employee 201 Files', 'Every employee record, document and history in one place.', can().manage ? '<button class="primary" data-hr-add-employee>＋ Add employee</button>' : '') +
      `<section class="panel"><div class="toolbar hr-filters">
        <label class="search">Search<input type="search" data-q value="${esc(query.q)}" placeholder="Employee no., name, department, position or work email"></label>
        <label>Department<select data-f="department">${options(people.map(p => p.department), query.department, 'All departments')}</select></label>
        <label>Position<select data-f="position">${options(people.map(p => p.position), query.position, 'All positions')}</select></label>
        <label>Status<select data-f="status"><option value="">Active and inactive</option>${['Active', 'Inactive', 'Archived'].map(s => `<option ${s === query.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Classification<select data-f="classification">${options(people.map(p => p.classification), query.classification, 'All classifications')}</select></label>
        <button class="small" data-reset>Reset filters</button>
      </div>
      ${docFilterLabel ? `<div class="notice compact">Showing employees ${docFilterLabel}. <button class="small" data-reset>Show everyone</button></div>` : ''}
      ${table([head('number', 'Employee no.'), head('name', 'Name'), head('department', 'Department'), head('position', 'Position'), head('classification', 'Classification'), head('status', 'Status'), head('dateHired', 'Date hired'), ...(can().manage ? ['201 completion'] : []), 'Actions'],
        rows.map(p => [esc(p.number), `<button class="link-button" data-open="${esc(p.id)}">${esc(p.name)}</button>${p.workEmail ? `<small>${esc(p.workEmail)}</small>` : ''}`, esc(p.department || '—'), esc(p.position || '—'), esc(p.classification || '—'), statusBadge(p.archived ? 'Archived' : p.status), fmtDate(p.dateHired),
          ...(can().manage ? [p.documents ? progress(p.documents.percent, `${p.documents.verified}/${p.documents.required} verified${p.documents.missing ? ` · ${p.documents.missing} missing` : ''}`) : '—'] : []),
          `<span class="row-actions"><button class="small" data-open="${esc(p.id)}">View</button>${can().manage && !p.archived ? `<button class="small" data-edit-emp="${esc(p.id)}">Edit</button><button class="small" data-open="${esc(p.id)}" data-start-tab="documents">Documents</button>` : ''}${can().approve ? (p.archived ? `<button class="small" data-restore="${esc(p.id)}">Restore</button>` : `<button class="small danger" data-archive="${esc(p.id)}">Archive</button>`) : ''}</span>`]),
        query.q || query.department || query.position || query.status || query.classification || query.docs ? 'No employees match these filters.' : 'No employees yet. Add your first employee to start their 201 file.')}
      <div class="pager"><span>${list.length} employee${list.length === 1 ? '' : 's'}${pages > 1 ? ` · page ${pageNo} of ${pages}` : ''}</span>${pages > 1 ? `<button class="small" data-page="${pageNo - 1}" ${pageNo === 1 ? 'disabled' : ''}>‹ Previous</button><button class="small" data-page="${pageNo + 1}" ${pageNo === pages ? 'disabled' : ''}>Next ›</button>` : ''}</div></section>`;
  }
  async function directory(preset = null) {
    if (preset) { query = { q: '', department: '', position: '', status: '', classification: '', docs: '', ...preset }; pageNo = 1; }
    shell(heading('Employee 201 Files', 'Loading employees…') + '<div class="loading">Loading…</div>');
    people = await api('/hr/employees');
    draw();
  }
  function draw() {
    shell(directoryHtml());
    const root = document.querySelector('.content');
    root.querySelector('[data-q]').addEventListener('input', event => { query.q = event.target.value; pageNo = 1; const pos = event.target.selectionStart; draw(); const box = document.querySelector('[data-q]'); box.focus(); box.setSelectionRange(pos, pos); });
    root.addEventListener('change', event => { const f = event.target.dataset.f; if (f) { query[f] = event.target.value; pageNo = 1; draw(); } });
    root.addEventListener('click', onDirectoryClick);
  }
  async function onDirectoryClick(event) {
    const b = event.target.closest('button'); if (!b) return;
    if (b.dataset.sort) { sort = { key: b.dataset.sort, dir: sort.key === b.dataset.sort ? -sort.dir : 1 }; draw(); }
    if (b.hasAttribute('data-reset')) { query = { q: '', department: '', position: '', status: '', classification: '', docs: '' }; pageNo = 1; draw(); }
    if (b.dataset.page) { pageNo = Number(b.dataset.page); draw(); }
    if (b.dataset.open) await openProfile(b.dataset.open, b.dataset.startTab || 'overview');
    if (b.hasAttribute('data-hr-add-employee')) addEmployee();
    if (b.dataset.editEmp) editEmployee(b.dataset.editEmp, () => directory());
    if (b.dataset.archive) archive(b.dataset.archive);
    if (b.dataset.restore) { try { await api(`/hr/employees/${encodeURIComponent(b.dataset.restore)}/restore`, {}); toast('Employee restored.'); await directory(); } catch (e) { toast(e.message); } }
  }
  function addEmployee() { openEmployeeForm({ ...ctx, context: ctx.context() }, { title: 'Add employee', values: { employment: { dateHired: ctx.today(), status: 'Active' } }, onSaved: id => openProfile(id) }); }
  async function editEmployee(id, after) {
    try { const data = await api(`/hr/employees/${encodeURIComponent(id)}`); openEmployeeForm({ ...ctx, context: ctx.context() }, { id, title: `Edit ${data.name}`, values: data.form, onSaved: () => after() }); } catch (e) { toast(e.message); }
  }
  function archive(id) {
    const person = people.find(p => p.id === id);
    openDialog(`Archive ${person?.name || id}`, `<form id="archive-form"><div class="dialog-body"><p>Archiving moves the employee out of the active directory and stops future payroll from their end date. Their 201 documents and history are kept and stay visible to authorised HR users. You can restore the record later.</p><div class="form-grid"><label class="field">Reason<input name="reason" required minlength="3" maxlength="500" placeholder="e.g. Resigned effective 30 Sept"></label><label class="field">Last day (end date)<input name="endDate" type="date" value="${ctx.today()}"></label></div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Archive employee</button></div></form>`);
    dialog.querySelector('#archive-form').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.target);
      try { await api(`/hr/employees/${encodeURIComponent(id)}/archive`, { reason: f.get('reason'), endDate: f.get('endDate') }); dialog.close(); toast('Employee archived. Records are kept.'); await ctx.refresh().catch(() => {}); await directory(); } catch (e) { toast(e.message); }
    };
  }

  // ---------- Profile ----------
  async function openProfile(id, startTab = 'overview') {
    profileId = id; tab = startTab; ctx.setPage('employee201');
    await drawProfile();
  }
  async function drawProfile() {
    const id = profileId;
    shell('<div class="loading">Loading employee…</div>');
    const [record, checklist, extra] = await Promise.all([api(`/hr/employees/${encodeURIComponent(id)}`), api(`/hr/employees/${encodeURIComponent(id)}/documents`), api(`/hr/employees/${encodeURIComponent(id)}/activity`)]);
    if (profileId !== id) return;
    const f = record.form, legacy = ctx.legacy();
    const header = `<section class="panel hr-profile-head"><div class="hr-profile-id"><span class="hr-avatar large"><img src="/api/hr/employees/${encodeURIComponent(id)}/photo" alt="" data-photo>${esc(initials(record.name))}</span><div><h1>${esc(record.name)}</h1><p class="sub">${esc(record.number)} · ${esc(f.employment.position || 'No position')} · ${esc(f.employment.department || 'No department')}</p><p>${statusBadge(record.archived ? 'Archived' : record.activity)} ${f.employment.classification ? badge(f.employment.classification, 'neutral') : ''} ${record.draft ? badge('Pay setup incomplete', 'pending') : ''}</p></div></div>
      <div class="actions"><button class="small" data-back>← All employees</button>${record.canEdit && !record.archived ? '<button class="small primary" data-edit-self>Edit record</button>' : ''}${legacy ? `<button class="small" data-legacy-profile="${esc(id)}">Attendance, leave &amp; pay →</button>` : ''}</div></section>`;
    const tabs = `<div class="tabs hr-tabs" role="tablist">${TABS.map(([key, text]) => `<button role="tab" aria-selected="${key === tab}" class="${key === tab ? 'active' : ''}" data-tab-select="${key}">${text}</button>`).join('')}</div>`;
    shell(header + tabs + `<div class="hr-tab-body">${tabBody(record, checklist, extra)}</div>`);
    const root = document.querySelector('.content');
    root.querySelector('[data-photo]')?.addEventListener('error', event => event.target.remove());
    root.querySelector('[data-photo]')?.addEventListener('load', event => event.target.parentElement.classList.add('has-photo'));
    root.addEventListener('click', event => onProfileClick(event, record, checklist));
  }
  const dl = rows => `<dl class="details-grid hr-details">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v === '' || v === undefined || v === null ? '<span class="muted">—</span>' : esc(v)}</dd></div>`).join('')}</dl>`;
  function tabBody(record, checklist, extra) {
    const f = record.form;
    if (tab === 'overview') {
      const outstanding = checklist.items.filter(i => i.requirement.required && !['Verified', 'Not Applicable'].includes(i.status));
      const deadlines = [['Probation end', f.employment.probationEnd], ['Performance review', f.employment.reviewDate], ['Contract end', f.employment.contractEnd], ...checklist.items.filter(i => i.status === 'Missing' && i.due).map(i => [`${i.requirement.name} due`, i.due]), ...checklist.items.filter(i => i.current?.expiryDate).map(i => [`${i.requirement.name} expires`, i.current.expiryDate])].filter(([, d]) => d).sort((a, b) => a[1].localeCompare(b[1]));
      return `<div class="grid2"><section class="panel"><div class="panel-head"><h2>201 document completion</h2></div><div class="panel-body">${progress(checklist.percent, `${checklist.completeCount} of ${checklist.requiredCount} required documents verified`)}
        <h3 class="spaced">Outstanding requirements</h3>${outstanding.length ? `<ul class="plain-list">${outstanding.map(i => `<li>${badge(i.status, DOC_BADGE[i.status])} ${esc(i.requirement.name)}${i.overdue ? ' <strong class="danger-text">overdue</strong>' : ''}</li>`).join('')}</ul>` : '<p class="muted">All required documents are verified.</p>'}</div></section>
        <section class="panel"><div class="panel-head"><h2>Deadlines and reminders</h2></div><div class="panel-body">${deadlines.length ? `<ul class="plain-list">${deadlines.map(([k, d]) => `<li><strong>${fmtDate(d)}</strong> · ${esc(k)}${d < ctx.today() ? ' <span class="danger-text">(passed)</span>' : ''}</li>`).join('')}</ul>` : '<p class="muted">No dates set.</p>'}<p class="legend">Dates are reminders only; the system never changes employment status by itself.</p></div></section></div>
        <section class="panel"><div class="panel-head"><h2>Recent HR activity</h2></div>${table(['When', 'Who', 'What'], extra.activity.slice(0, 6).map(a => [fmtDateTime(a.at), esc(a.actor), `${esc(a.action)} · ${esc(a.area)}`]), 'No recorded activity yet.')}</section>`;
    }
    if (tab === 'personal') return `<section class="panel"><div class="panel-head"><h2>Personal information</h2></div><div class="panel-body">${dl([['First name', f.personal.firstName], ['Middle name', f.personal.middleName], ['Last name', f.personal.lastName], ['Suffix', f.personal.suffix], ['Preferred name', f.personal.preferredName], ['Sex', f.personal.sex], ['Date of birth', f.personal.birthDate && fmtDate(f.personal.birthDate)], ['Place of birth', f.personal.birthPlace], ['Civil status', f.personal.civilStatus], ['Nationality', f.personal.nationality]])}</div></section>
      <section class="panel"><div class="panel-head"><h2>Contact</h2></div><div class="panel-body">${dl([['Work email', f.contact.workEmail], ['Personal email', f.contact.personalEmail], ['Mobile', f.contact.mobile], ['Current address', f.contact.currentAddress], ['Permanent address', f.contact.permanentAddress]])}</div></section>
      <section class="panel"><div class="panel-head"><h2>Emergency contact</h2></div><div class="panel-body">${dl([['Contact person', f.emergency.name], ['Relationship', f.emergency.relationship], ['Contact number', f.emergency.contact]])}</div></section>
      <section class="panel"><div class="panel-head"><h2>Government identifiers</h2><span class="legend">${record.sensitiveIds ? 'Shown in full to authorised roles only.' : 'Masked for your role.'}</span></div><div class="panel-body">${dl([['TIN', f.government.tin], ['SSS', f.government.sss], ['PhilHealth', f.government.philHealth], ['Pag-IBIG', f.government.pagIbig]])}</div></section>`;
    if (tab === 'employment') return `<section class="panel"><div class="panel-head"><h2>Employment details</h2></div><div class="panel-body">${dl([['Employee number', record.number], ['Date hired', fmtDate(f.employment.dateHired)], ['Department', f.employment.department], ['Position', f.employment.position], ['Immediate supervisor', f.employment.supervisor], ['Work location', f.employment.workLocation], ['Status', f.employment.status], ['Classification', f.employment.classification], ['Contract start', f.employment.contractStart && fmtDate(f.employment.contractStart)], ['Contract end', f.employment.contractEnd && fmtDate(f.employment.contractEnd)], ['Probation end', f.employment.probationEnd && fmtDate(f.employment.probationEnd)], ['Performance review', f.employment.reviewDate && fmtDate(f.employment.reviewDate)]])}<p class="legend">Active / inactive status and employment classification are separate: an employee can be active and probationary at the same time.</p></div></section>`;
    if (tab === 'documents') return documentsTab(record, checklist);
    if (tab === 'memos') return `<section class="panel"><div class="panel-head"><h2>Memos and acknowledgements</h2></div>${table(['Memo', 'Reference', 'Version', 'Issued', 'Received', 'Acknowledged receipt'], extra.memos.map(m => [esc(m.title), esc(m.reference), `v${m.version}`, fmtDate(m.issueDate), fmtDateTime(m.assignedAt), m.acknowledgedAt ? badge(`Acknowledged ${fmtDateTime(m.acknowledgedAt)}`) : m.ackRequired ? badge('Pending', 'pending') : badge('Not required', 'neutral')]), 'No memos addressed to this employee.')}</section>`;
    if (tab === 'trainings') return `<section class="panel"><div class="panel-head"><h2>Training records</h2></div>${table(['Training', 'Date', 'Required', 'Registration', 'Attendance', 'Completion'], extra.trainings.map(t => [esc(t.title), fmtDate(t.date), t.required ? 'Required' : 'Optional', esc(t.registration), esc(t.attendance), t.completion === 'completed' ? badge('Completed') : esc(t.completion)]), 'No trainings assigned.')}</section>`;
    return `<section class="panel"><div class="panel-head"><h2>Activity history</h2><span class="legend">Changes are listed without their values; sensitive details stay in the restricted audit trail.</span></div>${table(['When', 'Who', 'Action', 'Area'], extra.activity.map(a => [fmtDateTime(a.at), esc(a.actor), esc(a.action), esc(a.area)]), record.canEdit ? 'No recorded activity yet.' : 'Activity history is available to HR.')}</section>`;
  }
  function documentsTab(record, checklist) {
    const manage = can().manage && !record.archived, approve = can().approve;
    const groups = [...new Set(checklist.items.map(i => i.requirement.category))];
    return `<section class="panel"><div class="panel-head"><div><h2>Digital 201 checklist</h2><p>Completion counts only current, verified, required documents.</p></div>${progress(checklist.percent, `${checklist.completeCount}/${checklist.requiredCount} verified`)}</div>
      ${groups.map(g => `<h3 class="hr-group-title">${esc(g)}</h3>${table(['Requirement', 'Status', 'Due / expiry', 'Current file', 'Reviewed', 'Actions'], checklist.items.filter(i => i.requirement.category === g).map(i => {
        const c = i.current;
        return [`${esc(i.requirement.name)}${i.requirement.required ? '' : ' <small>optional</small>'}${i.restricted ? ' <small>🔒 restricted</small>' : ''}`,
          `${badge(i.status, DOC_BADGE[i.status])}${i.overdue ? ' <small class="danger-text">overdue</small>' : ''}${i.expiringSoon ? ' <small>expiring soon</small>' : ''}${i.notApplicable ? `<small>${esc(i.notApplicable.reason)}</small>` : ''}`,
          c?.expiryDate ? `Expires ${fmtDate(c.expiryDate)}` : i.due && ['Missing', 'Rejected'].includes(i.status) ? `Due ${fmtDate(i.due)}` : '—',
          i.hidden ? '<span class="muted">Restricted</span>' : c ? `<a href="/api/hr/documents/${c.id}/content" target="_blank" rel="noopener">${esc(c.name)}</a><small>v${c.version} · ${fmtDate(c.uploadedAt)} · ${esc(c.uploadedBy)}</small>` : '—',
          c?.reviewer ? `${esc(c.reviewer)}<small>${fmtDate(c.reviewedAt)}${c.reviewNote ? ` · ${esc(c.reviewNote)}` : ''}</small>` : '—',
          `<span class="row-actions">${manage && !i.hidden ? `<button class="small" data-upload="${esc(i.requirement.id)}">${c ? 'Replace' : 'Upload'}</button>` : ''}${manage && c && !i.hidden && ['Submitted', 'Under Review', 'Expired'].includes(i.status) ? `<button class="small primary" data-review="${c.id}" data-req="${esc(i.requirement.name)}">Review</button>` : ''}${c && !i.hidden ? `<a class="small download-link" href="/api/hr/documents/${c.id}/content?download=1">Download</a>` : ''}${i.versions.length > 1 ? `<button class="small" data-versions="${esc(i.requirement.id)}">Versions (${i.versions.length})</button>` : ''}${approve ? `<button class="small" data-na="${esc(i.requirement.id)}" data-on="${i.notApplicable ? '' : '1'}">${i.notApplicable ? 'Mark applicable' : 'Not applicable'}</button>` : ''}</span>`];
      }))}`).join('')}</section>`;
  }
  async function onProfileClick(event, record, checklist) {
    const b = event.target.closest('button'); if (!b) return;
    const id = profileId;
    try {
      if (b.dataset.tabSelect) { tab = b.dataset.tabSelect; await drawProfile(); return; }
      if (b.hasAttribute('data-back')) { ctx.setPage('files'); await directory(); return; }
      if (b.hasAttribute('data-edit-self')) { editEmployee(id, drawProfile); return; }
      if (b.dataset.legacyProfile) { ctx.openLegacyProfile(b.dataset.legacyProfile); return; }
      if (b.dataset.upload) uploadDialog(checklist.items.find(i => i.requirement.id === b.dataset.upload));
      if (b.dataset.review) reviewDialog(b.dataset.review, b.dataset.req);
      if (b.dataset.versions) versionsDialog(checklist.items.find(i => i.requirement.id === b.dataset.versions));
      if (b.dataset.na !== undefined) {
        const on = !!b.dataset.on, reason = on ? window.prompt('Why is this requirement not applicable to this employee?') : '';
        if (on && !reason) return;
        await api(`/hr/employees/${encodeURIComponent(id)}/requirements/${b.dataset.na}`, { notApplicable: on, reason: reason || '' }); toast(on ? 'Marked not applicable.' : 'Requirement applies again.'); await drawProfile();
      }
    } catch (error) { toast(error.message); }
  }
  function uploadDialog(item) {
    const c = item.current, needsReason = c && c.reviewStatus === 'Verified';
    openDialog(`${c ? 'Replace' : 'Upload'}: ${item.requirement.name}`, `<form id="doc-upload"><div class="dialog-body form-grid">
      <label class="field full">File (PDF, JPG or PNG, up to ${ctx.context().uploads.documentMB} MB)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg" required></label>
      <label class="field">Issue date (optional)<input type="date" name="issueDate"></label><label class="field">Expiry date ${item.requirement.expires ? '' : '(optional)'}<input type="date" name="expiryDate" ${item.requirement.expires ? 'required' : ''}></label>
      ${c ? `<label class="field full">Reason for replacing${needsReason ? '' : ' (optional)'}<input name="replaceReason" ${needsReason ? 'required minlength="3"' : ''} maxlength="500" placeholder="e.g. Signed copy received"></label>` : ''}
      <label class="field full">Remarks (optional)<input name="remarks" maxlength="500"></label>
      ${c ? `<p class="legend full">The current version (v${c.version}) is kept in the version history.</p>` : ''}</div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Upload</button></div></form>`);
    dialog.querySelector('#doc-upload').onsubmit = async event => {
      event.preventDefault(); const form = event.target, file = form.elements.file.files[0], limit = ctx.context().uploads.documentMB;
      if (!file) return;
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)) { toast('Use a PDF, JPG or PNG file.'); return; }
      if (file.size > limit * 1024 * 1024) { toast(`Files can be up to ${limit} MB.`); return; }
      const button = form.querySelector('.primary'); button.disabled = true; button.textContent = 'Uploading…';
      try {
        await api(`/hr/employees/${encodeURIComponent(profileId)}/documents`, { requirementId: item.requirement.id, name: file.name, mime: file.type, data: await readFile(file), issueDate: form.elements.issueDate.value, expiryDate: form.elements.expiryDate.value, replaceReason: form.elements.replaceReason?.value || '', remarks: form.elements.remarks.value });
        dialog.close(); toast('Document uploaded. Review it to count it as complete.'); await drawProfile();
      } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'Upload'; }
    };
  }
  function reviewDialog(docId, name) {
    openDialog(`Review: ${name}`, `<form id="doc-review"><div class="dialog-body"><p><a href="/api/hr/documents/${docId}/content" target="_blank" rel="noopener">Open the document</a> and check it before deciding.</p><div class="form-grid"><label class="field">Decision<select name="decision"><option value="Verified">Verified</option><option value="Under Review">Under review</option><option value="Rejected">Rejected (tell the employee why)</option></select></label><label class="field">Note${' '}<input name="note" maxlength="500" placeholder="Required when rejecting"></label></div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save review</button></div></form>`);
    dialog.querySelector('#doc-review').onsubmit = async event => {
      event.preventDefault(); const f = new FormData(event.target);
      try { await api(`/hr/documents/${docId}/review`, { decision: f.get('decision'), note: f.get('note') }); dialog.close(); toast(`Document marked ${f.get('decision').toLowerCase()}.`); await drawProfile(); } catch (error) { toast(error.message); }
    };
  }
  function versionsDialog(item) {
    openDialog(`Versions: ${item.requirement.name}`, `<div class="dialog-body">${table(['Version', 'File', 'Uploaded', 'Status', 'Replacement reason'], item.versions.map(v => [`v${v.version}`, `<a href="/api/hr/documents/${v.id}/content" target="_blank" rel="noopener">${esc(v.name)}</a>`, `${fmtDateTime(v.uploadedAt)}<small>${esc(v.uploadedBy)}</small>`, `${esc(v.reviewStatus)}${v.reviewNote ? `<small>${esc(v.reviewNote)}</small>` : ''}`, esc(v.replaceReason || '—')]))}</div>`, '<div class="dialog-foot"><button data-close>Close</button></div>');
  }

  return { directory, openProfile, drawProfile, addEmployee, isProfile: () => !!profileId };
}
