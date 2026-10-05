// Employee 201 Files: directory (search, filters, sort, pagination) and the tabbed employee profile with the
// digital 201 document checklist.
import { DOC_BADGE, fmtDate, fmtDateTime, progress, initials, readFile, openEmployeeForm, fieldBoxes, sectionCard as sharedCard } from './hr-common.js';

const PAGE_SIZE = 15;
const TABS = [['overview', 'Overview', '📊'], ['personal', 'Personal', '👤'], ['employment', 'Employment', '💼'], ['compensation', 'Compensation', '💰'], ['leave', 'Leave credits', '🌴'], ['government', 'Government IDs', '🪪'], ['family', 'Family', '👨‍👩‍👧'], ['education', 'Education', '🎓'], ['history', 'Employment History', '🕘'], ['requirements', 'Requirements', '✅'], ['documents', 'Documents', '📁'], ['memos', 'Memos', '📝'], ['trainings', 'Trainings', '🏅'], ['activity', 'Activity', '↺']];
const EDUCATION_LEVELS = ['Elementary', 'High School', 'Senior High School', 'Vocational', 'College', 'Post-graduate', 'Other'];
const SCHEDULE_LABEL = { 'every-cutoff': 'Every cutoff', 'second-cutoff': 'Monthly, 2nd cutoff', 'first-cutoff': 'Monthly, 1st cutoff', once: 'One time' };
function serviceLength(start, today) {
  if (!start || start > today) return 'Not started';
  const a = new Date(`${start}T00:00:00Z`), b = new Date(`${today}T00:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
  if (months < 12) return months < 1 ? 'Less than a month' : `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12); months %= 12;
  return `${years} year${years === 1 ? '' : 's'}${months ? ` ${months} mo` : ''}`;
}

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
        <label class="search">Search<input type="search" data-q value="${esc(query.q)}" placeholder="Search by name, employee no., department or position"></label>
        <label>Department<select data-f="department">${options(people.map(p => p.department), query.department, 'All departments')}</select></label>
        <label>Position<select data-f="position">${options(people.map(p => p.position), query.position, 'All positions')}</select></label>
        <label>Status<select data-f="status"><option value="">Active and inactive</option>${['Active', 'Inactive', 'Archived'].map(s => `<option ${s === query.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Classification<select data-f="classification">${options(people.map(p => p.classification), query.classification, 'All classifications')}</select></label>
        <button class="small" data-reset>Reset filters</button>
      </div>
      ${docFilterLabel ? `<div class="notice compact">Showing employees ${docFilterLabel}. <button class="small" data-reset>Show everyone</button></div>` : ''}
      <div class="directory-wrap">${table([head('name', 'Employee'), head('department', 'Department'), head('position', 'Position'), head('classification', 'Classification'), head('status', 'Status'), head('dateHired', 'Date hired'), ...(can().manage ? ['201 completion'] : []), '<span class="sr-only">Actions</span>'],
        rows.map(p => [
          `<button class="emp-cell" data-open="${esc(p.id)}" aria-label="Open ${esc(p.name)}"><span class="hr-avatar small" aria-hidden="true"><img src="/api/hr/employees/${encodeURIComponent(p.id)}/photo" alt="" loading="lazy" data-dir-photo>${esc(initials(p.name))}</span><span class="emp-text"><strong>${esc(p.name)}</strong><small>${esc(p.number)}</small></span></button>`,
          `<span class="cell-strong">${esc(p.department || '—')}</span>`, esc(p.position || '—'), p.classification ? `<span class="chip-soft">${esc(p.classification)}</span>` : '<span class="muted">Not set</span>', statusBadge(p.archived ? 'Archived' : p.status), fmtDate(p.dateHired),
          ...(can().manage ? [p.documents ? `<div class="completion">${progress(p.documents.percent, `${p.documents.verified}/${p.documents.required} verified`)}${p.documents.missing ? `<small class="completion-missing">${p.documents.missing} missing</small>` : ''}</div>` : '—'] : []),
          `<span class="row-actions dir-actions"><button class="small primary" data-open="${esc(p.id)}">View</button>${can().manage && !p.archived ? `<button class="small" data-edit-emp="${esc(p.id)}">Edit</button><button class="small" data-open="${esc(p.id)}" data-start-tab="requirements">Documents</button>` : ''}${can().approve ? (p.archived ? `<button class="small" data-restore="${esc(p.id)}">Restore</button>` : `<button class="small ghost-danger" data-archive="${esc(p.id)}" aria-label="Archive ${esc(p.name)}">Archive</button>`) : ''}</span>`]),
        query.q || query.department || query.position || query.status || query.classification || query.docs ? 'No employees match these filters.' : 'No employees yet. Add your first employee to start their 201 file.')}</div>
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
    root.querySelectorAll('[data-dir-photo]').forEach(img => { img.addEventListener('error', () => img.remove()); img.addEventListener('load', () => img.parentElement.classList.add('has-photo')); });
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
  async function editEmployee(id, after, only = null, label = '') {
    try { const data = await api(`/hr/employees/${encodeURIComponent(id)}`); openEmployeeForm({ ...ctx, context: ctx.context() }, { id, title: `Edit ${label ? `${label} · ` : ''}${data.name}`, values: data.form, only, onSaved: () => after() }); } catch (e) { toast(e.message); }
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
    const enc = encodeURIComponent(id);
    const [record, checklist, extra, extras, leave] = await Promise.all([api(`/hr/employees/${enc}`), api(`/hr/employees/${enc}/documents`), api(`/hr/employees/${enc}/activity`), api(`/hr/employees/${enc}/extras`), api(`/hr/employees/${enc}/leave`).catch(() => null)]);
    extras.leave = leave;
    if (profileId !== id) return;
    const f = record.form, legacy = ctx.legacy(), today = ctx.today();
    const tabs = TABS.filter(([key]) => (key !== 'compensation' || extras.compensation) && (key !== 'leave' || extras.leave) && (!['family', 'education', 'history'].includes(key) || extras.family));
    if (!tabs.some(([key]) => key === tab)) tab = 'overview';
    const header = `<section class="panel hr-profile-head"><div class="hr-profile-id"><span class="hr-avatar large"><img src="/api/hr/employees/${enc}/photo" alt="" data-photo>${esc(initials(record.name))}</span><div><h1>${esc(record.name)}</h1><p class="sub">${esc(record.number)} · ${esc(f.employment.position || 'No position')} · ${esc(f.employment.department || 'No department')}</p><p>${statusBadge(record.archived ? 'Archived' : record.activity)} ${f.employment.classification ? badge(f.employment.classification, 'neutral') : ''} ${record.draft ? badge('Pay setup incomplete', 'pending') : ''}</p></div></div>
      <div class="actions"><button class="small" data-back>← All employees</button>${record.canEdit && !record.archived ? '<button class="small primary" data-edit-self>Edit record</button>' : ''}${legacy ? `<button class="small" data-legacy-profile="${esc(id)}">Attendance, leave &amp; pay →</button>` : ''}</div></section>`;
    const infoCard = (icon, label, value) => `<div class="info-card"><span class="info-icon" aria-hidden="true">${icon}</span><span><small>${esc(label)}</small><strong>${esc(value || '—')}</strong></span></div>`;
    const info = `<div class="info-cards">${infoCard('📅', 'Years of service', serviceLength(f.employment.dateHired, today))}${infoCard('💼', 'Employment type', f.employment.employmentType || 'Not set')}${infoCard('📈', 'Job level', f.employment.jobLevel || 'Not set')}${infoCard('🗓️', 'Date hired', fmtDate(f.employment.dateHired))}</div>`;
    const tabBar = `<section class="panel profile-tabs-panel"><div class="tabs hr-tabs profile-tab-grid" role="tablist">${tabs.map(([key, text, icon]) => `<button role="tab" aria-selected="${key === tab}" class="${key === tab ? 'active' : ''}" data-tab-select="${key}"><span aria-hidden="true">${icon}</span> ${text}</button>`).join('')}</div><div class="hr-tab-body">${safeBody(record, checklist, extra, extras)}</div></section>`;
    shell(header + info + tabBar);
    const root = document.querySelector('.content');
    root.querySelector('[data-photo]')?.addEventListener('error', event => event.target.remove());
    root.querySelector('[data-photo]')?.addEventListener('load', event => event.target.parentElement.classList.add('has-photo'));
    root.addEventListener('click', event => onProfileClick(event, record, checklist, extras));
  }
  const dl = rows => boxes(rows);   // all profile details use the boxed field layout
  // Read-only field boxes and section cards come from hr-common.js, shared with the employee portal.
  const boxes = rows => fieldBoxes(esc, rows);
  const sectionCard = (icon, title, body, action = '') => sharedCard(esc, icon, title, body, action);
  const emergencyRows = f => [['Contact person', f.emergency.name], ['Relationship', f.emergency.relationship], ['Contact number', f.emergency.contact]];
  const block = (icon, title, body, action = '') => sectionCard(icon, title, body, action);
  const editBtn = (section, canEdit) => (canEdit ? ` <button class="small" data-edit-section="${section}">Edit</button>` : '');
  const formBtn = (part, canEdit) => (canEdit ? ` <button class="small" data-edit-part="${part}">Edit</button>` : '');
  function personalRows(f) { return [['First name', f.personal.firstName], ['Middle name', f.personal.middleName], ['Last name', f.personal.lastName], ['Suffix', f.personal.suffix], ['Preferred name', f.personal.preferredName], ['Sex', f.personal.sex], ['Date of birth', f.personal.birthDate && fmtDate(f.personal.birthDate)], ['Place of birth', f.personal.birthPlace], ['Civil status', f.personal.civilStatus], ['Nationality', f.personal.nationality], ...(f.personal.bloodType ? [['Blood type', f.personal.bloodType]] : []), ['Mobile', f.contact.mobile], ['Work email', f.contact.workEmail], ['Personal email', f.contact.personalEmail], ['Current address', f.contact.currentAddress], ['Permanent address', f.contact.permanentAddress]]; }
  function employmentRows(record) { const f = record.form; return [['Employee number', record.number], ['Department', f.employment.department], ['Position', f.employment.position], ['Job level', f.employment.jobLevel], ['Employment type', f.employment.employmentType], ['Classification', f.employment.classification], ['Status', f.employment.status], ['Immediate supervisor', f.employment.supervisor], ['Work location', f.employment.workLocation], ['Date hired', fmtDate(f.employment.dateHired)], ['Contract start', f.employment.contractStart && fmtDate(f.employment.contractStart)], ['Contract end', f.employment.contractEnd && fmtDate(f.employment.contractEnd)], ['Probation end', f.employment.probationEnd && fmtDate(f.employment.probationEnd)], ['Performance review', f.employment.reviewDate && fmtDate(f.employment.reviewDate)]]; }
  function safeBody(...args) {
    try { return tabBody(...args); } catch (error) { return `<div class="notice">This tab could not be shown: ${esc(error.message)}. Reload the page (Ctrl+F5) and try again.</div>`; }
  }
  function tabBody(record, checklist, extra, extras) {
    const f = record.form, edit = extras.canEdit && !record.archived;
    if (tab === 'overview') {
      const docs = checklist.items.flatMap(i => i.versions).length, trainingsDone = extra.trainings.filter(x => x.completion === 'completed').length, acked = extra.memos.filter(m => m.acknowledgedAt).length;
      const stat = (icon, label, value, sub, percent = null) => `<div class="overview-stat"><span><span aria-hidden="true">${icon}</span> ${esc(label)}</span><strong>${value}</strong><small>${esc(sub)}</small>${percent === null ? '' : `<span class="hr-progress full"><span class="hr-progress-bar w${Math.round(percent / 5) * 5}"></span></span>`}</div>`;
      const outstanding = checklist.items.filter(i => i.requirement.required && !['Verified', 'Not Applicable'].includes(i.status));
      return `<div class="overview-stats">${stat('✅', 'Requirements', `${checklist.completeCount} / ${checklist.requiredCount}`, 'Complete', checklist.percent)}${stat('📁', 'Documents', docs, 'Total files')}${stat('🏅', 'Trainings', `${trainingsDone} / ${extra.trainings.length}`, 'Complete', extra.trainings.length ? Math.round(trainingsDone / extra.trainings.length * 100) : 0)}${stat('📝', 'Memos', extra.memos.length, `${acked} acknowledged`)}</div>
        ${sectionCard('👤', 'Personal Information', boxes(personalRows(f)))}
        ${sectionCard('📞', 'Emergency Contact', boxes(emergencyRows(f)))}
        ${block('💼', 'Employment information', dl(employmentRows(record)))}
        <p class="legend">Overview is read-only. To change details, open the Personal, Employment or other tabs.</p>
        ${outstanding.length ? block('⚠️', 'Outstanding requirements', `<ul class="plain-list">${outstanding.map(i => `<li>${badge(i.status, DOC_BADGE[i.status])} ${esc(i.requirement.name)}${i.overdue ? ' <strong class="danger-text">overdue</strong>' : ''}</li>`).join('')}</ul>`) : ''}`;
    }
    if (tab === 'personal') return sectionCard('👤', 'Personal Information', boxes(personalRows(f)), formBtn('personal', edit)) + sectionCard('📞', 'Emergency Contact', boxes(emergencyRows(f)), formBtn('emergency', edit));
    if (tab === 'employment') return block('💼', 'Employment information', dl(employmentRows(record)), formBtn('employment', edit)) + '<p class="legend">Active / inactive status and employment classification are separate. Probation and review dates are reminders only; the system never changes status by itself.</p>';
    if (tab === 'compensation') {
      const c = extras.compensation, daily = c.basis === 'daily';
      return block('💰', 'Pay', dl([['Pay basis', daily ? 'Daily-paid' : 'Monthly'], [daily ? 'Daily rate' : 'Monthly salary', ctx.money(daily ? c.dailyRate : c.monthlySalary)], ...(daily ? [['Monthly equivalent', ctx.money(c.monthlySalary)]] : [['Daily rate', c.dailyRate === null ? 'From company divisor' : ctx.money(c.dailyRate)]]), ['Payroll frequency', c.frequency || 'Company default'], ['Payroll status', c.status]]), extras.canEditPay ? ' <button class="small" data-edit-pay>Edit pay</button>' : '')
        + block('✔️', 'Pay coverage', dl([['Overtime', c.coveredOT ? 'Covered' : 'Not covered'], ['Night differential', c.coveredNSD ? 'Covered' : 'Not covered'], ['Holiday pay', c.coveredHoliday ? 'Covered' : 'Not covered'], ['13th month pay', c.covered13th ? 'Covered' : 'Not covered']]), extras.canEditPay ? ' <button class="small" data-edit-pay>Edit coverage</button>' : '')
        + block('➖', 'Active company deductions', table(['Deduction', 'Amount', 'When'], c.deductions.map(d => [esc(d.name), ctx.money(d.amount), SCHEDULE_LABEL[d.schedule] || esc(d.schedule)]), 'No active company deductions.'), ctx.legacy() ? ' <button class="small" data-go-deductions>Manage deductions</button>' : '')
        + (ctx.legacy() ? `<p class="legend">Salary, schedule and contributions are edited under <button class="link-button" data-legacy-profile="${esc(record.id)}">Attendance, leave &amp; pay</button>.</p>` : '');
    }
    if (tab === 'government') return block('🪪', 'Government IDs', dl([['TIN', f.government.tin], ['SSS number', f.government.sss], ['PhilHealth number', f.government.philHealth], ['Pag-IBIG MID', f.government.pagIbig]]), formBtn('government', edit && record.sensitiveIds && ctx.context().can.approve)) + `<p class="legend">${record.sensitiveIds ? 'Shown in full to authorised roles only. HR Managers and Administrators can edit them.' : 'Masked for your role.'}</p>`;
    if (tab === 'family') {
      const fam = extras.family;
      return block('💑', 'Spouse', dl([['Name', fam.spouse.name], ['Occupation', fam.spouse.occupation], ['Contact', fam.spouse.contact]]), editBtn('family', edit))
        + block('👪', 'Parents', dl([["Father's name", fam.father.name], ["Father's occupation", fam.father.occupation], ["Mother's maiden name", fam.mother.name], ["Mother's occupation", fam.mother.occupation]]), editBtn('family', edit))
        + block('🧒', 'Children', table(['Name', 'Date of birth'], fam.children.map(c => [esc(c.name), c.birthDate ? fmtDate(c.birthDate) : '—']), 'No children recorded.'), editBtn('family', edit));
    }
    if (tab === 'education') return block('🎓', 'Education', table(['Level', 'School', 'Course / strand', 'Years', 'Honors'], extras.education.entries.map(x => [esc(x.level), esc(x.school), esc(x.course || '—'), esc([x.yearFrom, x.yearTo].filter(Boolean).join('–') || '—'), esc(x.honors || '—')]), 'No education recorded.'), editBtn('education', edit));
    if (tab === 'history') return block('🏢', 'Employment with GDS', dl([...employmentRows(record), ['Length of service', serviceLength(f.employment.dateHired, ctx.today())]]), formBtn('employment', edit)) + block('🕘', 'Previous employment', table(['Company', 'Position', 'From', 'To', 'Reason for leaving'], extras.history.entries.map(x => [esc(x.company), esc(x.position || '—'), x.from ? fmtDate(x.from) : '—', x.to ? fmtDate(x.to) : '—', esc(x.reason || '—')]), 'No previous employment recorded.'), editBtn('history', edit));
    if (tab === 'leave') {
      const L = extras.leave;
      return block('🌴', `Leave credits · ${L.year}`, table(['Leave type', 'Eligible', 'Credits this year', 'Used before the system', 'Used in the system', 'Carried over', 'Available'], L.types.map(t => [esc(t.name), t.eligible ? 'Yes' : 'No', `${t.entitled} day${t.entitled === 1 ? '' : 's'}${t.manualCredits !== null ? '<small>typed by HR</small>' : `<small>policy ${t.policyDays} days</small>`}`, `${t.usedBefore} day${t.usedBefore === 1 ? '' : 's'}`, `${Math.round((t.used - t.usedBefore) * 100) / 100} day(s)`, `${t.carry}`, `<strong>${t.available} day${t.available === 1 ? '' : 's'}</strong>`]), 'No paid leave types are configured.'), L.canEdit && !record.archived ? ' <button class="small" data-edit-leave>Edit leave credits</button>' : '') + '<p class="legend">Available = credits + carried over − used. The same balance is shown in the employee’s account and used when HR approves leave.</p>';
    }
    if (tab === 'requirements') return documentsTab(record, checklist);
    if (tab === 'documents') {
      const files = checklist.items.flatMap(i => i.versions.map(v => ({ ...v, current: i.current?.id === v.id })));
      return block('📁', 'All 201 files', table(['File', 'Requirement', 'Version', 'Uploaded', 'Review', ''], files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).map(v => [`<a href="/api/hr/documents/${v.id}/content" target="_blank" rel="noopener">${esc(v.name)}</a>`, esc(v.requirementName || ''), `v${v.version}${v.current ? ' <small>current</small>' : ' <small>earlier</small>'}`, `${fmtDateTime(v.uploadedAt)}<small>${esc(v.uploadedBy)}</small>`, badge(v.reviewStatus, DOC_BADGE[v.reviewStatus]), `<a class="small download-link" href="/api/hr/documents/${v.id}/content?download=1">Download</a>`]), 'No files uploaded yet. Upload them from the Requirements tab.'));
    }
    if (tab === 'memos') return block('📝', 'Memos and acknowledgements', table(['Memo', 'Reference', 'Version', 'Issued', 'Received', 'Acknowledged receipt'], extra.memos.map(m => [esc(m.title), esc(m.reference), `v${m.version}`, fmtDate(m.issueDate), fmtDateTime(m.assignedAt), m.acknowledgedAt ? badge(`Acknowledged ${fmtDateTime(m.acknowledgedAt)}`) : m.ackRequired ? badge('Pending', 'pending') : badge('Not required', 'neutral')]), 'No memos addressed to this employee.'), edit ? ' <button class="small" data-go-memos>Send a memo</button>' : '');
    if (tab === 'trainings') return block('🏅', 'Training records', table(['Training', 'Date', 'Required', 'Registration', 'Attendance', 'Completion'], extra.trainings.map(x => [esc(x.title), fmtDate(x.date), x.required ? 'Required' : 'Optional', esc(x.registration), esc(x.attendance), x.completion === 'completed' ? badge('Completed') : esc(x.completion)]), 'No trainings assigned.'), edit ? ' <button class="small" data-go-trainings>Assign a training</button>' : '');
    return block('↺', 'Activity history', table(['When', 'Who', 'Action', 'Area', 'Previous → updated'], extra.activity.map(a => [fmtDateTime(a.at), esc(a.actor), esc(a.action), esc(a.area), (a.changes || []).length ? `<span class="wrap">${a.changes.map(c => `<small><strong>${esc(c.field)}</strong>: ${esc(c.before)} → ${esc(c.after)}</small>`).join('')}</span>` : '—']), record.canEdit ? 'No recorded activity yet.' : 'Activity history is available to HR.')) + '<p class="legend">The audit trail is permanent: it cannot be edited or deleted. Values you are not authorized to see (such as salary) are left out.</p>';
  }
  // Leave credits typed by HR: credits for the year (blank = the leave policy) and days used before the system.
  function leaveDialog(id, L) {
    const num = (name, value, label) => `<input type="number" min="0" max="366" step="0.5" name="${name}" value="${value ?? ''}" aria-label="${esc(label)}" class="narrow">`;
    openDialog(`Leave credits · ${L.year}`, `<form id="leave-form"><div class="dialog-body"><p class="sub">Type the leave credits for this year. Leave “Credits this year” blank to use the leave policy. “Used before the system” is leave already taken this year before it was recorded here.</p>
      <div class="scroll-table"><table class="edit-rows"><thead><tr><th>Leave type</th><th>Eligible</th><th>Credits this year (days)</th><th>Used before the system (days)</th></tr></thead><tbody>${L.types.map(t => `<tr data-type="${esc(t.typeId)}"><td>${esc(t.name)}<small>Policy: ${t.policyDays} days</small></td><td><input type="checkbox" name="eligible" ${t.eligible ? 'checked' : ''} aria-label="Eligible for ${esc(t.name)}"></td><td>${num('credits', t.manualCredits, `Credits for ${t.name}`)}</td><td>${num('used', t.usedBefore || '', `Used before the system for ${t.name}`)}</td></tr>`).join('')}</tbody></table></div>
      <label class="field">Remarks (kept in the audit trail)<input name="remarks" maxlength="500"></label></div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save leave credits</button></div></form>`);
    dialog.classList.add('wide-dialog');
    dialog.querySelector('#leave-form').onsubmit = async event => {
      event.preventDefault();
      const items = [...dialog.querySelectorAll('tr[data-type]')].map(tr => { const credits = tr.querySelector('[name=credits]').value; return { typeId: tr.dataset.type, eligible: tr.querySelector('[name=eligible]').checked, manualCredits: credits === '' ? null : Number(credits), usedBefore: Number(tr.querySelector('[name=used]').value || 0) }; });
      try { await api(`/hr/employees/${encodeURIComponent(id)}/leave`, { year: L.year, items, remarks: event.target.elements.remarks.value }); dialog.close(); toast('Leave credits saved. The employee sees the same balance.'); tab = 'leave'; await drawProfile(); } catch (error) { toast(error.message); }
    };
  }
  // Repeating-row editors for family, education and previous employment.
  function sectionDialog(section, extras) {
    const row = (cells, removable = true) => `<tr>${cells}<td>${removable ? '<button type="button" class="small danger" data-row-del>Remove</button>' : ''}</td></tr>`;
    const input = (name, value = '', type = 'text', extra = '') => `<td><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></td>`;
    let body, template;
    if (section === 'family') {
      const fam = extras.family;
      template = row(input('childName', '', 'text', 'required maxlength="200" aria-label="Child name"') + input('childBirth', '', 'date', 'aria-label="Date of birth"'));
      body = `<div class="form-grid"><label class="field">Spouse name<input name="spouseName" value="${esc(fam.spouse.name)}" maxlength="200"></label><label class="field">Spouse occupation<input name="spouseOccupation" value="${esc(fam.spouse.occupation)}" maxlength="200"></label><label class="field">Spouse contact<input name="spouseContact" value="${esc(fam.spouse.contact)}" maxlength="40"></label><span></span>
        <label class="field">Father's name<input name="fatherName" value="${esc(fam.father.name)}" maxlength="200"></label><label class="field">Father's occupation<input name="fatherOccupation" value="${esc(fam.father.occupation)}" maxlength="200"></label>
        <label class="field">Mother's maiden name<input name="motherName" value="${esc(fam.mother.name)}" maxlength="200"></label><label class="field">Mother's occupation<input name="motherOccupation" value="${esc(fam.mother.occupation)}" maxlength="200"></label></div>
        <h3 class="spaced">Children</h3><div class="scroll-table"><table class="edit-rows"><thead><tr><th>Name</th><th>Date of birth</th><th></th></tr></thead><tbody>${fam.children.map(c => row(input('childName', c.name, 'text', 'required maxlength="200" aria-label="Child name"') + input('childBirth', c.birthDate, 'date', 'aria-label="Date of birth"'))).join('')}</tbody></table></div>`;
    } else if (section === 'education') {
      const levelSelect = v => `<td><select name="level" aria-label="Level">${EDUCATION_LEVELS.map(l => `<option ${l === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>`;
      template = row(levelSelect('College') + input('school', '', 'text', 'required maxlength="200" aria-label="School"') + input('course', '', 'text', 'aria-label="Course"') + input('yearFrom', '', 'text', 'maxlength="4" class="narrow" aria-label="From year"') + input('yearTo', '', 'text', 'maxlength="4" class="narrow" aria-label="To year"') + input('honors', '', 'text', 'aria-label="Honors"'));
      body = `<div class="scroll-table"><table class="edit-rows"><thead><tr><th>Level</th><th>School</th><th>Course / strand</th><th>From</th><th>To</th><th>Honors</th><th></th></tr></thead><tbody>${extras.education.entries.map(x => row(levelSelect(x.level) + input('school', x.school, 'text', 'required maxlength="200" aria-label="School"') + input('course', x.course, 'text', 'aria-label="Course"') + input('yearFrom', x.yearFrom, 'text', 'maxlength="4" class="narrow" aria-label="From year"') + input('yearTo', x.yearTo, 'text', 'maxlength="4" class="narrow" aria-label="To year"') + input('honors', x.honors, 'text', 'aria-label="Honors"'))).join('')}</tbody></table></div>`;
    } else {
      template = row(input('company', '', 'text', 'required maxlength="200" aria-label="Company"') + input('position', '', 'text', 'aria-label="Position"') + input('from', '', 'date', 'aria-label="From"') + input('to', '', 'date', 'aria-label="To"') + input('reason', '', 'text', 'aria-label="Reason for leaving"'));
      body = `<div class="scroll-table"><table class="edit-rows"><thead><tr><th>Company</th><th>Position</th><th>From</th><th>To</th><th>Reason for leaving</th><th></th></tr></thead><tbody>${extras.history.entries.map(x => row(input('company', x.company, 'text', 'required maxlength="200" aria-label="Company"') + input('position', x.position, 'text', 'aria-label="Position"') + input('from', x.from, 'date', 'aria-label="From"') + input('to', x.to, 'date', 'aria-label="To"') + input('reason', x.reason, 'text', 'aria-label="Reason for leaving"'))).join('')}</tbody></table></div>`;
    }
    const title = { family: 'Family', education: 'Education', history: 'Previous employment' }[section];
    openDialog(`Edit ${title.toLowerCase()}`, `<form id="section-form"><div class="dialog-body">${body}<button type="button" class="small spaced" data-row-add>＋ Add ${section === 'family' ? 'child' : 'row'}</button><template id="row-template">${template}</template></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save ${title.toLowerCase()}</button></div></form>`);
    dialog.classList.add('wide-dialog');
    const form = dialog.querySelector('#section-form');
    form.addEventListener('click', event => {
      if (event.target.closest('[data-row-del]')) event.target.closest('tr').remove();
      if (event.target.closest('[data-row-add]')) form.querySelector('tbody').append(form.querySelector('#row-template').content.cloneNode(true));
    });
    form.onsubmit = async event => {
      event.preventDefault();
      const rows = [...form.querySelectorAll('tbody tr')].map(tr => Object.fromEntries([...tr.querySelectorAll('[name]')].map(el => [el.name, el.value.trim()])));
      const g = n => form.elements[n]?.value.trim() || '';
      const value = section === 'family'
        ? { spouse: { name: g('spouseName'), occupation: g('spouseOccupation'), contact: g('spouseContact') }, father: { name: g('fatherName'), occupation: g('fatherOccupation') }, mother: { name: g('motherName'), occupation: g('motherOccupation') }, children: rows.map(r => ({ name: r.childName, birthDate: r.childBirth })) }
        : { entries: rows };
      try { await api(`/hr/employees/${encodeURIComponent(profileId)}/sections/${section}`, value); dialog.classList.remove('wide-dialog'); dialog.close(); toast(`${title} saved.`); await drawProfile(); } catch (error) { toast(error.message); }
    };
  }
  function documentsTab(record, checklist) {
    const manage = can().manage && !record.archived, approve = can().approve;
    const groups = [...new Set(checklist.items.map(i => i.requirement.category))];
    return `<section class="panel checklist-panel"><div class="panel-head"><div><h2>Digital 201 checklist</h2><p>Completion counts only current, verified, required documents.</p></div>${progress(checklist.percent, `${checklist.completeCount}/${checklist.requiredCount} verified`)}</div>
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
  async function onProfileClick(event, record, checklist, extras) {
    const b = event.target.closest('button'); if (!b) return;
    const id = profileId;
    try {
      if (b.dataset.tabSelect) { tab = b.dataset.tabSelect; await drawProfile(); return; }
      if (b.hasAttribute('data-edit-leave')) { leaveDialog(id, extras.leave); return; }
      if (b.hasAttribute('data-back')) { ctx.setPage('files'); await directory(); return; }
      if (b.hasAttribute('data-edit-self')) { editEmployee(id, drawProfile); return; }
      if (b.dataset.legacyProfile) { ctx.openLegacyProfile(b.dataset.legacyProfile); return; }
      if (b.dataset.editSection) { sectionDialog(b.dataset.editSection, extras); return; }
      if (b.dataset.editPart) {
        const parts = { personal: [['Personal information', 'Contact information'], 'personal information'], emergency: [['Emergency contact'], 'emergency contact'], employment: [['Employment information'], 'employment'], government: [['Government identifiers (restricted)'], 'government IDs'] }[b.dataset.editPart];
        editEmployee(id, drawProfile, parts[0], parts[1]); return;
      }
      if (b.hasAttribute('data-edit-pay')) { ctx.editPay(id); return; }
      if (b.hasAttribute('data-go-deductions')) { ctx.go({ page: 'deductions' }); return; }
      if (b.hasAttribute('data-go-memos')) { ctx.go({ page: 'memos' }); return; }
      if (b.hasAttribute('data-go-trainings')) { ctx.go({ page: 'trainings' }); return; }
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

  return { directory, openProfile, drawProfile, addEmployee, isProfile: () => !!profileId, currentId: () => profileId };
}
