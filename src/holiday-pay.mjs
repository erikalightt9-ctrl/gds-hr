// Holiday breakdown of a payroll row, shared by the payslip (screen and PDF) and the payroll exports, so every place
// shows the same split. The engine's earnings.basic still holds the whole cutoff basic (13th month, tax and totals use
// it); here it is divided into:
//   regularBasic  basic for the regular workdays (basic less the one-day pay of each holiday credited)
//   holidayPay    one day per holiday credited (row.holidayPay) + the holiday-work premiums (specialHoliday,
//                 regularHoliday, otherHoliday), so each holiday is paid once
//   overtime      overtime (also on holidays / rest days), rest-day premium and night differential
// Rows posted before this breakdown existed have no holiday fields: their basic stays whole and only the premiums move.
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
export const HOLIDAY_PREMIUM_KEYS = ['specialHoliday', 'regularHoliday', 'otherHoliday'];
export const OVERTIME_KEYS = ['regularOT', 'restOT', 'specialOT', 'regularHolidayOT', 'otherOT', 'nsd', 'restDay'];

export function holidaySplit(row) {
  const e = row.earnings || {}, sum = keys => keys.reduce((s, k) => s + (Number(e[k]) || 0), 0);
  const dayPay = Math.max(0, Math.min(Number(row.holidayPay) || 0, Number(e.basic) || 0));
  const holidayPremium = round(sum(HOLIDAY_PREMIUM_KEYS));
  return {
    holidayDays: dayPay ? (row.holidayDays ?? 0) : 0,
    holidayDayPay: round(dayPay),
    holidayPremium,
    holidayPay: round(dayPay + holidayPremium),
    regularBasic: round((Number(e.basic) || 0) - dayPay),
    regularDays: row.regularDays ?? row.creditedDays ?? row.daysPresent ?? 0,
    overtime: round(sum(OVERTIME_KEYS)),
  };
}
