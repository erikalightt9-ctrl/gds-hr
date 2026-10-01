export const handbook = 'https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf';
export const defaultRules = {
  id: 'initial', effectiveDate: '2026-01-01', basis: `Starting policy template; verify employee coverage and current issuances. ${handbook}`,
  approvedBy: '', updatedAt: '', ordinaryOT: 1.25, rest: 1.3, premiumOT: 1.3,
  special: 1.3, specialRest: 1.5, regular: 2, double: 3, nsd: 0.1,
  specialUnworked: 0, regularUnworked: 1, doubleUnworked: 2, other: 1, otherUnworked: 0,
  normalHours: 8, dailyDivisor: 22, hourlyDivisor: 8, workdaysPerMonth: 22,
  graceMinutes: 0, deductLate: true, deductUndertime: true, cutoff: 'semi-monthly',
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
    version: 1, employees: [], attendance: [], leaves: [], holidays: [], loans: [], adjustments: [], runs: [],
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
