// Salary days: the 1st–15th cutoff is paid on the 22nd of the same month; the 16th–end cutoff on the 8th of the
// next month (a whole-month cutoff is also paid on the 8th of the next month). Payslips of a finalized payroll
// become visible in the employee's account on that day (Asia/Manila).
export const PAY_DAY_FIRST_CUTOFF = 22;
export const PAY_DAY_SECOND_CUTOFF = 8;
const pad = n => String(n).padStart(2, '0');
export function payDateFor(start, end) {
  const y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7));
  const firstHalf = start.slice(8, 10) === '01' && Number(end.slice(8, 10)) <= 15;
  if (firstHalf) return `${y}-${pad(m)}-${pad(PAY_DAY_FIRST_CUTOFF)}`;
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-${pad(PAY_DAY_SECOND_CUTOFF)}`;
}
export const payslipReleased = (run, today) => run.status === 'posted' && (!!run.releasedAt || payDateFor(run.start, run.end) <= today);
