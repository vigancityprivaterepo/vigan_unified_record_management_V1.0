# antislop audit 002: follow-up

Date: 2026-10-02
Approved for fixing: #1 to #5. Backups of the stylesheets: `backups/antislop-audit-002/`.

## Fixed

| # | Rule | What changed | Evidence |
|---|---|---|---|
| 1 | R-37, DESIGN.md | Nothing under 12px except the two uppercase labels DESIGN.md records (sidebar group labels 11px, table column headers 11.5px). Error messages, field help and small buttons 13px (were 11.5px); tags, badges, the sidebar count badge (was 9px), footer, chart axes and legends 12px. | Size count after the fix: only the two recorded labels are under 12px. |
| 2 | R-02, R-31 | One page-title style: `hero-title` now matches `ws-page-head h1` (22px, same letter spacing); the office Home greeting lost its inline 26px. Titles renamed to match their sidebar entry and sentence case: "Duplicate review" (was Duplicate Review Queue), "Matching settings" (was Duplicate Matching), "New visualization" (was Create Visualization). | grep: no Title Case page titles left. |
| 3 | R-31 | Every half-pixel size snapped to whole pixels (10.5, 11.5 to 12; 12.5 to 13; 13.5 to 14; 14.5 to 15) in both stylesheets and 9 components. Scale tokens `--fs-xs` to `--fs-title` added for new code and the scale written into DESIGN.md. | 21 CSS rules and 9 component files changed. |
| 4 | R-31 | `public/fonts/PublicSans-Variable.woff2` deleted (referenced nowhere). | Build passes. |
| 5 | R-02 | Badges read "Needs review" and "Pending". | |

## Not done

The roughly 140 inline sizes in components were snapped to the scale but not rewritten to use the `--fs-*` tokens one by one; the tokens are for new code.

## Also found

A comment clean-up made outside this session (committed separately as `298121d`) had removed an `eslint-disable` line in the Insights page, which failed the lint check. The line is restored with its reason.

## Delivery Gate

- R-02: titles and status words in sentence case; no em dashes added.
- R-37: the size floor now matches DESIGN.md's choice of larger text for older staff.
- Checked at 360px: all 14 admin pages fit (scrollWidth 360). Typecheck, lint, production build and 122 backend tests pass.
