import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFinalPayPdf } from '../src/final-pay-pdf.mjs';

test('final pay PDF: formal one-page document with the computation, net final pay and signature lines', () => {
  const record = { id: 'fp-1', employeeId: '2026-0717', name: 'Dela Cruz, Israel', separationDate: '2026-09-28', releaseDue: '2026-10-28', computedAt: '2026-10-08T05:00:00Z', computedBy: 'gds.erika',
    dailyRate: 961.54, monthlySalary: 25000, yearsOfService: 0, input: { separationCause: 'none' }, gross: 10606.08, deductions: 0, net: 10606.08,
    items: [{ side: 'earnings', label: 'Unpaid salary 2026-09-16 to 2026-09-30', amount: 6067.62, basis: 'Finalized payroll (net pay on the payslip)' },
      { side: 'earnings', label: 'Pro-rated 13th month pay', amount: 4538.46, basis: '54461.53 basic earned in 2026 ÷ 12 = 4538.46, less 0 already paid' }] };
  const pdf = renderFinalPayPdf(record, { designation: 'Driver', startDate: '2026-07-17' }).toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4'));
  for (const text of ['FINAL PAY COMPUTATION', 'DELA CRUZ, ISRAEL', 'September 28, 2026', '6,067.62', '4,538.46', 'NET FINAL PAY', 'PHP 10,606.08', 'Received by', 'Prepared by', '/ 12']) assert.ok(pdf.includes(text), text);
  assert.ok(!pdf.includes('?'.repeat(1) + ' 12 ='), 'division sign is printable');
});
