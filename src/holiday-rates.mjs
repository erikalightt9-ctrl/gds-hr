// Philippine holiday-pay rates from the DOLE/NWPC Handbook on Workers' Statutory Monetary Benefits,
// 2024 edition (https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf).
// Adopted for GDS on 20 November 2026. These are the configurable Rules & rates defaults.
// A rules version that carries them is not in force until an administrator approves it.
//
// Combined rates the engine derives (day rate × overtime factor × night factor):
//   regular holiday worked 200%; OT 260%; on a rest day 260%; rest-day OT 338%
//   special non-working day worked 130%; OT 169%; on a rest day 150%; rest-day OT 195%
//   double regular holiday worked 300%; OT 390%; on a rest day 390%; rest-day OT 507%
//   unworked regular 100% and unworked double 200%, only when qualifiesForUnworkedHoliday is true
//   unworked special: statutory floor 0 (no pay). GDS company policy is 1 (stay paid) and applies first.
// Night differential (nsd) is added on top of the rate for that hour. It is not folded into these day rates.
export const DOLE_HANDBOOK = 'https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf';

export const DOLE_HOLIDAY_RATES = {
  ordinaryOT: 1.25, rest: 1.3, premiumOT: 1.3,
  special: 1.3, specialRest: 1.5, regular: 2, double: 3, other: 1, nsd: 0.1,
  specialUnworked: 0, regularUnworked: 1, doubleUnworked: 2, otherUnworked: 0,
};

// Legal basis stored on the unapproved rules version. Must stay within the 1,000-character rules limit,
// and must not contain the word "draft" (an approved version cannot keep that wording).
// GDS decision 20 Nov 2026: unworked special non-working days stay paid. That practice is more favorable
// than the DOLE floor (no work, no pay) and the handbook allows it. The rules version uses this value.
export const COMPANY_SPECIAL_UNWORKED = 1;

export const DOLE_HOLIDAY_BASIS = `Holiday premiums follow the DOLE Handbook on Workers' Statutory Monetary Benefits, 2024 edition, adopted 20 November 2026. Where company policy is more favorable, it applies first. Unworked special non-working days stay paid (GDS decision; the statutory floor is no pay). Unworked regular holiday: 100% if present or on paid leave the workday before. Unworked double regular holiday: 200% on that condition. Worked regular holiday: 200%, overtime 260%; on a rest day 260%, overtime 338%. Special non-working day worked: 130%, overtime 169%; on a rest day 150%, overtime 195%. Double regular holiday worked: 300%, overtime 390%. Night differential stays 10% of that hour's rate, added on top. Not approved. ${DOLE_HANDBOOK}`;

export const DOLE_HOLIDAY_DRAFT_ID = 'dole-holiday-2026-11-16';
export const DOLE_HOLIDAY_EFFECTIVE = '2026-11-16';

const weekday = date => new Date(`${date}T00:00:00Z`).getUTCDay();
const isRestDay = (employee, date) => (employee.restDays || []).includes(weekday(date));
export const shiftDate = (date, days) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// The handbook's combined percentages, from the stored rule values. Tests lock these to the DOLE table.
const r4 = n => Math.round((n + Number.EPSILON) * 10000) / 10000;
export function holidayPremiums(rules) {
  const ot = rules.premiumOT, night = 1 + rules.nsd;
  return {
    regularUnworked: rules.regularUnworked,
    regular: rules.regular,
    regularOT: r4(rules.regular * ot),
    regularRest: r4(rules.regular * rules.rest),
    regularRestOT: r4(rules.regular * rules.rest * ot),
    regularNight: r4(rules.regular * night),
    specialUnworked: rules.specialUnworked,
    special: rules.special,
    specialOT: r4(rules.special * ot),
    specialRest: rules.specialRest,
    specialRestOT: r4(rules.specialRest * ot),
    doubleUnworked: rules.doubleUnworked,
    double: rules.double,
    doubleOT: r4(rules.double * ot),
    doubleRest: r4(rules.double * rules.rest),
    doubleRestOT: r4(rules.double * rules.rest * ot),
    nsd: rules.nsd,
  };
}

function leaveOn(state, employee, date) {
  return (state.leaves || []).find(l => l.employeeId === employee.id && l.status === 'approved' && l.startDate <= date && l.endDate >= date);
}
function paidLeaveOn(state, employee, date) {
  const leave = leaveOn(state, employee, date);
  if (!leave) return false;
  return !!(state.leaveTypes || []).find(t => t.id === leave.typeId)?.paid;
}
// Present, on official business, still timed in, or a work-from-home day the schedule counts as present.
function workedOn(state, employee, date, profile) {
  const rec = (state.attendance || []).find(a => a.employeeId === employee.id && a.date === date);
  if (rec) return rec.status === 'official-business' || (rec.status === 'present' && !!rec.timeIn);
  if ((state.openClockIns || []).some(c => c.employeeId === employee.id && c.workDate === date)) return true;
  if (leaveOn(state, employee, date) || isRestDay(employee, date)) return false;
  return !!(profile?.daySchedules || []).find(s => s.day === weekday(date))?.autoPresent;
}

// Article 94 / handbook §E: unworked regular (and double) holiday pay requires presence or paid leave
// on the workday immediately before the holiday. A rest day in between is skipped. Two regular holidays
// in a row: the later one is paid when the earlier one was worked, or when the earlier one itself qualified.
// holidayEligible: false on the holiday's attendance record withholds the pay. Covered employees only.
export function qualifiesForUnworkedHoliday(state, employee, date, attendanceProfile = {}, seen = new Set()) {
  if (!employee?.coveredHoliday || seen.has(date)) return false;
  seen.add(date);
  const record = (state.attendance || []).find(a => a.employeeId === employee.id && a.date === date);
  if (record && record.holidayEligible === false) return false;
  let previous = shiftDate(date, -1);
  for (let i = 0; i < 14 && isRestDay(employee, previous); i++) previous = shiftDate(previous, -1);
  if (employee.startDate && previous < employee.startDate) return false;
  const earlier = (state.holidays || []).find(h => h.date === previous && (h.kind === 'regular' || h.kind === 'double'));
  if (earlier) return workedOn(state, employee, previous, attendanceProfile) || qualifiesForUnworkedHoliday(state, employee, previous, attendanceProfile, seen);
  return workedOn(state, employee, previous, attendanceProfile) || paidLeaveOn(state, employee, previous);
}
