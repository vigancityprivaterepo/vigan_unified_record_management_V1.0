# antislop audit 003: follow-up

Date: 2026-10-02
Approved for fixing: #1, #2, #3. Numbers 4 to 8 were not touched.

## Fixed

| # | Rule | What changed |
|---|---|---|
| 1 | R-02 | Every double hyphen used as a dash in on-screen text replaced with a period or a comma: the 7 messages listed in the audit, one more the audit missed (chart cards with no records yet: "No records yet in ... It fills in once staff submit intakes there."), and 8 server error messages that appear on screen (can't deactivate, delete or demote your own account; module used by a visualization; field already on every form; record linked to a citizen; person already heads a household). Only the dashes changed; other wording ("module", "admin") is left for #4 and #8. |
| 2 | R-36, C-5 | Sign-in footer: "RA 10173 (Data Privacy Act) compliant" became "Personal data here is covered by the Data Privacy Act (RA 10173)." |
| 3 | R-36 | Program gaps rule type: "is NOT in the program" / "IS still in the program" became "Not yet served: meets the conditions and is not in the program" / "Needs cleanup: meets the conditions and is still in the program". |

## Delivery Gate

- R-02: no ` -- ` or em dash left in on-screen text or server messages (search over `.ts` and `.tsx`, comments excluded).
- R-36: no all-caps emphasis; no compliance claim.
- Typecheck, lint and 122 backend tests pass. No test depended on the changed messages.

## Still open

#4 to #8 from `audit-003-2026-10-02.md`, and whether to restore the page descriptions removed outside this session.
