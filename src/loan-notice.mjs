// The employee's notice when HR records or changes their loan (written from Store.log for every 'loans' create /
// update / payroll reversal by HR, so every way of changing a loan is covered). HR and the employee read the same loan
// record, so the change shows on both sides; this notice tells the employee what changed, old → new.
const peso = n => `₱${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SCHEDULE = { every: 'every cutoff', first: '1st–15th cutoff only', second: '16th–end cutoff only' };
const FIELDS = [
  ['type', 'loan type', v => v || '—'], ['reference', 'reference', v => v || '—'], ['original', 'amount', peso], ['balance', 'balance', peso],
  ['interestTotal', 'interest', peso], ['monthlyAmortization', 'monthly', peso], ['perPayroll', 'per payroll', peso],
  ['loanDate', 'loan date', v => v || '—'], ['startDate', 'first deduction', v => v || '—'], ['endDate', 'last deduction', v => v || '—'],
  ['terms', 'payroll terms', v => String(v ?? '—')], ['remainingTerms', 'remaining terms', v => String(v ?? '—')],
  ['deductOn', 'deducted', v => SCHEDULE[v || 'every'] || v], ['authorized', 'status', v => (v ? 'authorized' : 'not authorized')],
];

export function loanChangeText(before, after, action) {
  if (!after?.employeeId) return '';
  const name = `${after.type || 'loan'}${after.reference ? ` ${after.reference}` : ''}`;
  if (action === 'create') return after.applicationId ? '' : `HR recorded a ${name} of ${peso(after.original)} on your account: ${peso(after.perPayroll)} per payroll from ${after.startDate || '—'}. See My loans.`;
  if (action === 'payroll-reversal') return `A posted payroll was reversed, so the deduction for your ${name} was restored. Balance now ${peso(after.balance)}. See My loans.`;
  if (action !== 'update' || !before) return '';
  const changes = FIELDS.filter(([k]) => JSON.stringify(before[k] ?? (k === 'deductOn' ? 'every' : null)) !== JSON.stringify(after[k] ?? (k === 'deductOn' ? 'every' : null)))
    .map(([k, label, show]) => `${label} ${show(before[k])} → ${show(after[k])}`);
  const skipsBefore = before.skipCutoffs || [], skipsAfter = after.skipCutoffs || [];
  if (JSON.stringify(skipsBefore) !== JSON.stringify(skipsAfter)) changes.push(skipsAfter.length ? `not deducted on: ${skipsAfter.join(', ')}` : 'no cutoffs skipped any more');
  const paidBefore = (before.priorPayments || []).reduce((s, p) => s + p.amount, 0), paidAfter = (after.priorPayments || []).reduce((s, p) => s + p.amount, 0);
  if (JSON.stringify(before.priorPayments || []) !== JSON.stringify(after.priorPayments || [])) changes.push(`payments before the system ${peso(paidBefore)} → ${peso(paidAfter)}`);
  return changes.length ? `Your ${name} was updated by HR: ${changes.join('; ')}. See My loans.` : '';
}
