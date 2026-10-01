# DESIGN.md: Vigan City Records (VUCRMS)

Design direction for the Vigan Unified Central Record Management System frontend.
Everything below was decided by the product owner during development; the source of each decision is noted. Items marked **[OWNER TO SET]** have not been decided yet and must not be filled in by an agent.

## Identity

- **Product:** the City Government of Vigan's central record system. Office staff register and correct citizen records; the administrator sees the whole city.
- **Audience:** city hall staff across offices, including older and non-technical users; one city administrator.
- **Personality:** plain, official, trustworthy. A working tool, not a showcase.
- **Mark:** the real City of Vigan seal. No invented logo.
- **Identity motif: Vigan brick.** The fired-clay red of the bahay na bato walls on Calle Crisologo (#9A3B22; #D9805F on dark surfaces). Used in three places only: the primary button in light mode, the active navigation marker, and the sign-in screen (product name and Sign in button). Everything else stays monochrome. *Source: owner, 2026-10-01 (audit 001 #14).*

## Dials

- **Dial: ENERGY 1 / RHYTHM 1 / MOTION 1** *(source: owner, 2026-10-01, "calm public-service")*
- ENERGY 1: calm, plain, no attention-seeking visuals; one clear focal point per screen.
- RHYTHM 1: predictable, uniform layouts on purpose, so staff find things in the same place on every screen.
- MOTION 1: hover and focus states only; no scroll reveals, parallax or looping animation.

## Color

- **Chrome is monochrome**, except the Vigan brick motif above. Buttons, active navigation, badges, focus rings, status pills and card surfaces use charcoal in light mode and muted emerald in dark mode, not a color per office. *Source: owner asked to simplify the "AI slop colors" to black.*
- **Color only where it carries meaning:** office icon tiles identify the office; charts use color to separate series. *Source: owner, "at visualization and icons we still need colors".*
- **Office hue stays on icon tiles, not bare dots.** With 30 to 40 offices the 16 hues repeat, so a colored dot alone cannot name an office; the icon plus its accessible name can. Where a label already names the office (filter chips, the office dropdown), no color mark is added. Lists show at most 4 office marks, then "+N". *Source: owner, 2026-10-01 (audit 001 #12).*
- **Charts:** colorblind-safe Okabe-Ito set, teal first, no purple; at most 4 colored series, the rest muted grey; donuts capped at 5 slices. *Source: owner approved the Anti-AI-UI chart guide fixes.*
- **Dark mode:** a "light dark" emerald green (deep green-tinted surfaces, not navy or black), with a working light/dark toggle. *Source: owner request.*
- **Semantic colors:** red for errors and delete, green for success. Nothing else.
- **Contrast:** all text at least 4.5:1 (WCAG AA). Measured values live next to the tokens in `frontend/src/styles/workspace.css`.

## Typography

- **Headings:** Libre Franklin. **Body and tables:** Source Sans 3. **IDs and codes only:** JetBrains Mono (`.mono`). *Source: owner asked to replace the "AI slop" fonts using the Anti-AI-UI repository as reference; this is its institutional/government pairing, adjusted to a sans body for dense tables.*
- Weights 400, 500, 600 only. Page titles 22px / 600.
- **Uppercase is used in two places only, on purpose:** sidebar group labels (they group navigation, not content) and table column headers (short, scannable column names). Both at 11 to 11.5px, 600 weight, 0.06 to 0.08em tracking. Everything else is sentence case. *Source: owner approved audit 001 #8.*
- Body text 15px, kept above the guide's 13 to 14px on purpose for older staff. *Source: owner approved.*
- Fonts are self-hosted (offline server).

## Layout and components

- Fixed sidebar plus top bar; content scrolls.
- One sidebar entry, "Office workspaces", opens a searchable directory of offices, so the sidebar does not grow with 30 to 40 offices. *Source: owner request.*
- Detail views (citizen profile, household, chart) open as popup cards from a full-width list. *Source: owner request.*
- Radius tokens: `--r-sm` 6px (status pills, badges, counts, office marks), `--r-md` 10px (cards), `--r-lg` 12px (popups), `--r-pill` only for things you press to filter (chips, segmented controls, legend toggles). *Source: owner approved audit 001 #13.*
- **Icons:** one hand-drawn 24px set (`lib/officeTheme.ts` ICONS), 1.8 to 1.9px rounded strokes, kept on purpose: thin rounded strokes stay clear at 15 to 18px for older staff and match the light Source Sans body. Office icons name what each office does: sprout (Agriculture: crops), sprout2 (Livelihood and Cooperatives: growing a business), heart (CSWD: social care), cross (Health: medical), scroll (Civil Registry: certificates), coins (Treasurer: payments), paw (Veterinary: animals), store (BPLO: businesses), building (Assessor: property), clipboard (Planning and Development: plans and clearances), map (Tourism: places to visit), hammer (Engineering: building permits), leaf (CENRO: environment), alert (CDRRMO: disasters), briefcase (PESO: jobs), grad (Scholarship: students); building is also the fallback. No text glyphs (check marks, arrows, x) as icons; the set's SVGs are used instead. *Source: owner, 2026-10-01 (audit 001 #9, #10).*
- **City overview's job:** show which barangays the programs reach and which they miss. Order: KPIs, barangay coverage (fewest citizens first, every barangay listed), entries per month by office, citizens served by more than one program. No donut. *Source: owner, 2026-10-01 (audit 001 #11).*
- Sample data is always labelled "Sample" / "Sample data".

## Open decisions

- None from audit 001.
