# GDS HR project handoff

The current user is continuing work on the GDS CAPITAL INC. HR application in this repository. Read README.md and docs/HR-201.md for operation and architecture. Ask the user what to change next; this handoff is not a request to add features automatically.

## Scope
- HR application: src (Node.js service and SQLite), public (browser UI), tests, scripts.
- Keep current uncommitted work. Do not reset files or overwrite private databases.
- Do not read or transmit private databases or employee documents unless needed and explicitly authorized. Never publish data/ or demo logins.

## Running the HR application
- Preview URL: http://127.0.0.1:3401/ . It may already be running; do not start a duplicate.
- Preview command: npm run preview
- Preview SQLite: data/roster-preview.sqlite; live SQLite: data/hr.sqlite. They are separate.
- Live application command: npm run dev (default port 3400); public site: HR_ORIGIN=https://hr.blkstone.site npm start with the gds-hr Cloudflare tunnel.
- Checks: npm test; npm run lint.
- Most recent full test run: 120 tests passing (Oct 2026).

## Current features and approved design
- GDS CAPITAL INC. branding: red, gold, white, black.
- Employee profiles: position is mandatory when saving Employment details.
- Four clickable profile boxes: Personal Information, Employment Details, Attendance, Audit History. They open separate detail views with Back to profile cards. They are not accordions.
- Profile boxes are stacked vertically at 25% container width, approximately 246 x 50 pixels at the reviewed desktop size. No Open details label, arrow, or visible subtitle on these boxes.
- The four destinations retain personal/emergency details; employment/documents/government IDs; attendance/leave/payroll/bank/loans; and audit history respectively.
- Employee self-service includes own-record-only login, optional TOTP, HR-assisted recovery, GPS clocking, live HR updates, leave requests, explanations, supporting documents, and posted payslips.
- Payslip screen and PDF itemize contributions, loans, adjustments and salary computations using posted payroll snapshots.
- Employee navigation cards are approximately twice their prior height with relevant emojis. They use a responsive 3-column desktop / 2-column mobile grid.
- Welcome banner uses existing mascot copied from public/mascot-poses/07-welcoming-client.png into public/welcome-mascot.png. The HR server exposes /welcome-mascot.png.
- Welcome banner includes a visible Philippine Time (Asia/Manila, UTC+8) clock and full date, ticking each second. It uses the device clock for display; attendance remains server-timed.
- Day-specific schedules: attendance profiles accept weekday overrides (start, end, regular hours up to 16, meal break, Office/WFH/Hybrid). Engine helper `scheduleOn` in src/engine.mjs; tests in tests/schedules.test.mjs.
- Daily-paid basis: payroll profile `basis: 'daily'` + `dailyRate` pays rate × scheduled workdays (src/engine.mjs); tests in tests/daily-pay.test.mjs.
- Employee directory shows Position only. Profile header has Delete profile (history-free employees only; src/service.mjs assertNoEmployeeHistory; tests/employee-delete.test.mjs).
- Rules & rates: Government contributions panel (public/contributions.js; tests/contributions.test.mjs).
- Latest changes: public/portal.js, public/style.css, src/server.mjs and public/welcome-mascot.png.

## Since then
- HR 201 modules (dashboard, 201 files and documents, data sheets, memos, trainings, reports, settings, new roles): see docs/HR-201.md.
- Red-and-gold theme is the default (Settings → Company branding); forest green is optional.
- The 菲龍集團 GDS Capital logo is public/gds-logo.png (app) and public/payslip-logo.jpg (payslip PDF).
- This project was separated from the PDMN Virtual Office website repository in Oct 2026; it is now its own repository.
- Employee 201 profile (public/hr-files.js): info cards (years of service, employment type, job level, date hired) and tabs Overview, Personal, Employment, Compensation, Government IDs, Family, Education, Employment History, Requirements, Documents, Memos, Trainings, Activity. The older four-box profile is still reached through "Attendance, leave & pay".
- Manual time & pay entry per employee per cutoff (src/payroll-inputs.mjs, engine `manual`): mode add (hours on top of attendance) or replace (days/absences/late/undertime typed, attendance not required). Opened from the payroll computation screen.
- Shared UI for every account: boxed fields/section cards live in public/hr-common.js (fieldBoxes, sectionCard) and are used by the HR profile and the employee portal's "My profile" tab (read-only; GET /api/hr/me/profile).
- Interface updates reach open tabs: GET /api/version (hash of public file mtimes); app.js checks every 60 s, shows a notice and reloads at the next page change when no dialog or form is being edited. Shared records and settings are always server-side (SQLite); browser storage holds only per-device preferences (sidebar collapsed, Payroll & Attendance menu open).
- 13th month & final pay (src/thirteenth.mjs, public/thirteenth-ui.js; tests/thirteenth.test.mjs): basic salary for months before the system is encoded per employee per month (prior_earnings table); posted payroll months always win. Final pay itemizes unpaid salary, pro-rated 13th month, leave conversion, separation pay (authorised causes) and outstanding loans; saved computations are audited.
- Maker role (tests/maker.test.mjs): every non-salary employee record (incl. government IDs and restricted non-salary documents) without pay: no compensation tab, payroll workspace, pay reports, salary-bearing documents (employment contract, tax) or salary values in the audit trail. The audit table has SQLite triggers that reject UPDATE and DELETE.
- Payroll manual overrides (manual entry dialog → "Manual overrides of calculated amounts"): replace one computed earning/deduction per cutoff with a reason; trace labelled "Manual override" with original → revised. Overtime filing (src/overtime.mjs, overtime_requests table): late clock-out is not overtime by itself; employees file OT in the portal (My overtime), HR approves/rejects in Attendance → Overtime filings (or records approved OT for an employee). Payroll pays only approved hours, capped at hours worked beyond the schedule; pending filings block posting. Rules & rates → Overtime approval can switch back to paying all approved attendance beyond the schedule. Tests: tests/payroll-overrides.test.mjs.
- Login accounts are created manually in Account & access (no automatic creation). Admins can delete login accounts (type username to confirm; not self or the last enabled admin).
- Employee 201 compliance: the portal dashboard shows a red "Not complied" banner and the My 201 documents tab a count flag while any required document is Missing/Rejected/Expired; uploading lifts it. Employee uploads go into the same 201 record HR reviews (HR bell counts them) and send HR a notification.
- Employee portal dashboard order: Welcome box, Time in/out card, not-complied notice, menu cards; Account & security and Sign out buttons sit at the top right of the header. Requirements have "Provided by" (Employee / Company-HR; Settings → requirements); company-provided ones (contract, job description, onboarding, evaluation, training certificates, separation) are not listed in employee accounts. The not-complied notice is a numbered list.
- Account & access → "Create accounts for all employees": one login per registered (non-archived) employee without one; username = Employee number; the admin types a default password (never stored in code or logs); users.must_change_password forces "Choose your own password" at first sign-in (server returns 403 for everything else until changed). Top bar shows only the system title (no page name).
- Night differential on overtime filings (src/overtime.mjs nightHoursBetween/nightEstimate): night hours = portion of the filed span between 10 PM and 6 AM; employee form shows them live; HR Overtime filings panel has totals (pending, approved OT hours, approved night differential hours and estimated pay). Payroll pays NSD (rules nsd, default 10%) on approved OT minutes actually worked in the night window. Memos use 5 categories (dropdown).
- Names are capitalized word by word (src/names.mjs titleCase): applied server-side to personal names, emergency contact and family names on every save (201 form, profile sections, data sheets), and in the browser when a name box loses focus. Existing names change only when that record is next saved.
- One-time start-up migrations (src/migrations.mjs, recorded in hr_counters, audited): existing names capitalized; every employee's department set to GDS Capital HQ (added to Settings departments). Live DB backup before this: data/backups/hr.sqlite.before-names-20261005-170726. Live attendance no longer shows the "Not configured" geofence label.
- Leave policy (one-time migration, audited; backup data/backups/hr.sqlite.before-leave-20261005-171528): Vacation Leave 7 days + SIL 5 days, both after 12 months; Erika, Albert, Marien, Edwin get VL + SIL, others SIL. 201 file → Leave credits tab: HR / Admin / Maker type credits for the year (blank = policy), days used before the system, and eligibility; leave profile entitlements gained manualCredits / usedBefore (engine leaveBalance uses the exact-year entry).
- Employee portal: notification bell in the header (replaces the bottom notification list; count = unread since last opened, per device). Every employee submission (time in/out, leave, proof, explanation, documents, overtime, loans, data sheet, memo acknowledgement, cancellations) shows a confirmation box and writes a notice to the employee's bell (server.mjs employeeNotice). HR/admin bell number also clears once opened until new items appear.
- Withholding Tax Calculation dialog has "Adjust withholding tax" (amount + reason, stored as a payroll-input tax override; Reset to computed). Payroll computation table keeps the Employee column fixed while scrolling sideways.
- Withholding tax: payroll profile withholdingTax (withhold / exempt; legacy profile Payroll section, shown on the 201 Compensation tab). One-time migration set every current employee to Exempt and restored contribution timing to split (half each cutoff; it had been set to the second cutoff on 2026-10-02). Backup: data/backups/hr.sqlite.before-wtax-20261005-180607.
