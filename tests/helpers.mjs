import { initialState, defaultRules } from '../src/defaults.mjs';
import { dates, isRest } from '../src/engine.mjs';
export const admin = { id: 'admin', username: 'admin', role: 'admin' };
export function completeState() {
  const state = initialState();
  // Fictional zero contribution brackets for tests only, never production defaults.
  const zero = [{ from: 0, to: null, fixed: 0, rate: 0, excessOver: 0 }];
  state.rules = [{ ...structuredClone(defaultRules), id: 'r1', effectiveDate: '2026-01-01', basis: 'Fictional test policy, not statutory contribution tables', approvedBy: 'admin', contributionsReviewed: true, calendarReviewedYears: [2026], contributions: { SSS: zero, PhilHealth: zero, 'Pag-IBIG': zero }, taxBrackets: zero, thirteenthTaxExemption: 90000 }];
  state.employees = [{ id: 'EMP-001', name: 'Sample Employee', department: 'Operations', monthlySalary: 30000, startDate: '2025-01-01', endDate: '', restDays: [0, 6], scheduleStart: '08:00', active: true, coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: ['vacation', 'sil', 'unpaid'] }];
  state.attendance = dates('2026-09-01', '2026-09-15').filter(d => !isRest(state.employees[0], d)).map(d => ({ id: `a-${d}`, employeeId: 'EMP-001', date: d, status: 'present', scheduledIn: '08:00', timeIn: '08:00', timeOut: '16:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true }));
  state.loans = [{ id: 'loan1', employeeId: 'EMP-001', type: 'Salary Loan', reference: 'TEST-001', original: 50000, balance: 1200, monthlyAmortization: 5000, perPayroll: 2500, startDate: '2026-01-01', endDate: '2026-12-31', terms: 20, remainingTerms: 1, authorized: true }];
  return state;
}
