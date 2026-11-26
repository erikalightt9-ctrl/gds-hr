// Trainings: list and month calendar, schedule form, participants with separate registration / attendance /
// completion, and certificates filed in the employee's 201 documents. Times are shown in Asia/Manila.
import { fmtDate, readFile } from './hr-common.js';

export function createTrainings(ctx) {
  const { api, esc, table, badge, toast, openDialog, dialog, shell, heading } = ctx;
  let view = 'list', month = ctx.today().slice(0, 7), trainings = [], people = [];
  const STATUS = { scheduled: ['Scheduled', 'pending'], completed: ['Completed', ''], cancelled: ['Cancelled', 'neutral'] };

  async function render(openId = null) {
    shell(heading('Trainings', 'Loading…') + '<div class="loading">Loading trainings…</div>');
    [trainings, people] = await Promise.all([api('/hr/trainings'), ctx.context().can.manage ? api('/hr/employees') : Promise.resolve([])]);
    draw();
    if (openId) detail(openId);
  }
  function calendar() {
    const [y, m] = month.split('-').map(Number), first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = first.getUTCDay();
    const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
    const label = first.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `<div class="cal-head"><button class="small" data-month="-1">‹</button><strong>${label}</strong><button class="small" data-month="1">›</button></div><div class="calendar">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-dow">${d}</div>`).join('')}${cells.map(d => d ? `<div class="cal-day ${d === ctx.today() ? 'today' : ''}"><span>${Number(d.slice(8))}</span>${trainings.filter(t => d >= t.date && d <= (t.endDate || t.date)).map(t => `<button class="cal-event ${t.status}" data-open="${t.id}">${t.startTime ? `${t.startTime} ` : ''}${esc(t.title)}</button>`).join('')}</div>` : '<div class="cal-day empty"></div>').join('')}</div>`;
  }
  // Nov 25, 2026 design: red hero with books and cap, List / Calendar, KPI cards, two tables with empty states.
  const tic = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const TI = {
    cap: tic('<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5M22 9v6"/>'),
    check: tic('<path d="m6 12.5 4 4 8-9"/>'),
    people: tic('<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2.3"/><circle cx="19" cy="10" r="2.3"/><path d="M7.5 20c0-2.8 2-4.8 4.5-4.8s4.5 2 4.5 4.8M1.5 19c0-2.2 1.5-3.8 3.5-3.8M22.5 19c0-2.2-1.5-3.8-3.5-3.8"/>'),
    bars: tic('<path d="M6 20V12M12 20V6M18 20v-9"/>'),
    list: tic('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
    cal: tic('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01"/>'),
    box: tic('<rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M12 12v5M9.5 14.5 12 12l2.5 2.5"/>'),
    plus: tic('<path d="M12 5v14M5 12h14"/>'),
  };
  const HERO = '<svg viewBox="0 0 130 110" aria-hidden="true"><rect x="14" y="74" width="96" height="16" rx="4" fill="#f47b20"/><rect x="14" y="74" width="96" height="5" fill="#ffb36b"/><rect x="20" y="58" width="90" height="16" rx="4" fill="#2659e6"/><rect x="20" y="58" width="90" height="5" fill="#7aa2f5"/><rect x="10" y="88" width="104" height="14" rx="4" fill="#1f3a8a"/><rect x="104" y="90" width="8" height="10" fill="#fff"/><path d="m24 34 42-20 42 20-42 20Z" fill="#14306e"/><path d="M42 44v12c0 6 11 10 24 10s24-4 24-10V44l-24 11Z" fill="#1d3f8c"/><path d="M104 36v20" stroke="#f2b33d" stroke-width="3"/><circle cx="104" cy="58" r="4" fill="#f2b33d"/></svg>';
  const EMPTY_CAL = '<svg viewBox="0 0 120 100" aria-hidden="true"><rect x="14" y="18" width="80" height="66" rx="10" fill="#c9d7f3"/><rect x="14" y="18" width="80" height="18" rx="10" fill="#4f78c9"/><path d="M34 12v14M74 12v14" stroke="#14306e" stroke-width="6" stroke-linecap="round"/><g fill="#fff">' + [0, 1, 2, 3].map(c => [0, 1].map(r => `<rect x="${24 + c * 16}" y="${46 + r * 14}" width="10" height="8" rx="2"/>`).join('')).join('') + '</g><circle cx="90" cy="74" r="18" fill="#fff" stroke="#2659e6" stroke-width="5"/><path d="M90 64v11l7 4" stroke="#2659e6" stroke-width="5" stroke-linecap="round" fill="none"/></svg>';
  const EMPTY_PAST = '<svg viewBox="0 0 120 100" aria-hidden="true"><path d="M14 30a6 6 0 0 1 6-6h24l8 8h44a6 6 0 0 1 6 6v6H14z" fill="#4f78c9"/><path d="M10 44h92l-8 40a6 6 0 0 1-6 5H22a6 6 0 0 1-6-5z" fill="#7aa2f5"/><circle cx="90" cy="72" r="15" fill="#d7141a"/><path d="m84 66 12 12M96 66 84 78" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>';
  function draw() {
    const can = ctx.context().can, today = ctx.today();
    const upcoming = trainings.filter(t => t.status === 'scheduled' && (t.endDate || t.date) >= today).sort((a, b) => a.date.localeCompare(b.date)), past = trainings.filter(t => !upcoming.includes(t));
    const live = trainings.filter(t => t.status !== 'cancelled'), assigned = live.reduce((n, t) => n + (t.participants || 0), 0), done = live.reduce((n, t) => n + (t.completed || 0), 0);
    const rate = assigned ? Math.round(done / assigned * 100) : 0;
    const rows = list => list.map(t => `<tr><td><button class="link-button" data-open="${t.id}">${esc(t.title)}</button>${t.required ? '<small>Required</small>' : ''}</td><td>${fmtDate(t.date)}${t.endDate && t.endDate !== t.date ? ` – ${fmtDate(t.endDate)}` : ''}${t.startTime ? `<small>${t.startTime}${t.endTime ? `–${t.endTime}` : ''}</small>` : ''}</td><td>${esc(t.facilitator || '—')}</td><td>${esc(t.venue || (t.meetingLink ? 'Online' : '—'))}</td><td>${t.participants} assigned<small>${t.confirmed} confirmed · ${t.attended} attended · ${t.completed} completed</small></td><td>${badge(...STATUS[t.status])}</td></tr>`).join('');
    const tableOf = (icon, title, list, whenLabel, empty, emptyText) => `<section class="dp-panel trn-panel"><h2 class="trn-title">${icon}${title}</h2><div class="dp-table"><table><thead><tr><th>Training</th><th>${whenLabel}</th><th>Facilitator</th><th>Venue</th><th>Participants</th><th>Status</th></tr></thead><tbody>${rows(list)}</tbody></table>${list.length ? '' : `<div class="dp-empty trn-empty">${empty}<strong>Nothing here yet</strong><span>${emptyText}</span></div>`}</div></section>`;
    const kpi = (tone, icon, value, label) => `<div class="trn-kpi trn-${tone}"><span>${icon}</span><div><strong>${value}</strong><small>${label}</small></div></div>`;
    shell(`<div class="dp trn"><section class="dp-hero trn-hero"><span class="trn-hero-art">${HERO}</span><div class="dp-hello"><span>People Operations</span><h1>Trainings</h1><p>Schedule trainings, assign employees and record attendance and completion.</p></div>${can.manage ? `<button class="dp-new" data-new>${TI.plus}Add Training</button>` : ''}</section>
      <div class="trn-switch" role="tablist"><button role="tab" data-view="list" class="${view === 'list' ? 'on' : ''}" aria-selected="${view === 'list'}">${TI.list}List</button><button role="tab" data-view="calendar" class="${view === 'calendar' ? 'on' : ''}" aria-selected="${view === 'calendar'}">${TI.cal}Calendar</button></div>
      <div class="trn-kpis">${kpi('blue', TI.cap, upcoming.length, 'Upcoming Trainings')}${kpi('green', TI.check, trainings.filter(t => t.status === 'completed').length, 'Completed')}${kpi('orange', TI.people, assigned, 'Total Participants')}${kpi('violet', TI.bars, `${rate}%`, 'Completion Rate')}</div>
      ${view === 'calendar' ? `<section class="dp-panel">${calendar()}</section>` : `${tableOf(TI.cal, 'Upcoming Trainings', upcoming, 'When (Date &amp; Time)', EMPTY_CAL, 'No upcoming trainings.')}${tableOf(TI.box, 'Past and Cancelled', past, 'When', EMPTY_PAST, 'None yet.')}`}</div>`);
    document.querySelector('.content').addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.dataset.view) { view = b.dataset.view; draw(); }
      if (b.dataset.month) { const [y, m] = month.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + Number(b.dataset.month), 1)); month = d.toISOString().slice(0, 7); draw(); }
      if (b.hasAttribute('data-new')) editor(null);
      if (b.dataset.open) detail(b.dataset.open);
    });
  }
  function editor(t) {
    const v = t || { title: '', description: '', facilitator: '', date: ctx.today(), endDate: '', startTime: '09:00', endTime: '12:00', venue: '', meetingLink: '', required: false, audience: '', status: 'scheduled' };
    // Training window (Nov 26, 2026 design): navy title band with a graduation cap, 'Training Information' and 'Schedule
    // Details' cards with light-blue headers, icon inputs, Cancel and red Save Training. Same fields and saving.
    const g = p => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
    const I = { people: g('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5c1.9.8 3 2.9 3 5.5"/>'), person: g('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'), cal: g('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01"/>'), clock: g('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'), pin: g('<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>'), link: g('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), flag: g('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'), info: g('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>'), undo: g('<path d="M4 4v6h6"/><path d="M5 10a8 8 0 1 1 1.6 6.4"/>'), save: g('<path d="M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1Z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>') };
    const req = ' <b class="trf-req">*</b>', inp = (icon, html) => `<span class="trf-in">${icon}${html}</span>`;
    openDialog(t ? 'Edit Training' : 'Add Training', `<form id="training-form"><div class="dialog-body trf"><p class="trf-sub">Record employee training and development details. Times are in Philippine time (Asia/Manila).</p><div id="tr-error" class="form-error hidden" role="alert"></div>
      <section class="trf-card"><h3>${I.people}Training Information</h3><div class="trf-grid">
        <label class="trf-field"><span>Title${req}</span><input name="title" required maxlength="200" value="${esc(v.title)}" placeholder="Enter training title…"></label>
        <label class="trf-field trf-tall"><span>Description</span><textarea name="description" rows="3" maxlength="5000" placeholder="Provide a brief description of the training…">${esc(v.description)}</textarea></label>
        <label class="trf-field"><span>Facilitator</span>${inp(I.person, `<input name="facilitator" maxlength="200" value="${esc(v.facilitator)}" placeholder="Enter facilitator name…">`)}</label>
        <label class="trf-field"><span>Intended Participants</span>${inp(I.people, `<input name="audience" maxlength="300" value="${esc(v.audience)}" placeholder="e.g. All new hires, Admin department">`)}</label>
      </div></section>
      <section class="trf-card"><h3>${I.cal}Schedule Details</h3><div class="trf-grid trf-four">
        <label class="trf-field"><span>Date${req}</span>${inp(I.cal, `<input type="date" name="date" required value="${esc(v.date)}">`)}</label>
        <label class="trf-field"><span title="For trainings over several days">End Date (optional)</span>${inp(I.cal, `<input type="date" name="endDate" value="${esc(v.endDate)}">`)}</label>
        <label class="trf-field"><span>Start Time</span>${inp(I.clock, `<input type="time" name="startTime" value="${esc(v.startTime)}">`)}</label>
        <label class="trf-field"><span>End Time</span>${inp(I.clock, `<input type="time" name="endTime" value="${esc(v.endTime)}">`)}</label>
      </div><div class="trf-grid">
        <label class="trf-field"><span>Venue</span>${inp(I.pin, `<input name="venue" maxlength="300" value="${esc(v.venue)}" placeholder="Enter training venue…">`)}</label>
        <label class="trf-field"><span>Online Meeting Link (if applicable)</span>${inp(I.link, `<input type="url" name="meetingLink" maxlength="500" value="${esc(v.meetingLink)}" placeholder="https://">`)}</label>
        <label class="trf-field"><span>Status${req}</span>${inp(I.flag, `<select name="status">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}</label>
        <label class="trf-check"><input type="checkbox" name="required" ${v.required ? 'checked' : ''}> Required Training <i title="Required trainings are expected of every participant assigned to them.">${I.info}</i></label>
      </div></section></div>
      <div class="dialog-foot trf-foot"><button type="button" class="trf-cancel" data-close>${I.undo}Cancel</button><button class="trf-save">${I.save}Save Training</button></div></form>`);
    dialog.classList.add('trf-dialog');
    const form = dialog.querySelector('#training-form');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = Object.fromEntries(new FormData(form)); f.required = form.elements.required.checked;
      try { const saved = await api(t ? `/hr/trainings/${t.id}` : '/hr/trainings', f); toast('Training saved.'); await render(saved.id); }
      catch (error) { const box = form.querySelector('#tr-error'); box.textContent = error.message; box.classList.remove('hidden'); }
    };
  }
  async function detail(id) {
    try {
      const t = await api(`/hr/trainings/${id}`), assigned = new Set(t.participants.map(p => p.employeeId)), free = people.filter(p => !p.archived && !assigned.has(p.id));
      const sel = (p, key, values) => t.canEdit ? `<select data-p="${esc(p.employeeId)}" data-k="${key}" aria-label="${key}">${values.map(v => `<option ${v === p[key] ? 'selected' : ''}>${v}</option>`).join('')}</select>` : esc(p[key]);
      openDialog(t.title, `<div class="dialog-body">
        <p class="sub">${badge(...STATUS[t.status])} ${fmtDate(t.date)}${t.startTime ? ` · ${t.startTime}${t.endTime ? `–${t.endTime}` : ''} (Manila time)` : ''}${t.facilitator ? ` · ${esc(t.facilitator)}` : ''}${t.required ? ' · required' : ''}</p>
        ${t.venue ? `<p>📍 ${esc(t.venue)}</p>` : ''}${t.meetingLink ? `<p>🔗 <a href="${esc(t.meetingLink)}" target="_blank" rel="noopener noreferrer">${esc(t.meetingLink)}</a></p>` : ''}${t.description ? `<p class="memo-body">${esc(t.description)}</p>` : ''}
        <h3 class="spaced">Participants (${t.participants.length})</h3>
        ${t.canEdit ? `<div class="assign-row"><select id="tr-add" multiple size="5" aria-label="Employees to assign">${free.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.department || '')}</option>`).join('')}</select><div class="actions"><button class="small primary" data-assign>Assign selected</button>${ctx.context().departments.length ? `<select id="tr-dept" aria-label="Assign a whole department"><option value="">Whole department…</option>${ctx.context().departments.map(d => `<option>${esc(d)}</option>`).join('')}</select>` : ''}</div></div>` : ''}
        ${table(['Employee', 'Department', 'Registration', 'Attendance', 'Completion', 'Certificate', ''], t.participants.map(p => [esc(p.name), esc(p.department || '—'), sel(p, 'registration', ['assigned', 'confirmed', 'declined']), sel(p, 'attendance', ['pending', 'attended', 'absent']), sel(p, 'completion', ['not-started', 'completed', 'incomplete']), p.certificateDocId ? `<a href="/api/hr/documents/${p.certificateDocId}/content" target="_blank" rel="noopener">View</a>` : t.canEdit ? `<label class="small-file">Upload<input type="file" data-cert="${esc(p.employeeId)}" accept="application/pdf,image/png,image/jpeg" hidden></label>` : '—', t.canEdit && p.attendance !== 'attended' && p.completion !== 'completed' ? `<button class="small" data-remove="${esc(p.employeeId)}">Remove</button>` : '']), 'No participants assigned yet.')}
        <p class="legend">Registration, attendance and completion are recorded separately. Completion needs attendance first. Certificates are filed in the employee's 201 documents.</p></div>`,
        `<div class="dialog-foot">${t.canEdit ? '<button data-edit-t>Edit training</button><button class="danger" data-delete-t>Delete</button>' : ''}<button data-close>Close</button></div>`);
      const box = dialog;
      box.querySelector('.dialog-body').addEventListener('change', async event => {
        const el = event.target;
        try {
          if (el.dataset.p) { await api(`/hr/trainings/${id}/participants/${encodeURIComponent(el.dataset.p)}`, { [el.dataset.k]: el.value }); toast('Saved.'); }
          if (el.id === 'tr-dept' && el.value) { const ids = people.filter(p => !p.archived && p.status === 'Active' && p.department === el.value && !assigned.has(p.id)).map(p => p.id); if (!ids.length) { toast('Everyone in that department is already assigned.'); return; } await api(`/hr/trainings/${id}/participants`, { employeeIds: ids }); toast(`${ids.length} assigned.`); await detail(id); }
          if (el.dataset.cert) {
            const file = el.files[0]; if (!file) return;
            const doc = await api(`/hr/employees/${encodeURIComponent(el.dataset.cert)}/documents`, { requirementId: 'training-cert', name: file.name, mime: file.type, data: await readFile(file), remarks: `Certificate: ${t.title}` });
            await api(`/hr/trainings/${id}/participants/${encodeURIComponent(el.dataset.cert)}`, { certificateDocId: doc.id }); toast('Certificate filed.'); await detail(id);
          }
        } catch (error) { toast(error.message); await detail(id); }
      });
      box.querySelector('.dialog-body').addEventListener('click', async event => {
        const b = event.target.closest('button'); if (!b) return;
        try {
          if (b.hasAttribute('data-assign')) { const ids = [...box.querySelector('#tr-add').selectedOptions].map(o => o.value); if (!ids.length) { toast('Choose employees to assign.'); return; } await api(`/hr/trainings/${id}/participants`, { employeeIds: ids }); toast(`${ids.length} assigned.`); await detail(id); }
          if (b.dataset.remove) { await api(`/hr/trainings/${id}/participants`, { employeeIds: [b.dataset.remove], remove: true }); await detail(id); }
        } catch (error) { toast(error.message); }
      });
      box.querySelector('.dialog-foot').onclick = async event => {
        try {
          if (event.target.closest('[data-edit-t]')) editor(t);
          if (event.target.closest('[data-delete-t]') && window.confirm('Delete this training?')) { await api(`/hr/trainings/${id}`, null, 'DELETE'); dialog.close(); toast('Training deleted.'); await render(); }
        } catch (error) { toast(error.message); }
      };
    } catch (error) { toast(error.message); }
  }
  return { render, create: () => editor(null) };
}
