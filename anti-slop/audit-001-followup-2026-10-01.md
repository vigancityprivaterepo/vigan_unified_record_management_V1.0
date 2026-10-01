# antislop audit 001: follow-up

Date: 2026-10-01
Approved for fixing: #1 to #5 (round 1), chart motion, #6, #7 (round 2), #8 to #15 (round 3).
Backups of every changed file: `backups/antislop-audit-001/`.

## Fixed

| # | Rule | What changed | Evidence |
|---|---|---|---|
| 1 | R-37, R-31 | `DESIGN.md` created at the project root. It records only decisions the owner made (monochrome chrome, color only for office icons and charts, emerald dark mode, Libre Franklin plus Source Sans 3, Okabe-Ito charts, 15px body, office directory, popup detail views), each with its source. Dials and the identity motif are marked **[OWNER TO SET]**, not invented. | File present; no field filled without a source. |
| 2 | R-25 | `--t-light` (text used for axis labels, hints, placeholders, footer) changed from #94A3B8 to #666E7B in light mode. | Measured with `contrast-check.py`: 5.15:1 on white, 4.80:1 on #F6F7F8, 4.72:1 on #F4F5F7, 4.63:1 on #F2F3F5 (was 2.56:1 on white). An intermediate value, #6B7280, was rejected because it measured 4.35:1 on #F2F3F5. |
| 3 | R-32 | A global `:focus-visible` ring (2px, `--focus-ring`) for buttons, links, role=button and tabbable elements; a light ring on the always-dark admin rail; a ring on the search wrappers (`.ws-list-search`, `.ws-picker-search`, `.ws-search form`) whose inputs remove their own outline; a ring on `.input/.select/.textarea` for keyboard focus. | Ring colors measured: #1B2230 on white 15.93:1; #A9CFC1 on the dark card 7.04:1; #E6EAF0 on the admin rail 14.62:1 (non-text minimum 3:1). |
| 4 | R-02 | 9 em dashes removed from UI text. Sentences rewritten with a comma ("correct it in Citizens, since it's shared…", "Sample data, not real records", "…with a chart, for example registrations…"). Empty-value placeholders replaced with words: "No barangay", "Not provided", "N/A" when a load failed, "…" while loading. | `grep` for the em dash in non-comment `.ts/.tsx` lines: 0. |
| 5 | R-27 | New `LoadError` component (what failed, the server's reason when given, Retry). Failures that used to look like "empty" now show an error: City overview (no more endless spinner), its KPI cards ("N/A" instead of a dash), the review-queue count, office Home charts (no longer shows "Build a chart" on failure), an office's programs in admin's workspace view, office staff's own programs, the intake registry search ("search failed, try again before registering a new person", so a failed search can't cause a duplicate registration), the barangay list on the intake form, and the office list on Staff accounts. | Typecheck, lint and production build pass. Left as is on purpose: `/auth/me` failing means "signed out", and the admin sidebar's office count is decorative. |

## Delivery Gate (items 1 to 5 only)

- R-02 PASS: no em dash left in UI text (grep count 0).
- R-25 PASS for the changed token: every measured pair above is at least 4.5:1.
- R-27 PASS for the listed screens: each now has loading, empty and error states.
- R-32 PASS by code inspection: every focusable element gets a visible ring in both themes and on the dark rail.
- R-37 PASS (dials): owner set ENERGY 1 / RHYTHM 1 / MOTION 1 (calm public-service) on 2026-10-01, recorded in DESIGN.md. Identity motif still [OWNER TO SET].
- R-35: see round 2 below (browser click-through run).

## Round 2 (approved: chart motion, #6, #7)

| Item | Rule | What changed | Evidence |
|---|---|---|---|
| Motion | R-19, MOTION 1 | Owner set MOTION 1 (hover and focus only). All chart entrance animations turned off: Visualizations bar/line/donut, Insights trend and barangay ranking (recharts `isAnimationActive={false}`), household tree and Sankey (ECharts `animation: false`). | grep: no `isAnimationActive` left that isn't `false`. |
| #7 | R-03 | Below 900px the top-bar search becomes a 44px Search button that opens a full-width search row (focused, Escape closes, Ctrl+K opens it). Top-bar buttons are 44px on small screens; Help got an accessible name now that its text label hides. | Click-through: 768px and 360px, search opens focused, Escape closes. |
| #6 | R-35 | Click-through in Microsoft Edge (headless, Playwright) with the temporary test accounts claude.admin and claude.staff (random in-memory passwords set via the audited admin route; both deactivated afterwards; nothing saved). | See below. |
| #6 fix | R-03 | The click-through found two 360px overflows, both fixed: (a) Overview "served by more than one program" rows drew a dot for every office (16+ dots); now only the offices in that combination, with an accessible label. (b) Matching settings: a base rule kept a card header's last child from shrinking, so the description could not wrap; the title block now shrinks. | Re-measured all 10 admin pages at 360px: scrollWidth 360 on every page. |

### Recorded click-through (admin, 1366px unless noted)

- Sign in -> City overview loads. PASS
- Theme toggle -> data-theme changes and back. PASS
- Help -> dialog opens, Escape closes. PASS
- Ctrl+K -> top-bar search focused; typing shows the results menu. PASS
- Nav to Visualizations, Insights, Citizens, Households, Duplicate review, Office workspaces, Offices, Staff accounts, Matching settings -> each page's heading renders. PASS
- Chart card -> popup opens, Escape closes. Create visualization -> form opens, Escape closes. PASS
- Citizen row -> profile popup. Household row -> household popup. Both close with Escape. PASS
- Office workspace -> Records and Charts tabs switch. PASS
- Offices -> Manage popup and Create office popup open and close. Staff accounts -> Add staff account popup opens and closes. PASS
- Keyboard: 6 Tab presses from the top -> every focused element shows a 2px solid outline. PASS
- 768px and 360px -> page fits the width (after the fix above); search button opens search; navigation drawer opens and closes. PASS
- Sign out -> back to the sign-in form. PASS
- Console: only the expected 401 from the pre-login session check. HTTP errors after sign-in: 0.

### Recorded click-through (office staff, Civil Registry)

- Sign in -> office Home ("Good …") loads. PASS
- Charts -> office chart board loads. PASS
- Records -> Birth records page loads. PASS
- New registration -> intake step 1 shows (nothing submitted). PASS
- Sign out. PASS
- Console: only the expected pre-login 401. HTTP errors: 0.

Not covered by this run: submitting forms (to avoid creating data), every dark-mode screen (toggle verified on Overview only), and office staff pages at 360px.

## Round 3 (approved: #8 to #15)

Owner decisions taken first (2026-10-01): #14 Vigan brick accent; #11 the Overview is for barangay coverage; #12 keep hues on icon tiles; #9 keep the icon set and write the reason. Backups: `backups/antislop-audit-001-round3/`.

| # | Rule | What changed | Evidence |
|---|---|---|---|
| 8 | R-06 | Uppercase kept only for sidebar group labels and table column headers, with the reason in DESIGN.md, at 11 to 11.5px and calmer tracking (was 10px at 0.14 to 0.2em). Sentence case for eyebrows (office Home date, household and citizen counts), popup kickers, "Manage office" section titles, the brand tag, the chart form's office headings, and the sign-in footer. | Click-through: no uppercase text on Visualizations. |
| 9 | R-04 | Icon set kept. DESIGN.md records why (thin rounded strokes are clear at small sizes for older staff) and why each office has its icon, checked against the live office table. | DESIGN.md "Layout and components". |
| 10 | R-04 | Text glyphs replaced with the set's SVGs plus readable text: barangay filter chip (x icon, "Clear barangay filter" name), KPI change ("Up / Down" with trend icons, new `trendUp` / `trendDown`), "Open review queue" arrow, "On dashboard / On Home" check, intake stepper check (with "(done)" for screen readers), "Selected" check. | grep for the glyphs in `.tsx`: 0 (the remaining bullets are the ID mask, which is content). |
| 11 | R-05, C-3 | Overview reordered around its job: KPIs, then **Barangay coverage** (all 42 barangays, fewest citizens first, "None yet" for unreached ones; sort toggle; first 10 then "Show all"; columns Citizens / Records / Offices; selecting one filters the charts below and names it in the chart title), then entries per month by office (full width), then citizens served by more than one program. Donut removed. New `coverage` field on the office breakdown API (all time, includes barangays with no records). | Click-through: section order, 10 rows then 42, fewest-first starts at "None yet", selecting a barangay filters and retitles the chart. |
| 12 | R-29 | Bare office dots replaced with `OfficeMark` (small colored icon tile with an accessible name) on Citizens rows and chart cards; at most 4, then "+N". Dots removed where a label already names the office (filter chips, office dropdown) and from the Overview overlap list (the program names say it). | Click-through: Citizens rows show named marks. |
| 13 | R-11 | Radius tokens `--r-sm` 6 / `--r-md` 10 / `--r-lg` 12 / `--r-pill`. Status shapes (pills, badges, office chips, household counts, tags) moved from pill to 6px; pill kept only for filter chips, segmented controls and legend toggles. 12 inline radii (8, 10, 12, 14) mapped to `--r-md` / `--r-lg`. | Typecheck, lint, build pass. |
| 14 | R-20 | Vigan brick motif (#9A3B22, #D9805F on dark surfaces): primary buttons in light mode, the active navigation marker (admin rail and office rail), the sign-in product name and button. | Contrast: white on #9A3B22 6.95:1; #9A3B22 on #F4F5F7 6.37:1; #D9805F on admin rail 6.05:1 and on the dark office rail 4.50:1. Click-through: sign-in button and admin active marker read back as brick. |
| 15 | R-31 | Dead rules for the removed sidebar office list deleted (`.ws-rail-filter`, `.ws-rail-group*`, `.ws-chev`, 778 bytes). Repeated inline values moved to classes for the new Overview sections (`.ws-cov-*`, `.ws-section-head`, `.ws-stack-y`). | grep for the removed selectors: 0. |

Also found and fixed while checking: 10 more em dashes written as `&mdash;` entities that round 1's search missed (intake result card, duplicate review, sign-in footer). R-02 grep now covers both the character and the entity: 0.

### Round 3 click-through (Edge, temp account claude.admin, deactivated afterwards)

- Sign-in button is Vigan brick. PASS
- Overview order: Barangay coverage, Entries per month by office, Citizens served by more than one program; donut gone. PASS
- Coverage: 10 rows, "Show all 42 barangays" lists 42, fewest first starts with "None yet", "Most first" reorders. PASS
- Selecting a barangay filters the monthly chart and its title says which barangay; the clear chip has an accessible name. PASS (first run FAILED: the title did not change; fixed and re-run)
- Admin active navigation marker is brick. PASS
- Citizens rows show named office marks. PASS (screenshot showed 12+ marks squeezing names; capped at 4 plus "+N" after the run)
- No uppercase text on Visualizations. PASS
- 360px: Overview, Visualizations, Citizens, Offices, Staff accounts all scrollWidth 360. PASS
- HTTP errors: 0.

Not covered: the office-staff rail marker and dark mode were checked by contrast measurement and code only, not by screenshot; the Citizens "+N" cap was typechecked and linted but not re-screenshotted.

### Data note (not a UI change)

The barangay table holds three test rows, "Filter A" (TSTFLTA), "Filter B" (TSTFLTB) and "Edit A" (TSTEDTA), left by an automated test. They now show in Barangay coverage as "None yet". Not deleted: hard deletes need the owner's go-ahead.

## Still open

Nothing from audit 001.
