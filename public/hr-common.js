// Shared pieces for the HR 201 screens: badges, progress bars, file reading and the Add / Edit Employee form.
export const DOC_BADGE = { Missing: 'rejected', Rejected: 'rejected', Expired: 'rejected', Submitted: 'pending', 'Under Review': 'pending', Verified: '', 'Not Applicable': 'neutral', 'Expiring soon': 'pending' };
export const fmtDate = d => (d ? new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export function readFile(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = () => reject(new Error('The file could not be read.')); r.readAsDataURL(file); });
}
export const progress = (percent, label = '') => `<span class="hr-progress" role="img" aria-label="${percent}% complete"><span class="hr-progress-bar w${Math.round(percent / 5) * 5}"></span></span><small>${label || `${percent}%`}</small>`;
export const initials = name => String(name || '?').replace(/,/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();

// ---------- Employee form ----------
const SECTIONS = ctx => [
  ['Personal information', [
    ['personal.firstName', 'First name', 'text', { required: true }], ['personal.middleName', 'Middle name'], ['personal.lastName', 'Last name', 'text', { required: true }], ['personal.suffix', 'Suffix', 'text', { placeholder: 'Jr., III' }],
    ['personal.preferredName', 'Preferred name'], ['personal.sex', 'Sex', 'select', { options: ['', 'Female', 'Male', 'Other'] }], ['personal.birthDate', 'Date of birth', 'date'],
    ...(ctx.optionalFields.birthPlace ? [['personal.birthPlace', 'Place of birth']] : []), ...(ctx.optionalFields.civilStatus ? [['personal.civilStatus', 'Civil status', 'select', { options: ['', 'Single', 'Married', 'Widowed', 'Separated', 'Annulled'] }]] : []),
    ['personal.nationality', 'Nationality'], ...(ctx.optionalFields.bloodType ? [['personal.bloodType', 'Blood type (restricted)', 'select', { options: ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] }]] : []),
  ]],
  ['Contact information', [['contact.workEmail', 'Work email', 'email'], ['contact.personalEmail', 'Personal email', 'email'], ['contact.mobile', 'Mobile number', 'tel', { placeholder: '09171234567' }], ['contact.currentAddress', 'Current address', 'textarea'], ['contact.permanentAddress', 'Permanent address', 'textarea', { same: true }]]],
  ['Emergency contact', [['emergency.name', 'Contact person'], ['emergency.relationship', 'Relationship'], ['emergency.contact', 'Contact number', 'tel']]],
  ['Employment information', [
    ['employment.dateHired', 'Date hired', 'date', { required: true }], ['employment.department', 'Department', 'list', { required: true, list: ctx.departments }], ['employment.position', 'Position', 'list', { required: true, list: ctx.positions }],
    ['employment.supervisor', 'Immediate supervisor'], ['employment.workLocation', 'Work location'], ['employment.status', 'Status', 'select', { options: ['Active', 'Inactive', 'On Leave'] }],
    ['employment.classification', 'Employment classification', 'select', { required: true, options: ['', ...ctx.classifications] }], ['employment.contractStart', 'Contract start', 'date'], ['employment.contractEnd', 'Contract end', 'date'],
    ['employment.probationEnd', 'Probation end (reminder only)', 'date'], ['employment.reviewDate', 'Performance review date (reminder only)', 'date'], ['employeeNumber', 'Displayed employee number (optional)', 'text', { placeholder: 'Leave blank to use the generated number' }],
  ]],
  ...(ctx.can.sensitiveIds ? [['Government identifiers (restricted)', [['government.tin', 'TIN'], ['government.sss', 'SSS number'], ['government.philHealth', 'PhilHealth number'], ['government.pagIbig', 'Pag-IBIG MID']]]] : []),
];
const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj) ?? '';
export function employeeFormHtml(ctx, esc, values = {}, { isNew = true } = {}) {
  const lists = [];
  const control = ([path, title, type = 'text', opt = {}]) => {
    const id = `ef-${path.replace('.', '-')}`, v = get(values, path), req = opt.required ? 'required' : '', star = opt.required ? ' <span class="req">*</span>' : '';
    let input;
    if (type === 'select') input = `<select id="${id}" name="${path}" ${req}>${opt.options.map(o => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(o || '—')}</option>`).join('')}</select>`;
    else if (type === 'textarea') input = `<textarea id="${id}" name="${path}" rows="2" maxlength="500">${esc(v)}</textarea>${opt.same ? '<label class="inline-check"><input type="checkbox" data-same-address> Same as current address</label>' : ''}`;
    else if (type === 'list') { const listId = `${id}-list`; lists.push(`<datalist id="${listId}">${opt.list.map(o => `<option value="${esc(o)}"></option>`).join('')}</datalist>`); input = `<input id="${id}" name="${path}" list="${listId}" value="${esc(v)}" maxlength="120" ${req} autocomplete="off">`; }
    else input = `<input id="${id}" name="${path}" type="${type}" value="${esc(v)}" ${req} maxlength="${type === 'date' ? 10 : 200}" ${opt.placeholder ? `placeholder="${esc(opt.placeholder)}"` : ''} ${path.startsWith('government.') && String(v).includes('•') ? 'data-masked' : ''}>`;
    return `<label class="field" for="${id}">${esc(title)}${star}${input}</label>`;
  };
  return `<form id="employee-form" novalidate><div class="dialog-body">
    <div id="ef-errors" class="form-error hidden" role="alert"></div>
    ${isNew ? `<div class="photo-row"><span class="hr-avatar" id="ef-photo-preview">?</span><label class="button-like">Upload photo<input type="file" id="ef-photo" accept="image/png,image/jpeg" hidden></label><small>JPG or PNG, up to ${ctx.uploads.photoMB} MB.</small></div>` : ''}
    ${SECTIONS(ctx).map(([title, fields]) => `<fieldset class="form-section-box"><legend>${esc(title)}</legend><div class="form-grid">${fields.map(control).join('')}</div></fieldset>`).join('')}
    ${lists.join('')}
    <div id="ef-duplicates"></div>
  </div><div class="dialog-foot"><button type="button" data-ef-cancel>Cancel</button><button class="primary" type="submit">Save employee</button></div></form>`;
}
function collect(form) {
  const out = { personal: {}, contact: {}, emergency: {}, employment: {}, government: { tin: '', sss: '', philHealth: '', pagIbig: '' }, employeeNumber: '' };
  for (const el of form.querySelectorAll('[name]')) {
    const [group, key] = el.name.split('.');
    if (!key) out[group] = el.value.trim(); else out[group][key] = el.value.trim();
  }
  return out;
}
function clientErrors(v) {
  const errors = [];
  if (!v.personal.firstName) errors.push('First name is required.');
  if (!v.personal.lastName) errors.push('Last name is required.');
  if (!v.employment.dateHired) errors.push('Date hired is required.');
  if (!v.employment.department) errors.push('Department is required.');
  if (!v.employment.position) errors.push('Position is required.');
  if (!v.employment.classification) errors.push('Employment classification is required.');
  for (const k of ['workEmail', 'personalEmail']) if (v.contact[k] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.contact[k])) errors.push(`${k === 'workEmail' ? 'Work' : 'Personal'} email is not valid.`);
  if (v.personal.birthDate && v.personal.birthDate > new Date().toISOString().slice(0, 10)) errors.push('Date of birth cannot be in the future.');
  if (v.employment.contractEnd && v.employment.contractStart && v.employment.contractEnd < v.employment.contractStart) errors.push('Contract end is before contract start.');
  return errors;
}
// Opens the form; resolves after a successful save with the saved employee id.
export function openEmployeeForm({ api, esc, toast, openDialog, dialog, context }, { id = null, values = {}, title = 'Add employee', onSaved }) {
  openDialog(title, employeeFormHtml(context, esc, values, { isNew: !id }));
  dialog.classList.add('wide-dialog');
  const form = dialog.querySelector('#employee-form');
  let dirty = false, photo = null;
  form.addEventListener('input', () => { dirty = true; });
  const same = form.querySelector('[data-same-address]');
  same?.addEventListener('change', () => { if (same.checked) { form.elements['contact.permanentAddress'].value = form.elements['contact.currentAddress'].value; dirty = true; } });
  form.querySelector('#ef-photo')?.addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) { toast('Use a JPG or PNG photo.'); return; }
    if (file.size > context.uploads.photoMB * 1024 * 1024) { toast(`Photos can be up to ${context.uploads.photoMB} MB.`); return; }
    photo = { name: file.name, mime: file.type, data: await readFile(file) };
    const img = document.createElement('img'); img.alt = 'Photo preview'; img.src = URL.createObjectURL(file);
    form.querySelector('#ef-photo-preview').replaceChildren(img); dirty = true;
  });
  const close = () => { dialog.classList.remove('wide-dialog'); dialog.close(); };
  const cancel = () => { if (!dirty || window.confirm('Discard the changes you made to this employee?')) close(); };
  form.querySelector('[data-ef-cancel]').addEventListener('click', cancel);
  dialog.querySelector('.dialog-head [data-close]')?.replaceWith(Object.assign(document.createElement('button'), { className: 'small', textContent: '✕', type: 'button', ariaLabel: 'Close dialog', onclick: cancel }));
  dialog.oncancel = event => { event.preventDefault(); cancel(); };
  const save = async (confirmDuplicate = false) => {
    const value = collect(form), errors = clientErrors(value), box = form.querySelector('#ef-errors');
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    if (errors.length) { box.textContent = errors.join(' '); box.classList.remove('hidden'); form.querySelectorAll('[required]').forEach(el => { if (!el.value.trim()) el.setAttribute('aria-invalid', 'true'); }); box.scrollIntoView({ block: 'nearest' }); return; }
    box.classList.add('hidden');
    const submit = form.querySelector('[type=submit]'); submit.disabled = true; submit.textContent = 'Saving…';
    try {
      const result = await api(id ? `/hr/employees/${encodeURIComponent(id)}` : '/hr/employees', { ...value, ...(id ? {} : { confirmDuplicate }) });
      if (!id && result.duplicates?.length) {
        form.querySelector('#ef-duplicates').innerHTML = `<div class="notice"><strong>Possible duplicate record${result.duplicates.length > 1 ? 's' : ''}.</strong> ${result.duplicates.map(d => `${esc(d.number)} · ${esc(d.name)} (${esc(d.department || 'no department')})`).join('; ')}. Check before saving a new record.<br><button type="button" class="small" data-ef-anyway>Save as a new employee anyway</button></div>`;
        form.querySelector('[data-ef-anyway]').onclick = () => save(true);
        return;
      }
      const savedId = id || result.created.id;
      if (photo) await api(`/hr/employees/${encodeURIComponent(savedId)}/photo`, photo).catch(error => toast(`Saved, but the photo was not uploaded: ${error.message}`));
      dirty = false; close();
      toast(id ? 'Employee record updated.' : `Employee saved as ${result.created.number}.`);
      onSaved?.(savedId);
    } catch (error) { box.textContent = error.message; box.classList.remove('hidden'); box.scrollIntoView({ block: 'nearest' }); }
    finally { submit.disabled = false; submit.textContent = 'Save employee'; }
  };
  form.addEventListener('submit', event => { event.preventDefault(); save(false); });
}
