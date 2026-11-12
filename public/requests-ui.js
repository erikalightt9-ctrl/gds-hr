// Attendance reconsideration requests. Employee: file a request (forgot time in / out, failed office time in / out,
// off-site reconsideration; leave opens the existing leave form), follow its status, answer HR, cancel. HR / Admin:
// a review dashboard with counts, the day's record and clock events, and Review / Ask for information / Remark /
// Reject / Approve. Nothing changes in attendance until HR approves.
export const CATEGORIES = { 'forgot-in': 'Forgot to time in', 'forgot-out': 'Forgot to time out', failed: 'Failed or incorrect office time in / out', system: 'System error (app, website or server problem)', offsite: 'Off-site work reconsideration', other: 'Other reason' };
// Like a failed time in / out: transaction, requested times and a description of the problem.
export const PROBLEM_CATEGORIES = ['failed', 'system', 'other'];
export const STATUS = { pending: ['Pending HR approval', 'pending'], review: ['Under review', 'pending'], info: ['Additional information required', 'rejected'], approved: ['Approved', ''], rejected: ['Rejected', 'rejected'], cancelled: ['Cancelled by employee', 'neutral'] };
const nice = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const stamp = iso => (iso ? new Date(iso).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '');
const manilaToday = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() + 8 * 3600000 - n * 86400000).toISOString().slice(0, 10);
const times = r => `${r.timeIn || '—'} – ${r.timeOut || '—'}${r.endNextDay ? ' (next day)' : ''}`;
const ACTIONS = { submitted: 'Submitted', review: 'HR started the review', info: 'HR asked for more information', replied: 'Employee answered', remark: 'HR remark', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled by the employee' };
const historyHtml = (r, esc) => `<ol class="ar-history">${(r.history || []).map(h => `<li><strong>${esc(ACTIONS[h.action] || h.action)}</strong> · ${esc(stamp(h.at))} · ${esc(h.by)}${h.note ? `<br><span class="wrap">${esc(h.note)}</span>` : ''}</li>`).join('')}</ol>`;
const evidenceHtml = (r, esc) => (r.evidence || []).map((id, i) => `<a class="button small" href="/api/documents/${esc(id)}/content" target="_blank" rel="noopener">Evidence ${i + 1}</a>`).join(' ');

async function upload(api, file) {
  if (!file) return null;
  if (!['application/pdf', 'image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a PDF, PNG or JPEG up to 5 MB.');
  const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Unable to read the file.')); reader.readAsDataURL(file); });
  return (await api('/me/documents', { type: 'Leave Supporting', name: file.name, mime: file.type, data, expiry: '', remarks: 'Attendance request evidence' })).id;
}

// ---------- Employee ----------
const POLICY = 'All attendance corrections must be completed within three (3) days from the date the correction is requested. If the record remains uncorrected after this period and no valid reason is provided, the employee will be marked absent for the affected date.';
export function createEmployeeRequests({ api, esc, openDialog, dialog, toast, confirmBox, onLeave }) {
  let list = [];
  const badge = s => { const [label, tone] = STATUS[s] || [s, 'neutral']; return `<span class="badge ${tone}">${esc(label)}</span>`; };
  function render(box) {
    box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>My attendance requests</h2><p class="legend">Forgot to time in or out, a failed time in, a system error or another reason? File a request; HR approves it before your record changes.</p><p class="ar-policy">${esc(POLICY)}</p></div><button class="primary" data-ar-new>New request</button></div>
      ${list.length ? `<div class="ar-list">${list.map(r => `<article class="ar-item"><header><strong>${esc(r.reference)}</strong>${badge(r.status)}</header>
        <p><b>${esc(CATEGORIES[r.category])}</b> · ${esc(nice(r.date))} · requested ${esc(times(r))}</p>
        ${r.decision?.approved && r.status === 'approved' ? `<p>Approved: ${esc(times(r.decision.approved))}</p>` : ''}
        ${r.status === 'info' ? `<p class="oof-warn">HR asks: ${esc([...(r.history || [])].reverse().find(h => h.action === 'info')?.note || '')}</p>` : ''}
        ${r.decision?.remarks ? `<p class="legend">HR remarks: ${esc(r.decision.remarks)}</p>` : ''}
        <details><summary>History</summary>${historyHtml(r, esc)}</details>
        <div class="row-actions">${r.status === 'info' ? `<button class="small primary" data-ar-reply="${esc(r.id)}">Answer HR</button>` : ''}${['pending', 'review', 'info'].includes(r.status) ? `<button class="small" data-ar-cancel="${esc(r.id)}">Cancel request</button>` : ''}</div></article>`).join('')}</div>` : '<p class="muted">Nothing to show yet.</p>'}</section>`;
  }
  async function fill(box) {
    try { list = await api('/me/attendance-requests'); render(box); } catch (error) { box.innerHTML = `<p class="muted">${esc(error.message)}</p>`; }
    box.onclick = async event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-ar-new')) openForm('', () => fill(box));
      if (b.dataset.arCancel && window.confirm('Cancel this request?')) { try { await api(`/me/attendance-requests/${b.dataset.arCancel}/cancel`, {}); toast('Request cancelled.'); fill(box); } catch (error) { toast(error.message); } }
      if (b.dataset.arReply) replyForm(b.dataset.arReply, () => fill(box));
    };
  }
  function replyForm(id, done) {
    openDialog('Answer HR', `<form class="dialog-body form-grid" id="ar-reply"><label class="field full">Your answer<textarea name="note" required minlength="3" maxlength="2000"></textarea></label><label class="field full">Add evidence (optional)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"></label><p class="full oof-error" data-ar-error hidden></p><button class="primary full" type="submit">Send to HR</button></form>`);
    const form = dialog.querySelector('#ar-reply');
    form.onsubmit = async event => {
      event.preventDefault();
      const f = new FormData(form), err = form.querySelector('[data-ar-error]'), submit = form.querySelector('[type=submit]'); submit.disabled = true;
      try { const doc = await upload(api, form.elements.file.files[0]); await api(`/me/attendance-requests/${id}/reply`, { note: String(f.get('note') || ''), evidence: doc ? [doc] : [] }); dialog.close(); confirmBox('Answer sent', 'HR has your answer and will continue the review.'); done(); } catch (error) { err.textContent = error.message; err.hidden = false; submit.disabled = false; }
    };
  }
  // The request form; the fields follow the chosen category.
  function openForm(category = '', done = () => {}) {
    openDialog('New attendance request', `<form class="dialog-body form-grid" id="ar-form">
      <label class="field full">Request<select name="category" required><option value="">Choose…</option>${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${k === category ? 'selected' : ''}>${esc(v)}</option>`).join('')}<option value="leave">Leave application</option></select></label>
      <label class="field">Date (within 3 days)<input type="date" name="date" required min="${daysAgo(3)}" max="${manilaToday()}" value="${manilaToday()}"></label>
      <label class="field" data-show="failed system other">Transaction<select name="transaction"><option value="in">Time in</option><option value="out">Time out</option><option value="both">Time in and time out</option></select></label>
      <label class="field" data-show="forgot-in failed system other offsite">Requested time in<input type="time" name="timeIn"></label>
      <label class="field" data-show="forgot-out failed system other offsite forgot-in">Requested time out<input type="time" name="timeOut"></label>
      <label class="field full ar-check" data-show="forgot-out failed system other offsite forgot-in"><input type="checkbox" name="endNextDay"> The time out is on the next day (overnight work)</label>
      <label class="field" data-show="forgot-in forgot-out">Attendance type<select name="attendanceType"><option value="office">Office</option><option value="offsite">Off-site work</option></select></label>
      <label class="field full" data-show="forgot-in forgot-out offsite">Exact work location and address<input name="location" maxlength="300" placeholder="Unit / floor, building, street, barangay, city"></label>
      <label class="field full" data-show="offsite">Purpose of the official assignment<input name="purpose" maxlength="300"></label>
      <label class="field full" data-show="failed system other">Description of the problem<textarea name="problem" maxlength="2000" placeholder="e.g. The office Wi-Fi was down; the app said I was not on the office network"></textarea></label>
      <label class="field full" data-show="forgot-in forgot-out failed system other offsite">Reason<textarea name="reason" minlength="5" maxlength="2000" placeholder="Why the time in / out was not recorded"></textarea></label>
      <label class="field full" data-show="forgot-in forgot-out failed system other offsite">Supporting evidence (optional: screenshot, photo, PDF up to 5 MB)<input type="file" name="file" accept="application/pdf,image/png,image/jpeg"></label>
      <p class="full legend" data-show="forgot-in">If the whole day was not recorded, enter both the time in and the time out.</p>
      <p class="full ar-policy">${esc(POLICY)}</p>
      <p class="full oof-error" data-ar-error hidden></p>
      <button class="primary full" type="submit">Submit to HR</button></form>`);
    const form = dialog.querySelector('#ar-form'), err = form.querySelector('[data-ar-error]');
    const sync = () => {
      const c = form.elements.category.value;
      form.querySelectorAll('[data-show]').forEach(el => { el.hidden = !c || !el.dataset.show.split(' ').includes(c); });
      if (c === 'offsite') form.elements.attendanceType.value = 'offsite';
    };
    form.addEventListener('change', event => { if (event.target.name === 'category' && event.target.value === 'leave') { dialog.close(); onLeave(); return; } sync(); });
    sync();
    form.onsubmit = async event => {
      event.preventDefault(); err.hidden = true;
      const f = new FormData(form), submit = form.querySelector('[type=submit]'), c = String(f.get('category'));
      const tx = PROBLEM_CATEGORIES.includes(c) ? String(f.get('transaction')) : '';
      const body = { category: c, date: String(f.get('date')), timeIn: tx === 'out' || c === 'forgot-out' ? '' : String(f.get('timeIn') || ''), timeOut: tx === 'in' ? '' : String(f.get('timeOut') || ''), endNextDay: !!f.get('endNextDay'),
        attendanceType: c === 'offsite' ? 'offsite' : String(f.get('attendanceType') || 'office'), transaction: tx, location: String(f.get('location') || ''), purpose: String(f.get('purpose') || ''), reason: String(f.get('reason') || ''), problem: String(f.get('problem') || ''), evidence: [] };
      submit.disabled = true; submit.textContent = 'Submitting…';
      try {
        const doc = await upload(api, form.elements.file.files[0]); if (doc) body.evidence = [doc];
        const saved = await api('/me/attendance-requests', body);
        dialog.close(); confirmBox('Request submitted', `Your request <strong>${esc(saved.reference)}</strong> was sent to HR. Your attendance changes only if HR approves it.`); done();
      } catch (error) { err.textContent = error.message; err.hidden = false; submit.disabled = false; submit.textContent = 'Submit to HR'; }
    };
  }
  return { fill, openForm };
}

// ---------- HR / Admin ----------
export function createHrRequests({ api, esc, badge, openDialog, dialog, toast, onLeave }) {
  let data = { requests: [], leave: { pending: 0, needsInfo: 0 } }, filter = 'open', who = '';
  const statusBadge = s => { const [label, tone] = STATUS[s] || [s, 'neutral']; return badge(label, tone); };
  const open = r => ['pending', 'review', 'info'].includes(r.status);
  const shown = () => data.requests.filter(r => (!who || r.employeeId === who) && (filter === 'open' ? ['pending', 'review'].includes(r.status) : filter === 'all' ? true : CATEGORIES[filter] ? r.category === filter && open(r) : r.status === filter));
  function render(box) {
    const n = f => data.requests.filter(f).length, waiting = r => ['pending', 'review'].includes(r.status);
    const tile = (key, count, label) => `<button data-ar-filter="${key}" class="${filter === key ? 'active' : ''}"><strong>${count}</strong>${label}</button>`;
    const people = [...new Map(data.requests.map(r => [r.employeeId, r.employeeName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    box.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Attendance requests</h2><p class="legend">Nothing changes in attendance until you approve. Approved requests become HR-approved adjustments; the original record stays in the correction history.</p><p class="ar-policy">${esc(POLICY)}</p></div></div>
      <div class="ot-summary ar-tiles">${tile('open', n(waiting) + data.leave.pending, 'Total pending')}${tile('forgot-in', n(r => r.category === 'forgot-in' && open(r)), 'Forgot time in')}${tile('forgot-out', n(r => r.category === 'forgot-out' && open(r)), 'Forgot time out')}${tile('failed', n(r => r.category === 'failed' && open(r)), 'Failed time in / out')}${tile('system', n(r => r.category === 'system' && open(r)), 'System error')}${tile('other', n(r => r.category === 'other' && open(r)), 'Other reason')}${tile('offsite', n(r => r.category === 'offsite' && open(r)), 'Off-site reconsideration')}<button data-ar-leave><strong>${data.leave.pending}</strong>Leave applications</button>${tile('info', n(r => r.status === 'info') + data.leave.needsInfo, 'Awaiting more information')}${tile('approved', n(r => r.status === 'approved'), 'Approved')}${tile('rejected', n(r => r.status === 'rejected'), 'Rejected')}${tile('all', data.requests.length, 'All requests')}</div>
      <div class="ot-filters"><label class="field">Employee<select data-ar-who><option value="">All employees</option>${people.map(([id, name]) => `<option value="${esc(id)}" ${id === who ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label></div>
      <div class="table-wrap"><table><thead><tr><th>Reference</th><th>Employee</th><th>Request</th><th>Date</th><th>Requested</th><th>Status</th><th>Submitted</th><th></th></tr></thead><tbody>
      ${shown().map(r => `<tr><td><strong>${esc(r.reference)}</strong></td><td>${esc(r.employeeName)}</td><td>${esc(CATEGORIES[r.category])}</td><td>${esc(nice(r.date))}</td><td>${esc(times(r))}</td><td>${statusBadge(r.status)}</td><td>${esc(stamp(r.submittedAt))}</td><td><button class="small" data-ar-open="${esc(r.id)}">Open</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nothing to show yet.</td></tr>'}
      </tbody></table></div></section>`;
  }
  function detail(r, box) {
    const cur = r.current, clock = (r.clock || []).map(e => `${e.kind === 'in' ? 'Time in' : 'Time out'} ${esc(e.time)} · ${e.type === 'offsite' ? 'Off-site' : 'Office'}${e.hrApproved ? ' · HR-approved' : ''}${e.address ? ` · ${esc(e.address)}` : ''}`).join('<br>') || 'No time in / out recorded';
    const rows = [['Reference', esc(r.reference)], ['Employee', esc(r.employeeName)], ['Request', esc(CATEGORIES[r.category])], ['Status', statusBadge(r.status)], ['Date', esc(nice(r.date))], ['Requested time', esc(times(r))],
      ...(r.transaction ? [['Transaction', esc({ in: 'Time in', out: 'Time out', both: 'Time in and time out' }[r.transaction])]] : []), ['Attendance type', r.attendanceType === 'offsite' ? 'Off-site work' : 'Office'], ...(r.location ? [['Location', esc(r.location)]] : []), ...(r.purpose ? [['Purpose', esc(r.purpose)]] : []),
      ...(r.problem ? [['Problem', `<span class="wrap">${esc(r.problem)}</span>`]] : []), ['Reason', `<span class="wrap">${esc(r.reason)}</span>`], ['Evidence', evidenceHtml(r, esc) || 'None attached'],
      ['Record for that day', cur ? `${esc(cur.timeIn || '—')} – ${esc(cur.timeOut || '—')} · ${esc(cur.status)}${cur.approved ? ' · approved' : ' · not approved'}` : 'No attendance record'], ['Time in / out events', clock],
      ...(r.decision ? [['Decision', `${esc(r.status === 'approved' ? 'Approved' : 'Rejected')} by ${esc(r.decision.by)} · ${esc(stamp(r.decision.at))}${r.decision.approved ? `<br>Approved time: ${esc(times(r.decision.approved))}` : ''}${r.decision.original ? `<br>Original: ${esc(times(r.decision.original))}` : ''}${r.decision.remarks ? `<br>Remarks: ${esc(r.decision.remarks)}` : ''}`]] : [])];
    const actions = open(r) ? `<form class="form-grid ar-decide" id="ar-decide"><label class="field">Approved time in<input type="time" name="timeIn" value="${esc(r.timeIn)}"></label><label class="field">Approved time out<input type="time" name="timeOut" value="${esc(r.timeOut)}"></label><label class="field full ar-check"><input type="checkbox" name="endNextDay" ${r.endNextDay ? 'checked' : ''}> Time out on the next day</label><label class="field full">HR remarks / reason (required to reject, ask for information, or approve a different time)<textarea name="note" maxlength="2000"></textarea></label><p class="full oof-error" data-ar-error hidden></p></form>` : '';
    const foot = open(r) ? `<div class="dialog-foot">${r.status === 'pending' ? '<button data-ar-act="review">Start review</button>' : ''}<button data-ar-act="remark">Add remark</button><button data-ar-act="info">Ask for information</button><button data-ar-act="reject">Reject</button><button class="primary" data-ar-act="approve">Approve</button></div>` : '<div class="dialog-foot"><button data-close>Close</button></div>';
    openDialog(`${r.reference} · ${CATEGORIES[r.category]}`, `<div class="dialog-body"><dl class="ar-facts">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><h3>History</h3>${historyHtml(r, esc)}${actions}</div>`, foot);
    dialog.querySelectorAll('[data-ar-act]').forEach(b => { b.onclick = async () => {
      const form = dialog.querySelector('#ar-decide'), f = new FormData(form), note = String(f.get('note') || '').trim(), err = form.querySelector('[data-ar-error]'), act = b.dataset.arAct;
      const body = { review: undefined, remark: { note }, info: { note }, reject: { remarks: note }, approve: { timeIn: String(f.get('timeIn') || ''), timeOut: String(f.get('timeOut') || ''), endNextDay: !!f.get('endNextDay'), remarks: note } }[act];
      try { await api(`/attendance-requests/${r.id}/${act}`, body || {}); dialog.close(); toast({ review: 'Review started; the employee was notified.', remark: 'Remark added.', info: 'The employee was asked for more information.', reject: 'Request rejected; the record is unchanged.', approve: 'Approved; the attendance record was updated.' }[act]); load(box); } catch (error) { err.textContent = error.message; err.hidden = false; }
    }; });
  }
  async function load(box) {
    try { data = await api('/attendance-requests'); render(box); } catch (error) { box.innerHTML = `<p class="muted">${esc(error.message)}</p>`; }
  }
  function fill(box) {
    box.onclick = event => {
      const b = event.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-ar-filter')) { filter = b.dataset.arFilter; render(box); }
      if (b.hasAttribute('data-ar-leave')) onLeave();
      if (b.dataset.arOpen) { const r = data.requests.find(x => x.id === b.dataset.arOpen); if (r) detail(r, box); }
    };
    box.onchange = event => { if (event.target.matches('[data-ar-who]')) { who = event.target.value; render(box); } };
    load(box);
  }
  return { fill };
}
