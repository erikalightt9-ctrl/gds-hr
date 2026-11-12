# HR & Payroll System — Reusable Design Handoff

A specification for recreating an HR 201, attendance, leave, payroll and employee self-service system for **your own company and employee records**. It covers the visual design, layouts, navigation, forms, roles, approval workflows and payroll rules.

**What this package contains**

| File | Purpose |
| --- | --- |
| `HR-SYSTEM-HANDOFF.md` | This specification |
| `assets/logo-placeholder.svg` | Replaceable logo (fictional "Your Company") |
| `assets/fonts/dancing-script-700.woff2` + `OFL.txt` | Script font for the welcome greeting (SIL Open Font License) |

**What it deliberately does not contain:** any real employee or company data, logos, letterheads, mascots, screenshots, credentials, keys, databases or uploaded files. Every name, number and amount below is a **fictional example** (marked *Example*). Replace every `{{PLACEHOLDER}}` with your own value.

Context: written for a Philippine private-sector employer (PHP, Asia/Manila time, SSS / PhilHealth / Pag-IBIG / BIR). Adjust rates and agencies for other jurisdictions.

---

## 1. Company settings to configure first

| Setting | Placeholder | Example |
| --- | --- | --- |
| Company name (header, payslips, reports) | `{{COMPANY_NAME}}` | Example: Sample Trading Corp. |
| Short name / system title | `{{SYSTEM_TITLE}}` | Example: HR 201 File & Employee Management System |
| Logo (app, payslip, memo letterhead) | `{{LOGO_FILE}}` | `assets/logo-placeholder.svg` |
| Memo letterhead image | `{{LETTERHEAD_FILE}}` | Your own A4 letterhead |
| Brand colors | `{{BRAND}}`, `{{ACCENT}}` | See section 2 |
| Companies / departments | `{{COMPANIES}}` | Example: Head Office, Branch A |
| Employee number format | `{{EMPLOYEE_NUMBER_FORMAT}}` | Example: YYYY-NNNN (year hired + sequence) |
| Employer registration numbers | `{{SSS_ER_NO}}`, `{{PHILHEALTH_ER_NO}}`, `{{PAGIBIG_ER_NO}}`, `{{TIN}}` | Your own |
| Office location (geofence) | `{{OFFICE_LAT}}`, `{{OFFICE_LNG}}`, radius m | Example: 100 m |
| Office network (public IP) | `{{OFFICE_IPS}}` | Your own |
| Public web address | `{{APP_ORIGIN}}` | Your own |
| Payroll rules (rates, divisor, cutoffs) | Rules & rates | Section 8 |
| Holiday calendar | Holiday calendar | Your national / local holidays |
| Leave types and policies | Leave policies | Section 7.4 |
| 201 document requirements | Settings | Section 6.3 |

---

## 2. Visual design

### 2.1 Brand palette (replaceable)

The reference theme is **red + gold + black + ivory** ("liquid glass" gold surfaces). An alternative theme (forest green) is selectable in Settings → Company branding. Define colors as CSS tokens so a company can swap them.

| Token | Role | Reference value |
| --- | --- | --- |
| `--brand` | Primary actions, links, active states, red headers on payslips | `#a91e2d` (hover `#8c1622`) |
| `--gold-100` … `--gold-700` | Surfaces, cards, badges, highlights | `#fff8e4`, `#f7e6b4`, `#ebcf86`, `#d9b85c`, `#c29a3e`, `#7c5d18` |
| `--accent` / `--gold` | Active nav item, focus accents, outlines | `#d9b85c` |
| `--ink` | Body text | `#1d1a14` |
| `--ink-soft` / `--muted` | Secondary text (≥ 6:1 contrast on gold) | `#5a4e34` |
| `--line` | Borders, dividers | `rgb(194 154 62 / .22)` |
| Sidebar | Navigation background | `#171717` with light text `#dedede` |
| Page background | Warm ivory gradient | `#fbf8f0` → `#f4eee2` with soft gold/red radial glows |
| Danger | Delete, reject | `#a31927` on `#ffeded` |

Status badges: pending = amber (`#fff4dd` / `#795414`), approved = gold (`#fff0c4` / `#755313`), rejected = red (`#ffeded` / `#a31927`), neutral = grey (`#f0f0f0` / `#606060`).

### 2.2 Surfaces

- **Cards and boxes**: gold "glass" gradient (`rgb(255 250 233 / .86)` → `rgb(246 226 168 / .62)`), `backdrop-filter: blur(18px) saturate(160%)`, 1 px gold edge, radius 18 px (12 px small), soft layered shadow; lift on hover.
- **Panels and tables**: white/ivory glass, 1 px line border, radius 10–18 px.
- Respect `prefers-reduced-transparency` (solid fills) and `prefers-reduced-motion`.

### 2.3 Typography

| Use | Font | Size / weight |
| --- | --- | --- |
| Interface | `"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif` | 12–13 px body; 600 weight for labels |
| Page title (h1) | Same | 30 px, 600, letter-spacing −1.1 px |
| Section title (h2) | Same | 17 px, 600 |
| Eyebrow / table headers | Same | 10 px, uppercase, letter-spacing 0.45–1.6 px |
| Big numbers (cards) | Same | 27 px, 600, tabular numerals |
| Welcome greeting | Dancing Script 700 (included) | Decorative only |

### 2.4 Components

| Component | Look and behavior |
| --- | --- |
| Primary button | `--brand` fill, white text, radius 7 px, 10×15 px padding; used once per screen for the main action |
| Secondary button | White, 1 px line border, brand-colored text |
| Small button | 12 px text, 6×9 px padding (row actions) |
| Inputs / selects | 1 px `#d6d6d6`, radius 6 px, 10×11 px padding; labels above in 11–12 px, 600 |
| Searchable dropdown | Button showing the selection; the list opens with a search box beside the group heading (e.g. "Employee"); filters by name or ID; Enter picks the first match |
| Toolbar | Row of labeled filters + one primary button, bottom-aligned, wraps on small screens |
| Table | Sticky uppercase header (10 px), 15×20 px cells, row hover ivory, numbers right-aligned and tabular; first (name) column fixed when scrolling sideways; empty state with an icon, a bold line and a hint |
| Card row | 4–5 summary cards (label, big value, small foot note); one "featured" card in deeper gold |
| Dialog | Centered, max 850 px, radius 13 px, sticky header and footer (actions right), blurred dark backdrop |
| Notice | Ivory box with gold border for information; red variant for "Not complied" / errors |
| Toast | Dark pill bottom-right, auto-hides |
| Badge | Pill, 10 px, 600 weight, colors per status |
| Tabs | Pill buttons; active = gold fill |
| Bell | Header icon with unread count; panel lists items with their dates; clicking an item opens the exact page and highlights the target (gold outline) |
| Breadcrumb | Eyebrow above the title: "Group › Page" |

### 2.5 Layout and responsive behavior

- **HR workspace**: left sidebar 236 px (195 px under 1150 px wide) + main column (max 1700 px, 34×38 px padding). Top bar 76 px with the system title, date, time zone, messages, bell, avatar menu, settings.
- **Under 760 px**: sidebar collapses to a ☰ drawer; cards go 2 per row; forms one column; tables scroll sideways with the name column fixed; dialogs full width.
- **Employee portal**: header with ☰, a larger logo and the bell; left sidebar menu (drawer on phones); navigation cards in a 3-column grid on desktop, 2 on mobile, with emojis.
- Installable as a PWA (manifest + service worker; offline page); icons 192, 512, maskable 512, Apple touch.
- Print styles hide navigation and actions.

---

## 3. Navigation

### 3.1 HR / admin workspace (sidebar)

| Group | Pages (shown by role) |
| --- | --- |
| — | Dashboard |
| HR Management | Employee 201 Files · Data Sheet Submissions · Memos · Trainings |
| Payroll & Attendance | Attendance · Leave Management · Payroll & 13th Month · Employee Loans · Government Contributions · Holiday Calendar · Rules & Rates |
| Administration | Reports · Audit trail · Settings |

A group is hidden entirely when the role can open none of its pages.

### 3.2 Employee portal (sidebar menu)

My dashboard 🏠 · Attendance 🕒 · My leave 🌴 · My payslips 💰 · My profile 👤 · My loans 💳 · My overtime ⏱️ · Memos 📝 · Trainings 🎓 · My 201 file 📁 — then Account & security and Sign out at the bottom.

---

## 4. Roles and permissions (enforced on the server, never only in the screen)

| Role | Scope |
| --- | --- |
| System Administrator | Everything, including Settings, accounts, rules approval |
| HR Manager | Employee records, approvals, memos, trainings, reports, payroll and attendance |
| HR Staff | Day-to-day 201 work; government numbers masked; no restricted documents or settings |
| Maker | Encodes every non-salary record; never sees pay (screens, files, reports, audit values) |
| Department Manager | Read-only view of their own department |
| Management (viewer) | Dashboards and summary reports |
| Payroll | Pay records, payroll, loans, contributions |
| Employee | Own record only (portal) |

Rules: pay is visible only to Admin, HR Manager, Payroll and Management; government numbers in full only to Admin, HR Manager, Payroll and Maker; the audit trail cannot be edited or deleted (database triggers).

---

## 5. Accounts and security

- Login accounts are created by an admin (one per employee in bulk is available: username = employee number, a default password typed by the admin, never stored in code or logs). First sign-in forces "Choose your own password".
- Optional TOTP two-factor; HR-assisted account recovery.
- Several devices may be signed in at once; sessions last 8 hours; a password change signs out everywhere; HR can sign an account out of all devices.
- CSRF token on every change; same-origin check on requests; `Cache-Control: no-store` for app data.
- Deleting a login requires typing the username; the last enabled admin and your own account cannot be deleted.
- Daily encrypted off-site backups (AES-256-GCM) to private object storage; keys kept outside the server.

---

## 6. HR 201 records

### 6.1 Employee directory
Search, filters (company, status, department), sorting, pagination; columns show name, employee number, position. Add employee (form below), archive / restore, delete only when the employee has no history.

### 6.2 Employee profile
Header (photo or initials, name, position, status, actions) and info cards (years of service, employment type, job level, date hired). Tabs: Overview · Personal · Employment · Compensation · Government IDs · Family · Education · Employment History · Requirements · Documents · Memos · Trainings · Leave credits · Activity.

Form conventions: fields in boxed sections; names are capitalized word by word on save; position is required for employment details; government numbers are digits only.

### 6.3 201 documents
- A checklist from Settings, each requirement marked **Provided by** Employee or Company/HR (company-provided ones are hidden from employees).
- Upload, preview (file name opens it), review (approve / reject with reason), replace (versioned), Not applicable (with reason).
- Government-issued ID uploads require the ID type and are named after it.
- Government registration numbers are "complied" when the number is on file (no upload).
- Employees with missing / rejected / expired required documents see a red numbered "Not complied" notice; uploading lifts it and notifies HR.

### 6.4 Data sheets
Employee fills "My data sheet" → Submitted → Under review → Approved (updates the same record) / Returned / Rejected.

### 6.5 Memos
Draft → issue to all / companies / departments / employees → revise (new version) → archive. Five categories. Employees acknowledge receipt; counts are tracked. System memos (e.g. monthly tardiness) are issued automatically as PDF on the letterhead.

### 6.6 Trainings
List and calendar; registration, attendance and completion recorded separately; certificates filed as 201 documents.

---

## 7. Attendance, leave and requests

### 7.1 Time in / out (employee portal)
- A clock card on the dashboard. **Office** time in/out is accepted from the office network (public IP) or GPS inside the office radius. **Off-site / Out of office** needs a reason; high-accuracy GPS is turned into a readable address (OpenStreetMap), which the employee may reword (never the coordinates) and must confirm. Readings above the accuracy limit (default 50 m) are recorded but flagged.
- Clock events are immutable. HR sees Live attendance (status, times, location, reason chips) and Time in/out records (office / off-site / flagged, map per record).

### 7.2 Late explanations and memos
- A time in 15 minutes or more after the day's scheduled start needs a written explanation; HR reviews (approve with an optional offset of 0–1,440 minutes, return, reject).
- Monthly: 3+ such days in the previous month → one automatic tardiness memo (advisory, no penalty) on the 5th.

### 7.3 Attendance requests
Forgot to time in / out, failed office time in/out, off-site reconsideration, system error, other. Filed within 3 days of the date, unposted payroll only, reference `AR-YYYY-NNNN`; statuses pending → review → info requested → approved / rejected / cancelled. Approval writes an HR-approved correction (original kept). HR is reminded about requests waiting 48 h+.

### 7.4 Leave
- Types configurable (e.g. Service incentive, Vacation, Unpaid, Bereavement, Maternity/Paternity, Solo parent, Special leave for women). Eligibility, yearly credits, carry-over, days used before the system.
- Apply: type, dates (half days allowed), reason from a dropdown with "Other (please specify)", optional supporting document. Reference `LV-YYYY-NNNN`.
- HR: Pending · Approved · Rejected · Cancelled · Balances · Leave policies. Approved leave is final. HR may "Ask for proof" (does not block approval).
- Balances matrix: one row per employee, entitled / used per type.

### 7.5 Overtime applications
Date, start, end (past midnight allowed), unpaid break, work to be done, optional attachment. Pending filings can be edited or cancelled; overlapping filings are refused. HR approves (other hours need a reason) or rejects; every step is audited and notified.

### 7.6 Schedules
Per employee: start, end, regular hours, meal break, arrangement. Day-specific overrides per weekday, with **Flexible time** (any start, only the hours count, never late, no overtime), **Present without time in/out** (work-from-home day, counted only once the date arrives) and **Missing time priced at (h)**.

---

## 8. Payroll rules

### 8.1 Settings (Rules & rates; versioned by effective date, admin-approved)

| Setting | Default |
| --- | --- |
| Cutoffs | 1st–15th paid on the 22nd; 16th–end paid on the 8th of the next month |
| Monthly divisor D | 26, every month |
| Lateness threshold | 15 min (whole late time counts once reached) |
| Overtime | Approved filings only, 30-minute blocks |
| Rates | OT 125%, rest day 130%, rest-day OT 169%, special holiday worked 130%, regular holiday worked 200%, night differential +10% (10 PM–6 AM) |
| Rounding of days credited | 2 decimals (or exact) |
| Contributions | Full monthly employee share in the 16th–end cutoff |

### 8.2 Working days
Counted for the whole month from the calendar and each employee's rest days (holidays included), split between cutoffs. *Example:* November 2026 with Sunday rest = 12 + 13 = 25; with Saturday rest = 26. The count is separate from the divisor D.

### 8.3 Monthly-paid
Complete attendance = half the monthly salary every cutoff (12 or 13 working days alike).
```
Daily = Monthly ÷ D      Hourly = Daily ÷ scheduled hours
Days credited = D/2 − absences − late min ÷ day min − undertime min ÷ day min
Basic = Days credited × Daily
```
*Example:* salary 31,200 (daily 1,200) → 15,600.00 per cutoff; one absence → 14,400.00; 30 min late once → 15,528.00 (12.94 days; 15,525.00 with exact rounding).

### 8.4 Daily-paid
Daily rate × scheduled working days attended, less absences and unworked time at daily ÷ hours. *Example:* rate 800, 12 working days → 9,600.00; one absence → 8,800.00.

### 8.5 Attendance adjustments
Under 15 min late: nothing lost. 15 min or more: whole late time less approved offset. Offsets cover late time first, then undertime. Lunch is taken out automatically on regular working days when no break is recorded. Undertime has no grace. A scheduled day without attendance or leave is not credited; days not yet reached are never credited in advance. Adjustments lower Days present and Basic pay (not separate deduction lines).

### 8.6 Holidays
Holiday days on scheduled working days are credited once (Holiday Days column + Holiday Pay amount, between Overtime and Other additions); a holiday on a rest day is not counted; a Sunday holiday moves only with a substitute date. Worked holidays add the premium.

### 8.7 Overtime
Paid from the overlap of actual work after the schedule and the approved period, whole 30-minute blocks, up to approved hours. Pending or unsupported filings block posting.

### 8.8 Loans
```
Monthly amortization = (Amount + Interest) ÷ Months     Per payroll = Monthly ÷ 2
Deduction = min(still due, per payroll, monthly − already deducted this month)
```
Interest pro rata; continues past the end date until paid; per-loan cutoff choice and skipped cutoffs; balances change only when payroll is posted (reversal restores them); final pay deducts outstanding balances.

### 8.9 Government contributions (Philippines, verify yearly)
SSS 5% EE / 10% ER of MSC (5,000–35,000) + EC 10 / 30; PhilHealth 2.5% / 2.5% (floor 10,000, ceiling 100,000); Pag-IBIG 200 / 200 (at 10,000+). Employee shares reduce the tax basis. Monthly report with employer and employee shares, loans, eGov fee; a new hire counts in the start month only with 15+ working days. "Remittance only" status for people outside payroll.

*Example:* salary 24,000 → employee 2,000.00 · employer 3,230.00 · remitted 5,230.00.

### 8.10 Tax
Withholding per the approved bracket table on taxable cutoff earnings (gross less contributions and attendance reductions); per-employee withhold / exempt; HR may adjust with a reason.

### 8.11 13th month and final pay
13th month = basic earned in the year ÷ 12 (months before the system can be encoded per employee); separate 13th-month payslip (draft → finalized snapshot, adjustments need admin approval). Final pay itemizes unpaid salary, prorated 13th month, leave conversion, separation pay where applicable, less outstanding loans; never computed past the separation date.

### 8.12 Payroll screen and posting
- Toolbar: Cutoff start (end auto-fills), Cutoff end, Employee (searchable: All / Company / Employee), 13th month (Accrue only / Pay accrued balance), **Generate payroll**.
- Cards: Gross earnings · Total deductions · Net payroll · Employees · Employer contributions.
- Table: Employee · Salary · Working days · Days present · Holiday days · Leave days / notes · Basic pay · Leave pay · Overtime, rest day & night differential · Holiday pay · Other additions · Gross pay · Deductions · Net pay.
- Clicking Net pay opens the computation (every earning/deduction in a box; editable ones save as overrides with a reason; contributions and loans read-only). Manual time & pay entry per cutoff (add or replace).
- Blockers list (missing attendance, pending filings, negative net…) must be cleared or waived before **Post**. Generate and post on the same day.
- Payroll history with company filter; Send payslips early; reverse a posting (audited).
- Exports: Excel workbook (payroll, calculation audit, lateness, metadata), PDF register, copy to clipboard.

### 8.13 Payslip
Logo, gold border, red headers; employee name, ID, position, cutoff, salary day; Working days (month), Days credited, Holiday days; earnings (Basic, Holiday pay, Leave pay, Overtime…), deductions (SSS, PhilHealth, Pag-IBIG, tax, loans…), net pay; employer shares as information. Employees see it from salary day.

---

## 9. Notifications and workflows summary

| Event | Who is notified | Opens |
| --- | --- | --- |
| Employee submits leave / overtime / request / explanation / document / data sheet | HR bell (with dates) + employee confirmation | The exact review page, target highlighted |
| HR decision | Employee bell + notice detail | The record |
| Late time in (15+ min) | Employee and admins | Explanations → Waiting for the employee |
| Payslip available | Employee (once) | My payslips |
| Interface updated | Open tabs | Reloads at the next page change |

Every submission shows a confirmation box; every change is written to the audit trail (who, when, before / after).

---

## 10. Reports
Master list, department/company summaries, new hires, document gaps and completion, memo acknowledgements, training participation, payroll register, government contributions (monthly), leave balances, 13th month — each with filters and Excel / PDF.

---

## 11. Technical reference (one possible implementation)
Node.js server with SQLite (WAL), plain JavaScript modules in the browser (no build step), Zod validation on every input, server-side role checks, one immutable audit table, files stored as BLOBs with metadata, PDFs generated on the server, a service worker for installability. Any stack works if the rules above are kept.

---

## 12. Fictional sample data (for testing only)

| Employee number | Name | Pay basis | Rate | Rest day | Schedule |
| --- | --- | --- | --- | --- | --- |
| 2026-0001 | Example: Ana Sample | Monthly | 31,200.00 / month | Sunday | 09:00–18:00, 1 h lunch |
| 2026-0002 | Example: Ben Placeholder | Daily | 800.00 / day | Sunday | Mon–Fri 09:00–18:00; Sat flexible 4 h |
| 2026-0003 | Example: Carla Fictional | Monthly | 28,600.00 / month | Saturday | 07:00–19:00 (12-hour duty) |

These people do not exist. Do not import real records into a test or demo environment.

---

## 13. Handoff checklist
- [ ] Replace every `{{PLACEHOLDER}}`, the logo and the letterhead.
- [ ] Set colors (section 2.1) or choose the alternative theme.
- [ ] Configure companies, departments, positions, employee number format, document requirements.
- [ ] Enter and approve Rules & rates, the holiday calendar and leave policies.
- [ ] Verify government contribution and tax tables against current official issuances.
- [ ] Create admin accounts; enable two-factor; set up encrypted off-site backups.
- [ ] Test with the fictional sample data before importing your own employees.
