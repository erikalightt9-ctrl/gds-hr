const labels = { personal: 'Personal Information', employment: 'Employment', government: 'Government IDs', attendance: 'Attendance', leave: 'Leave', payroll: 'Payroll', bank: 'Bank Details', loans: 'Loans', documents: 'Documents', emergency: 'Emergency Contact', audit: 'Audit History' };
const fields = {
  personal: ['lastName', 'firstName', 'middleName', 'suffix', 'sex', 'birthDate', 'civilStatus', 'nationality', 'mobile', 'personalEmail', 'address'],
  employment: ['position', 'employmentStatus', 'regularizationDate', 'employmentType', 'supervisor', 'workLocation', 'businessEmail', 'employeeStatus'],
  government: ['sss', 'philHealth', 'pagIbig', 'tin', 'otherId', 'expiry'],
  emergency: ['name', 'relationship', 'contact', 'alternateContact', 'address'],
  attendance: ['scheduleEnd', 'hoursPerDay', 'mealBreakMinutes', 'graceMinutes', 'paidFrom', 'approvedLocation', 'latitude', 'longitude', 'radiusMeters', 'arrangement', 'policy'],
  payroll: ['basis', 'dailyRate', 'hourlyRate', 'frequency', 'schedule', 'status'], bank: ['name', 'accountName', 'accountNumber'],
};
const choices = { sex: ['Female', 'Male', 'Other'], employmentStatus: ['Probationary', 'Regular', 'Project-Based', 'Contractual', 'Seasonal', 'Other'], employmentType: ['Full-Time', 'Part-Time', 'Other'], employeeStatus: ['Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated', 'Inactive'], arrangement: ['Office', 'WFH', 'Hybrid'], paidFrom: ['actual', 'schedule'], frequency: ['monthly', 'semi-monthly'], basis: ['monthly', 'daily'], status: ['Active', 'Hold'] };
const numeric = ['hoursPerDay', 'mealBreakMinutes', 'graceMinutes', 'latitude', 'longitude', 'radiusMeters', 'dailyRate', 'hourlyRate'];
const documentTypes = ['Photo', 'Employment Contract', 'Government ID', 'Resume/CV', 'Birth Certificate', 'Tax', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Company ID', 'Medical', 'Leave Supporting', 'Disciplinary', 'Other HR'];
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayFields = ['scheduleStart', 'scheduleEnd', 'hoursPerDay', 'mealBreakMinutes', 'arrangement'];
const describeDay = s => [s.scheduleStart && `${s.scheduleStart}–${s.scheduleEnd || '?'}`, s.hoursPerDay != null && `${s.hoursPerDay} h`, s.mealBreakMinutes != null && `${s.mealBreakMinutes} min meal`, s.arrangement].filter(Boolean).join(' · ');
const title = key => ({ sss: 'SSS number', philHealth: 'PhilHealth number', pagIbig: 'Pag-IBIG number', tin: 'TIN number', hoursPerDay: 'Working hours / day', paidFrom: 'Paid time starts at (actual time in / schedule)', radiusMeters: 'Geofence radius (meters)', dailyRate: 'Daily rate override', hourlyRate: 'Hourly rate override', frequency: 'Payroll frequency', basis: 'Pay basis (blank = monthly)' })[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());

export function createProfileView(ctx) {
  const { api, esc, money, table, shell, heading, toast, refresh, editMaster, openRun, today } = ctx;
  let employeeId, profile, requestVersion = 0;
  let selectedCard = null;
  const display = value => value === null || value === undefined || value === '' ? 'Not set' : esc(value);
  const facts = entries => `<dl class="profile-facts">${entries.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${display(value)}</dd></div>`).join('')}</dl>`;
  function inputs(section, value) {
    return fields[section].map(key => {
      const v = value[key] ?? '', options = choices[key], type = numeric.includes(key) ? 'number' : /Date$/.test(key) || key === 'expiry' ? 'date' : key === 'scheduleEnd' ? 'time' : /Email$/.test(key) ? 'email' : 'text';
      return `<label class="field">${esc(title(key))}${key === 'position' ? ' (required)' : ''}${options ? `<select name="${key}"><option value="">Not set</option>${options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input name="${key}" type="${type}" ${key === 'position' ? 'required pattern=".*\\S.*" title="Enter the employee position."' : ''} ${type === 'number' ? 'step="any"' : 'maxlength="1000"'} value="${esc(v)}">`}</label>`;
    }).join('');
  }
  // Weekday overrides (Monday first); blank cells inherit the base schedule above.
  function dayScheduleInputs(daySchedules = []) {
    const cell = (day, key, value) => key === 'arrangement'
      ? `<select name="ds-${day}-${key}" aria-label="${weekdays[day]} arrangement"><option value="">Same</option>${choices.arrangement.map(o => `<option ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select>`
      : `<input name="ds-${day}-${key}" aria-label="${weekdays[day]} ${esc(title(key))}" type="${key.startsWith('schedule') ? 'time' : 'number'}" ${key.startsWith('schedule') ? '' : `step="any" min="${key === 'hoursPerDay' ? 1 : 0}" max="${key === 'hoursPerDay' ? 16 : 240}"`} value="${esc(value ?? '')}">`;
    const rows = [1, 2, 3, 4, 5, 6, 0].map(day => { const s = daySchedules.find(v => v.day === day) || {}; return [weekdays[day], ...dayFields.map(key => cell(day, key, s[key]))]; });
    return `<div class="panel-body"><h3>Day-specific schedules</h3><p class="legend">Only fill a day that differs from the schedule above. Blank cells use the base schedule; rest days come from the master record.</p>${table(['Day', 'Start', 'End', 'Regular hours', 'Meal break (min)', 'Arrangement'], rows)}</div>`;
  }
  function readDaySchedules(values) {
    const result = [];
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const entry = { day };
      for (const key of dayFields) {
        const raw = values[`ds-${day}-${key}`] ?? ''; delete values[`ds-${day}-${key}`];
        entry[key] = ['hoursPerDay', 'mealBreakMinutes'].includes(key) ? (raw === '' ? null : Number(raw)) : raw;
      }
      if (dayFields.some(key => entry[key] !== '' && entry[key] !== null)) result.push(entry);
    }
    return result;
  }
  function section(key) {
    if (!profile.readable.includes(key)) return `<div class="notice">${labels[key]} are restricted to authorized personnel.</div>`;
    const value = profile.sections[key] || {}, editable = profile.editable.includes(key);
    return `<section class="panel"><div class="panel-head"><h2>${labels[key]}</h2><span class="legend">${editable ? 'Changes are saved to the employee record' : 'Read only'}</span></div>${editable ? `<form data-profile-section="${key}"><div class="panel-body form-grid">${inputs(key, value)}</div>${key === 'attendance' ? dayScheduleInputs(value.daySchedules) : ''}<div class="panel-foot"><button class="primary" type="submit">Save ${labels[key].toLowerCase()}</button><span class="profile-save" role="status"></span></div></form>` : facts([...fields[key].map(k => [title(k), value[k]]), ...(value.daySchedules || []).map(s => [weekdays[s.day], describeDay(s)])])}</section>`;
  }
  const masterButton = () => ctx.canEditMaster() ? '<button class="small" data-profile-master>Update master record</button>' : '';
  const deleteButton = () => ctx.canEditMaster() ? '<button class="small danger" data-profile-delete>Delete profile</button>' : '';
  function content(tab) {
    const p = profile, e = p.employee;
    if (tab === 'personal') return facts([['Employee ID', e.id], ['Registered name', e.name], ['Age', p.derived.age === null ? null : `${p.derived.age} years`]]) + section('personal') + '<p class="legend">The registered name is maintained in the master record. Upload a Photo in Documents to add the employee portrait.</p>';
    if (tab === 'employment') return `<section class="panel"><div class="panel-head"><h2>Master employment record</h2>${masterButton()}</div>${facts([['Department', e.department], ['Joining date', e.startDate], ['End date', e.endDate], ['Service', p.derived.serviceMonths === null ? null : `${p.derived.serviceYears} years, ${p.derived.serviceMonths % 12} months`], ['Next anniversary', p.derived.nextAnniversary], ['Monthly salary', e.monthlySalary === null ? null : money(e.monthlySalary)], ['Schedule starts', e.scheduleStart], ['Rest days', e.restDays.map(i => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][i]).join(', ')], ['Payroll readiness', e.draft ? 'Draft — needs details' : 'Complete']])}</section>` + section('employment');
    if (tab === 'government' || tab === 'emergency') return section(tab);
    if (tab === 'attendance') return `<section class="panel"><div class="panel-head"><h2>Linked work schedule</h2>${masterButton()}</div>${facts([['Schedule starts', e.scheduleStart], ['Rest days', e.restDays.map(i => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]).join(', ') ]])}</section>` + section('attendance') + '<p class="legend">Blank hours and grace use approved company rules. Geofence settings describe the assigned location; manual attendance does not capture or verify GPS.</p>' + `<section class="panel"><div class="panel-head"><h2>Attendance records</h2><button data-nav="attendance" class="small">Open attendance</button></div>${table(['Date', 'Status', 'In / out', 'Approval'], p.attendance.slice().sort((a, b) => b.date.localeCompare(a.date)).map(a => [a.date, esc(a.status), `${a.timeIn || '—'} / ${a.timeOut || '—'}`, a.approved ? 'Approved' : 'Pending']))}</section>`;
    if (tab === 'leave') return `<section class="panel"><div class="panel-head"><h2>Leave credits</h2>${masterButton()}</div><p class="panel-body legend">Eligibility is assigned in the master record. Annual overrides apply from the specified year onward; blank entries inherit company policy. A zero-day override is supported.</p>${table(['Leave type', 'Entitled', 'Used / reserved', 'Remaining', 'Eligibility'], p.balances.map(b => [esc(b.name), b.entitled, b.used, b.available, b.eligible ? 'Eligible' : 'Not eligible']))}</section>` + (p.editable.includes('leave') ? `<section class="panel"><div class="panel-head"><h2>Individual entitlement</h2></div><form data-leave-override><div class="panel-body form-grid"><label class="field">Leave type<select name="typeId">${p.balances.map(b => `<option value="${esc(b.typeId)}">${esc(b.name)}</option>`).join('')}</select></label><label class="field">Annual days<input name="annualDays" type="number" min="0" max="366" step="0.5" required></label><label class="field">Effective year<input name="effectiveYear" type="number" min="2000" max="2200" value="${today().slice(0, 4)}" required></label><label class="field">Reason / policy basis<input name="remarks" maxlength="1000" value="${esc(p.sections.leave?.remarks || '')}"></label></div><div class="panel-foot"><button class="primary">Save entitlement</button></div></form>${table(['Type', 'Annual days', 'From year'], (p.sections.leave?.entitlements || []).map(v => [esc(p.balances.find(b => b.typeId === v.typeId)?.name), v.annualDays, v.effectiveYear]))}</section>` : '') + `<section class="panel"><div class="panel-head"><h2>Leave history</h2><button data-nav="leave" class="small">Open leave management</button></div>${table(['Dates', 'Type', 'Days', 'Status'], p.leaves.map(l => [`${l.startDate} → ${l.endDate}`, esc(p.balances.find(b => b.typeId === l.typeId)?.name), l.days, esc(l.status)]))}</section>`;
    if (tab === 'payroll') return facts([['Monthly salary', e.monthlySalary === null ? null : money(e.monthlySalary)], ['Daily rate', p.derived.dailyRate === null ? null : money(p.derived.dailyRate)], ['Hourly rate', p.derived.hourlyRate === null ? null : money(p.derived.hourlyRate)]]) + section('payroll') + '<p class="legend">Daily-paid employees earn their daily rate for each scheduled workday; rest days are unpaid and absences deduct whole days. Blank rate overrides use approved company divisors. Frequency must match approved payroll rules. A hold blocks posting until released. Contributions and tax below come from posted payroll calculations.</p>' + section('bank') + salaryDetails(p) + `<section class="panel"><div class="panel-head"><h2>Payroll history</h2><button data-nav="payroll" class="small">Open payroll</button></div>${table(['Cutoff', 'SSS', 'PhilHealth', 'Pag-IBIG', 'Tax', 'Net', ''], p.payroll.map(r => [`${r.start} → ${r.end}`, money(r.row.deductions.SSS), money(r.row.deductions.PhilHealth), money(r.row.deductions['Pag-IBIG']), money(r.row.deductions.tax), money(r.row.net), `<button class="small" data-profile-run="${esc(r.id)}">View</button>`]))}</section><section class="panel"><div class="panel-head"><h2>Adjustments and other deductions</h2></div>${table(['Date', 'Kind', 'Amount', 'Reason'], p.adjustments.map(a => [a.date, esc(a.kind), money(a.amount), esc(a.reason)]))}</section>`;
    if (tab === 'loans') return `<section class="panel"><div class="panel-head"><h2>Linked employee loans</h2><button data-nav="loans" class="small">Manage loans</button></div>${table(['Loan', 'Start date', 'Original', 'Monthly deduction', 'Balance', 'Terms left', 'Status'], p.loans.map(l => [esc(l.type), l.startDate, money(l.original), money(l.monthlyAmortization), money(l.balance), `${l.remainingTerms} / ${l.terms}`, l.balance <= 0 ? 'Paid' : l.authorized ? 'Active' : 'Pending authorization']))}<p class="panel-foot">Balances and remaining terms update when payroll is posted.</p></section>`;
    if (tab === 'documents') return `${p.editable.includes('personal') ? `<section class="panel"><div class="panel-head"><h2>Upload employee document</h2><span class="legend">PDF, PNG or JPEG · up to 5 MB</span></div><form data-document-upload><div class="panel-body form-grid"><label class="field">Document type<select name="type">${documentTypes.map(t => `<option>${t}</option>`).join('')}</select></label><label class="field">File<input name="file" type="file" accept="application/pdf,image/png,image/jpeg" required></label><label class="field">Expiry date<input type="date" name="expiry"></label><label class="field">Remarks<input name="remarks" maxlength="1000"></label></div><div class="panel-foot"><button class="primary">Upload document</button></div></form></section>` : ''}<section class="panel"><div class="panel-head"><h2>Employee documents</h2><span class="legend">Only documents available to your role appear</span></div>${table(['Document', 'Type', 'Uploaded / by', 'Expiry', 'Status', 'Remarks', ''], p.documents.map(d => [`<a href="/api/documents/${esc(d.id)}/content" target="_blank" rel="noopener">${esc(d.name)}</a>`, esc(d.type), `${esc(d.uploadedAt.slice(0, 10))}<br>${esc(d.uploadedBy)}`, d.expiry || '—', d.status === 'Active' && d.expiry && d.expiry < today() ? 'Expired' : d.status, esc(d.remarks), p.editable.includes('personal') ? `<button class="small" data-document-edit="${esc(d.id)}">Edit details</button>` : '']))}</section>`;
    return `<section class="panel"><div class="panel-head"><h2>Employee audit history</h2><span class="legend">Accessible events from the latest 1,000 system events</span></div>${table(['Time', 'Actor', 'Action', 'Section', 'Changes'], p.audit.map(a => [esc(new Date(a.at).toLocaleString()), esc(a.actor), esc(a.action), esc(a.kind), `<details><summary>Inspect</summary><pre>${esc(JSON.stringify({ before: a.before, after: a.after }, null, 2))}</pre></details>`]))}</section>`;
  }
  function salaryDetails(p) {
    const name = key => ({ SSS: 'SSS contribution', PhilHealth: 'PhilHealth contribution', 'Pag-IBIG': 'Pag-IBIG contribution', tax: 'Withholding tax', absence: 'Unpaid leave / absence', nsd: 'Night shift differential', thirteenth: '13th month pay', other: 'Other authorized deductions' })[key] || title(key);
    return '<section class="panel"><div class="panel-head"><h2>Salary computations and itemized deductions</h2></div>' + (p.payroll.length ? p.payroll.map(run => {
      const row = run.row;
      const deductions = Object.entries(row.deductions).filter(([key]) => key !== 'loans' && key !== 'other').map(([key, amount]) => [esc(name(key)), money(amount)]);
      const loans = row.loanDeductions || [], adjustments = (row.trace || []).filter(t => t.side === 'deductions' && t.component === 'other');
      deductions.push(...loans.map(l => [esc(l.type || 'Loan') + (l.reference ? ' · ' + esc(l.reference) : ''), money(l.amount)]));
      const loanRemainder = Math.round(((row.deductions.loans || 0) - loans.reduce((sum, l) => sum + l.amount, 0)) * 100) / 100;
      if (loanRemainder) deductions.push(['Other loan deductions', money(loanRemainder)]);
      deductions.push(...adjustments.map(t => [esc(t.formula), money(t.amount)]));
      const otherRemainder = Math.round(((row.deductions.other || 0) - adjustments.reduce((sum, t) => sum + t.amount, 0)) * 100) / 100;
      if (otherRemainder || !adjustments.length) deductions.push(['Other authorized deductions', money(otherRemainder)]);
      return `<details class="profile-pay-period"><summary>${esc(run.start)} — ${esc(run.end)}<span>Net pay · ${money(row.net)}</span></summary><div class="profile-pay-body">${facts([['Monthly salary', money(row.monthlySalary)], ['Daily rate', money(row.dailyRate)], ['Hourly rate', money(row.hourlyRate)]])}<h3>Earnings</h3>${table(['Component', 'Amount'], Object.entries(row.earnings).map(([key, value]) => [esc(name(key)), money(value)]))}<h3>Itemized deductions</h3>${table(['Deduction', 'Amount'], deductions)}<p class="profile-net">Gross ${money(row.gross)} − Deductions ${money(row.totalDeductions)} = <strong>Net pay ${money(row.net)}</strong></p><h3>Calculation details</h3>${table(['Date', 'Type', 'Component', 'Calculation / reason', 'Amount'], (row.trace || []).map(t => [esc(t.date || ''), esc(t.side), esc(name(t.component)), '<span class="profile-formula">' + esc(t.formula) + '</span>', money(t.amount)]))}</div></details>`;
    }).join('') : '<p class="panel-body legend">Salary calculations appear here after payroll is posted.</p>') + '</section>';
  }
  function consolidatedCards() {
    const groups = [
      ['personal', 'Personal Information', 'Personal details, contact information, and emergency contacts', ['personal', 'emergency'], '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>'],
      ['employment', 'Employment Details', 'Role, employment records, supporting files, and identification', ['employment', 'documents', 'government'], '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a24 24 0 0 0 18 0M12 11v4"/>'],
      ['work', 'Attendance', 'Work records, leave balances, salary computations, and deductions', ['attendance', 'leave', 'payroll', 'loans'], '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/>'],
      ['audit', 'Audit History', 'Record changes, responsible users, dates, and timestamps', ['audit'], '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7M12 7v5l3 2"/>'],
    ];
    const selected = groups.find(([id]) => id === selectedCard);
    if (selected) return `<section class="profile-group profile-detail"><div class="profile-detail-heading"><button type="button" data-profile-back>← Back to profile cards</button><h2 tabindex="-1" id="profile-detail-title">${selected[1]}</h2><p>${selected[2]}</p></div><div class="profile-group-body">${selected[3].map(key => `<div class="profile-subsection" data-profile-subsection="${key}">${content(key)}</div>`).join('')}</div></section>`;
    return '<div class="profile-box-grid">' + groups.map(([id, name, description, , paths]) => `<button type="button" class="profile-box" data-profile-open="${id}"><span class="profile-group-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg></span><span class="profile-group-title"><strong>${name}</strong><small>${description}</small></span></button>`).join('') + '</div>';
  }
  async function draw() {
    const version = ++requestVersion;
    const loaded = await api(`/employees/${encodeURIComponent(employeeId)}/profile`);
    if (version !== requestVersion || !ctx.isActive()) return;
    profile = loaded;
    const e = profile.employee, employment = profile.sections.employment || {}, photo = profile.documents.find(d => d.type === 'Photo' && d.status === 'Active');
    shell(heading('Employee profile', 'One employee record, connected across your HR workspace.', '<button class="small" data-nav="employees">← Employee directory</button>') + `<div id="employee-profile"><section class="panel profile-header"><div class="photo-slot">${photo ? `<img class="employee-photo" src="/api/documents/${esc(photo.id)}/content" alt="Photo of ${esc(e.name)}">` : `<span class="employee-photo initials">${esc(e.name.slice(0, 1))}</span>`}${profile.editable.includes('personal') ? `<label class="photo-upload">${photo ? 'Change photo' : 'Upload photo'}<input type="file" accept="image/png,image/jpeg" data-photo-upload class="photo-input"></label>` : ''}</div><div><span class="eyebrow">${esc(e.id)}</span><h2>${esc(e.name)}</h2><p>${esc(employment.position || 'Position required — update Employment')} · ${esc(e.department || 'Department not set')}</p><div class="profile-summary"><span>${esc(employment.employmentStatus || 'Employment status not set')}</span><span>${esc(employment.employeeStatus || (e.active ? 'Active' : 'Inactive'))}</span><span>Joined ${esc(e.startDate || 'not set')}</span><span>${profile.derived.serviceMonths === null ? 'Service not set' : `${profile.derived.serviceYears} years, ${profile.derived.serviceMonths % 12} months`}</span></div></div><div class="profile-header-actions">${masterButton()}${deleteButton()}</div></section><div class="profile-content">${!employment.position?.trim() ? '<div class="notice" role="status">Position is required. Open Employment Details to complete this profile.</div>' : ''}${consolidatedCards()}</div></div>`);
    const root = document.querySelector('#employee-profile');
    root.onclick = async event => {
      const b = event.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.profileOpen) { selectedCard = b.dataset.profileOpen; await draw(); document.querySelector('#profile-detail-title')?.focus(); return; }
        if (b.hasAttribute('data-profile-back')) { const previous = selectedCard; selectedCard = null; await draw(); document.querySelector(`[data-profile-open="${previous}"]`)?.focus(); return; }
        
        if (b.hasAttribute('data-profile-master')) editMaster(employeeId);
        if (b.hasAttribute('data-profile-delete')) {
          // Two-step confirmation, matching record deletion elsewhere in the workspace.
          if (b.dataset.confirm !== 'yes') { b.dataset.confirm = 'yes'; b.textContent = `Confirm: delete ${profile.employee.name}`; return; }
          b.disabled = true;
          try { await api(`/records/employees?id=${encodeURIComponent(employeeId)}`, null, 'DELETE'); await refresh(); toast('Employee profile deleted; audit history retained.'); ctx.openDirectory(); }
          catch (error) { b.disabled = false; b.dataset.confirm = ''; b.textContent = 'Delete profile'; throw error; }
          return;
        }
        if (b.dataset.profileRun) await openRun(b.dataset.profileRun);
        if (b.dataset.documentEdit) {
          const d = profile.documents.find(d => d.id === b.dataset.documentEdit);
          const panel = document.createElement('div'); panel.className = 'panel panel-body';
          panel.innerHTML = `<h3>Edit ${esc(d.name)}</h3><form data-document-update="${esc(d.id)}"><div class="form-grid"><label class="field">Expiry<input name="expiry" type="date" value="${esc(d.expiry)}"></label><label class="field">Status<select name="status"><option ${d.status === 'Active' ? 'selected' : ''}>Active</option><option ${d.status === 'Archived' ? 'selected' : ''}>Archived</option></select></label><label class="field">Remarks<input name="remarks" value="${esc(d.remarks)}" maxlength="1000"></label></div><button class="primary">Save document details</button></form>`;
          root.querySelector('[data-document-update]')?.closest('.panel').remove(); root.querySelector('.profile-content').prepend(panel); panel.scrollIntoView({ behavior: 'smooth' });
        }
      } catch (error) { toast(error.message); }
    };
    root.onchange = async event => {
      const input = event.target.closest('[data-photo-upload]'); if (!input) return;
      const file = input.files[0]; input.value = '';
      try {
        if (!file || !['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a PNG or JPEG photo up to 5 MB.');
        const target = employeeId, previous = profile.documents.filter(d => d.type === 'Photo' && d.status === 'Active');
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read the photo.')); reader.readAsDataURL(file); });
        await api(`/employees/${encodeURIComponent(target)}/documents`, { type: 'Photo', name: file.name, mime: file.type, data, expiry: '', remarks: 'Profile photo' });
        // Keep one current portrait; earlier photos stay in Documents as archived history.
        for (const d of previous) await api(`/documents/${d.id}`, { expiry: d.expiry || '', remarks: d.remarks || '', status: 'Archived' });
        if (ctx.isActive() && employeeId === target) await draw(); toast('Photo updated.');
      } catch (error) { toast(error.message); }
    };
    root.onsubmit = async event => {
      event.preventDefault(); const form = event.target, button = form.querySelector('button[type="submit"], button.primary'); if (!button) return;
      const targetEmployeeId = employeeId;
      button.disabled = true;
      try {
        const values = Object.fromEntries(new FormData(form));
        if (form.dataset.profileSection) {
          for (const key of numeric) if (key in values) values[key] = values[key] === '' ? null : Number(values[key]);
          if (form.dataset.profileSection === 'payroll' && !values.status) values.status = 'Active';
          if (form.dataset.profileSection === 'attendance') values.daySchedules = readDaySchedules(values);
          await api(`/employees/${encodeURIComponent(targetEmployeeId)}/profiles/${form.dataset.profileSection}`, values);
        } else if (form.hasAttribute('data-leave-override')) {
          const entry = { typeId: values.typeId, annualDays: Number(values.annualDays), effectiveYear: Number(values.effectiveYear) };
          const entitlements = (profile.sections.leave?.entitlements || []).filter(v => v.typeId !== entry.typeId || v.effectiveYear !== entry.effectiveYear);
          await api(`/employees/${encodeURIComponent(targetEmployeeId)}/profiles/leave`, { entitlements: [...entitlements, entry], remarks: values.remarks });
        } else if (form.hasAttribute('data-document-upload')) {
          const file = form.elements.file.files[0];
          if (!file || file.size > 5 * 1024 * 1024) throw new Error('Choose a PDF, PNG or JPEG file up to 5 MB.');
          const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read the file.')); reader.readAsDataURL(file); });
          await api(`/employees/${encodeURIComponent(targetEmployeeId)}/documents`, { type: values.type, name: file.name, mime: file.type, data, expiry: values.expiry, remarks: values.remarks });
        } else if (form.dataset.documentUpdate) await api(`/documents/${form.dataset.documentUpdate}`, values);
        await refresh(); if (ctx.isActive() && employeeId === targetEmployeeId) await draw(); toast('Employee record saved.');
      } catch (error) { toast(error.message); button.disabled = false; }
    };
  }
  return { open: async (id) => { employeeId = id; selectedCard = null; await draw(); }, redraw: draw };
}
