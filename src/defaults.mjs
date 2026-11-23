import { DOLE_HANDBOOK, DOLE_HOLIDAY_RATES } from './holiday-rates.mjs';
export const handbook = DOLE_HANDBOOK;
export const defaultRules = {
  id: 'initial', effectiveDate: '2026-01-01', basis: `DOLE holiday pay (Handbook on Workers' Statutory Monetary Benefits, 2024). Verify employee coverage and current issuances before approving. ${handbook}`,
  approvedBy: '', updatedAt: '', ...DOLE_HOLIDAY_RATES,
  normalHours: 8, dailyDivisor: 22, hourlyDivisor: 8, workdaysPerMonth: 22,
  graceMinutes: 15, lateThresholdMinutes: 5, deductLate: true, deductUndertime: true, cutoff: 'semi-monthly', overtimeApproval: 'separate',
  includeHolidayBaseIn13th: false, contributionsReviewed: false,
  calendarReviewedYears: [], thirteenthTaxExemption: 0,
  contributions: { SSS: [], PhilHealth: [], 'Pag-IBIG': [] }, taxBrackets: [],
  contributionBasis: 'monthly-salary', taxBasis: 'gross-less-contributions',
};

export const leaveNames = [
  ['vacation', 'Vacation Leave'], ['sick', 'Sick Leave'], ['emergency', 'Emergency Leave'],
  ['bereavement', 'Bereavement Leave'], ['maternity', 'Maternity Leave'], ['paternity', 'Paternity Leave'],
  ['solo-parent', 'Solo Parent Leave'], ['parental', 'Parental Leave'],
  ['sil', 'Service Incentive Leave (SIL)'], ['unpaid', 'Unpaid Leave / Absent'],
];
export function initialState() {
  return {
    version: 1, employees: [], attendance: [], leaves: [], holidays: [], loans: [], adjustments: [], deductions: [], runs: [],
    rules: [structuredClone(defaultRules)],
    leaveTypes: leaveNames.map(([id, name]) => ({
      id, name, paid: id !== 'unpaid', category: ['sil', 'maternity', 'paternity', 'solo-parent'].includes(id) ? 'statutory' : 'company',
      entitledDays: id === 'sil' ? 5 : 0, minServiceMonths: id === 'sil' ? 12 : 0,
      eligibility: id === 'sil' ? 'At least one year of service; HR must verify statutory coverage and exclusions.' : 'HR must configure entitlement and verify individual eligibility before approval.',
      accrual: 'annual', carryOverDays: 0, expirationMonths: 12,
      dayBasis: id === 'maternity' ? 'calendar' : 'working',
      documentsRequired: !['vacation', 'unpaid'].includes(id), approvalRequired: true,
      affectsPayroll: true, includedIn13th: id !== 'unpaid', balanceRequired: id !== 'unpaid',
    })),
  };
}
