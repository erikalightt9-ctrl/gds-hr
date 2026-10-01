# GDS CAPITAL INC. — Leave & Payroll

The GDS CAPITAL INC. private HR application, housed in the existing website repository. Employee profiles, attendance, leave policies and requests, holidays, deductions, loans, payroll, and the annual 13th-month ledger share one persistent database.

The public Next.js site remains a static export. This application runs as a **separate Node.js service** because authentication, transactions, and private employee data cannot run in the existing static-only deployment. It is not included in `out/` or the public Cloudflare upload ZIP.

## Start locally

Requires Node.js **24.14 or later** and the repository's installed dependencies (`npm install` on a new checkout).

```powershell
npm run hr:dev
```

Open **http://127.0.0.1:3400**. On the first run, the terminal prints a one-time setup code. Enter it in the setup screen and create an administrator with a unique password of at least 12 characters. There is no default production password. Setup stops accepting new initial administrators once the first account exists.

Records persist in `hr/data/hr.sqlite`. SQLite WAL/SHM files may accompany it. This folder is Git-ignored and must never be copied into `public/`, `out/`, or the static deployment archive.

Name-only employee rosters can be saved as draft profiles. Drafts have no assumed salary, department, employment date, schedule, or benefit entitlement and are excluded from payroll and transactional HR records. Complete the profile and clear **Draft profile** before using it. Authorized local operators can import a private one-name-per-line text file with `node hr/scripts/import-roster.mjs <names.txt>`; existing names are skipped and new IDs use the `GDS-` prefix.

The local roster preview, when prepared, runs with `node hr/scripts/preview-roster.mjs` on port 3401. Its changes persist separately in `hr/data/roster-preview.sqlite`; they do not update `hr/data/hr.sqlite`. It uses the same local-only demo credentials below and must not be exposed publicly. The imported roster itself is also saved in the live database, which retains its own first-run administrator setup.

For a disposable sample workspace:

```powershell
node hr/tests/browser-fixture.mjs
```

Open http://127.0.0.1:3401 and use `demo.admin` / `Demo-preview-only-2026`. This separate **in-memory test service** contains fictional data and fictional contribution tables, displays a demo banner, and loses all changes on exit. These credentials do not work on the real service.

## First payroll

1. Add employees with stable employee IDs, salaries, employment dates, schedules, rest days, individual wage-benefit coverage, and HR-verified leave eligibility. Coverage defaults off for new profiles.
2. Review the ten starting leave policies. Configure entitlement, minimum service, eligibility, annual/monthly/no accrual, working/calendar-day counting, carry-over, expiry, documents, approval, pay, and inclusion in 13th-month basic salary. SIL starts at five days after twelve months, subject to explicit coverage verification. Other entitlements default to zero until configured. Per-event benefits can use no accrual and disable the annual balance requirement.
3. Add official holiday classifications for each relevant year. Dates are never seeded as permanent holidays. Employee rest days are combined with calendar classifications during calculation.
4. Create an approved Rules & Rates version. Set effective date, policy/legal basis, multipliers, divisors, grace period, cutoff, attendance deductions, contribution tables, tax brackets, reviewed calendar years, and the annual tax exemption allocated to 13th-month pay. The recorded approver comes from the signed-in administrator; a typed name cannot impersonate an approver.
5. Enter attendance or approved leave for every scheduled day. An unworked holiday on a rest day also needs a record to establish eligibility. Record unpaid breaks by exact date/time, and enter overnight clock-out using the next-day checkbox. Approve records and any documented offsets or exceptions.
6. Add authorized loans and additional earnings/deductions. Existing loans can begin with a verified opening balance. Once used by posted payroll, their repayment record is immutable through the application.
7. Calculate payroll. Resolve all blockers, open employee amounts to inspect formulas and underlying records, then review and post. Export the posted payroll as a real `.xlsx` workbook, including employee IDs, component calculations, late details, and posting metadata.

## Calculation conventions

- **Salary basis:** monthly salaried employees by default. A payroll profile with pay basis **daily** and a daily rate is paid that rate × scheduled workdays in the cutoff instead; rest days are unpaid, absences/unpaid leave deduct whole days, and the master monthly salary is used only as the contribution basis. Cutoff basic is monthly salary × 1 (monthly) or 0.5 (semi-monthly), prorated by scheduled days employed within that cutoff. Employment end dates, not the directory's active flag, stop subsequent payroll. Payroll cutoffs are whole calendar months or 1–15 and 16–month-end.
- **Rates:** daily wage = monthly salary ÷ daily divisor; hourly wage = daily wage ÷ hourly divisor. Reference workdays/month are policy metadata; actual scheduled days come from the employee schedule. HR must select consistent divisors and coverage for the employee population. A separate rules version cannot become effective partway through a cutoff; the engine blocks that cutoff until the rule change is aligned.
- **Premiums:** rest/holiday factors combine with OT and night factors. Ordinary OT defaults to 1.25, rest-day pay to 1.30, premium-day OT to a further 1.30, and NSD to a 0.10 differential. These are unapproved starting templates, not a claim that every employee is covered. The UI shows the compounded total rate. Actual earnings add only the premium above basic salary already credited, plus NSD separately, preventing double counting.
- **Time:** all input is local Philippines wall time. Shifts may cross midnight, last at most 24 hours, and contain timed unpaid breaks. Night time is 22:00–06:00. Each paid minute uses its actual calendar-date holiday classification; overtime begins after the shift's configured normal work minutes. Payroll allocation follows the shift's start date, including its next-day tail. Separate overlapping shifts are rejected. One attendance record is allowed per employee/start date.
- **Attendance:** missing/unapproved records block posting. Absences and unpaid leave deduct the configured daily wage; lateness uses uncovered minutes after grace and approved offsets; approved exceptions exempt late and undertime deductions. Official business is paid. Under-time is the normal work-minute deficit after excluding lateness, avoiding duplicate deductions.
- **Holidays:** special non-working days without work default to no pay; favorable company policy can provide pay. Regular/double unworked holiday pay requires verified coverage and an eligibility flag. Special+rest, regular+rest, double, and other classifications are configurable.
- **Leave:** whole-day requests only, using the policy's calendar-day or working-day basis. Requests may cross a calendar-year boundary; days are allocated to each annual balance. Annual grants renew each calendar year after the service requirement is met. Monthly accrual grants 1/12 per eligible month, beginning in the eligibility month. Carry-over is capped, consumed first, and expires at the end of the configured month. Current-year entitlement expires at year end. Approved requests reserve their days, including future requests. Leave policies without an approval requirement auto-approve an HR entry only after the same eligibility, documentation, and balance checks pass.
- **Contributions:** Rules & rates shows a Government contributions reference (`public/contributions.js`): mandated SSS, PhilHealth and Pag-IBIG percentages, floors, ceilings and legal basis; each bracket table checked against the mandate formula; employer shares for remittance planning only; and a monthly-salary calculator. Update `MANDATES` when an agency issues a new schedule. Tables intentionally start empty. For each employee, a monthly-salary bracket computes `fixed + rate × max(0, salary − excessOver)`, apportioned across the selected cutoffs. Brackets use inclusive lower bounds and exclusive upper bounds. A blank ceiling means infinity. HR must enter employee-share tables, including applicable caps and exemptions; the application does not guess current government schedules.
- **Tax:** the selected cutoff's table applies to gross less attendance deductions, employee contributions, and the exempt portion of 13th-month pay. The annual exemption is configured explicitly and defaults to zero in the unapproved template. Allocate it after accounting for any other benefits sharing that exemption. Taxable 13th-month excess is included automatically. Nonstandard benefits, annual tax reconciliation, previous-employer income, and refunds require approved adjustments; this is not a BIR filing/remittance service.
- **Loans:** each posted deduction is capped to outstanding balance, deduction per payroll, and remaining monthly amortization. Remaining terms count payroll deductions, not calendar months. Zero-balance loans stop automatically. Previews do not change balances; posting and balances commit in one SQLite transaction. Retrying the same posted fingerprint returns the original payroll.
- **13th month:** applicable basic earned in posted calendar-year payrolls ÷ 12, less any amount already paid. Wage deductions reduce applicable basic. Overtime, premiums, NSD, and ordinary allowances remain separate. Approved leave policies, holiday-base policy, and explicitly integrated additional earnings govern basic inclusion. Choose “Pay accrued balance” to include the unpaid entitlement in the cutoff; repeated payouts cannot pay the same entitlement twice.
- **Rounding:** currency is rounded to centavos on each auditable component/source line; totals sum those rounded lines. Intermediate wage rates retain precision.
- **Finalization:** payroll posts chronologically for each employee. Overlapping cutoffs, negative net pay, missing tables, and stale previews are rejected. Posted runs preserve source snapshots and the rules used. Attendance, leave, calendar entries, and adjustments affecting posted cutoffs are locked. Use an approved adjustment in a later open cutoff for corrections. There is no delete/unpost operation for finalized payroll.

## Access & deployment

Roles: Admin configures policies and users; HR maintains employees, attendance, leave, and holidays; Payroll maintains authorized loans/adjustments and posts payroll; Viewer reads shared HR and payroll reports, not private profile sections. Viewer is not an employee self-service account. Government IDs and bank details are readable only by Admin/HR/Payroll. Personal information and emergency contacts are Admin/HR only. HR/Admin edit government IDs; Payroll/Admin edit bank and payroll settings. Restricted audit events follow the same permissions, enforced on the server.

Passwords are salted with scrypt; browser sessions use HttpOnly/SameSite cookies, expire after eight hours, and require CSRF tokens for changes. Password changes revoke existing sessions. Login/setup attempts are rate-limited. Record inputs use strict server-side schemas. Audit events retain actor, timestamp, and before/after values. XLSX strings cannot execute as formulas.

Environment options:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HR_HOST` | `127.0.0.1` | Bind address; private local use by default |
| `HR_PORT` | `3400` | Listening port |
| `HR_ORIGIN` | `http://127.0.0.1:3400` | Exact browser origin for CSRF/origin checks |
| `HR_DATA_DIR` | `hr/data` | Private persistent database directory |
| `HR_SETUP_TOKEN` | Random per first-run process | Optional explicit bootstrap code |

For shared/production access, deploy this service on a Node host with a persistent private disk and an HTTPS reverse proxy, set `HR_ORIGIN` to its exact public HTTPS origin, and configure `HR_HOST` for the proxy. Secure cookies/HSTS activate for HTTPS origins. Do not expose it through a static-only Cloudflare upload. Use one service instance per database; this implementation is designed for a small HR team, not a horizontally scaled deployment. The database stores an application state document transactionally plus separate user/session/audit, modular employee-profile, and employee-document tables.

Protect the host and database with OS access controls and encrypted disk/backups. Stop the service before taking/restoring a complete copy of its database directory, or use SQLite's online backup tools. Test restoring a backup before operational use. Password recovery is administrator-assisted. There is no email delivery, external SSO, government submission, or bank disbursement integration.

## Employee 360 profiles

Admin/HR can delete a profile from its header (two-step confirmation) only when it has no attendance, leave, loan, adjustment, payroll, document, clock or login history; the audit trail keeps a delete entry. Otherwise set Employee status to Resigned or Inactive. Click an employee in the directory to open Personal Information, Employment, Government IDs, Attendance, Leave, Payroll, Loans, Documents, Emergency Contact, and Audit History. Existing IDs remain the links for all records. Unknown personal and employment facts remain blank; IDs are never interpreted as joining dates. Personal name edits update the master display name. Age, completed service months/years, rates, leave balances and next anniversary are calculated, with upcoming anniversaries shown on the dashboard for the next 60 days. February 29 anniversaries use February 28 in non-leap years.

Employee leave overrides specify annual days and an effective year, continuing until a subsequent year's override. Zero days is valid. Overrides retain the company's accrual, minimum service, carry-over and HR eligibility rules; they do not automatically grant coverage. Prior-year carry-over uses that prior year's override. A reduction below approved leave is rejected.

Attendance profiles store working hours (up to 16 regular hours), meal-break duration, grace, location, coordinates, geofence radius and policy. Optional day-specific schedules override start, end, regular hours, meal break and Office/WFH/Hybrid arrangement for a weekday, such as a Saturday half day; blank cells inherit the base schedule. Payroll undertime/overtime, clock-generated scheduled start and the employee portal use the schedule for each date. Individual hours/grace affect payroll; exact unpaid break times still come from each attendance record. Coordinates configure a location but manual attendance does not capture or validate GPS. Payroll profiles support rate overrides and holds. A hold blocks the whole posting for review; it never silently omits an employee. Employee frequency must match the approved company cutoff/tax rules; mixed-frequency batches are not supported. Profile settings are captured in posted payroll sources; personal/government/bank/emergency data never enter those sources.

HR/Admin upload PDF, PNG or JPEG documents up to 5 MB. Files are stored as private SQLite BLOBs, never in public assets. File signatures are checked; this is not antivirus scanning. All downloads require a session and document-specific authorization. Medical, disciplinary, resume, birth-certificate and other HR documents are Admin/HR only. Employees can upload and read their own leave/attendance supporting documents; HR/Admin can review them. Tax, statutory and employment/company-ID documents are Admin/HR/Payroll. Photos are visible to signed-in workspace users. Metadata includes uploader, date, expiry, status and remarks; documents can be archived without deleting history. PDFs and non-photo images download as attachments. Document contents are excluded from audit JSON, payroll snapshots and exports. Backups must protect these files as well as the rest of the database.

## Employee login and self-service

Administrators create accounts in **Account & access**, select **Employee — own records only**, and bind an existing Employee ID. Each employee can have only one account. They can sign in using that ID or their username. Employee sessions are denied all staff state, profile, audit, user-management and payroll-export endpoints; self-service endpoints derive ownership from the session, never a supplied Employee ID. Employee account access can be disabled and re-enabled by an administrator, revoking sessions immediately.

Complete and activate the employee's master profile before they clock attendance or request leave. Creating a login does not invent dates, salaries or entitlements. Real roster logins are not automatically provisioned with shared/default passwords. The local preview has a fictional-only `demo.employee` account, password `Demo-employee-only-2026`, bound to sample `EMP-001`; it is never created in the live database. A disposable UI fixture runs with `node hr/tests/portal-browser-fixture.mjs` on port 3402.

The employee portal includes today's status, actual/scheduled times, hours, late/undertime, original location history, leave credits and applications, pending-request cancellation, attendance explanations and offset requests, private supporting uploads, notifications and posted payslips. Payslips contain only the authenticated employee's figures and can be downloaded as paginated PDFs. The PDF uses a standard Latin font; the browser view preserves Unicode names.

**Live synchronization:** `/api/events` uses authenticated server-sent events to notify open screens after committed changes. Events contain no employee data; each client fetches only the data its session can access. HR's Overview and Live attendance views update without manual refresh. The client also updates every 20 seconds for time-based status changes and reconnect fallback, preserving open forms. Disable proxy buffering for event streams and allow long-lived connections. Session expiry, account disable, password changes and resets invalidate streams. A single Node process serves each database.

**Attendance:** Time in/out requests capture a fresh device location using the browser's Geolocation API. Production requires HTTPS and the employee's location permission; localhost is suitable for development. The server owns attendance time and stores device capture, server receipt and synchronization timestamps separately. Requests use idempotency IDs. Stale readings, duplicate clock-ins, invalid/over-24-hour shifts, closed payroll dates and disabled employment are rejected. Open overnight shifts retain their starting work date. An employee who misses checkout must time out within 24 hours or ask HR for a documented correction.

Original clock events are append-only, backed by SQLite update/delete rejection triggers. A completed shift creates an unapproved attendance record automatically. HR reviews actual unpaid break intervals, holiday eligibility and exceptions before payroll; no fabricated meal-break times are subtracted. Every correction or approval requires a reason and records before/after, actor, time and approver. Clock-linked employee/work-date identity cannot be reassigned. Attendance cannot be deleted through the API. Corrected missing checkout records have no fabricated GPS reading. Explanations are reviewed by HR/Admin; approved offsets are applied to the matching attendance and the employee is notified. Posted payroll remains locked.

**Location accuracy:** the portal shows latitude/longitude, the device's accuracy radius, distance from the configured workplace and Within/Outside/Uncertain geofence status. Uncertainty considers the accuracy circle, not just the center point. Poor readings are flagged; browser GPS can be inaccurate or spoofed and is not proof of physical presence. OpenStreetMap is loaded only when the user chooses **Load interactive map**, with disclosure that the coordinates go to that provider. No map request occurs automatically.

Reverse-geocoded addresses are optional. Set `HR_GEOCODING_URL` to an approved HTTPS Nominatim-compatible reverse endpoint returning `display_name`; configure service access, quotas and provider privacy requirements before enabling it. Address lookup occurs only when requested, is cached separately from the immutable original event, and does not prevent clocking if unavailable. Without a provider, the UI displays the exact stored coordinates and the configured workplace label without claiming it is a verified street address.

**Recovery and two-factor:** Forgotten-password requests produce an indistinguishable response for unknown accounts and appear in the administrator's recovery queue for valid accounts. After verifying identity, the administrator issues a random, single-use reset code valid for 15 minutes and delivers it directly. Codes are stored only as hashes and never in audit events. Issuing/redeeming codes revokes sessions. Administrators can explicitly reset a lost authenticator after identity verification. Optional TOTP setup requires the current password and confirmation from an authenticator (SHA-1, six digits, 30 seconds). Two-factor changes revoke sessions; login rejects reused codes. Password/OTP attempts are rate-limited. The application does not send email or SMS.

Technical references: [browser location permissions and freshness options](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/getCurrentPosition), [OpenStreetMap embedding](https://wiki.openstreetmap.org/wiki/Export), [TOTP specification](https://www.rfc-editor.org/rfc/rfc6238.html).

## Verification & code map

```powershell
npm run hr:test
npm run hr:coverage
node node_modules/eslint/bin/eslint.js hr --max-warnings=0
npm run build
```

- `src/engine.mjs`: pure payroll, date, night-work, eligibility, and leave-balance calculations.
- `src/schema.mjs`: strict entity/request schemas.
- `src/service.mjs`: authorization, record workflows, locking, posting, and loan transactions.
- `src/store.mjs`: persistent SQLite state, users, sessions, and audit events.
- `src/auth.mjs`: password hashing, sessions, rate limits, and password changes.
- `src/portal.mjs`: owned employee data, clock events, geofences, leave/explanation workflow, HR live views, and payslip PDFs.
- `src/profiles.mjs`: modular profiles and restricted employee documents.
- `public/portal.js`: mobile employee portal, live HR attendance, map, recovery and authenticator controls.
- `src/server.mjs`: same-origin authenticated HTTP API and public sign-in assets.
- `src/export.mjs`: dependency-free XLSX workbook generation.
- `public/`: responsive HR interface.
- `tests/`: calculation, workflow, persistence, authorization, and HTTP tests plus a disposable browser fixture.

Policy reference: [DOLE/NWPC 2024 workers' statutory monetary benefits handbook](https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf). Its special-day guidance establishes no-work/no-pay subject to favorable policy, while its premium, OT, and NSD sections explain compounded rates. [DOLE's 13th-month guidance](https://dole.gov.ph/news/dole-to-employers-give-13th-month-pay-on-time/) describes the annual basic-salary basis and exclusions. Current company and statutory applicability must be reviewed through the application's versioned configuration.
