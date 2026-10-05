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
  function draw() {
    const can = ctx.context().can, today = ctx.today();
    const upcoming = trainings.filter(t => t.status === 'scheduled' && (t.endDate || t.date) >= today).sort((a, b) => a.date.localeCompare(b.date)), past = trainings.filter(t => !upcoming.includes(t));
    const rows = list => list.map(t => [`<button class="link-button" data-open="${t.id}">${esc(t.title)}</button>${t.required ? ' <small>required</small>' : ''}`, `${fmtDate(t.date)}${t.endDate && t.endDate !== t.date ? ` – ${fmtDate(t.endDate)}` : ''}${t.startTime ? `<small>${t.startTime}${t.endTime ? `–${t.endTime}` : ''}</small>` : ''}`, esc(t.facilitator || '—'), esc(t.venue || (t.meetingLink ? 'Online' : '—')), `${t.participants} assigned<small>${t.confirmed} confirmed · ${t.attended} attended · ${t.completed} completed</small>`, badge(...STATUS[t.status])]);
    shell(heading('Trainings', 'Schedule trainings, assign employees and record attendance and completion.', can.manage ? '<button class="primary" data-new>＋ Add training</button>' : '') +
      `<div class="tabs"><button data-view="list" class="${view === 'list' ? 'active' : ''}">List</button><button data-view="calendar" class="${view === 'calendar' ? 'active' : ''}">Calendar</button></div>` +
      (view === 'calendar' ? `<section class="panel panel-body">${calendar()}</section>` :
        `<section class="panel"><div class="panel-head"><h2>Upcoming</h2></div>${table(['Training', 'When (Manila time)', 'Facilitator', 'Venue', 'Participants', 'Status'], rows(upcoming), 'No upcoming trainings.')}</section><section class="panel"><div class="panel-head"><h2>Past and cancelled</h2></div>${table(['Training', 'When', 'Facilitator', 'Venue', 'Participants', 'Status'], rows(past), 'None yet.')}</section>`));
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
    openDialog(t ? 'Edit training' : 'Add training', `<form id="training-form"><div class="dialog-body"><div id="tr-error" class="form-error hidden" role="alert"></div><div class="form-grid">
      <label class="field full">Title<input name="title" required maxlength="200" value="${esc(v.title)}"></label>
      <label class="field full">Description<textarea name="description" rows="3" maxlength="5000">${esc(v.description)}</textarea></label>
      <label class="field">Facilitator<input name="facilitator" maxlength="200" value="${esc(v.facilitator)}"></label>
      <label class="field">Intended participants<input name="audience" maxlength="300" value="${esc(v.audience)}" placeholder="e.g. All new hires, Admin department"></label>
      <label class="field">Date<input type="date" name="date" required value="${esc(v.date)}"></label><label class="field">End date (multi-day, optional)<input type="date" name="endDate" value="${esc(v.endDate)}"></label>
      <label class="field">Start time<input type="time" name="startTime" value="${esc(v.startTime)}"></label><label class="field">End time<input type="time" name="endTime" value="${esc(v.endTime)}"></label>
      <label class="field">Venue<input name="venue" maxlength="300" value="${esc(v.venue)}"></label><label class="field">Online meeting link<input type="url" name="meetingLink" maxlength="500" value="${esc(v.meetingLink)}" placeholder="https://"></label>
      <label class="field check"><input type="checkbox" name="required" ${v.required ? 'checked' : ''}> Required training</label>
      <label class="field">Status<select name="status">${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${k === v.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <p class="legend full">Times are in Philippine time (Asia/Manila).</p></div></div><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save training</button></div></form>`);
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
