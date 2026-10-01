# Workspaces redesign — integration guide

Everything in `redesign-code/` mirrors your repo layout. Copy the files over, apply the small patches below, run the migration, done.
Backend logic (resolvePerson, RBAC/RLS, audit log, encryption) is untouched.

## 1. Files

**New — copy as-is**
| File | What it is |
|---|---|
| `backend/prisma/migrations/20260925090000_office_accent_and_icon/migration.sql` | `accent_hue` + `icon` on `office`, seeded for the 3 existing offices |
| `backend/src/services/officeBreakdown.ts` (+ `.test.ts`) | Per-office monthly + per-barangay counts for the City overview |
| `frontend/src/styles/workspace.css` | Per-office theming (one `--hue` → all `--primary*` tokens), dark mode, new component classes |
| `frontend/src/lib/officeTheme.ts` | Icon set, hue choices, `officeAppearance()`, `officeColor()` |
| `frontend/src/components/Icon.tsx` | Renders icons from `officeTheme.ts` |
| `frontend/src/components/shell/OfficeSidebar.tsx` | Scoped office rail (identity + per-module New/Records) |
| `frontend/src/components/shell/AdminSidebar.tsx` | Dark admin rail (Analytics / Records / Office workspaces / Manage) |
| `frontend/src/components/OfficeAppearancePicker.tsx` | Color + icon picker for Create/Edit office |
| `frontend/src/components/RecordStatusPill.tsx` | "Linked to registry" / "Not linked" pill + name helper |
| `frontend/src/pages/OfficeHomePage.tsx` | Office staff landing page |
| `frontend/src/pages/AdminOverviewPage.tsx` | City overview: story line, KPIs, stacked monthly chart, donut, barangay ranking, overlap |
| `frontend/src/pages/AdminOfficeWorkspacePage.tsx` | Admin's read-only view into one office |

**Replace your existing file**
| File | Change |
|---|---|
| `frontend/src/App.tsx` | Split into Office/Admin shells, sets `--hue`, adds `home`, `reports`, `office:<id>` tabs |
| `frontend/src/pages/DynamicOfficeIntakePage.tsx` | 3-step flow (Find → Details → Review). Same `submitOfficeRecord` payload |
| `frontend/src/pages/DynamicOfficeRecordsPage.tsx` | Workspace header, `readOnly` + `onNew` props |

Admin tab keys that moved: the old **Dashboard** page (`AdminDashboardPage`) now lives under **Reports & exports** (`reports`); `dashboard` is the new `AdminOverviewPage`.

## 2. Patches to existing files

### `backend/prisma/schema.prisma` — `model Office`
```prisma
  accentHue   Int      @default(255) @map("accent_hue")
  icon        String   @default("building")
```

### `backend/src/routes/adminOffices.ts`
```ts
const OFFICE_SELECT = { id: true, name: true, slug: true, description: true, isActive: true, createdAt: true, accentHue: true, icon: true } as const;

// createOfficeSchema and updateOfficeSchema — add:
  accentHue: z.number().int().min(0).max(359).optional(),
  icon: z.string().trim().min(1).max(40).optional(),

// in the POST handler's client.office.create({ data: { ... } }) — add:
  accentHue: parsed.data.accentHue,
  icon: parsed.data.icon,
```
(PATCH already spreads the parsed body into `update` — if not, add the same two fields there.)

### `backend/src/routes/office.ts`
Add `accentHue: true, icon: true` to its `OFFICE_SELECT` so office staff get their own office's appearance.

### `backend/src/routes/adminInsights.ts`
```ts
import { computeOfficeBreakdown } from '../services/officeBreakdown';

adminInsightsRouter.get(
  '/office-breakdown',
  asyncHandler(async (req, res) => {
    const client = getPrismaForRole('admin');
    res.json(await computeOfficeBreakdown(client, filtersFromQuery(req.query)));
  }),
);
```
Already behind `requireRole('admin')`. Add `GET /admin/insights/office-breakdown` to `routes/rbacMatrix.test.ts` (admin 200, office_staff 403, anonymous 401).

### `frontend/src/lib/api.ts`
```ts
export type Office = {
  // ...existing fields
  accentHue?: number;
  icon?: string;
};

export type OfficeBreakdown = {
  offices: Array<{ id: string; name: string; slug: string; accentHue: number; icon: string }>;
  moduleOffice: Record<string, string>;
  months: Array<{ month: string; counts: Record<string, number> }>;
  barangays: Array<{ code: string; name: string; total: number; counts: Record<string, number> }>;
};

// in `api`:
  createOffice: (data: { name: string; slug: string; description?: string; accentHue?: number; icon?: string }) => ...,
  updateOffice: (id: string, data: { name?: string; description?: string | null; isActive?: boolean; accentHue?: number; icon?: string }) => ...,
  officeBreakdown: (filters: InsightsFilters = {}) =>
    request<OfficeBreakdown>(`/admin/insights/office-breakdown${queryString(filters)}`),
```

### `frontend/src/main.tsx`
```ts
import './styles/adminator.css';
import './styles/workspace.css'; // must load after adminator.css
```

### `frontend/src/pages/CreateOfficePage.tsx`
```tsx
const [hue, setHue] = useState(195);
const [icon, setIcon] = useState('cross');
// usedBy: build from api.listOffices() -> { [accentHue]: shortName(name) }

<OfficeAppearancePicker hue={hue} icon={icon} usedBy={usedBy} previewName={name}
  onChange={(p) => { if (p.hue !== undefined) setHue(p.hue); if (p.icon) setIcon(p.icon); }} />

await api.createOffice({ name, slug, description: description || undefined, accentHue: hue, icon });
```
Same picker in `AllOfficesPage`'s edit form, calling `updateOffice`.

### `frontend/src/components/OfficeModuleRecordsPanel.tsx`
Add a status column to its `RecordsListTable` columns:
```tsx
{ header: 'Registry status', render: (r) => <RecordStatusPill record={r} /> }
```

## 3. Fonts (air-gapped server)
`workspace.css` expects `frontend/public/fonts/PublicSans-Variable.woff2` (SIL Open Font License). Download it once on the build machine; it gets baked into the frontend image, so nothing is fetched at runtime.

## 4. Rollout order
1. `npx prisma migrate deploy` → `npx prisma generate`
2. Backend patches, then `npm run test --workspace backend` (incl. the new `officeBreakdown.test.ts`)
3. Frontend files + patches, then `npm run typecheck && npm run lint`
4. Sign in as each demo account and check: office rail color, intake steps 1–3, records header, admin office workspaces, City overview filters, dark mode toggle.

## 5. Mapped from the prototype, not yet coded
These pages keep working as they are today and pick up the new colors, type and dark mode from `workspace.css`. The prototype's extra interaction for each is a follow-up:
- **Matching settings:** a live table showing what would happen to sample name pairs at the current threshold.
- **Households:** an indented family-tree layout, with office chips on each member.
- **Visualizations:** a donut chart type. The backend `WidgetChartType` only has `bar | line | number`, so this needs an enum migration.
- **Staff accounts:** filter chips by office.
