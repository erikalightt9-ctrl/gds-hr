import { createHash } from 'node:crypto';
import { date as dateSchema } from './schema.mjs';

// Computed amounts an authorized user may override. Loans (balances), contributions (own approval flow) and the
// 13th month (annual ledger) are not overridable here.
export const OVERRIDE_EARNINGS = ['basic', 'regularOT', 'restDay', 'restOT', 'nsd', 'specialHoliday', 'specialOT', 'regularHoliday', 'regularHolidayOT', 'otherHoliday', 'otherOT', 'additional', 'allowance'];
export const OVERRIDE_DEDUCTIONS = ['absence', 'undertime', 'other', 'tax', 'SSS', 'PhilHealth', 'Pag-IBIG', 'sssLoan', 'pagibigLoan', 'salaryDeduction'];
export const round = v => Math.round((v + Number.EPSILON) * 100) / 100;
const dayMs = 86400000;
export function dates(start, end) {
  dateSchema.parse(start); dateSchema.parse(end);
  if (end < start || (Date.parse(end) - Date.parse(start)) / dayMs > 366) throw new Error('Invalid date range (maximum 366 days).');
  const result = [];
  for (let d = Date.parse(start); d <= Date.parse(end); d += dayMs) result.push(new Date(d).toISOString().slice(0, 10));
  return result;
}
export const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
export const isRest = (employee, date) => employee.restDays.includes(weekday(date));
// The schedule in force on a date: a weekday override's non-blank fields, else the base profile, else company rules.
export function scheduleOn(employee, profile = {}, date, rule) {
  const override = profile.daySchedules?.find(s => s.day === weekday(date)) || {};
  const start = override.scheduleStart || employee.scheduleStart || '';
  return {
    start,
    end: override.scheduleEnd || (override.scheduleStart ? '' : profile.scheduleEnd || ''),
    hoursPerDay: override.hoursPerDay ?? profile.hoursPerDay ?? rule?.normalHours ?? 8,
    mealBreakMinutes: override.mealBreakMinutes ?? profile.mealBreakMinutes ?? 60,
    arrangement: override.arrangement || profile.arrangement || '',
  };
}
export const leaveDates = (employee, type, start, end) => dates(start, end).filter(d => type.dayBasis === 'calendar' || !isRest(employee, d));
// Leave with times: each counted day is a whole day, or a half day when the leave covers at most 60% of that day's
// scheduled span (e.g. 14:00-18:00 of a 09:00-18:00 day). Blank times mean the whole scheduled day.
// Returns invalidDate when the time on a day falls outside the work schedule.
export function leaveSplit(employee, profile, rule, type, startDate, endDate, startTime = '', endTime = '') {
  const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const countedDates = leaveDates(employee, type, startDate, endDate), partialDates = [];
  for (const d of countedDates) {
    const s = scheduleOn(employee, profile || {}, d, rule), from0 = mins(s.start || '09:00');
    let to0 = s.end ? mins(s.end) : from0 + Math.round(s.hoursPerDay * 60) + (s.mealBreakMinutes ?? 60);
    if (to0 <= from0) to0 += 1440;
    let end = d === endDate && endTime ? mins(endTime) : to0;
    if (end <= from0 && to0 > 1440) end += 1440;
    const from = Math.max(from0, d === startDate && startTime ? mins(startTime) : from0), to = Math.min(to0, end);
    if (to <= from) return { countedDates, partialDates, days: 0, invalidDate: d };
    if (to - from <= (to0 - from0) * 0.6) partialDates.push(d);
  }
  return { countedDates, partialDates, days: countedDates.length - partialDates.length / 2 };
}
export const leaveFraction = (leave, d) => ((leave.partialDates || []).includes(d) ? 0.5 : 1);
export function classification(state, employee, date) {
  const kind = state.holidays.find(h => h.date === date)?.kind || 'ordinary';
  return kind === 'ordinary' ? (isRest(employee, date) ? 'rest' : 'ordinary') : `${kind}${isRest(employee, date) ? '-rest' : ''}`;
}
export function dayRate(kind, r) {
  return ({ ordinary: 1, rest: r.rest, special: r.special, 'special-rest': r.specialRest,
    regular: r.regular, 'regular-rest': r.regular * r.rest, double: r.double,
    'double-rest': r.double * r.rest, other: r.other, 'other-rest': r.other * r.rest })[kind];
}
// Local Manila wall-clock timestamps represented on a UTC axis (Philippines has no DST).
function stamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Use a local timestamp: YYYY-MM-DDTHH:mm.');
  dateSchema.parse(value.slice(0, 10));
  return Date.parse(`${value}:00Z`);
}
export function workMinutes(start, end, breaks = []) {
  const a = stamp(start), b = stamp(end);
  if (b <= a || b - a > dayMs) throw new Error('A shift must last more than zero and no more than 24 hours.');
  const intervals = breaks.map(x => [stamp(x.start), stamp(x.end)]).sort((x, y) => x[0] - y[0]);
  intervals.forEach(([s, e], i) => {
    if (s < a || e > b || e <= s || (i && s < intervals[i - 1][1])) throw new Error('Breaks must be within the shift and must not overlap.');
  });
  const result = [];
  for (let m = a; m < b; m += 60000) if (!intervals.some(([s, e]) => m >= s && m < e)) result.push(m);
  return result;
}
export function nightMinutes(start, end, breaks) {
  return workMinutes(start, end, breaks).filter(m => { const h = new Date(m).getUTCHours(); return h >= 22 || h < 6; }).length;
}
export function attendanceMinutes(record) {
  const next = new Date(Date.parse(record.date) + dayMs).toISOString().slice(0, 10);
  return workMinutes(`${record.date}T${record.timeIn}`, `${record.endNextDay ? next : record.date}T${record.timeOut}`, record.breaks);
}
function earnedEntitlement(e, t, asOf) {
  if (e.draft || !e.startDate) return 0;
  const eligibilityDate = new Date(`${e.startDate}T00:00:00Z`);
  eligibilityDate.setUTCMonth(eligibilityDate.getUTCMonth() + t.minServiceMonths);
  const eligible = eligibilityDate.toISOString().slice(0, 10);
  if (!e.leaveEligibility.includes(t.id) || asOf < eligible) return 0;
  if (t.accrual === 'none') return 0;
  const year = Number(asOf.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const start = eligible > yearStart ? eligible : yearStart;
  if (t.accrual === 'annual') return t.entitledDays;
  const a = new Date(start), b = new Date(asOf);
  const completed = Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + (b.getUTCDate() >= a.getUTCDate() ? 1 : 0));
  return round(t.entitledDays * Math.min(12, completed) / 12);
}
export function leaveBalance(state, employee, type, asOf) {
  const custom = state.employeeProfiles?.find(p => p.employeeId === employee.id && p.section === 'leave');
  const override = custom?.entitlements.filter(e => e.typeId === type.id && e.annualDays !== null && e.annualDays !== undefined && e.effectiveYear <= Number(asOf.slice(0, 4))).sort((a, b) => b.effectiveYear - a.effectiveYear)[0];
  const priorOverride = custom?.entitlements.filter(e => e.typeId === type.id && e.annualDays !== null && e.annualDays !== undefined && e.effectiveYear <= Number(asOf.slice(0, 4)) - 1).sort((a, b) => b.effectiveYear - a.effectiveYear)[0];
  // Typed in the 201 file for this exact year: credits granted (replaces the policy amount) and days used before the system.
  const manual = custom?.entitlements.find(e => e.typeId === type.id && e.effectiveYear === Number(asOf.slice(0, 4)));
  const originalType = type;
  if (override) type = { ...type, entitledDays: override.annualDays };
  const year = Number(asOf.slice(0, 4));
  const approved = state.leaves.filter(l => l.employeeId === employee.id && l.typeId === type.id && l.status === 'approved');
  const counted = l => l.countedDates || leaveDates(employee, type, l.startDate, l.endDate);
  const usedIn = y => approved.reduce((s, l) => s + counted(l).filter(d => d.startsWith(`${y}-`)).reduce((n, d) => n + leaveFraction(l, d), 0), 0);
  const priorEntitlement = earnedEntitlement(employee, priorOverride ? { ...originalType, entitledDays: priorOverride.annualDays } : originalType, `${year - 1}-12-31`);
  const carryEntitled = Math.min(type.carryOverDays, Math.max(0, priorEntitlement - usedIn(year - 1)));
  const expiry = new Date(Date.UTC(year, type.expirationMonths, 0)).toISOString().slice(0, 10);
  const consumedBeforeExpiry = Math.min(carryEntitled, approved.reduce((sum, l) => sum + counted(l).filter(d => d.startsWith(`${year}-`) && d <= expiry).reduce((n, d) => n + leaveFraction(l, d), 0), 0));
  // Expired, unused carry is removed; carry already consumed must not consume this year's grant twice.
  const carry = asOf <= expiry ? carryEntitled : consumedBeforeExpiry;
  const entitled = manual && manual.manualCredits !== null && manual.manualCredits !== undefined ? manual.manualCredits : earnedEntitlement(employee, type, asOf), used = round(usedIn(year) + (manual?.usedBefore || 0));
  return { entitled, carry, used, expired: Math.max(0, carryEntitled - carry), available: round(Math.max(0, entitled + carry - used)) };
}
// Salary encoded by HR for months before the system went live. A month that already has posted payroll for the
// employee is counted from payroll only, so nothing is counted twice.
// Months whose whole period (1st to month end) is covered by posted payroll for the employee.
export function fullyPostedMonths(state, employeeId) {
  const runs = state.runs.filter(r => r.status === 'posted' && r.rows.some(row => row.employeeId === employeeId));
  const months = new Set(runs.map(r => r.start.slice(0, 7))), full = new Set();
  for (const m of months) {
    const end = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    if (runs.some(r => r.start === `${m}-01`) && runs.some(r => r.end === end && r.start.startsWith(m))) full.add(m);
  }
  return full;
}
export function priorBasicFor(state, employeeId, year) {
  const postedMonths = fullyPostedMonths(state, employeeId);
  const rows = (state.priorEarnings || []).filter(p => p.employeeId === employeeId && p.month.startsWith(`${year}-`) && !postedMonths.has(p.month));
  return { basic: round(rows.reduce((s, p) => s + p.basic, 0)), thirteenthPaid: round(rows.reduce((s, p) => s + (p.thirteenthPaid || 0), 0)), months: rows.map(p => p.month) };
}
export function ruleOn(state, date) {
  return state.rules.filter(r => r.effectiveDate <= date && r.approvedBy).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
}
function matchBracket(brackets, basis, label, blockers) {
  const matches = brackets.filter(b => basis >= b.from && (b.to === null || basis < b.to));
  if (matches.length !== 1) { blockers.push(`${label}: configure exactly one applicable bracket for basis ${round(basis)}.`); return null; }
  return matches[0];
}
function bracketAmount(brackets, basis, label, blockers) {
  const b = matchBracket(brackets, basis, label, blockers);
  return b ? round(b.fixed + Math.max(0, basis - b.excessOver) * b.rate) : 0;
}
// Monthly employee, employer and EC amounts for one contribution, from the bracket or an employee override.
const OVERRIDE_KEYS = { SSS: ['sssEmployee', 'sssEmployer', 'sssEc'], PhilHealth: ['philHealthEmployee', 'philHealthEmployer'], 'Pag-IBIG': ['pagIbigEmployee', 'pagIbigEmployer'] };
const isSet = v => v !== null && v !== undefined;
export function contributionShares(name, brackets, basis, label, blockers, override = {}) {
  const b = matchBracket(brackets, basis, label, blockers), excess = b ? Math.max(0, basis - b.excessOver) : 0;
  const table = b ? { employee: round(b.fixed + excess * b.rate), employer: round((b.employerFixed || 0) + excess * (b.employerRate || 0)), ec: round(b.ec || 0) } : { employee: 0, employer: 0, ec: 0 };
  const [eeKey, erKey, ecKey] = OVERRIDE_KEYS[name];
  const pick = (key, fallback) => (key && isSet(override[key]) ? override[key] : fallback);
  return { employee: pick(eeKey, table.employee), employer: pick(erKey, table.employer), ec: pick(ecKey, table.ec), overridden: [eeKey, erKey, ecKey].some(k => k && isSet(override[k])) };
}
// Whether a company deduction applies to the cutoff [start, end].
export function deductionApplies(d, start, end) {
  if (d.schedule === 'once') return d.startDate >= start && d.startDate <= end;
  if (d.startDate > end || (d.endDate && d.endDate < start)) return false;
  if (d.schedule === 'first-cutoff') return start.endsWith('-01');
  if (d.schedule === 'second-cutoff') return start.endsWith('-16') || (start.endsWith('-01') && end.slice(8) >= '28');
  return true;
}
// The approved per-employee contribution setting in force on a date: the latest effective date on or before it.
export function activeContributionSetting(changes, employeeId, date) {
  return (changes || []).filter(c => c.employeeId === employeeId && c.status === 'approved' && c.effectiveDate <= date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.reviewedAt.localeCompare(a.reviewedAt))[0] || null;
}
const SETTING_SHARE_KEYS = { SSS: ['sssEmployee', 'sssEmployer', 'sssEc'], PhilHealth: ['philHealthEmployee', 'philHealthEmployer'], 'Pag-IBIG': ['pagIbigEmployee', 'pagIbigEmployer'] };
export function calculatePayroll(state, start, end, pay13th = false, employeeIds = null) {
  const days = dates(start, end);
  if (start.slice(0, 7) !== end.slice(0, 7)) throw new Error('Payroll cutoffs must be within one calendar month.');
  const blockers = [], rules = ruleOn(state, start);
  if (!rules) blockers.push('No approved payroll rules are effective for this cutoff.');
  const r = rules || state.rules[0];
  if (!r) throw new Error('Configure payroll rules first.');
  if (!r.contributionsReviewed) blockers.push('Contribution and tax parameters require Admin review.');
  if (!r.calendarReviewedYears.includes(Number(start.slice(0, 4)))) blockers.push('The holiday calendar for this year requires Admin review in Payroll Rules.');
  if (state.rules.some(v => v.approvedBy && v.effectiveDate > start && v.effectiveDate <= end)) blockers.push('Rules change within this cutoff. Use a cutoff-aligned effective date.');
  const monthEnd = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const validCutoff = r.cutoff === 'monthly' ? start.endsWith('-01') && end === monthEnd : (start.endsWith('-01') && end.endsWith('-15')) || (start.endsWith('-16') && end === monthEnd);
  if (!validCutoff) blockers.push(`Dates do not match the ${r.cutoff} payroll cutoff.`);
  const factor = r.cutoff === 'monthly' ? 1 : 0.5;
  const chosen = employeeIds?.length ? new Set(employeeIds) : null;
  // 'Remittance only' (e.g. the CEO): government contributions are remitted but the employee is not paid through payroll.
  const remittanceOnly = new Set((state.employeeProfiles || []).filter(p => p.section === 'payroll' && p.status === 'Remittance only').map(p => p.employeeId));
  const rows = state.employees.filter(e => (!chosen || chosen.has(e.id)) && !e.draft && !remittanceOnly.has(e.id) && e.startDate && e.startDate <= end && (!e.endDate || e.endDate >= start)).map(e => {
    const prefix = `${e.id} ${e.name}`;
    const payrollProfile = state.employeeProfiles?.find(p => p.employeeId === e.id && p.section === 'payroll');
    const contributionOverride = state.employeeProfiles?.find(p => p.employeeId === e.id && p.section === 'contributions');
    const attendanceProfile = state.employeeProfiles?.find(p => p.employeeId === e.id && p.section === 'attendance');
    const graceMinutes = attendanceProfile?.graceMinutes ?? r.graceMinutes;
    if (payrollProfile?.status === 'Hold') blockers.push(`${prefix}: payroll is on hold. Release the hold before posting.`);
    if (payrollProfile?.frequency && payrollProfile.frequency !== r.cutoff) blockers.push(`${prefix}: employee payroll frequency differs from the approved cutoff rules.`);
    if (state.runs.some(run => run.status === 'posted' && run.start <= end && run.end >= start && run.rows.some(row => row.employeeId === e.id))) blockers.push(`${prefix}: overlaps a posted payroll.`);
    if (state.runs.some(run => run.status === 'posted' && run.start > end && run.rows.some(row => row.employeeId === e.id))) blockers.push(`${prefix}: payroll must be posted chronologically; a later cutoff has already been posted.`);
    // Daily-paid staff earn their daily rate per scheduled workday; absences then deduct whole days.
    const dailyPaid = payrollProfile?.basis === 'daily';
    if (dailyPaid && !payrollProfile.dailyRate) blockers.push(`${prefix}: daily-paid employees need a daily rate in their payroll profile.`);
    // Hourly rate follows the employee's own scheduled hours (a 12-hour driver: daily ÷ 12), else the rules divisor.
    const scheduledHours = attendanceProfile?.hoursPerDay || r.hourlyDivisor;
    const daily = payrollProfile?.dailyRate ?? e.monthlySalary / r.dailyDivisor, hourly = payrollProfile?.hourlyRate ?? daily / scheduledHours;
    const allScheduled = days.filter(d => !isRest(e, d));
    const employed = days.filter(d => d >= e.startDate && (!e.endDate || d <= e.endDate));
    const scheduled = employed.filter(d => !isRest(e, d));
    const baseline = dailyPaid ? round(daily * scheduled.length) : round(e.monthlySalary * factor * (allScheduled.length ? scheduled.length / allScheduled.length : 0));
    const earnings = { basic: baseline, regularOT: 0, restDay: 0, restOT: 0, nsd: 0, specialHoliday: 0, specialOT: 0, regularHoliday: 0, regularHolidayOT: 0, otherHoliday: 0, otherOT: 0, allowance: 0, additional: 0, thirteenth: 0 };
    const deductions = { undertime: 0, absence: 0, SSS: 0, PhilHealth: 0, 'Pag-IBIG': 0, tax: 0, loans: 0, sssLoan: 0, pagibigLoan: 0, salaryDeduction: 0, other: 0 };
    const trace = [], late = [], leaveNotes = [], loanDeductions = [], workBreakdown = [];
    let holidayBase = 0, excludedLeave = 0, additionalBasic = 0, daysPresent = 0, leaveDays = 0;
    let lateDaysLost = 0, lateReduction = 0, lateMinutesUnoffset = 0;   // late time lowers credited days, never a separate deduction
    const add = (side, component, amount, formula, source, date, quantity = null, multiplier = null) => {
      const rounded = round(amount);
      side[component] = round(side[component] + rounded);
      trace.push({ component, side: side === earnings ? 'earnings' : 'deductions', amount: rounded, formula, sourceId: source?.id || r.id, sourceKind: source?.sourceKind || (source?.timeIn !== undefined ? 'attendance' : source?.typeId ? 'leaves' : source?.kind ? 'adjustments' : 'rules'), date, quantity, multiplier });
    };
    trace.push({ component: 'basic', side: 'earnings', amount: baseline, formula: dailyPaid ? `${daily} × ${scheduled.length} scheduled workdays (daily-paid)` : `${e.monthlySalary} × ${factor} × ${scheduled.length}/${allScheduled.length || 1} scheduled days employed`, sourceId: e.id, sourceKind: 'employees', date: start });
    // Manual entry for exactly this cutoff: "replace" skips attendance; "add" pays the typed hours on top of it.
    const manual = (state.payrollInputs || []).find(i => i.employeeId === e.id && i.start === start && i.end === end) || null;
    for (const d of manual?.mode === 'replace' ? [] : employed) {
      // Real time: a time-in with no time out yet counts as a scheduled workday (lateness from the actual time in);
      // it stays flagged until the time out is recorded.
      const openIn = (state.openClockIns || []).find(c => c.employeeId === e.id && c.workDate === d);
      let record = state.attendance.find(a => a.employeeId === e.id && a.date === d);
      if (!record && openIn) {
        const sched = scheduleOn(e, attendanceProfile, d, r), [sh, sm] = (sched.start || openIn.time).split(':').map(Number), endMin = sh * 60 + sm + Math.round(sched.hoursPerDay * 60);
        record = { id: `open-${openIn.id}`, employeeId: e.id, date: d, status: 'present', scheduledIn: sched.start || openIn.time, timeIn: openIn.time, timeOut: `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`, endNextDay: endMin >= 1440, breaks: [], approved: false, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true };
        blockers.push(`${prefix}: timed in at ${openIn.time} on ${d} with no time out yet; counted as a scheduled day until the time out is recorded.`);
      }
      const leave = state.leaves.find(l => l.employeeId === e.id && l.status === 'approved' && l.startDate <= d && l.endDate >= d);
      const rest = isRest(e, d), kind = classification(state, e, d);
      const half = leave && !rest && leaveFraction(leave, d) === 0.5;
      let leaveCoverMinutes = 0, leaveShiftStart = '';
      if (half) {
        // Half-day leave: half the day is leave (paid or unpaid by type); the other half follows attendance as usual.
        const type = state.leaveTypes.find(t => t.id === leave.typeId), normal = scheduleOn(e, attendanceProfile, d, r).hoursPerDay;
        leaveDays += 0.5; leaveNotes.push(`${d}: ${type?.name || leave.typeId} (half day${leave.startTime ? ` ${leave.startTime}-${leave.endTime}` : ''})`);
        if (type?.affectsPayroll && !type.paid) add(deductions, 'absence', daily / 2, `${daily} × 0.5 unpaid half-day leave`, leave, d);
        else add(earnings, 'basic', 0, `Approved ${type?.name || leave.typeId} (half day); salary already included in cutoff basic`, leave, d);
        if (type?.paid && !type.includedIn13th) excludedLeave += daily / 2;
        leaveCoverMinutes = normal * 30;
        // Morning leave: lateness is measured from the end of the leave.
        if (leave.endTime && leave.startDate === d && (!leave.startTime || leave.startTime <= (record?.scheduledIn || '00:00'))) leaveShiftStart = leave.endTime;
        if (!record) { add(deductions, 'absence', daily / 2, `${daily} × 0.5 day: no attendance for the other half of the day`, null, d); continue; }
      }
      if (leave && !rest && !half) {
        const type = state.leaveTypes.find(t => t.id === leave.typeId);
        leaveDays++; leaveNotes.push(`${d}: ${type?.name || leave.typeId}`);
        if (type?.affectsPayroll && !type.paid) add(deductions, 'absence', daily, `${daily} × 1 unpaid leave day`, leave, d);
        else add(earnings, 'basic', 0, `Approved ${type?.name || leave.typeId}; salary already included in cutoff basic`, leave, d);
        if (type?.paid && !type.includedIn13th) excludedLeave += daily;
        if (record?.status === 'present') blockers.push(`${prefix}: attendance conflicts with leave on ${d}.`);
        continue;
      }
      if (!record) {
        if (!rest || kind !== 'rest') blockers.push(`${prefix}: Missing attendance / approved leave on ${d}.`);
        // No attendance on a scheduled workday: the day is not credited (no pay) until attendance or a leave is recorded.
        if (!rest && kind === 'ordinary') add(deductions, 'absence', daily, `${daily} × 1 day with no attendance record (not credited)`, null, d);
        continue;
      }
      // Unapproved attendance is still counted (real time) but must be approved before the payroll is final.
      if (!record.approved && !String(record.id).startsWith('open-')) blockers.push(`${prefix}: attendance on ${d} is not approved.`);
      if (record.status !== 'present') {
        if (record.status === 'official-business') { add(earnings, 'basic', 0, 'Approved official business; salary already included in cutoff basic', record, d); continue; }
        if (record.status === 'rest-day-swap') { add(earnings, 'basic', 0, `Rest-day swap (${record.explanation}); salary already included in cutoff basic`, record, d); continue; }
        const holiday = kind.replace('-rest', '');
        if (['special', 'regular', 'double', 'other'].includes(holiday)) {
          const paidRate = (holiday === 'special' || holiday === 'other' || (e.coveredHoliday && record.holidayEligible)) ? r[`${holiday}Unworked`] : 0;
          const coveredBase = rest ? 0 : 1;
          if (paidRate < coveredBase) add(deductions, 'absence', daily * (coveredBase - paidRate), `${daily} × (${coveredBase} salary credit − ${paidRate} unworked policy)`, record, d);
          if (paidRate > coveredBase) add(earnings, holiday === 'special' ? 'specialHoliday' : 'regularHoliday', daily * (paidRate - coveredBase), `${daily} × (${paidRate} unworked policy − ${coveredBase} salary credit)`, record, d);
          holidayBase += daily * Math.min(coveredBase, paidRate);
        } else if (!rest) add(deductions, 'absence', daily, `${daily} × 1 absent day`, record, d);
        continue;
      }
      daysPresent++;
      const normalHours = scheduleOn(e, attendanceProfile, d, r).hoursPerDay;
      const startMinute = stamp(`${d}T${record.timeIn}`), scheduledMinute = stamp(`${d}T${leaveShiftStart || record.scheduledIn}`);
      // Company policy option: time before the scheduled start is not paid, so overtime only accrues after the scheduled end.
      const minutes = attendanceProfile?.paidFrom === 'schedule' && !rest ? attendanceMinutes(record).filter(m => m >= scheduledMinute) : attendanceMinutes(record);
      const lateMinutes = rest ? 0 : Math.max(0, (startMinute - scheduledMinute) / 60000);
      // Late time is offset by working the same minutes after the scheduled end (or by an approved offset); only what
      // is not offset is deducted. Late below the grace period (15 minutes) is not tagged late; from 15 minutes it is a
      // late incident (src/late-incidents.mjs: the 3rd in a month asks for an explanation letter) even when offset.
      const withinGrace = lateMinutes > 0 && lateMinutes < graceMinutes;
      const workedOffset = Math.max(0, Math.min(lateMinutes, minutes.length + lateMinutes + leaveCoverMinutes - normalHours * 60));
      const deductibleMinutes = record.exception ? 0 : Math.max(0, lateMinutes - workedOffset - record.offsetMinutes);
      // Unoffset late time is converted to a fraction of the scheduled day and taken off the days credited for pay.
      const dayMinutes = normalHours * 60, lostDay = r.deductLate ? deductibleMinutes / dayMinutes : 0, deduction = round(lostDay * daily);
      late.push({ date: d, scheduledTime: record.scheduledIn, actualTime: record.timeIn, lateMinutes, approvedOffset: record.offsetMinutes, withinGrace, workedOffset, validExplanation: record.exception, explanation: record.explanation, deductibleMinutes: r.deductLate ? deductibleMinutes : 0, dayFraction: Math.round(lostDay * 10000) / 10000, deduction, sourceId: record.id });
      if (deduction) {
        lateDaysLost += lostDay; lateReduction += deduction; lateMinutesUnoffset += deductibleMinutes;
        add(earnings, 'basic', -deduction, `Late ${deductibleMinutes} min not offset ÷ ${dayMinutes} min day = ${Math.round(lostDay * 10000) / 10000} day × ${daily} (days credited reduced)`, record, d);
      }
      const under = rest || record.exception ? 0 : Math.max(0, normalHours * 60 - minutes.length - lateMinutes - leaveCoverMinutes);
      if (r.deductUndertime && under) add(deductions, 'undertime', under / 60 * hourly, `${under} minutes ÷ 60 × ${hourly}`, record, d);
      const groups = new Map();
      // Policy "separate" (the default): time after the schedule is overtime only up to the hours the employee filed
      // and HR approved; clocking out late without a filing is not paid. A pending filing blocks posting.
      const separateOT = (r.overtimeApproval || 'separate') === 'separate', filings = (state.overtimeRequests || []).filter(o => o.employeeId === e.id && o.date === d);
      const approvedOTMinutes = filings.filter(o => o.status === 'approved').reduce((s, o) => s + o.approvedHours * 60, 0);
      if (separateOT && e.coveredOT && filings.some(o => o.status === 'pending')) blockers.push(`${prefix}: overtime filed for ${d} is pending approval. Approve or reject it in Attendance → Overtime filings before posting.`);
      let unfiledMinutes = 0;
      minutes.forEach((m, index) => {
        const date = new Date(m).toISOString().slice(0, 10), c = classification(state, e, date);
        const ot = index >= normalHours * 60, h = new Date(m).getUTCHours(), night = h >= 22 || h < 6;
        if (ot && separateOT && e.coveredOT && index - normalHours * 60 >= approvedOTMinutes) { unfiledMinutes++; return; }
        const key = `${date}/${c}/${ot}/${night}`;
        const group = groups.get(key) || { date, c, ot, night, count: 0 }; group.count++; groups.set(key, group);
      });
      if (unfiledMinutes) trace.push({ component: 'regularOT', side: 'earnings', amount: 0, formula: `${round(unfiledMinutes / 60)} h after the schedule${approvedOTMinutes ? ` beyond the ${round(approvedOTMinutes / 60)} h approved` : ''} without approved overtime filing: not paid`, sourceKind: 'attendance', sourceId: record.id, date: d, quantity: round(unfiledMinutes / 60) });
      for (const g of groups.values()) {
        const mult = dayRate(g.c, r), overtime = g.c === 'ordinary' ? r.ordinaryOT : r.premiumOT;
        const fullRate = mult * (g.ot ? overtime : 1), hours = g.count / 60;
        let component = g.c.startsWith('special') ? (g.ot ? 'specialOT' : 'specialHoliday') : g.c.startsWith('regular') || g.c.startsWith('double') ? (g.ot ? 'regularHolidayOT' : 'regularHoliday') : g.c.startsWith('other') ? (g.ot ? 'otherOT' : 'otherHoliday') : g.c === 'rest' ? (g.ot ? 'restOT' : 'restDay') : g.ot ? 'regularOT' : 'basic';
        const credit = !g.ot && !rest ? 1 : 0;
        // Exempt employees require an explicit approved additional-pay entry for OT.
        if (g.ot && !e.coveredOT) continue;
        if (!g.ot && component !== 'basic' && !rest) holidayBase += g.c === 'rest' ? 0 : hours * hourly;
        const amount = hours * hourly * (fullRate - credit);
        workBreakdown.push({ date: g.date, classification: g.c, overtime: g.ot, night: g.night, hours: round(hours), dayMultiplier: mult, otMultiplier: g.ot ? overtime : 1, nightMultiplier: g.night && e.coveredNSD ? 1 + r.nsd : 1, combinedMultiplier: Math.round(fullRate * (g.night && e.coveredNSD ? 1 + r.nsd : 1) * 10000) / 10000, sourceId: record.id });
        if (amount) {
          add(earnings, component, amount, `${round(hours)} h × ${round(hourly)} × (${mult}${g.ot ? ` × ${overtime}` : ''} − ${credit} already in salary)`, record, g.date, round(hours), fullRate);
          if (component === 'basic') additionalBasic += amount;
        }
        else if (!g.ot) add(earnings, 'basic', 0, `${round(hours)} regular hours; salary already included in cutoff basic`, record, g.date, round(hours), 1);
        if (g.night && e.coveredNSD) add(earnings, 'nsd', hours * hourly * fullRate * r.nsd, `${round(hours)} night h × ${round(hourly)} × ${mult}${g.ot ? ` × ${overtime}` : ''} × ${r.nsd} differential only`, record, g.date, round(hours), fullRate * (1 + r.nsd));
      }
    }
    if (manual) {
      const m = manual, src = { id: `manual-${e.id}-${start}`, sourceKind: 'payroll-inputs' }, tag = `Manual entry by ${m.updatedBy}${m.reason ? ` (${m.reason})` : ''}`;
      if (m.mode === 'replace') {
        if (dailyPaid) {
          const diff = round(daily * m.daysWorked - baseline);
          if (diff) add(earnings, 'basic', diff, `${tag}: ${m.daysWorked} days worked × ${daily} instead of ${scheduled.length} scheduled days`, src, end, m.daysWorked, 1);
          daysPresent = m.daysWorked;
        } else {
          if (m.absenceDays) add(deductions, 'absence', daily * m.absenceDays, `${tag}: ${m.absenceDays} absent day(s) × ${daily}`, src, end, m.absenceDays, 1);
          daysPresent = Math.max(0, scheduled.length - m.absenceDays);
        }
        if (m.lateMinutes) {
          const amount = round(m.lateMinutes / 60 * hourly), dayMinutes = (r.normalHours || 8) * 60;
          lateDaysLost += m.lateMinutes / dayMinutes; lateReduction += amount; lateMinutesUnoffset += m.lateMinutes;
          add(earnings, 'basic', -amount, `${tag}: late ${m.lateMinutes} min ÷ 60 × ${hourly} (days credited reduced)`, src, end);
        }
        if (m.undertimeMinutes) add(deductions, 'undertime', m.undertimeMinutes / 60 * hourly, `${tag}: undertime ${m.undertimeMinutes} min ÷ 60 × ${hourly}`, src, end);
      }
      // Hours typed by HR, priced with the approved multipliers. Holiday hours are on a scheduled workday, so the
      // day itself is already in the salary and only the premium is added.
      // A manual "add" entry for a component that attendance already pays would count the same work twice: flag it.
      const fromAttendance = new Set(trace.filter(t => t.sourceKind === 'attendance' && t.side === 'earnings' && t.amount > 0).map(t => t.component));
      const H = (key, component, multiplier, label, c, ot, night = false) => {
        const h = m.hours?.[key] || 0; if (!h) return;
        if (m.mode === 'add' && fromAttendance.has(component)) blockers.push(`${prefix}: manual ${label} hours overlap ${label} already calculated from attendance. Review the manual entry (use "replace" or remove the overlap).`);
        add(earnings, component, h * hourly * multiplier, `${tag}: ${h} h × ${round(hourly)} × ${Math.round(multiplier * 10000) / 10000} ${label}`, src, end, h, multiplier);
        workBreakdown.push({ date: end, classification: c, overtime: ot, night, hours: h, dayMultiplier: multiplier, otMultiplier: 1, nightMultiplier: 1, combinedMultiplier: multiplier, sourceId: src.id });
      };
      H('regularOT', 'regularOT', r.ordinaryOT, 'overtime', 'ordinary', true);
      H('restDay', 'restDay', dayRate('rest', r), 'rest day', 'rest', false);
      H('restOT', 'restOT', dayRate('rest', r) * r.premiumOT, 'rest day overtime', 'rest', true);
      H('specialHoliday', 'specialHoliday', dayRate('special', r) - 1, 'special holiday premium', 'special', false);
      H('specialOT', 'specialOT', dayRate('special', r) * r.premiumOT, 'special holiday overtime', 'special', true);
      H('regularHoliday', 'regularHoliday', dayRate('regular', r) - 1, 'regular holiday premium', 'regular', false);
      H('regularHolidayOT', 'regularHolidayOT', dayRate('regular', r) * r.premiumOT, 'regular holiday overtime', 'regular', true);
      H('nightDiff', 'nsd', r.nsd, 'night differential', 'ordinary', false, true);
    }
    for (const a of state.adjustments.filter(a => a.employeeId === e.id && a.date >= start && a.date <= end)) {
      if (!a.approved) { blockers.push(`${prefix}: additional pay/deduction ${a.id} needs approval.`); continue; }
      const deduction = a.kind === 'otherDeduction';
      add(deduction ? deductions : earnings, deduction ? 'other' : a.kind, a.amount, a.reason, a, a.date);
      if (!deduction && a.includedIn13th) additionalBasic += a.amount;
    }
    // Company deductions: each appears on the payslip under its own name.
    for (const d of (state.deductions || []).filter(d => d.employeeId === e.id && d.active && deductionApplies(d, start, end))) {
      add(deductions, 'other', d.amount, d.name, { id: d.id, sourceKind: 'deductions' }, end);
    }
    // A loan with a balance keeps being deducted after its planned last date (e.g. after skipped cutoffs).
    for (const loan of state.loans.filter(l => l.employeeId === e.id && l.authorized && round(l.balance + (l.interestBalance || 0)) > 0 && l.startDate <= end)) {
      if ((loan.skipCutoffs || []).includes(start)) {
        trace.push({ component: 'loans', side: 'deductions', amount: 0, formula: `${loan.type} ${loan.reference}: not deducted this cutoff (skipped at the employee's request)`, sourceKind: 'loans', sourceId: loan.id, date: end });
        continue;
      }
      if (!loan.remainingTerms) { blockers.push(`${prefix}: loan ${loan.reference} has a balance but no remaining terms.`); continue; }
      const alreadyDeducted = state.runs.filter(run => run.status === 'posted' && run.start.slice(0, 7) === start.slice(0, 7)).flatMap(run => run.rows).flatMap(row => row.loanDeductions).filter(l => l.loanId === loan.id).reduce((sum, l) => sum + l.amount, 0);
      // Total due = principal + any interest; the final deduction never exceeds it. Interest is taken pro rata, so
      // only the principal portion reduces the principal balance.
      const interestDue = loan.interestBalance || 0, due = round(loan.balance + interestDue);
      const monthlyLeft = loan.monthlyAmortization > 0 ? Math.max(0, loan.monthlyAmortization - alreadyDeducted) : Infinity;
      const amount = round(Math.min(due, loan.perPayroll, monthlyLeft));
      if (!amount) continue;
      const interest = due ? round(amount * interestDue / due) : 0, principal = round(amount - interest);
      loanDeductions.push({ loanId: loan.id, type: loan.type, reference: loan.reference, amount, principal, interest, previousBalance: loan.balance, remainingBalance: round(loan.balance - principal), previousInterest: interestDue, remainingInterest: round(interestDue - interest), startDate: loan.startDate, endDate: loan.endDate, terms: loan.terms, previousTerms: loan.remainingTerms, remainingTerms: amount >= due ? 0 : loan.remainingTerms - 1 });
      deductions.loans = round(deductions.loans + amount);
      trace.push({ component: 'loans', side: 'deductions', amount, formula: `${loan.type} ${loan.reference}: min(${due} due, ${loan.perPayroll} per payroll${loan.monthlyAmortization > 0 ? `, ${round(loan.monthlyAmortization - alreadyDeducted)} monthly amount remaining` : ''})${interest ? ` = ${principal} principal + ${interest} interest` : ''}`, sourceKind: 'loans', sourceId: loan.id, date: end });
    }
    // Manual overrides replace a computed amount; the original stays in the trace and on the row for review.
    const overrides = [];
    const override = (side, bucket, keys) => {
      for (const o of (manual?.overrides || []).filter(x => keys.includes(x.component))) {
        const original = round(bucket[o.component] || 0), delta = round(o.amount - original);
        bucket[o.component] = round(o.amount);
        trace.push({ component: o.component, side, amount: delta, formula: `Manual override by ${manual.updatedBy}: ${original} calculated → ${o.amount}${o.reason ? ` (${o.reason})` : ''}`, sourceKind: 'payroll-overrides', sourceId: `${e.id}:${start}:${o.component}`, date: end });
        overrides.push({ component: o.component, side, original, revised: round(o.amount), delta, reason: o.reason, by: manual.updatedBy, at: manual.updatedAt });
      }
    };
    override('earnings', earnings, OVERRIDE_EARNINGS);
    override('deductions', deductions, ['absence', 'undertime', 'other', 'sssLoan', 'pagibigLoan', 'salaryDeduction']);
    // Overrides of basic, absence and undertime also change the basic salary earned (13th month and final pay).
    const basicOverride = overrides.filter(o => o.component === 'basic').reduce((s, o) => s + o.delta, 0);
    // Absences reduce the attendance credited and therefore basic pay; they are not shown as a deduction.
    const absenceAmount = round(deductions.absence || 0);
    if (absenceAmount) {
      earnings.basic = Math.max(0, round(earnings.basic - absenceAmount)); deductions.absence = 0;   // rounding never makes it negative
      if (!daysPresent && !leaveDays && earnings.basic < 1) earnings.basic = 0;   // no day credited: no centavo residue from rounding
      for (const t of trace) if (t.component === 'absence' && t.side === 'deductions') Object.assign(t, { component: 'basic', side: 'earnings', amount: -t.amount, formula: `Absence (days credited reduced): ${t.formula}` });
    }
    const applicableBasic = round(Math.max(0, baseline - absenceAmount - lateReduction - deductions.undertime - (r.includeHolidayBaseIn13th ? 0 : holidayBase) - excludedLeave + additionalBasic + basicOverride));
    const annualRows = state.runs.filter(run => run.status === 'posted' && run.start.slice(0, 4) === start.slice(0, 4)).flatMap(run => run.rows.filter(row => row.employeeId === e.id));
    const prior = priorBasicFor(state, e.id, start.slice(0, 4));
    const annualBasic = round(annualRows.reduce((s, row) => s + row.applicableBasic, 0) + prior.basic + applicableBasic);
    const thirteenthAccrued = e.covered13th ? round(annualBasic / 12) : 0;
    const thirteenthPaid = round(annualRows.reduce((s, row) => s + row.earnings.thirteenth, 0) + prior.thirteenthPaid);
    const thirteenthBalance = Math.max(0, round(thirteenthAccrued - thirteenthPaid));
    if (pay13th) add(earnings, 'thirteenth', thirteenthBalance, `${annualBasic} applicable annual basic${prior.basic ? ` (incl. ${prior.basic} encoded for ${prior.months.length} month${prior.months.length === 1 ? '' : 's'} before the system)` : ''} ÷ 12 − ${thirteenthPaid} already paid`, null, end);
    // Semi-monthly payroll takes half each cutoff by default, or the full monthly amount on one chosen cutoff.
    const contributionFactor = r.cutoff === 'monthly' ? 1 : r.contributionTiming === 'second' ? (start.endsWith('-16') ? 1 : 0) : r.contributionTiming === 'first' ? (start.endsWith('-01') ? 1 : 0) : factor;
    // Employee shares are deducted; employer shares (and SSS EC) are recorded separately and never reduce pay.
    // An approved contribution setting may change the basis per agency (never the salary) or fix a share.
    const employer = { SSS: 0, 'SSS EC': 0, PhilHealth: 0, 'Pag-IBIG': 0 }, setting = activeContributionSetting(state.contributionChanges, e.id, start), contributionBasis = {};
    for (const name of ['SSS', 'PhilHealth', 'Pag-IBIG']) {
      const adjusted = setting?.agencies?.[name] || {}, [eeKey, erKey, ecKey] = SETTING_SHARE_KEYS[name];
      const override = setting ? { [eeKey]: adjusted.employee, [erKey]: adjusted.employer, ...(ecKey ? { [ecKey]: adjusted.ec } : {}) } : contributionOverride || {};
      const basisAmount = adjusted.basis ?? e.monthlySalary;
      contributionBasis[name] = basisAmount;
      const s = contributionShares(name, r.contributions[name], basisAmount, `${prefix} ${name}`, blockers, override);
      const basisText = adjusted.basis !== null && adjusted.basis !== undefined ? `${name} contribution basis ${basisAmount} (salary ${e.monthlySalary}; approved change ${setting.id.slice(0, 8)}, ${setting.effectiveDate})` : `Monthly salary ${e.monthlySalary}`;
      const basis = s.overridden ? `${basisText}; ${setting ? `share set by approved change (${setting.reason})` : `employee override (${override.reason || 'HR'})`}` : `${basisText} -> approved ${name} monthly bracket`;
      add(deductions, name, s.employee * contributionFactor, `${basis} x ${contributionFactor}${contributionFactor === 1 ? ' (full monthly amount this cutoff)' : contributionFactor === 0 ? ' (deducted on the other cutoff)' : ''}`, null, end);
      employer[name] = round(s.employer * contributionFactor);
      trace.push({ component: name, side: 'employer', amount: employer[name], formula: `${basis}: employer share ${s.employer} x ${contributionFactor}`, sourceKind: 'rules', sourceId: r.id, date: end });
      if (name === 'SSS') {
        employer['SSS EC'] = round(s.ec * contributionFactor);
        trace.push({ component: 'SSS EC', side: 'employer', amount: employer['SSS EC'], formula: `${basis}: Employees' Compensation ${s.ec} x ${contributionFactor}`, sourceKind: 'rules', sourceId: r.id, date: end });
      }
    }
    // Employee contribution shares typed for this cutoff (the employee's contribution basis is unchanged).
    override('deductions', deductions, ['SSS', 'PhilHealth', 'Pag-IBIG']);
    const employerTotal = round(Object.values(employer).reduce((s, n) => s + n, 0));
    const gross = round(Object.values(earnings).reduce((s, n) => s + n, 0));
    const contributionTotal = deductions.SSS + deductions.PhilHealth + deductions['Pag-IBIG'];
    // Tax brackets use this cutoff's taxable earnings. Configure the table for the selected cutoff.
    const taxableThirteenth = Math.max(0, thirteenthPaid + earnings.thirteenth - r.thirteenthTaxExemption) - Math.max(0, thirteenthPaid - r.thirteenthTaxExemption);
    const taxBasis = Math.max(0, gross - earnings.thirteenth + taxableThirteenth - deductions.absence - deductions.undertime - contributionTotal);
    // Employees marked exempt in their payroll profile have no withholding tax (a manual override can still set one).
    if (payrollProfile?.withholdingTax === 'exempt') trace.push({ component: 'tax', side: 'deductions', amount: 0, formula: `Exempt from withholding tax (payroll setting); taxable cutoff earnings ${round(taxBasis)}`, sourceKind: 'employees', sourceId: e.id, date: end });
    else add(deductions, 'tax', bracketAmount(r.taxBrackets, taxBasis, `${prefix} withholding tax`, blockers), `Taxable cutoff earnings ${round(taxBasis)} → approved ${r.cutoff} bracket; includes ${round(taxableThirteenth)} taxable 13th-month excess over configured annual exemption ${r.thirteenthTaxExemption}`, null, end);
    override('deductions', deductions, ['tax']);
    const totalDeductions = round(Object.values(deductions).reduce((s, n) => s + n, 0)), net = round(gross - totalDeductions);
    const loanBalance = round(state.loans.filter(l => l.employeeId === e.id).reduce((sum, l) => sum + l.balance, 0) - deductions.loans);
    if (net < 0) blockers.push(`${prefix}: net salary is negative. Review authorized deductions.`);
    return { employeeId: e.id, employeeName: e.name, monthlySalary: e.monthlySalary, manualEntry: manual, overrides, absenceAmount, payBasis: payrollProfile?.basis || 'monthly', contributionBasis, contributionChangeId: setting?.id || null, workingDays: scheduled.length, daysPresent, creditedDays: Math.round((daysPresent - lateDaysLost) * 10000) / 10000, lateDaysLost: Math.round(lateDaysLost * 10000) / 10000, lateMinutesUnoffset, lateReduction: round(lateReduction), leaveDays, leaveNotes, hourlyRate: round(hourly), dailyRate: round(daily), earnings, deductions, gross, totalDeductions, net, applicableBasic, annualBasic, thirteenthAccrued, thirteenthPaid, thirteenthBalance, loanDeductions, loanBalance, late, trace, workBreakdown, employer, employerTotal, contributionFactor };
  });
  if (!rows.length) blockers.push('No employees are eligible for this cutoff.');
  const result = { start, end, pay13th, ...(chosen ? { employeeIds: [...chosen] } : {}), ruleId: r.id, rows, blockers: [...new Set(blockers)], totals: { gross: round(rows.reduce((s, row) => s + row.gross, 0)), deductions: round(rows.reduce((s, row) => s + row.totalDeductions, 0)), net: round(rows.reduce((s, row) => s + row.net, 0)), employer: round(rows.reduce((s, row) => s + row.employerTotal, 0)) } };
  return { ...result, fingerprint: createHash('sha256').update(JSON.stringify({ state, result })).digest('hex') };
}
