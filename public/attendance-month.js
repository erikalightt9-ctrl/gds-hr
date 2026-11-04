// Monthly attendance sheet (Attendance → Monthly): every employee across every day of the month, like the HR
// attendance workbook. Each day shows Present, Late, Absent, Leave or a shaded rest day / holiday; the top row gives
// the share of scheduled people present that day, and each person's present / absent / leave totals with a bar.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MARK = { present: ['✓', 'Present'], late: ['✓', 'Late'], absent: ['✕', 'Absent'], leave: ['●', 'On leave'], open: ['✓', 'Timed in, no time out'], half: ['◐', 'Half day: worked half, half-day leave approved'], 'half-pending': ['◐', 'Half day: worked half, half-day leave not yet approved'] };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const minutes = hm => { const [h, m] = String(hm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };

// Status of one employee on one date, or a reason the day is not scheduled.
function dayStatus(state, e, date, today, since) {
  if (!e.startDate || date < e.startDate || (e.endDate && date > e.endDate)) return 'none';
  const a = state.attendance.find(x => x.employeeId === e.id && x.date === date);
  if (a) {
    if (a.status !== 'present') return a.status === 'absent' ? 'absent' : 'leave';
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
  const isWeekend = d => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
  const holiday = d => (state.holidays || []).find(h => h.date === d && h.kind !== 'ordinary');
  // Work days per month are fixed by the payroll rules (26 for every month), as on the payroll screen.
  const workDays = (state.rules || []).filter(r => r.approvedBy).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0]?.dailyDivisor ?? 26;
  const counted = s => ['present', 'late', 'open', 'half', 'half-pending'].includes(s);
  // A half day counts 0.5 present and 0.5 leave (0.5 absent while the half-day leave is pending).
  const sum = (days, weights) => days.reduce((s, d) => s + (weights[d] || 0), 0);
  const rows = grid.map(({ e, days }) => {
    const present = sum(days, { present: 1, late: 1, open: 1, half: 0.5, 'half-pending': 0.5 }), absent = sum(days, { absent: 1, 'half-pending': 0.5 }), leave = sum(days, { leave: 1, half: 0.5 });
    return { e, days, present, absent, leave, rate: pct(present, present + absent + leave) };
  });
  const dailyRate = dates.map((d, i) => { const due = rows.filter(r => ['present', 'late', 'open', 'absent', 'leave', 'half', 'half-pending'].includes(r.days[i])); return due.length && d <= today ? pct(due.filter(r => counted(r.days[i])).length, due.length) : null; });
  const average = rows.length ? Math.round(rows.reduce((s, r) => s + r.rate, 0) / rows.length) : 0;
  const box = (label, value) => `<div class="am-box"><span>${esc(label)}</span><strong>${esc(String(value))}</strong></div>`;
  const nice = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-PH', { month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const cell = s => s === 'rest' || s === 'holiday' || s === 'none' || s === 'future' ? '' : `<span class="am-mark am-${s.replace('-pending', ' am-pending')}" title="${MARK[s][1]}">${MARK[s][0]}</span>`;

  return `<section class="panel am-sheet">
    <div class="am-top">
      <div class="am-months">${MONTHS.map((name, i) => `<button class="${i + 1 === m ? 'active' : ''}" data-am-month="${y}-${String(i + 1).padStart(2, '0')}">${name}</button>`).join('')}</div>
      <div class="am-boxes">${box('Year', y)}${box('Month', m)}${box('Start date', nice(start))}${box('End date', nice(end))}${box('Total days', last)}${box('Work days', workDays)}</div>
      <dl class="am-summary"><div><dt>Total persons</dt><dd>${rows.length}</dd></div><div><dt>Average attendance</dt><dd>${average}%</dd></div><div><dt>Persons below 50%</dt><dd>${rows.filter(r => r.rate < 50).length}</dd></div><div><dt>Persons with 0%</dt><dd>${rows.filter(r => r.rate === 0).length}</dd></div></dl>
    </div>
    <div class="am-wrap"><table class="am-table">
      <thead>
        <tr class="am-rate-row"><th colspan="2" class="am-label">Analysis by days</th>${dates.map((d, i) => `<th class="${isWeekend(d) ? 'am-weekend' : ''}">${dailyRate[i] === null ? '' : `${dailyRate[i]}%`}</th>`).join('')}<th colspan="4" class="am-label">Analysis by name</th></tr>
        <tr><th rowspan="2" class="am-id">Empl ID</th><th rowspan="2" class="am-name">Employee</th>${dates.map(d => `<th class="${isWeekend(d) ? 'am-weekend' : ''}${holiday(d) ? ' am-holiday' : ''}" title="${esc(holiday(d)?.name || '')}">${DAY[new Date(`${d}T00:00:00Z`).getUTCDay()]}</th>`).join('')}<th rowspan="2" class="am-present">Present</th><th rowspan="2" class="am-absent">Absent</th><th rowspan="2" class="am-leave">Leave</th><th rowspan="2" class="am-chart">Attendance</th></tr>
        <tr>${dates.map(d => `<th class="am-date${isWeekend(d) ? ' am-weekend' : ''}${holiday(d) ? ' am-holiday' : ''}${d === today ? ' am-today' : ''}"><button data-am-day="${d}" title="Open ${d} in Daily records">${d.slice(8)}</button></th>`).join('')}</tr>
      </thead>
      <tbody>${rows.length ? rows.map(r => `<tr><td class="am-id">${esc(r.e.id)}</td><td class="am-name">${esc(r.e.name)}</td>${r.days.map((s, i) => `<td class="${isWeekend(dates[i]) || s === 'rest' ? 'am-weekend' : ''}${s === 'holiday' ? ' am-holiday' : ''}">${cell(s)}</td>`).join('')}<td class="am-num am-present">${r.present}</td><td class="am-num am-absent">${r.absent}</td><td class="am-num am-leave">${r.leave}</td><td class="am-chart"><span class="am-bar"><i class="am-w${Math.round(r.rate / 5) * 5}"></i></span><b>${r.rate}%</b></td></tr>`).join('') : `<tr><td colspan="${dates.length + 6}" class="empty">No employees this month.</td></tr>`}</tbody>
    </table></div>
    <p class="am-legend"><span class="am-mark am-present">✓</span> Present <span class="am-mark am-late">✓</span> Late <span class="am-mark am-absent">✕</span> Absent <span class="am-mark am-leave">●</span> On leave <span class="am-mark am-half">◐</span> Half day <span class="am-key am-weekend"></span> Rest day / weekend <span class="am-key am-holiday"></span> Holiday</p>
  </section>`;
}
