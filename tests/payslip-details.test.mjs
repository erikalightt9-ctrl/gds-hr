import test from 'node:test';
import assert from 'node:assert/strict';
import { premiumHours } from '../src/engine.mjs';
import { renderPayslipPdf, releaseDate } from '../src/payslip-pdf.mjs';

// Erickson's Oct 16-31 lines typed from the HR sheet: hourly = 25,000 / 26 / 12.
const hourly = 25000 / 26 / 12, rates = { regularOT: 1.25, restDay: 1.3, restOT: 1.69, nsd: 0.1 };
const earnings = { basic: 7692.31, regularOT: 1151.84, restDay: 1250, nsd: 12.02 };
const overrides = ['regularOT', 'restDay', 'nsd'].map(component => ({ component }));

test('hours behind typed pay lines are worked back from the amount (amount / hourly / multiplier)', () => {
  assert.deepEqual(premiumHours([], earnings, overrides, hourly, rates), { regularOT: 11.5, restDay: 12, nsd: 1.5 });
});

test('attendance-based lines keep the breakdown hours; lines with no amount are left out', () => {
  const breakdown = [{ classification: 'ordinary', overtime: true, night: true, hours: 2 }, { classification: 'rest', overtime: false, night: false, hours: 8 }];
  assert.deepEqual(premiumHours(breakdown, { regularOT: 300, nsd: 24, restDay: 0 }, [], 100, rates), { regularOT: 2, nsd: 2 });
});

test('release date is written as "05 Nov. 2026" in Philippine time', () => {
  assert.equal(releaseDate('2026-11-04T17:30:00Z'), '05 Nov. 2026');
});

test('the payslip lists hours / days for each line, rest day in days, whole days without decimals, no pay-basis row', () => {
  const slip = { start: '2026-10-16', end: '2026-10-31', employeeId: 'EMP-2026-0003', employeeName: 'Bayona, Erickson', monthlySalary: 25000, workingDays: 8, creditedDays: 8, daysCredited: 8, daysWorked: 8, hoursPerDay: 12, payBasis: 'monthly',
    quantities: { regularOT: 11.5, restDay: 12, nsd: 1.5 }, earnings, deductions: { SSS: 1250, PhilHealth: 625, 'Pag-IBIG': 200 }, gross: 10106.17, totalDeductions: 2075, net: 8031.17 };
  const pdf = renderPayslipPdf(slip, { draft: true, designation: 'Driver', now: new Date('2026-11-05T01:00:00Z') }).toString('latin1');
  for (const s of ['(05 Nov. 2026)', '(11.5)', '(1.5)', '(DAY)', '(HRS)', '(Driver)']) assert.ok(pdf.includes(s), s);
  assert.match(pdf, /\(Days credited\)[\s\S]*?\(8\) Tj/);
  assert.ok(!pdf.includes('Pay basis') && !pdf.includes('8.00)'), 'no pay-basis row; whole days without decimals');
  assert.match(pdf, /\(Rest day \/ RDOT\) Tj ET[\s\S]*?\(1\) Tj[\s\S]*?\(DAY\)/, 'rest day of 12 h on a 12-hour schedule = 1 DAY');
});

test('payslips of PDMN employees use the PDMN logo; others keep the GDS logo', async () => {
  const { companyLogo, logo } = await import('../src/payslip-pdf.mjs');
  const pdmn = companyLogo('PDMN'), gds = companyLogo('GDS Capital HQ');
  assert.ok(pdmn && pdmn.data.length !== logo().data.length, 'a different image for PDMN');
  assert.deepEqual([pdmn.width, pdmn.height], [317, 133]);
  assert.equal(gds, logo()); assert.equal(companyLogo(''), logo());
});
