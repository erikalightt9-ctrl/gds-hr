# HR & Payroll System — Payroll Rules

How the HR and payroll system computes pay, attendance adjustments, holidays, overtime, loans and government contributions. It describes the system's design and settings, not any company's employees. All names and amounts below are examples.

Status as of November 2026. Philippine context (PHP, Asia/Manila time, SSS / PhilHealth / Pag-IBIG).

---

## 1. Pay bases and settings

Every employee has a **pay basis** and a **schedule**. A job title never decides the formula.

| Setting | Where | Default |
| --- | --- | --- |
| Pay basis | Employee payroll profile | Monthly-paid; or Daily-paid with a daily rate |
| Payroll calendar | Rules & rates | Semi-monthly: 1st–15th (paid on the 22nd), 16th–month end (paid on the 8th of the next month) |
| Monthly divisor (D) | Rules & rates | 26, every month |
| Schedule | Employee attendance profile | Start, end, regular hours per day, meal break, arrangement (Office / WFH / Hybrid) |
| Day-specific schedules | Attendance profile, per weekday | Overrides for start, end, hours, meal break; flags: Flexible time, Present without time in/out; "Missing time priced at (h)" |
| Rest days | Employee record | e.g. Sunday |
| Lateness threshold | Rules & rates | 15 minutes, full duration once reached |
| Overtime approval | Rules & rates | Paid only when the employee files it and HR approves it |
| Rounding of days credited | Rules & rates | 2 decimals (or "exact": full precision, only pesos rounded) |
| Contribution timing | Rules & rates | Full monthly employee share in the 16th–end cutoff |

Rules are versioned by effective date and need Admin approval; a rules change inside a cutoff blocks that payroll.

---

## 2. Working days

Scheduled working days are counted automatically for the **whole month** from the calendar and each employee's own rest days. Rest days are excluded; holidays on working days are included. The month is split between the two cutoffs.

```
Working days (month) = days in the month − the employee's rest days in that month
```

| Example: November 2026 | 1st–15th | 16th–30th | Month |
| --- | --- | --- | --- |
| Sunday rest (Mon–Sat schedule) | 12 | 13 | 25 |
| Saturday rest | 13 | 13 | 26 |

The payroll table's **Working days** column shows the month figure (cutoff share on hover). The working-day count and the divisor D are separate settings.

---

## 3. Monthly-paid employees

With complete attendance, a monthly-paid employee receives **half the monthly salary every cutoff**, whether the cutoff has 12 or 13 working days.

```
Cutoff basic      = Monthly salary × 0.5
Daily rate        = Monthly salary ÷ D            (D = 26)
Hourly rate       = Daily rate ÷ scheduled hours per day
Days credited     = D/2 − absent days − late min ÷ day min − undertime min ÷ day min
Basic pay         = Days credited × Daily rate     (days rounded to 2 decimals by default)
```

- A scheduled working day with no attendance and no approved leave is not credited.
- A day that has not arrived yet is not credited until it does (the draft payroll is "accrued to date", never a projection).
- Joining or leaving mid-cutoff: prorated by scheduled days employed.
- Paid leave moves that day's pay from Basic to Leave pay; unpaid leave is an absence.

| Example (salary 31,200; daily 1,200) | Working days | Days credited | Basic pay |
| --- | --- | --- | --- |
| Complete attendance | 13 | 13 | 15,600.00 |
| Complete attendance | 12 | 13 | 15,600.00 |
| One unpaid absence | 13 | 12 | 14,400.00 |
| 30 minutes late once, no offset | 13 | 12.94 (12.9375 exact) | 15,528.00 (15,525.00 exact) |

---

## 4. Daily-paid employees

Daily-paid employees earn their daily rate for each scheduled working day attended, less unworked time.

```
Basic = Daily rate × scheduled working days
        − Daily rate × absent days
        − (Daily rate ÷ hours) × (late + undertime minutes) ÷ 60
```

- A month with 27 Monday–Saturday working days pays 27 × the daily rate with complete attendance.
- **Short / flexible days** (e.g. a 4-hour Saturday): any start time, never late, extra hours are not overtime. Missing time is priced at the base hours (÷ 8) unless the day sets "Missing time priced at (h)" (e.g. 4 → one missing hour = ¼ day).
- Over the regular hours: paid only with an approved overtime application.
- The daily rate is stored on the payroll profile and audited; verify it against the current regional minimum wage separately.

| Example (daily rate 800; 12 working days) | Basic |
| --- | --- |
| Complete attendance | 9,600.00 |
| One unpaid absence | 8,800.00 |
| Left 1 hour early once (÷ 8) | 9,500.00 |

---

## 5. Extended-duty (12-hour) schedules

Monthly- or daily-paid like everyone else; the schedule decides the hours.

- The hourly rate is daily rate ÷ the scheduled hours per day (e.g. ÷ 12).
- A meal break set on the schedule is unpaid; with none set, the whole span is paid work.
- Overtime starts after the scheduled hours worked and still needs an approved filing.

```
Scheduled working time = Scheduled span − Unpaid break
12-hour span with a 1-hour unpaid break = 11 working hours
```

Each company must decide how many of those hours the salary covers and whether any are scheduled overtime (see the Labor Code's 8-hour normal workday) before configuring such a profile.

---

## 6. Attendance rules (all pay bases)

Each minute is counted once: as late time, undertime, lunch or overtime, never two of them.

| Rule | Behavior |
| --- | --- |
| Late under 15 min | Nothing lost |
| Late 15 min or more | The whole late time counts, less any approved offset; lost as late min ÷ day min of a day |
| Staying after the end | Not an automatic offset (shown to HR) |
| Approved offset | Covers late time first; what is left covers undertime that day |
| Attendance exception | Clears late time and undertime for that day |
| Lunch | Taken out automatically on regular working days when no break is recorded (from 12:00 PM, the scheduled length); recorded breaks are used as recorded; not on rest days, flexible days, or schedules with no meal break |
| Undertime | Scheduled hours − hours worked − late − leave hours − offset left; no grace period |
| Days credited | Late and undertime lower Days present and Basic pay; they are not separate deduction lines |
| Work-from-home "present" days | Counted present without time in/out, only once the date arrives |

Example: 9:00 AM–6:00 PM with a 1-hour lunch = 8 hours. Leaving at 5:00 PM = 7 hours worked, 60 minutes undertime (unless covered by an approved offset).

---

## 7. Holidays

- Holidays come from the holiday calendar. A holiday on a rest day is not counted; a Sunday holiday moves only when a substitute date is in the calendar.
- **Days Present** (regular days attended), **Holiday Days** (count) and **Holiday Pay** (amount) are separate columns; Holiday Pay sits between Overtime and Other additions.
- Each holiday is paid once: for monthly-paid staff it is part of the half-month, not added on top.
- Work on a holiday keeps its attendance and adds the configured holiday-work premium.

| Rate (configurable in Rules & rates) | Default |
| --- | --- |
| Ordinary overtime | 125% |
| Rest day | 130% |
| Rest-day overtime | 169% |
| Special holiday worked | 130% |
| Regular holiday worked | 200% |
| Night differential (10 PM–6 AM) | +10% |

---

## 8. Overtime

- Paid from the overlap of actual work after the schedule and an approved overtime period, in whole 30-minute blocks (rounded down), up to the approved hours.
- Pending filings, or approved hours not supported by attendance, block posting (HR may waive the attendance check for a cutoff).
- Overlapping filings are refused, so the same time is never paid twice.
- Minutes that make up offset late time sit inside the regular day and are never also paid as overtime.

---

## 9. Loans

```
Monthly amortization = (Approved amount + Interest) ÷ Months
Per payroll          = Monthly amortization ÷ 2        Terms = Months × 2
Deduction            = min(principal + interest still due,
                           per payroll,
                           monthly amortization − already deducted in posted payroll this month)
```

- Employees apply in the portal (up to 3 pending); Admin, HR or Payroll approve (setting amount, interest, months, start date) or reject with a reason. HR may also encode a loan directly, including payments made before the system.
- Interest is taken pro rata from each deduction; the rest reduces the principal. The last deduction never exceeds what is due.
- A loan keeps being deducted after its planned end date until fully paid.
- Per loan, HR can choose the cutoff (every / 1st–15th only / 16th–end only, with a reason) and skip cutoffs at the employee's request; a skip extends the loan.
- Balances change only when payroll is posted; reversing a posted payroll restores them. A loan used in posted payroll can only have its schedule changed.
- Loan deductions are not part of the tax basis and are read-only in the pay form.
- Final pay deducts every outstanding balance in full by default.
- If deductions would make net pay negative, the payroll cannot be posted.

| Example | Amount |
| --- | --- |
| Loan 12,000 + interest 600 over 6 months | Total due 12,600.00 |
| Monthly amortization / per payroll | 2,100.00 / 1,050.00 (12 terms) |
| First deduction: interest / principal | 50.00 / 1,000.00 |

---

## 10. Government contributions

Computed monthly from the employee's monthly salary (or an approved per-employee basis). The full employee share is deducted in the 16th–end cutoff; employer shares and SSS EC are recorded separately and never reduce pay. Employee shares are taken off before withholding tax.

| Agency | Employee | Employer | Range |
| --- | --- | --- | --- |
| SSS (2025 table) | 5% of Monthly Salary Credit | 10% of MSC + EC (10 below MSC 15,000; 30 from it) | MSC 5,000–35,000 |
| PhilHealth (2026) | 2.5% | 2.5% | Floor 10,000; ceiling 100,000 |
| Pag-IBIG | 200 | 200 | At salaries of 10,000 and above |

| Example (salary 24,000) | Employee | Employer | Remitted |
| --- | --- | --- | --- |
| SSS | 1,200.00 | 2,400.00 + EC 30.00 | 3,630.00 |
| PhilHealth | 600.00 | 600.00 | 1,200.00 |
| Pag-IBIG | 200.00 | 200.00 | 400.00 |
| Total | 2,000.00 | 3,230.00 | 5,230.00 |

Ways to change contributions:

| Change | Effect |
| --- | --- |
| Contribution basis change (per agency, from a chosen cutoff, reason required) | Changes the basis or fixes a share; previous amounts kept; removable later |
| One-cutoff override in the pay form | That cutoff's deduction only |
| Month edit in the contributions report | Report and its downloads only; payroll and payslips unchanged |
| "Remittance only" status | Not in payroll; full monthly shares still remitted |

Monthly report: posted payroll per cutoff, else the draft; a new hire is included in the start month only with 15+ working days to month end; SSS and Pag-IBIG loans listed with the contributions; employer numbers and the eGov fee from company settings.

Verify the agency tables against the current circulars each year.

---

## 11. Posting and audit

- Generate payroll and Post on the same day (the computation includes the date).
- Each posted payroll stores the rules, rates, attendance, approvals and a line-by-line calculation trace; posted payrolls never recompute.
- Manual overrides replace one computed amount for one cutoff, with a reason, and keep the original in the trace.
- Every change to rules, rates, schedules, loans and contributions is audited (who, when, before / after).
