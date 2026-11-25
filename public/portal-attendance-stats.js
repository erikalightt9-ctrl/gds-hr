// Employee home: My Attendance analytics (Nov 25, 2026 design). Figures come from GET /api/me/attendance-summary, which
// uses the same day-by-day statuses as HR's attendance history and payroll (see src/attendance-summary.mjs).
const ico = d => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const I = {
  cal: ico('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/>'),
  clock: ico('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  glass: ico('<path d="M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9"/>'),
  bars: ico('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  pie: ico('<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>'),
  doc: ico('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  palm: ico('<path d="M12 21V11M12 11c-2-3-5-4-8-3 2-3 6-3 8 0 1-3 5-4 8-2-3 0-6 2-8 5z"/><path d="M8 21h8"/>'),
  plus: ico('<circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/>'),
  x: ico('<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  bulb: ico('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>'),
  refresh: ico('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  check: ico('<path d="m5 12 5 5 9-10"/>'),
};
const monthLabel = m => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const stamp = iso => new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const pct = v => (v === null || v === undefined ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)}%`);
const STATUS = { approved: ['Approved', 'ok'], pending: ['Pending', 'wait'], rejected: ['Rejected', 'off'], cancelled: ['Cancelled', 'off'] };

export function renderAttendanceSummary(box, s, { esc, onMonth, onRefresh, onLeave }) {
  const kpi = (icon, label, value, chip, tone) => `<div class="ma-kpi"><span class="ma-kpi-ico">${icon}</span><div><span>${esc(label)}</span><strong>${value}</strong></div><em class="ma-chip ma-${tone}">${chip}</em></div>`;
  const max = Math.max(10, Math.ceil(Math.max(s.requiredHours, ...s.bars.map(b => b.hours)) / 2) * 2), ticks = Array.from({ length: max / 2 + 1 }, (_, i) => max - i * 2);
  const chart = s.bars.length ? `<div class="ma-chart"><div class="ma-yaxis">${ticks.map(t => `<span>${t}h</span>`).join('')}</div><div class="ma-plot-wrap"><div class="ma-plot" data-ma-ref="${(s.requiredHours / max).toFixed(4)}">
      ${ticks.map(() => '<i class="ma-grid"></i>').join('')}<b class="ma-ref"></b>
      ${s.bars.map(b => `<div class="ma-col${b.kind === 'rest' ? ' rest' : ''}" title="${esc(day(b.date))}: ${b.hours} h"><small>${b.hours.toFixed(1)}h</small><span class="ma-bar" data-ma-h="${(b.hours / max).toFixed(4)}"></span><em>${b.day}<br>${esc(b.weekday)}</em></div>`).join('')}</div></div></div>`
    : '<p class="ma-empty">No hours logged yet this month.</p>';
  const total = s.present + s.absent + s.leave;
  const rows = [...s.leaves.map(l => ({ icon: /vacation/i.test(l.type) ? I.palm : /sick|medical/i.test(l.type) ? I.plus : I.cal, text: l.type, date: l.startDate === l.endDate ? day(l.startDate) : `${day(l.startDate)} – ${day(l.endDate)}`, chip: STATUS[l.status] || [l.status, 'wait'] })),
    ...s.absences.map(a => ({ icon: I.x, text: 'Absent', date: day(a.date), chip: a.byHr ? ['Verified by HR', 'off'] : ['No time in / out', 'off'] }))];
  const note = s.incomplete ? `${s.incomplete} day${s.incomplete === 1 ? '' : 's'} need a time correction. Use Correction Request on the home screen.` : s.absent ? `${s.absent} day${s.absent === 1 ? '' : 's'} without a time in / out this month. If you worked, file a Correction Request.` : 'Your attendance record is up to date.';
  box.innerHTML = `<div class="ma-head"><h2><span class="ma-title-ico">${I.cal}</span>My Attendance</h2><button type="button" class="ma-refresh ma-refresh-top" data-ma-refresh aria-label="Refresh" title="Refresh">${I.refresh}</button><label class="ma-month">${I.cal}<select data-ma-month aria-label="Month">${s.months.map(m => `<option value="${m}" ${m === s.month ? 'selected' : ''}>${esc(monthLabel(m))}</option>`).join('')}</select></label></div>
    <div class="ma-kpis">${kpi(I.cal, 'Days Present', `${s.present} <small>/ ${s.workdays}</small>`, pct(s.presentRate), 'green')}${kpi(I.clock, 'On-time Rate', pct(s.onTimeRate), s.late ? `${s.late} late` : `${I.check} On Time`, s.late ? 'amber' : 'green')}${kpi(I.glass, 'Late Arrivals', String(s.late), s.lateMinutes ? `${s.lateMinutes} min` : pct(s.lateRate ?? 0), 'blue')}${kpi(I.clock, 'Hours Logged', `${s.hours.toFixed(1)} h`, s.avgHours === null ? 'No hours yet' : `Avg. ${s.avgHours.toFixed(1)} h/day`, 'violet')}</div>
    <section class="ma-panel"><div class="ma-panel-head"><h3>${I.bars}Hours per Day</h3><span class="ma-legend"><b class="ma-dot worked"></b>Worked Hours<b class="ma-dot req"></b>Required Hours (${s.requiredHours}h)</span></div>${chart}</section>
    <div class="ma-mini"><span><b class="ma-dot worked"></b>Present <strong>${s.present}</strong></span><span><b class="ma-dot absent"></b>Absent <strong>${s.absent}</strong></span><span><b class="ma-dot leave"></b>Leave <strong>${s.leave}</strong></span><button type="button" class="ma-link" data-ma-leave>Details →</button></div>
    <div class="ma-two">
      <section class="ma-panel"><div class="ma-panel-head"><h3>${I.pie}Attendance Summary</h3></div><div class="ma-donut-wrap"><div class="ma-donut" data-ma-donut="${s.present},${s.absent},${s.leave}"><div><strong>${pct(s.presentRate)}</strong><span>Present</span></div></div>
        <ul class="ma-donut-legend"><li><b class="ma-dot worked"></b><span>Present<strong>${s.present} day${s.present === 1 ? '' : 's'}</strong></span></li><li><b class="ma-dot absent"></b><span>Absent<strong>${s.absent} day${s.absent === 1 ? '' : 's'}</strong></span></li><li><b class="ma-dot leave"></b><span>Leave<strong>${s.leave} day${s.leave === 1 ? '' : 's'}</strong></span></li></ul></div>${total ? '' : '<p class="ma-empty">No working days yet this month.</p>'}</section>
      <section class="ma-panel"><div class="ma-panel-head"><h3>${I.doc}Leave &amp; Absence Details</h3><button type="button" class="ma-link" data-ma-leave>View All →</button></div>${rows.length ? `<ul class="ma-rows">${rows.slice(0, 5).map(r => `<li><span class="ma-row-ico">${r.icon}</span><span class="ma-row-text">${esc(r.text)}</span><span class="ma-row-date">${esc(r.date)}</span><em class="ma-chip ma-${r.chip[1] === 'ok' ? 'green' : r.chip[1] === 'wait' ? 'amber' : 'red'}">${esc(r.chip[0])}</em></li>`).join('')}</ul>${rows.length > 5 ? `<p class="ma-more">and ${rows.length - 5} more</p>` : ''}` : '<p class="ma-empty">No leave or absences this month.</p>'}</section>
    </div>
    <section class="ma-note"><span class="ma-note-ico">${I.bulb}</span><div><strong>Attendance Note</strong><p>${esc(note)}${s.lastUpdated ? ` Last updated: ${esc(stamp(s.lastUpdated))}.` : ''}</p></div><button type="button" class="ma-refresh" data-ma-refresh>${I.refresh}<span>Refresh</span></button></section>`;
  // Sizes are set from script: the page's security policy does not allow style attributes.
  box.querySelectorAll('[data-ma-h]').forEach(el => el.style.setProperty('--h', `${Math.max(1, Number(el.dataset.maH) * 100)}%`));
  box.querySelectorAll('[data-ma-ref]').forEach(el => el.style.setProperty('--ref', `${Number(el.dataset.maRef) * 100}%`));
  box.querySelectorAll('.ma-plot').forEach(plot => { const lines = [...plot.querySelectorAll('.ma-grid')]; lines.forEach((g, i) => { g.style.top = `${(i / (lines.length - 1)) * 100}%`; }); });
  box.querySelectorAll('[data-ma-donut]').forEach(el => {
    const [p, a, l] = el.dataset.maDonut.split(',').map(Number), t = p + a + l || 1, pe = p / t * 100, ae = pe + a / t * 100;
    el.style.background = `conic-gradient(#c8102e 0 ${pe}%, #f7b9c1 ${pe}% ${ae}%, #3b82f6 ${ae}% 100%)`;
    if (!p && !a && !l) el.style.background = '#f1e7e8';
  });
  box.querySelector('[data-ma-month]').onchange = event => onMonth(event.target.value);
  box.querySelectorAll('[data-ma-refresh]').forEach(b => { b.onclick = () => onRefresh(); });
  box.querySelectorAll('[data-ma-leave]').forEach(b => { b.onclick = () => onLeave(); });
}
