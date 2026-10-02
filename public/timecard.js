// Employee timecard: one employee's days for a cutoff, each beside its effect on pay.
// Figures come from the payroll engine's own calculation (a preview for that employee),
// so what HR checks here is exactly what payroll will compute.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = { present: 'Present', absent: 'Absent', off: 'Off duty', 'official-business': 'Official business', 'rest-day-swap': 'Rest-day swap' };

function datesBetween(start, end) {
  const out = [];
  for (let d = Date.parse(`${start}T00:00:00Z`); d <= Date.parse(`${end}T00:00:00Z`); d += 86400000) out.push(new Date(d).toISOString().slice(0, 10));
  return out.slice(0, 62);
}
const round = v => Math.round((v + Number.EPSILON) * 100) / 100;
const minutesBetween = (a, b) => { const [h1, m1] = a.split(':').map(Number), [h2, m2] = b.split(':').map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); };

export function createTimecard(ctx) {
  const { api, esc, money, badge, table, getState, canEdit, editButton, cutoffDefaults } = ctx;
  const view = { employeeId: '', start: '', end: '' };

  function setEmployee(id) { view.employeeId = id; }

  function controls(state) {
    const people = state.employees.filter(e => !e.draft);
    if (!view.employeeId || !people.some(e => e.id === view.employeeId)) view.employeeId = people[0]?.id || '';
    if (!view.start) Object.assign(view, cutoffDefaults());
    return `<form class="toolbar" id="timecard-form"><label>Employee<select name="employeeId">${people.map(e => `<option value="${esc(e.id)}" ${e.id === view.employeeId ? 'selected' : ''}>${esc(e.name)} (${esc(e.id)})</option>`).join('')}</select></label><label>Cutoff start<input type="date" name="start" value="${view.start}" required></label><label>Cutoff end<input type="date" name="end" value="${view.end}" required></label><button class="primary" type="submit">Show timecard</button></form>`;
  }

  function panel(state) {
    return `<section class="panel"><div class="panel-head"><div><h2>Employee timecard</h2><p>Each day beside what it does to pay. Figures match the payroll calculation exactly.</p></div></div>${controls(state)}<div id="timecard-body" class="panel-body"><p class="legend">Loading timecard…</p></div></section>`;
  }

  // One row per calendar day, combining the attendance record, leave, holiday and the payroll trace.
  function rows(state, employee, run) {
    const row = run.rows.find(r => r.employeeId === employee.id);
    return datesBetween(view.start, view.end).map(date => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(), rest = employee.restDays.includes(weekday);
      const record = state.attendance.find(a => a.employeeId === employee.id && a.date === date);
      const leave = state.leaves.find(l => l.employeeId === employee.id && !['rejected', 'cancelled'].includes(l.status) && l.startDate <= date && l.endDate >= date);
      const holiday = state.holidays.find(h => h.date === date && h.kind !== 'ordinary');
      const employed = employee.startDate && date >= employee.startDate && (!employee.endDate || date <= employee.endDate);
      // The cutoff's basic salary is one entry dated on the first day; it is not that day's own effect.
      const trace = (row?.trace || []).filter(t => t.date === date && !(t.component === 'basic' && t.sourceKind === 'employees'));
      const work = (row?.workBreakdown || []).filter(w => w.date === date);
      const late = (row?.late || []).find(l => l.date === date);
      const amount = (side, components) => round(trace.filter(t => t.side === side && components(t.component)).reduce((s, t) => s + t.amount, 0));
      // Late time is a reduction of credited days (a negative basic entry), counted with undertime and absence.
      const lateCut = round(-trace.filter(t => t.side === 'earnings' && t.amount < 0).reduce((s, t) => s + t.amount, 0));
      const deducted = round(amount('deductions', c => ['undertime', 'absence'].includes(c)) + lateCut);
      const earned = round(trace.filter(t => t.side === 'earnings' && t.amount > 0).reduce((s, t) => s + t.amount, 0));   // overtime, premiums, night differential
      const undertime = trace.find(t => t.component === 'undertime');
      const blocker = run.blockers.find(b => b.startsWith(`${employee.id} `) && b.includes(date));
      let status, tone = 'neutral';
      if (!employed) status = 'Not employed';
      else if (leave) { status = `${leave.status === 'approved' ? 'Leave' : 'Leave (pending)'} · ${state.leaveTypes.find(t => t.id === leave.typeId)?.name || leave.typeId}`; tone = leave.status === 'approved' ? '' : 'pending'; }
      else if (record) { status = STATUS[record.status] || record.status; tone = record.status === 'absent' ? 'rejected' : record.status === 'present' ? '' : 'neutral'; }
      else if (rest) status = 'Rest day';
      else { status = 'Missing record'; tone = 'rejected'; }
      if (holiday && employed) status += ` · ${holiday.name}`;
      const breaks = record?.breaks?.reduce((s, b) => s + Math.max(0, minutesBetween(b.start.slice(11, 16), b.end.slice(11, 16))), 0) || 0;
      return {
        date, record, blocker, missing: employed && !record && !leave && !rest,
        cells: [
          `<strong>${WEEKDAYS[weekday]} ${esc(date.slice(5))}</strong>`,
          badge(status, tone) + (blocker && !blocker.includes('Missing') ? `<small class="timecard-flag">${esc(blocker.replace(`${employee.id} ${employee.name}: `, ''))}</small>` : ''),
          record?.status === 'present' ? `${esc(record.timeIn)} → ${esc(record.timeOut)}${record.endNextDay ? ' (+1)' : ''}<small>Scheduled ${esc(record.scheduledIn)}</small>` : '—',
          breaks ? `${breaks} min` : '—',
          work.length ? `${round(work.filter(w => !w.overtime).reduce((s, w) => s + w.hours, 0))} h` : '—',
          late?.lateMinutes ? `${late.lateMinutes} min${late.approvedOffset ? ` · ${late.approvedOffset} offset` : ''}${late.deduction ? `<small>−${late.dayFraction} day · −${money(late.deduction)}</small>` : '<small>Covered, no pay change</small>'}${late.deductibleMinutes && record && canEdit('attendance') ? `<button class="small" data-timecard-offset="${esc(record.id)}" data-minutes="${late.deductibleMinutes}">Apply offset</button>` : ''}` : '—',
          undertime ? `${undertime.formula.split(' ')[0]} min<small>−${money(undertime.amount)}</small>` : '—',
          work.some(w => w.overtime) ? `${round(work.filter(w => w.overtime).reduce((s, w) => s + w.hours, 0))} h${work.some(w => w.night) ? '<small>incl. night</small>' : ''}` : '—',
          deducted || earned ? `${earned ? `<span class="pay-plus">+${money(earned)}</span>` : ''}${deducted ? `<span class="pay-minus">−${money(deducted)}</span>` : ''}` : '<span class="legend">No change</span>',
          record ? badge(record.approved ? 'Approved' : 'Pending', record.approved ? '' : 'pending') : '—',
          record ? editButton('attendance', record.id) : employed && !leave && !rest && canEdit('attendance') ? `<button class="small primary" data-timecard-add="${esc(date)}">Add record</button>` : '',
        ],
      };
    });
  }

  function summary(row, dayRows) {
    const sum = (key, side) => round((row?.trace || []).filter(t => t.side === side && t.component === key).reduce((s, t) => s + t.amount, 0));
    const otHours = round((row?.workBreakdown || []).filter(w => w.overtime).reduce((s, w) => s + w.hours, 0));
    const missing = dayRows.filter(r => r.missing).length;
    const card = (title, value, foot, alert) => `<div class="card ${alert ? 'featured' : ''}"><div class="card-label">${esc(title)}</div><div class="card-value">${value}</div><div class="card-foot">${foot}</div></div>`;
    return `<div class="cards timecard-cards">
      ${card('Days credited', row?.creditedDays ?? row?.daysPresent ?? 0, `${row?.daysPresent ?? 0} present of ${row?.workingDays ?? 0} scheduled${row?.lateDaysLost ? ` − ${row.lateDaysLost} day late` : ''}`)}
      ${card('Missing records', missing, missing ? 'Add them before posting payroll' : 'Every scheduled day is accounted for', missing > 0)}
      ${card('Late not offset', `${row?.lateMinutesUnoffset ?? 0} min`, `Lowers days credited · −${money(row?.lateReduction ?? 0)} basic · Undertime ${money(sum('undertime', 'deductions'))} · Absence ${money(sum('absence', 'deductions'))}`)}
      ${card('Overtime', `${otHours} h`, `+${money((row?.earnings.regularOT || 0) + (row?.earnings.restOT || 0) + (row?.earnings.specialOT || 0) + (row?.earnings.regularHolidayOT || 0) + (row?.earnings.otherOT || 0) + (row?.earnings.nsd || 0))} incl. night differential`)}
    </div>
    <div class="timecard-totals">${row ? `Basic ${money(row.earnings.basic)} · Gross <strong>${money(row.gross)}</strong> · Deductions ${money(row.totalDeductions)} · <strong>Net ${money(row.net)}</strong>` : 'Not included in payroll for this period.'}
      <button class="small" data-timecard-payroll>Open in Payroll →</button></div>`;
  }

  async function fill() {
    const body = document.querySelector('#timecard-body'); if (!body) return;
    const state = getState(), employee = state.employees.find(e => e.id === view.employeeId);
    if (!employee) { body.innerHTML = '<p class="legend">Choose an employee with a completed profile.</p>'; return; }
    try {
      const run = await api('/payroll/preview', { start: view.start, end: view.end, pay13th: false, employeeIds: [employee.id] });
      if (!document.querySelector('#timecard-body')) return;
      const row = run.rows.find(r => r.employeeId === employee.id), dayRows = rows(state, employee, run);
      const other = run.blockers.filter(b => !dayRows.some(r => r.blocker === b));
      body.innerHTML = summary(row, dayRows)
        + (other.length ? `<div class="notice">${other.map(esc).join('<br>')}</div>` : '')
        + `<div class="scroll-table timecard-table">${table(['Day', 'Status', 'In → out', 'Unpaid breaks', 'Regular hours', 'Late (offset / days lost)', 'Undertime', 'Overtime', 'Pay effect', 'Approval', ''], dayRows.map(r => r.cells))}</div>`
        + `<p class="legend">Rates: ${row ? `${money(row.dailyRate)} daily · ${money(row.hourlyRate)} hourly` : '—'}. Corrections require a reason; the original record, the change and who made it stay in the audit trail, and the employee is notified.</p>`;
    } catch (error) { body.innerHTML = `<div class="notice">${esc(error.message)}</div>`; }
  }

  function bind(onAdd, onPayroll, onOffset) {
    const form = document.querySelector('#timecard-form');
    if (form) form.onsubmit = event => { event.preventDefault(); Object.assign(view, { employeeId: form.elements.employeeId.value, start: form.elements.start.value, end: form.elements.end.value }); fill(); };
    const body = document.querySelector('#timecard-body');
    if (body) body.onclick = event => {
      const add = event.target.closest('[data-timecard-add]'); if (add) onAdd(view.employeeId, add.dataset.timecardAdd);
      if (event.target.closest('[data-timecard-payroll]')) onPayroll(view.employeeId, view.start, view.end);
      const offset = event.target.closest('[data-timecard-offset]'); if (offset) onOffset(offset.dataset.timecardOffset, Number(offset.dataset.minutes));
    };
  }

  return { panel, fill, bind, setEmployee };
}
