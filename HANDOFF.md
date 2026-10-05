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
- Most recent full test run: 102 tests passing (Oct 2026).

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
