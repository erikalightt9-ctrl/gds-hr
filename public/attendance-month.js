// Monthly attendance sheet (Attendance → Monthly): every employee across every day of the month, like the HR
// attendance workbook. Each day shows Present, Late, Absent, Leave or a shaded rest day / holiday; the top row gives
// the share of scheduled people present that day, and each person's present / absent / leave totals with a bar.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MARK = { present: ['✓', 'Present'], late: ['✓', 'Late'], absent: ['✕', 'Absent'], leave: ['●', 'On leave'], open: ['✓', 'Timed in, no time out'], half: ['◐', 'Half day: worked half, half-day leave approved'], wfh: ['✓', 'Present · work from home (no time in / out needed)'], offset: ['↺', 'Offset: hours worked on another day'], 'half-pending': ['◐', 'Half day: worked half, half-day leave not yet approved'] };
const svg = (p, f = 'none') => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${f}" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const GLYPH = { present: svg('<path d="m7 12.5 3.2 3.2L17 9"/>'), late: svg('<circle cx="12" cy="12" r="6"/><path d="M12 8.5V12l2.2 1.6"/>'), absent: svg('<path d="m8.5 8.5 7 7M15.5 8.5l-7 7"/>'), leave: '', half: svg('<rect x="6.5" y="7.5" width="11" height="10" rx="1.5"/><path d="M9 6v3M15 6v3M6.5 11h11"/>'), wfh: svg('<path d="m6.5 12 5.5-4.5 5.5 4.5"/><path d="M8.5 11v6h7v-6"/>'), offset: svg('<path d="M8 9a5 5 0 1 1-1 5"/><path d="M8 5v4h4"/>') };
GLYPH.open = GLYPH.present; GLYPH['half-pending'] = GLYPH.half;
const AI = { cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01"/>'), work: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 13l2 2 4-4"/>'), person: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'), pulse: svg('<path d="M3 12h4l3-7 4 14 3-7h4"/>'), target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'), zero: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7M15 4l4 4"/>') };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const minutes = hm => { const [h, m] = String(hm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };

// Status of one employee on one date, or a reason the day is not scheduled.
function dayStatus(state, e, date, today, since) {
  if (!e.startDate || date < e.startDate || (e.endDate && date > e.endDate)) return 'none';
  const a = state.attendance.find(x => x.employeeId === e.id && x.date === date);
  if (a) {
    if (a.status !== 'present') return a.status === 'absent' ? 'absent' : a.status === 'off' ? 'rest' : a.status === 'offset' ? 'offset' : 'leave';   // a recorded day off is shown like a rest day
    // Worked part of the day beside a half-day leave: half present, half leave (or half absent until approved).
    const halfLeave = state.leaves.find(l => l.employeeId === e.id && ['approved', 'pending'].includes(l.status) && (l.partialDates || []).includes(date));
    if (halfLeave) return halfLeave.status === 'approved' ? 'half' : 'half-pending';
    const raw = minutes(a.timeIn) !== null && minutes(a.scheduledIn) !== null ? minutes(a.timeIn) - minutes(a.scheduledIn) : 0, grace = (state?.rules || []).filter(r => r.approvedBy).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.graceMinutes ?? 0;
    const late = raw >= Math.max(1, grace) && raw > (a.offsetMinutes || 0);
    return late ? 'late' : 'present';
  }
  if ((state.openClockIns || []).some(c => c.employeeId === e.id && c.workDate === date)) return 'open';
  if (state.leaves.some(l => l.employeeId === e.id && l.status === 'approved' && (l.countedDates || []).includes(date))) return 'leave';
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if ((e.restDays || []).includes(weekday)) return 'rest';
  // Work-from-home day set as present without time in / out (e.g. Saturdays).
  const profile = (state.employeeProfiles || []).find(p => p.employeeId === e.id && p.section === 'attendance');
  if (date <= today && (profile?.daySchedules || []).some(s => s.day === weekday && s.autoPresent)) return 'wfh';
  if ((state.holidays || []).some(h => h.date === date && h.kind !== 'ordinary')) return 'holiday';
  return date > today ? 'future' : date < since ? 'none' : 'absent';   // before attendance was kept in the system: no mark
}

export function monthSheet({ state, esc, today, month, search = '', company = '' }) {
  const [y, m] = month.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dates = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const start = dates[0], end = dates.at(-1);
  // Inactive employees (resigned, separated, set inactive) are not shown.
  const people = state.employees.filter(e => !e.draft && !e.archived && e.active !== false && e.startDate && e.startDate <= end && (!e.endDate || e.endDate >= start))
    .filter(e => !search || `${e.name} ${e.id}`.toLowerCase().includes(search.toLowerCase()))
    .filter(e => !company || e.department === company)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Attendance kept in the system starts with the first recorded time in; earlier days are not marked absent.
  const since = [...state.attendance.map(a => a.date), ...(state.openClockIns || []).map(c => c.workDate)].sort()[0] || today;
  const grid = people.map(e => ({ e, days: dates.map(d => dayStatus(state, e, d, today, since)) }));
  const holiday = d => (state.holidays || []).find(h => h.date === d && h.kind !== 'ordinary');
  // Scheduled work days this month, from the calendar and each person's rest day (holidays included): one number when
  // everyone shown has the same rest day, otherwise one per rest day (Nov 2026: Sun rest 25 · Sat rest 26).
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const workDaysBy = new Map();
  for (const e of people) { const key = (e.restDays || []).slice().sort().join(','); if (!workDaysBy.has(key)) workDaysBy.set(key, dates.filter(d => !(e.restDays || []).includes(new Date(`${d}T00:00:00Z`).getUTCDay())).length); }
  const workDays = workDaysBy.size <= 1 ? (workDaysBy.values().next().value ?? dates.length) : [...workDaysBy].map(([key, n]) => `${key ? key.split(',').map(k => dayNames[k]).join('/') : 'no'} rest ${n}`).join(' · ');
  const counted = s => ['present', 'late', 'open', 'half', 'half-pending', 'wfh', 'offset'].includes(s);
  // A half day counts 0.5 present and 0.5 leave (0.5 absent while the half-day leave is pending).
  const sum = (days, weights) => days.reduce((s, d) => s + (weights[d] || 0), 0);
  const rows = grid.map(({ e, days }) => {
    const present = sum(days, { present: 1, late: 1, open: 1, wfh: 1, offset: 1, half: 0.5, 'half-pending': 0.5 }), absent = sum(days, { absent: 1, 'half-pending': 0.5 }), leave = sum(days, { leave: 1, half: 0.5 });
    return { e, days, present, absent, leave, rate: pct(present, present + absent + leave) };
  });
  const dailyRate = dates.map((d, i) => { const due = rows.filter(r => ['present', 'late', 'open', 'absent', 'leave', 'half', 'half-pending', 'wfh', 'offset'].includes(r.days[i])); return due.length && d <= today ? pct(due.filter(r => counted(r.days[i])).length, due.length) : null; });
  const average = rows.length ? Math.round(rows.reduce((s, r) => s + r.rate, 0) / rows.length) : 0;
  const nice = d => `${d.slice(5, 7)}/${d.slice(8)}/${d.slice(0, 4)}`;
  const card = (icon, label, value) => `<div class="am-card"><i>${icon}</i><span><small>${esc(label)}</small><strong>${esc(String(value))}</strong></span></div>`;
  const line = (icon, label, value) => `<div><dt><i>${icon}</i>${esc(label)}</dt><dd>${esc(String(value))}</dd></div>`;
  const dow = d => new Date(`${d}T00:00:00Z`).getUTCDay();
  const col = d => `${dow(d) === 6 ? ' am-sat' : dow(d) === 0 ? ' am-sun' : ''}${holiday(d) ? ' am-holiday' : ''}`;
  const mark = s => (s === 'rest' || s === 'holiday' || s === 'none' || s === 'future' ? '' : `<span class="am-mark am-${s.replace('-pending', ' am-pending')}" title="${MARK[s][1]}">${GLYPH[s]}</span>`);
  const tone = r => (r >= 90 ? 'hi' : r >= 70 ? 'mid' : 'lo');
  const legend = [['present', 'Present'], ['late', 'Late'], ['absent', 'Absent'], ['leave', 'On leave'], ['half', 'Half day'], ['wfh', 'Present – work from home'], ['offset', 'Other (offset)']].map(([k, t]) => `<span><span class="am-mark am-${k}">${GLYPH[k]}</span>${t}</span>`).join('');

  return `<section class="am-sheet">
    <nav class="am-months" aria-label="Month">${MONTHS.map((name, i) => `<button class="${i + 1 === m ? 'active' : ''}" data-am-month="${y}-${String(i + 1).padStart(2, '0')}">${name}</button>`).join('')}</nav>
    <div class="am-main">
      <div class="am-top">
        <div class="am-period">${card(AI.cal, '', `${LONG[m - 1]} ${y}`).replace('am-card', 'am-card am-month-card')}${card(AI.cal, 'Start Date', nice(start))}${card(AI.cal, 'End Date', nice(end))}${card(AI.cal, 'Total Days', last)}${card(AI.work, 'Work Days', workDays)}</div>
        <dl class="am-summary">${line(AI.person, 'Total Persons', rows.length)}${line(AI.pulse, 'Average Attendance', `${average}%`)}${line(AI.target, 'Persons below 50%', rows.filter(r => r.rate < 50).length)}${line(AI.zero, 'Persons with 0%', rows.filter(r => r.rate === 0).length)}</dl>
      </div>
      <div class="am-wrap"><table class="am-table">
        <thead>
          <tr class="am-band"><th rowspan="3" class="am-id">Emp ID</th><th rowspan="3" class="am-name">Employee</th><th colspan="${dates.length}">Analysis by Days</th><th colspan="4" class="am-items">Analysis by Items</th></tr>
          <tr class="am-dow">${dates.map(d => `<th class="${col(d)}" title="${esc(holiday(d)?.name || '')}">${DOW[dow(d)]}</th>`).join('')}<th rowspan="2" class="am-present">Present</th><th rowspan="2" class="am-absent">Absent</th><th rowspan="2" class="am-leave">Leave</th><th rowspan="2" class="am-chart">Attendance</th></tr>
          <tr class="am-dates">${dates.map((d, i) => `<th class="am-date${col(d)}${d === today ? ' am-today' : ''}"><button data-am-day="${d}" title="Open ${d} in Daily records${dailyRate[i] === null ? '' : ` · ${dailyRate[i]}% present`}">${d.slice(8)}</button></th>`).join('')}</tr>
        </thead>
        <tbody>${rows.length ? rows.map(r => `<tr><td class="am-id">${esc(r.e.id)}</td><td class="am-name">${esc(r.e.name)}</td>${r.days.map((s, i) => `<td class="${col(dates[i])}${s === 'rest' ? ' am-rest' : ''}${s === 'holiday' ? ' am-holiday' : ''}">${mark(s)}</td>`).join('')}<td class="am-num am-present">${r.present}</td><td class="am-num am-absent">${r.absent}</td><td class="am-num am-leave">${r.leave}</td><td class="am-chart"><span class="am-bar am-${tone(r.rate)}"><i class="am-w${Math.round(r.rate / 5) * 5}"></i></span><b>${r.rate}%</b></td></tr>`).join('') : `<tr><td colspan="${dates.length + 6}" class="empty">No employees this month.</td></tr>`}</tbody>
      </table></div>
    </div>
    <p class="am-legend"><b>Legend:</b>${legend}<span><span class="am-key am-rest"></span>Rest day / weekend</span><span><span class="am-key am-holiday"></span>Holiday</span></p>
  </section>`;
}
