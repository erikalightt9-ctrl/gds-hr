// Excel workbook of one month's BIR Form 1601-C: the return (Part I and Part II items 14-36 as formulas over the
// employee sheet, so figures edited in Excel recompute), the employee details (derived columns are formulas, with a
// TOTAL row) and the year's monitoring sheet. Every export is audited.
import { permit } from './service.mjs';
import { workbook, tableSheet, colName } from './export.mjs';
import { month1601c, year1601c, VIEW_ROLES, ITEM_LABELS } from './bir1601c.mjs';

const HEADERS = ['Employee ID', 'Name', 'TIN', 'Total compensation (14)', 'Statutory minimum wage MWE (15)', 'Holiday / OT / NSD / hazard MWE (16)', '13th month & other benefits (17)', 'De minimis (18)', 'SSS / PHIC / HDMF employee share (19)', 'Other non-taxable (20)', 'Total non-taxable (21)', 'Taxable compensation (22)', 'Not subject to withholding (23)', 'Net taxable (24)', 'Tax withheld (25)', 'Typed figures / reason'];
// Column of each item on the employee sheet (D = item 14 ... O = item 25).
const ITEM_COLUMN = { 14: 3, 15: 4, 16: 5, 17: 6, 18: 7, 19: 8, 20: 9, 23: 12, 25: 14 };

function employeeSheet(data) {
  const rows = data.rows.map(r => [r.employeeId, r.name, r.tin || '', r.compensation, r.mweBasic, r.mwePremiums, r.thirteenth, r.deMinimis, r.contributions, r.otherNonTaxable, r.nonTaxable, r.taxable, r.notSubject, r.netTaxable, r.taxWithheld, r.edited ? `${r.edited.reason} (${r.edited.by})` : r.exempt ? 'Exempt from withholding (payroll setting)' : '']);
  const c = colName;
  return tableSheet({
    title: `BIR Form 1601-C · ${data.monthName} · Employee details`,
    description: `${data.agent.name}${data.agent.tin ? ` · TIN ${data.agent.tin}` : ''} · ${data.return.status === 'filed' ? `Filed ${data.return.filedOn} (${data.return.confirmationNo})` : data.draft ? 'Includes unposted (draft) payroll' : 'From posted payroll'} · ATC WW010`,
    headers: HEADERS, rows, totals: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    formulas: { 10: n => `SUM(${c(4)}${n}:${c(9)}${n})`, 11: n => `${c(3)}${n}-${c(10)}${n}`, 13: n => `${c(11)}${n}-${c(12)}${n}` },
  });
}
function returnSheet(data, totalRow) {
  const ret = data.return, a = data.agent, emp = col => (totalRow ? `'Employee details'!${colName(col)}${totalRow}` : '0');
  const rows = [
    [{ v: 'BIR Form 1601-C · Monthly Remittance Return of Income Taxes Withheld on Compensation', bold: true }],
    [`For the month of ${data.monthName} · Due ${data.dueDate} · Status: ${ret.status === 'filed' ? `Filed ${ret.filedOn}` : 'Not yet filed'}`],
    [],
    [{ v: 'Part I · Background information', bold: true }],
    ['1', 'For the month (MM/YYYY)', `${data.month.slice(5)}/${data.month.slice(0, 4)}`],
    ['2', 'Amended return?', ret.amended ? 'Yes' : 'No'],
    ['3', 'Any taxes withheld?', data.items[25] > 0 ? 'Yes' : 'No'],
    ['4', 'Number of sheet(s) attached', ret.sheets || 0],
    ['5', 'ATC', 'WW010'],
    ['6', 'Taxpayer Identification Number (TIN)', a.tin], ['7', 'RDO code', a.rdo], ['8', "Withholding agent's name", a.name], ['9', 'Registered address', a.address], ['9A', 'ZIP code', a.zip],
    ['10', 'Contact number', a.contact], ['11', 'Category of withholding agent', a.category], ['12', 'Email address', a.email], ['13', 'Payees availing of tax relief?', ret.taxRelief ? 'Yes' : 'No'],
    [],
    [{ v: 'Part II · Computation of tax', bold: true }],
    [{ v: 'Item', bold: true }, { v: 'Description', bold: true }, { v: 'Amount', bold: true }],
  ];
  const at = {}, push = (item, f) => { at[item] = rows.length + 1; rows.push([String(item), ITEM_LABELS[item], { f: f(), v: data.items[item], money: true, bold: [21, 22, 24, 27, 31, 35, 36].includes(item) }]); };
  const C = item => `C${at[item]}`, typed = item => (item === 26 ? data.items[26] : data.items[item]);
  for (const item of [14, 15, 16, 17, 18, 19, 20]) push(item, () => emp(ITEM_COLUMN[item]));
  push(21, () => `SUM(${C(15)}:${C(20)})`); push(22, () => `${C(14)}-${C(21)}`); push(23, () => emp(ITEM_COLUMN[23])); push(24, () => `${C(22)}-${C(23)}`);
  push(25, () => emp(ITEM_COLUMN[25]));
  for (const item of [26]) { at[item] = rows.length + 1; rows.push([String(item), ITEM_LABELS[item], { v: typed(item), money: true }]); }
  push(27, () => `${C(25)}+${C(26)}`);
  for (const item of [28, 29]) { at[item] = rows.length + 1; rows.push([String(item), ITEM_LABELS[item], { v: data.items[item], money: true }]); }
  push(30, () => `${C(28)}+${C(29)}`); push(31, () => `${C(27)}-${C(30)}`);
  for (const item of [32, 33, 34]) { at[item] = rows.length + 1; rows.push([String(item), ITEM_LABELS[item], { v: data.items[item], money: true }]); }
  push(35, () => `SUM(${C(32)}:${C(34)})`); push(36, () => `${C(31)}+${C(35)}`);
  rows.push([], [{ v: 'Filing and payment', bold: true }], ['', 'Date filed', ret.filedOn || ''], ['', 'Filing reference (eFPS / eBIRForms / TRA)', ret.confirmationNo || ''], ['', 'Payment date', ret.paymentDate || ''], ['', 'Payment reference', ret.paymentRef || ''], ['', 'Payment channel', ret.paymentChannel || ''], ['', 'Remarks', ret.remarks || '']);
  return { rows, header: null, widths: [8, 78, 22] };
}
function yearSheet(year) {
  const rows = year.months.map(m => [m.name, m.due, m.status === 'filed' ? 'Filed' : m.status === 'overdue' ? 'Overdue (not filed)' : m.status === 'upcoming' ? 'Upcoming' : 'Open', m.filedOn, m.confirmationNo, m.compensation ?? '', m.taxWithheld ?? '', m.amountDue ?? '', m.amended ? 'Yes' : '']);
  return tableSheet({ title: `BIR Form 1601-C · ${year.year} monitoring`, description: 'One line per taxable month; figures of open months are the current computation.', headers: ['Month', 'Due date', 'Status', 'Date filed', 'Filing reference', 'Total compensation', 'Tax withheld', 'Amount due', 'Amended'], rows, totals: [5, 6, 7] });
}
export function export1601c(store, actor, month) {
  permit(actor, VIEW_ROLES);
  const data = month1601c(store, actor, month), employees = employeeSheet(data), totalRow = data.rows.length ? employees.rows.length : null;
  const body = workbook({ [`1601-C ${data.month}`]: returnSheet(data, totalRow), 'Employee details': employees, [`Year ${data.month.slice(0, 4)}`]: yearSheet(year1601c(store, actor, data.month.slice(0, 4))) });
  store.log(actor, 'export', 'report', 'bir-1601c', null, { format: 'xlsx', month: data.month, rows: data.rows.length });
  return { filename: `gds-hr-bir-1601c-${data.month}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body };
}
