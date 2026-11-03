import { defaultRules, initialState } from '../src/defaults.mjs';

export function fixture() {
  const s = initialState();
  s.rules = [{ ...defaultRules, id: 'r1', effectiveDate: '2026-01-01', approvedBy: 'admin', contributionsReviewed: true, overtimeApproval: 'attendance' }];
  s.employees = [{ id: 'EMP-001', name: 'Test Employee', department: 'Operations', monthlySalary: 30000, startDate: '2025-01-01', endDate: '', restDays: [0, 6], scheduleStart: '08:00', coveredOT: true, coveredNSD: true, coveredHoliday: true, covered13th: true, leaveEligibility: ['vacation', 'sil'], active: true }];
  return s;
}
export function attend(date, extra = {}) {
  return { id: date, employeeId: 'EMP-001', date, status: 'present', scheduledIn: '08:00', timeIn: '08:00', timeOut: '16:00', endNextDay: false, breaks: [], approved: true, offsetMinutes: 0, exception: false, explanation: '', holidayEligible: true, ...extra };
}
