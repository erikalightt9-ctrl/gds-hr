// Data sheet review (HR) and Settings (System Administrator).
import { fmtDateTime, who } from './hr-common.js';

export function createAdmin(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  const SHEET = { submitted: ['Submitted', 'pending'], 'under-review': ['Under review', 'pending'], approved: ['Approved', ''], returned: ['Returned for correction', 'neutral'], rejected: ['Rejected', 'rejected'], draft: ['Draft', 'neutral'] };
  const LABELS = { firstName: 'First name', middleName: 'Middle name', lastName: 'Last name', suffix: 'Suffix', preferredName: 'Preferred name', sex: 'Sex', birthDate: 'Date of birth', birthPlace: 'Place of birth', civilStatus: 'Civil status', nationality: 'Nationality', personalEmail: 'Personal email', mobile: 'Mobile', currentAddress: 'Current address', permanentAddress: 'Permanent address', name: 'Contact person', relationship: 'Relationship', contact: 'Contact number', tin: 'TIN', sss: 'SSS', philHealth: 'PhilHealth', pagIbig: 'Pag-IBIG' };

  // ---------- Data sheet submissions ----------
  async function datasheets() {
    shell(heading('Data Sheet Submissions', 'Loading…') + '<div class="loading">Loading…</div>');
    const list = await api('/hr/datasheets'), open = list.filter(s => ['submitted', 'under-review'].includes(s.status));
    shell(heading('Data Sheet Submissions', 'Employees submit their information from their own account. Nothing changes in the employee record until HR approves it.') +
      `<section class="panel"><div class="panel-head"><h2>Waiting for review (${open.length})</h2></div>${table(['Employee', 'Department', 'Submitted', 'Status', ''], open.map(s => [esc(s.name), esc(s.department || '—'), fmtDateTime(s.submittedAt), badge(...SHEET[s.status]), `<button class="small primary" data-sheet="${s.id}">Review</button>`]), 'No data sheets waiting for review.')}</section>
      <section class="panel"><div class="panel-head"><h2>History</h2></div>${table(['Employee', 'Submitted', 'Decision', 'By', 'When', ''], list.filter(s => !open.includes(s)).map(s => [esc(s.name), fmtDateTime(s.submittedAt), badge(...SHEET[s.status]), esc(who(s.reviewedBy) || '—'), fmtDateTime(s.reviewedAt), `<button class="small" data-sheet="${s.id}">View</button>`]), 'No decisions yet.')}</section>
      <p class="legend">Employees open <strong>My data sheet</strong> in their portal. New hires need an employee login first (Account &amp; access).</p>`);
    document.querySelector('.content').addEventListener('click', event => { const b = event.target.closest('[data-sheet]'); if (b) sheet(b.dataset.sheet); });
  }
  async function sheet(id) {
    try {
      const s = await api(`/hr/datasheets/${id}`), editable = ['submitted', 'under-review'].includes(s.status);
      const rows = Object.entries(s.fields).flatMap(([group, values]) => Object.entries(values).map(([k, v]) => [group, k, v, s.current[group]?.[k] ?? ''])).filter(([, , v, c]) => v || c);
      openDialog(`Data sheet · ${s.employee?.name || s.employeeId}`, `<div class="dialog-body"><p class="sub">${badge(...SHEET[s.status])} Submitted ${fmtDateTime(s.submittedAt)}</p>
        ${table(['Field', 'Submitted by employee', 'Current record', ''], rows.map(([, k, v, c]) => [esc(LABELS[k] || k), esc(v || '—'), esc(c || '—'), v && v !== c ? badge('Changed', 'pending') : '']))}
        <p class="legend">Approving copies only the fields the employee filled in. Blank fields never erase existing information. Employment details stay HR-controlled.</p>
        <h3 class="spaced">History</h3><ul class="plain-list">${s.history.map(h => `<li>${fmtDateTime(h.at)} · ${esc(h.by)} · ${esc(h.action)}${h.note ? ` — ${esc(h.note)}` : ''}</li>`).join('')}</ul></div>`,
        `<div class="dialog-foot">${editable ? `${s.status === 'submitted' ? '<button data-d="under-review">Mark under review</button>' : ''}<button data-d="return">Return for correction</button>${s.canApprove ? '<button class="danger" data-d="reject">Reject</button><button class="primary" data-d="approve">Approve and update record</button>' : '<span class="legend">An HR Manager approves.</span>'}` : ''}<button data-close>Close</button></div>`);
      dialog.querySelector('.dialog-foot').onclick = async event => {
        const d = event.target.closest('[data-d]')?.dataset.d; if (!d) return;
        const note = ['return', 'reject'].includes(d) ? window.prompt(d === 'return' ? 'What should the employee correct?' : 'Reason for rejecting:') : '';
        if (['return', 'reject'].includes(d) && !note) return;
        if (d === 'approve' && !window.confirm('Approve and copy these details into the employee record?')) return;
        try { await api(`/hr/datasheets/${id}/review`, { decision: d, note: note || '' }); toast({ approve: 'Approved. The employee record is updated.', return: 'Returned to the employee.', reject: 'Rejected.', 'under-review': 'Marked under review.' }[d]); dialog.close(); await datasheets(); } catch (error) { toast(error.message); }
      };
    } catch (error) { toast(error.message); }
  }

  // ---------- Settings ----------
  let settings = null;
  async function settingsPage() {
    shell(heading('Settings', 'Loading…') + '<div class="loading">Loading…</div>');
    settings = await api('/hr/settings');
    drawSettings();
  }
  const lines = list => esc(list.join('\n'));
  const SI = { wifi: '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 15.8a4.8 4.8 0 0 1 6.4 0"/><circle cx="12" cy="19" r="1.2" fill="currentColor"/>', lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>', info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>', plus: '<path d="M12 5v14M5 12h14"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>' };
  const sIcon = (k, cls = '') => `<svg class="st-ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SI[k]}</svg>`;
  function reqRow(r, i) {
    return `<tr data-row="${i}"><td><input data-k="name" value="${esc(r.name)}" maxlength="200" aria-label="Requirement name"></td><td><input data-k="category" value="${esc(r.category)}" maxlength="80" aria-label="Category"></td>
      <td><input type="checkbox" data-k="required" ${r.required ? 'checked' : ''} aria-label="Required"></td><td><input type="checkbox" data-k="expires" ${r.expires ? 'checked' : ''} aria-label="Has expiry"></td><td><select data-k="providedBy" aria-label="Provided by"><option value="employee"${r.providedBy !== 'company' ? ' selected' : ''}>Employee</option><option value="company"${r.providedBy === 'company' ? ' selected' : ''}>Company / HR</option></select></td><td><input type="checkbox" data-k="restricted" ${r.restricted ? 'checked' : ''} aria-label="Restricted"></td>
      <td><input type="number" min="0" max="365" data-k="dueDays" value="${r.dueDays ?? ''}" aria-label="Due days after hire" class="narrow"></td><td><input data-k="departments" value="${esc(r.departments.join(', '))}" placeholder="All" aria-label="Departments"></td><td><input data-k="classifications" value="${esc(r.classifications.join(', '))}" placeholder="All" aria-label="Classifications"></td>
      <td><button type="button" class="st-trash" data-del="${i}" title="Remove requirement" aria-label="Remove requirement">${sIcon('trash')}</button></td></tr>`;
  }
  function drawSettings() {
    const s = settings, preview = `${[s.idFormat.prefix, s.idFormat.includeYear ? ctx.today().slice(0, 4) : ''].filter(Boolean).join('-')}${s.idFormat.prefix || s.idFormat.includeYear ? '-' : ''}${'1'.padStart(s.idFormat.digits, '0')}`;
    const field = (label, name, value, extra = '') => `<label class="field">${label}<input name="${name}" value="${esc(value ?? '')}" ${extra}></label>`;
    shell(heading('Settings', 'Manage company details, attendance access, and employee records.', `<span class="st-admin">${sIcon('lock')}System administrators only</span>`) +
      `<nav class="st-tabs">${[['st-wifi', 'Office Wi-Fi'], ['st-company', 'Company details'], ['st-numbers', 'Employee numbers'], ['st-requirements', 'Document requirements']].map(([id, label], i) => `<button type="button" data-st-jump="${id}" class="${i === 0 ? 'active' : ''}">${label}</button>`).join('')}</nav>
      <form id="settings-form">
      <section class="panel st-panel" id="st-company"><div class="st-head"><h2>Company details</h2></div><div class="panel-body">
        <h3 class="st-group">Company identity</h3><div class="form-grid">${field('Company name', 'company.name', s.company.name, 'required maxlength="120"')}${field('System title', 'company.systemTitle', s.company.systemTitle, 'required maxlength="120"')}</div>
        <h3 class="st-group">Employer registration</h3><div class="form-grid">${field('SSS employer ID no.', 'company.sssEmployerNo', s.company.sssEmployerNo, 'maxlength="40"')}${field('PhilHealth employer ID no.', 'company.philhealthEmployerNo', s.company.philhealthEmployerNo, 'maxlength="40"')}${field('Pag-IBIG (HDMF) employer ID no.', 'company.pagibigEmployerNo', s.company.pagibigEmployerNo, 'maxlength="40"')}<label class="field">eGov payment fee (₱, per remittance)<span class="st-peso"><input type="number" min="0" step="0.01" name="company.egovFee" value="${s.company.egovFee ?? 15}"></span><small>Per remittance.</small></label></div>
        <h3 class="st-group">Leave form signatories</h3><div class="form-grid">${field('Verified by (name)', 'company.leaveVerifiedName', s.company.leaveVerifiedName, 'maxlength="120"')}${field('Verified by (position)', 'company.leaveVerifiedTitle', s.company.leaveVerifiedTitle, 'maxlength="120"')}${field('Approved by (name)', 'company.leaveApprovedName', s.company.leaveApprovedName, 'maxlength="120"')}${field('Approved by (position)', 'company.leaveApprovedTitle', s.company.leaveApprovedTitle, 'maxlength="120"')}</div>
        <div class="form-grid st-appearance"><div><h3 class="st-group">Appearance</h3><label class="field">Theme<span class="st-theme"><select name="company.theme"><option value="gds" ${s.company.theme === 'gds' ? 'selected' : ''}>GDS red and gold</option><option value="forest" ${s.company.theme === 'forest' ? 'selected' : ''}>Forest green</option></select><i class="st-swatch red"></i><i class="st-swatch gold"></i></span></label></div>
          <div><h3 class="st-group st-group-light">Company logo</h3><div class="st-logo"><span><img src="/gds-logo.png" alt="Company logo"></span><small>Managed by your system administrator.</small></div></div></div>
      </div></section>
      <section class="panel st-panel" id="st-numbers"><div class="st-head"><h2>Employee numbers</h2></div><div class="panel-body st-numbers">
        <div class="st-numbers-fields"><label class="field">Prefix (letters / digits)<input name="idFormat.prefix" maxlength="10" pattern="[A-Z0-9]*" value="${esc(s.idFormat.prefix)}"></label><label class="field">Digits<input type="number" name="idFormat.digits" min="3" max="8" value="${s.idFormat.digits}"></label><label class="field check"><input type="checkbox" name="idFormat.includeYear" ${s.idFormat.includeYear ? 'checked' : ''}> Include year hired</label></div>
        <div class="st-next"><span>Next employee number</span><strong>${esc(preview)}</strong><small>Or the next available number.</small></div></div></section>
      <section class="panel st-panel" id="st-requirements"><div class="st-head"><div><h2>201 document requirements</h2><p>Define required documents, deadlines, and access.</p></div><button type="button" class="st-outline" data-add-req>${sIcon('plus')}Add requirement</button></div>
        <div class="scroll-table"><table class="settings-table st-req"><thead><tr><th>Requirement</th><th>Category</th><th>Required</th><th>Expires</th><th>Provided by</th><th>Restricted</th><th>Due after hire (days)</th><th>Departments</th><th>Classifications</th><th>Action</th></tr></thead><tbody id="req-rows">${s.documentRequirements.map(reqRow).join('')}</tbody></table></div>
        <p class="panel-body legend">Restricted documents (e.g. medical or disciplinary) are visible only to HR Managers and Administrators. Leave departments / classifications blank for everyone. Company / HR documents are not shown in employee accounts.</p></section>
      <section class="panel"><div class="panel-head"><h2>Lists</h2><span class="legend">One per line</span></div><div class="panel-body form-grid three">
        <label class="field">Departments<textarea name="departments" rows="8">${lines(s.departments)}</textarea></label>
        <label class="field">Positions<textarea name="positions" rows="8">${lines(s.positions)}</textarea></label>
        <label class="field">Employment classifications<textarea name="classifications" rows="8" required>${lines(s.classifications)}</textarea></label></div></section>
      <section class="panel"><div class="panel-head"><h2>Uploads, reminders and fields</h2></div><div class="panel-body form-grid three">
        <label class="field">Photo size limit (MB)<input type="number" step="0.5" min="0.5" max="10" name="uploads.photoMB" value="${s.uploads.photoMB}"></label>
        <label class="field">Document size limit (MB)<input type="number" min="1" max="20" name="uploads.documentMB" value="${s.uploads.documentMB}"></label>
        <label class="field">Archived records kept for (years)<input type="number" min="1" max="50" name="retention.archivedYears" value="${s.retention.archivedYears}"><small>Archived records are never deleted automatically.</small></label>
        <label class="field">Probation reminder (days before)<input type="number" min="0" max="180" name="reminders.probationDays" value="${s.reminders.probationDays}"></label>
        <label class="field">Review reminder (days before)<input type="number" min="0" max="180" name="reminders.reviewDays" value="${s.reminders.reviewDays}"></label>
        <label class="field">Document expiry warning (days before)<input type="number" min="0" max="365" name="reminders.expiryDays" value="${s.reminders.expiryDays}"></label>
        <label class="field check"><input type="checkbox" name="optionalFields.birthPlace" ${s.optionalFields.birthPlace ? 'checked' : ''}> Ask for place of birth</label>
        <label class="field check"><input type="checkbox" name="optionalFields.civilStatus" ${s.optionalFields.civilStatus ? 'checked' : ''}> Ask for civil status</label>
        <label class="field check"><input type="checkbox" name="optionalFields.bloodType" ${s.optionalFields.bloodType ? 'checked' : ''}> Ask for blood type <small>Off by default. Turn on only for a defined purpose (e.g. emergency response); visible to HR Managers only.</small></label>
        <label class="field">Feb 29 birthdays and start dates, in other years<select name="celebrations.leapDay"><option value="feb28" ${(s.celebrations?.leapDay || 'feb28') === 'feb28' ? 'selected' : ''}>Celebrate on Feb 28</option><option value="mar1" ${s.celebrations?.leapDay === 'mar1' ? 'selected' : ''}>Celebrate on Mar 1</option></select></label>
        <input type="hidden" name="reminders.memoDays" value="${s.reminders.memoDays}"></div>
        </section>
      <div class="st-footer"><span>Changes apply across your organization.</span><span><button type="button" data-st-cancel>Cancel</button><button class="primary">Save settings</button></span></div></form>`);
    const form = document.querySelector('#settings-form');
    officeWifi(form);
    document.querySelector('.st-tabs').addEventListener('click', event => {
      const b = event.target.closest('[data-st-jump]'); if (!b) return;
      document.querySelectorAll('.st-tabs button').forEach(x => x.classList.toggle('active', x === b));
      document.getElementById(b.dataset.stJump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    form.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-add-req')) { collectReqs(); settings.documentRequirements.push({ id: '', name: '', category: 'Other', required: true, expires: false, restricted: false, providedBy: 'employee', dueDays: null, departments: [], classifications: [] }); drawSettings(); }
      if (b.dataset.del) { collectReqs(); settings.documentRequirements.splice(Number(b.dataset.del), 1); drawSettings(); }
      if (b.hasAttribute('data-accounts')) ctx.openAccounts();
      if (b.hasAttribute('data-st-cancel')) drawSettings();   // discard unsaved edits
    });
    form.onsubmit = async event => {
      event.preventDefault();
      collectReqs();
      const g = n => form.elements[n], list = n => g(n).value.split('\n').map(x => x.trim()).filter(Boolean);
      const next = { ...settings,
        company: { name: g('company.name').value.trim(), systemTitle: g('company.systemTitle').value.trim(), theme: g('company.theme').value, sssEmployerNo: g('company.sssEmployerNo').value.trim(), philhealthEmployerNo: g('company.philhealthEmployerNo').value.trim(), pagibigEmployerNo: g('company.pagibigEmployerNo').value.trim(), egovFee: Number(g('company.egovFee').value || 0), leaveVerifiedName: g('company.leaveVerifiedName').value.trim(), leaveVerifiedTitle: g('company.leaveVerifiedTitle').value.trim(), leaveApprovedName: g('company.leaveApprovedName').value.trim(), leaveApprovedTitle: g('company.leaveApprovedTitle').value.trim() },
        departments: list('departments'), positions: list('positions'), classifications: list('classifications'),
        idFormat: { prefix: g('idFormat.prefix').value.trim().toUpperCase(), includeYear: g('idFormat.includeYear').checked, digits: Number(g('idFormat.digits').value) },
        uploads: { photoMB: Number(g('uploads.photoMB').value), documentMB: Number(g('uploads.documentMB').value) },
        reminders: { probationDays: Number(g('reminders.probationDays').value), reviewDays: Number(g('reminders.reviewDays').value), expiryDays: Number(g('reminders.expiryDays').value), memoDays: Number(g('reminders.memoDays').value) },
        optionalFields: { birthPlace: g('optionalFields.birthPlace').checked, civilStatus: g('optionalFields.civilStatus').checked, bloodType: g('optionalFields.bloodType').checked },
        retention: { archivedYears: Number(g('retention.archivedYears').value) },
        celebrations: { leapDay: g('celebrations.leapDay').value },
      };
      try { settings = await api('/hr/settings', next); toast('Settings saved.'); await ctx.reloadContext(); drawSettings(); } catch (error) { toast(error.message); }
    };
  }
  // Office Wi-Fi for time in / out: recognised by the office's internet address. Add it while on the office Wi-Fi.
  async function officeWifi(form) {
    const box = document.createElement('section'); box.className = 'panel st-panel'; box.id = 'st-wifi'; form.before(box);
    const draw = d => {
      const here = d.networks.some(n => n.ip === d.current);
      box.innerHTML = `<div class="st-head"><h2 class="st-wifi-title">${sIcon('wifi', 'st-wifi')}Office Wi-Fi for time in / out</h2><span class="st-chip ${d.networks.length ? 'ok' : ''}"><i></i>${d.networks.length ? 'Configured' : 'Not configured'}</span></div><div class="panel-body">
        <p class="legend">Limit time in and out to your office network. Off-site entries require a reason and HR or Admin approval.</p>
        <label class="field st-ip">This device's network address<input value="${ctx.esc(d.current || 'unknown')}" readonly></label>
        ${d.networks.length ? `<ul class="plain-list office-net-list">${d.networks.map(n => `<li><span><strong>${ctx.esc(n.label)}</strong> · ${ctx.esc(n.ip)} <small>added by ${ctx.esc(n.addedBy)}</small>${n.ip === d.current ? ' <span class="badge">✓ This network</span>' : ''}</span><button type="button" class="small danger" data-net-remove="${ctx.esc(n.ip)}">Remove</button></li>`).join('')}</ul>` : `<p class="st-warn">${sIcon('info')}No office network saved. Time in / out is currently unrestricted.</p>`}
        ${here ? '' : '<div class="st-wifi-add"><button type="button" class="primary" data-net-add>Add this network as office Wi-Fi</button><small>Connect to office Wi-Fi before adding. Add the network again if your public address changes.</small></div>'}
        <p class="form-error hidden" role="alert" data-net-error></p></div>`;
    };
    const show = async body => {
      try { draw(await ctx.api('/office-networks', body)); }
      catch (error) { const e = box.querySelector('[data-net-error]'); if (e) { e.textContent = error.message; e.classList.remove('hidden'); } else ctx.toast(error.message); }
    };
    box.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-net-add')) show({ action: 'add-current', label: 'Office Wi-Fi' });
      if (b.dataset.netRemove && window.confirm(`Remove ${b.dataset.netRemove}? Time in from that network will need Out of office.`)) show({ action: 'remove', ip: b.dataset.netRemove });
    });
    await show();
  }
  function collectReqs() {
    const slug = s => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'requirement';
    const taken = new Set();
    settings.documentRequirements = [...document.querySelectorAll('#req-rows tr')].map((tr, i) => {
      const old = settings.documentRequirements[i] || {}, v = k => tr.querySelector(`[data-k="${k}"]`);
      const name = v('name').value.trim();
      let id = old.id || slug(name); while (taken.has(id)) id = `${id}-2`; taken.add(id);
      const split = s => s.split(',').map(x => x.trim()).filter(Boolean);
      return { id, name, category: v('category').value.trim() || 'Other', required: v('required').checked, expires: v('expires').checked, restricted: v('restricted').checked, providedBy: v('providedBy').value === 'company' ? 'company' : 'employee', dueDays: v('dueDays').value === '' ? null : Number(v('dueDays').value), departments: split(v('departments').value), classifications: split(v('classifications').value) };
    });
  }
  return { datasheets, settingsPage };
}
