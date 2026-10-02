# antislop audit 003: follow-up

Date: 2026-10-02
Approved for fixing: #1, #2, #3 (first round); #4 and #8 (second round). Numbers 5, 6 and 7 were not touched.

## Fixed

| # | Rule | What changed |
|---|---|---|
| 1 | R-02 | Every double hyphen used as a dash in on-screen text replaced with a period or a comma: the 7 messages listed in the audit, one more the audit missed (chart cards with no records yet: "No records yet in ... It fills in once staff submit intakes there."), and 8 server error messages that appear on screen (can't deactivate, delete or demote your own account; module used by a visualization; field already on every form; record linked to a citizen; person already heads a household). Only the dashes changed; other wording ("module", "admin") is left for #4 and #8. |
| 2 | R-36, C-5 | Sign-in footer: "RA 10173 (Data Privacy Act) compliant" became "Personal data here is covered by the Data Privacy Act (RA 10173)." |
| 3 | R-36 | Program gaps rule type: "is NOT in the program" / "IS still in the program" became "Not yet served: meets the conditions and is not in the program" / "Needs cleanup: meets the conditions and is still in the program". |

## Second round (#4, #8)

| # | Rule | What changed |
|---|---|---|
| 4 | R-02 | Database and code words replaced with plain ones on screen and in server messages people see. "Citizen row" now reads "added to the City Citizen Registry", "already in the registry, so no duplicate was added", "saved without a registry link". Matching settings no longer shows the function name `resolvePerson()`: "Controls how close two registrations must be before they are treated as the same citizen." "Module" became "program" everywhere it is shown (form titles, the office delete question with a proper plural instead of "module(s)", error messages, "Select programs", "Programs set up"); the Create office field "Module name" (actually the office's identifier) became "Identifier (cannot be changed later)". "Intakes" became "registrations"; "dedup merges" became "merged duplicates"; "intake form" became "every program's form". |
| 8 | R-02 | "admin" became "administrator" in sentences: the review status ("Awaiting administrator review", also in CSV exports and Help), the intake result card ("The administrator will decide in Duplicate review", which also fixes the old page name), and the three "Have another administrator do it" messages. |

Code names (variables, routes, database columns) were not renamed; only text people read.

## Delivery Gate

- R-02: no ` -- ` or em dash left in on-screen text or server messages (search over `.ts` and `.tsx`, comments excluded).
- R-36: no all-caps emphasis; no compliance claim.
- Typecheck, lint, production build and 122 backend tests pass after both rounds. No test depended on the changed messages.

## Still open

#5, #6 and #7 from `audit-003-2026-10-02.md`, and whether to restore the page descriptions removed outside this session.
