# CLAUDE.md — AutoSync V3

## ⚠️ CRITICAL: THIS IS NOT NEXT.JS

This project uses **React Router 7** (formerly Remix). NOT Next.js. NOT standard React.

**If you catch yourself thinking about:**
- `app/page.tsx`, `app/layout.tsx`, `getServerSideProps`, `useRouter` → **STOP. Wrong framework.**
- `middleware.ts`, `next.config.ts`, `proxy.ts` → **STOP. This is React Router 7.**
- `shadcn/ui`, `Tailwind CSS`, `globals.css`, `design-tokens.ts` → **STOP. We use Shopify Polaris only.**
- `@vercel/postgres`, `@vercel/kv`, `Neon`, `Drizzle` → **STOP. We use Supabase.**
- `Server Components`, `'use client'`, `'use server'` → **STOP. React Router 7 doesn't use these directives.**

---

## ⚠️ MANDATORY WORKFLOW — READ BEFORE EVERY CHANGE

### Before writing ANY code:
1. **Read `app/lib/design.ts`** — ALL styles, colors, spacing, grid layouts, bar charts, status tones live here. NEVER hardcode styles inline. Import from design.ts.
2. **Read `app/lib/use-app-data.ts`** — ALL live data comes from this hook. NEVER create scattered useState+useEffect polling. Use `useAppData()`.
3. **Read `app/components/HowItWorks.tsx`** — Every page MUST have this component. Same design everywhere.
4. **Read `app/components/OperationProgress.tsx`** — Every operation with progress MUST use this. No custom progress bars.
5. **Read `app/routes/app.api.job-status.tsx`** — ALL stats flow through this single endpoint. NEVER query stats separately in loaders when live data is needed.

### When checking pages:
- **NEVER ASSUME anything works** — always verify via browser extension
- **Check EVERY element** for inconsistencies: wrong labels, missing data, broken badges, null values showing as "—"
- **Compare with other pages** — if Dashboard shows "Needs Review", ALL pages must show "Needs Review" (not "Unmapped" or "Flagged" separately)
- **Check database column names** — don't guess. Query the DB first to verify column names match your code
- **If you see a problem, FIX IT** — don't skip it, don't note it for later. Fix it now.

### Architecture rules:
- ALL styles → `app/lib/design.ts` (statMiniStyle, statGridStyle, cardRowStyle, barChartRowStyle, etc.)
- ALL live data → `app/lib/use-app-data.ts` (useAppData hook with 5s polling)
- ALL shared components → `app/components/` (HowItWorks, OperationProgress, IconBadge, SkeletonCard, DataTable)
- ALL job processing → Supabase Edge Function (`supabase/functions/process-jobs/index.ts`)
- ALL tenant data → scoped by `shop_id` from `session.shop`
- ALL publication IDs → from `tenants.online_store_publication_id` (NOT hardcoded)

---

## Session Rules

1. Read this file AND the mandatory workflow section before starting any work
2. Never ask "what's next" — check the plan and keep working
3. Quality over speed — no shortcuts, no placeholder code
4. Never stop working until the current phase is complete
5. Use relative imports (`../lib/...`) — no `~/` aliases configured
6. Always run `npx react-router build` to verify before committing
7. **NEVER ASSUME** — always verify via browser, database, and Vercel logs
8. **NEVER hardcode styles** — always use design.ts constants
9. **NEVER create new polling** — always use useAppData hook

---

## Project Overview

AutoSync is a **multi-tenant SaaS Shopify App** for automotive e-commerce. Any Shopify merchant installs it from the App Store to manage vehicle fitment data (Year/Make/Model/Engine), collections, and storefront widgets.

- **Framework**: React Router 7 (`@shopify/shopify-app-react-router`)
- **Bundler**: Vite (NOT Webpack, NOT Turbopack)
- **UI**: Shopify Polaris React (`@shopify/polaris ^13.9.5`) — NOT shadcn/ui, NOT Tailwind
- **Database**: Supabase (PostgreSQL via `@supabase/supabase-js`, service role key, NO RLS)
- **Auth**: Shopify OAuth via `authenticate.admin(request)` from `shopify.server.ts`
- **Session Storage**: Prisma (ONLY for Shopify sessions — NOT for app data)
- **Billing**: 6-tier managed pricing via Shopify Billing API
- **Deployment**: Vercel via `@vercel/react-router` adapter + `shopify app deploy` for extensions
- **Build**: `npx react-router build` (NOT `next build`, NOT `npm run build`)
- **Dev**: `shopify app dev` (starts Vite + ngrok tunnel)

---

## React Router 7 — How This Framework Works

### Routing (Flat Dot-Notation)

Routes are **flat files** in `app/routes/` using dot-notation (NOT nested folders):
```
app/routes/app._index.tsx       → /app           (dashboard)
app/routes/app.products._index.tsx → /app/products
app/routes/app.products.$id.tsx → /app/products/:id
app/routes/app.api.push.tsx     → /app/api/push  (API endpoint)
```

- `_index` = index route for a parent
- `$id` = dynamic parameter (accessed via `params.id`)
- `app.tsx` = layout route that wraps all `app.*` routes
- Files prefixed with `app.api.*` are API-only routes (no UI, just `action` exports)

### Data Loading (Loaders & Actions)

Every page has a `loader` (GET data) and optionally an `action` (POST/mutate data):

```typescript
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";

// Server-side: runs on the server, has access to DB, secrets, etc.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  // Query database, return data
  return { products, count };
};

// Server-side: handles form submissions and mutations
export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  // Process mutation
  return { success: true };
};

// Client-side: React component
export default function MyPage() {
  const { products, count } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  // Render with Polaris components
}
```

### Client-Side API Calls

For complex flows (file uploads, multi-step wizards), we use `fetch()` to API routes:

```typescript
// In a component:
const response = await fetch("/app/api/provider-fetch", {
  method: "POST",
  body: formData,
});
const result = await response.json();
```

For simpler mutations, use `useFetcher`:
```typescript
const fetcher = useFetcher();
fetcher.submit(formData, { method: "POST", action: "/app/api/push" });
```

### Key Differences from Next.js
| Next.js | React Router 7 |
|---------|---------------|
| `app/page.tsx` (nested folders) | `app/routes/app.page.tsx` (flat dot-notation) |
| `getServerSideProps` / Server Components | `export const loader` |
| `useRouter()` from `next/navigation` | `useNavigate()` from `react-router` |
| `useSearchParams()` from `next/navigation` | `useSearchParams()` from `react-router` |
| `'use client'` / `'use server'` directives | No directives needed — loaders run on server, components on client |
| `middleware.ts` | No middleware — auth in each loader via `authenticate.admin(request)` |
| `next/image` | Standard `<img>` or Polaris `<Thumbnail>` |
| API routes in `app/api/` | `app/routes/app.api.*.tsx` with `action` export |

---

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | React Router 7 + Vite | `@shopify/shopify-app-react-router ^1.1.0` |
| UI | `@shopify/polaris ^13.9.5` | Shopify-native components, NO custom CSS framework |
| Database | `@supabase/supabase-js ^2.99.2` | Service role key, NO RLS |
| Shopify Auth | `authenticate.admin(request)` | From `shopify.server.ts` |
| App Bridge | `@shopify/app-bridge-react ^4.2.4` | Embedded app experience |
| Session | Prisma (`@prisma/client ^6.16.3`) | ONLY for Shopify session storage |
| FTP | `basic-ftp ^5.2.0` | FTP file downloads (works on Vercel serverless) |
| Deployment | `@vercel/react-router ^1.2.6` | Vercel adapter for React Router |
| Build | `npx react-router build` | Vite-based build |
| Dev | `shopify app dev` | Vite dev server + ngrok tunnel |

---

## File Structure (Complete)

```
app/
  routes/                    # React Router flat dot-notation routes
    app.tsx                   # Layout wrapper (Polaris Frame, auth, tenant upsert)
    app._index.tsx            # Dashboard
    app.products._index.tsx   # Product browser (IndexTable, search, filter)
    app.products.$id.tsx      # Single product editor (fitment mapping)
    app.fitment._index.tsx    # Fitment overview
    app.fitment.manual.tsx    # Manual mapping queue (cascading YMME dropdowns)
    app.push.tsx              # Push to Shopify page
    app.collections.tsx       # Collection strategy manager
    app.vehicles.tsx          # YMME database browser
    app.vehicle-pages.tsx     # Vehicle spec page manager (metaobjects)
    app.providers._index.tsx  # Provider list (stats dashboard + card grid)
    app.providers.new.tsx     # New provider wizard (4 steps)
    app.providers.$id.tsx     # Provider detail (overview, settings, test connection)
    app.providers.$id.import.tsx    # Import wizard (4 steps: upload → preview → validate → import)
    app.providers.$id.products.tsx  # Provider products (IndexTable)
    app.providers.$id.imports.tsx   # Import history list
    app.providers.$id.imports.$importId.tsx  # Import detail view
    app.providers.$id.mapping.tsx   # Column mapping editor
    app.providers.$id.pricing.tsx   # Provider-scoped pricing rules
    app.pricing.tsx           # Global pricing rules
    app.analytics.tsx         # Analytics dashboard (plan-gated)
    app.plans.tsx             # Plan comparison (6 tiers)
    app.help.tsx              # Help documentation (12 sections)
    app.settings.tsx          # App settings
    app.admin._index.tsx      # Admin panel (owner-only, tenant stats)
    app.admin.plans.tsx       # Admin plan management
    app.admin.tenant.tsx      # Admin tenant detail
    app.api.auto-extract.tsx  # Auto-extraction API
    app.api.fetch-products.tsx # Shopify product sync API
    app.api.fetch-status.tsx  # Fetch status polling API
    app.api.pricing.tsx       # Pricing rules CRUD API
    app.api.provider-fetch.tsx  # Provider test connection + data fetch API
    app.api.provider-import.tsx # Import pipeline API
    app.api.provider-mapping.tsx # Column mapping CRUD API
    app.api.push.tsx          # Push to Shopify API
    app.api.scrape-brand.tsx  # Vehicle scraper API (admin-only)
    app.api.scrape-status.tsx # Scraper status API
    app.api.suggest-fitments.tsx # Fitment suggestion API
    app.api.upload-preview.tsx  # File upload + preview API
    app.api.upload.tsx        # Raw file upload API
    app.api.vehicle-pages.tsx # Vehicle spec pages API
    app.api.ymme.tsx          # YMME data API (makes/models/engines)
    proxy.tsx                 # App Proxy for storefront widgets
    auth.$.tsx                # OAuth callback
    auth.login/               # Login page
    legal.privacy.tsx         # Privacy policy
    legal.terms.tsx           # Terms of service
    webhooks.*.tsx            # Webhook handlers (6 files)
  components/
    AutoSyncLogo.tsx          # App logo component
    IconBadge.tsx             # Icon with colored background badge
    OnboardingChecklist.tsx   # First-time merchant checklist
    PageFooter.tsx            # Standard page footer
    PlanGate.tsx              # Feature gating UI (shows upgrade prompt)
    SectionCard.tsx           # Reusable card with header
    StatBar.tsx               # Horizontal stat bar
    SuggestionCard.tsx        # Fitment suggestion card
    VehicleSelector.tsx       # Cascading Make→Model→Year→Engine dropdowns
  lib/
    db.server.ts              # Supabase admin client (exports `db`)
    billing.server.ts         # 6-tier plan limits, assertFeature, getTenant
    admin.server.ts           # Admin shop detection
    types.ts                  # PlanTier, FitmentStatus, PlanLimits, Tenant, formatTimeAgo
    engine-format.ts          # Engine display formatting
    extraction/               # YMME extraction engine (8 files, ~2000+ lines)
      patterns.ts             # 55 make patterns, model/engine patterns
      ymme-index.ts           # In-memory YMME index builder
      ymme-scanner.ts         # 4-pass text scanner (make→model→year→engine)
      signal-extractor.ts     # 5-signal multi-source extraction
      signal-fuser.ts         # Signal fusion with source weights
      ymme-resolver.ts        # 5 model resolution strategies
      ymme-extract.ts         # V2 orchestrator
      index.ts                # Public exports
    pipeline/                 # Server pipelines
      fetch.server.ts         # Shopify product fetch
      extract.server.ts       # Fitment extraction
      push.server.ts          # Push tags/metafields to Shopify
      collections.server.ts   # Smart collection management
      pricing.server.ts       # Pricing rule engine
      cleanup.server.ts       # Data cleanup utilities
      vehicle-pages.server.ts # Vehicle spec page pipeline
    providers/                # Data source adapters
      csv-parser.server.ts    # CSV parsing (papaparse)
      xml-parser.server.ts    # XML parsing (fast-xml-parser)
      json-parser.server.ts   # JSON parsing
      universal-parser.server.ts # Auto-detect format + parse
      api-fetcher.server.ts   # HTTP API data fetcher
      ftp-fetcher.server.ts   # FTP file download (basic-ftp)
      column-mapper.server.ts # Smart column mapping with memory
      import-pipeline.server.ts # Full import orchestrator
      transform-rules.ts      # Data transformation rules
    scrapers/                 # Vehicle data scrapers (admin-only)
      autodata.server.ts      # auto-data.net scraper
      nhtsa.server.ts         # NHTSA API client
    dvla/                     # UK vehicle lookup
      ves-client.server.ts    # DVLA Vehicle Enquiry Service
      mot-client.server.ts    # MOT History API (OAuth2)
      vin-decode.server.ts    # VIN decoder
  shopify.server.ts           # Shopify app config (OAuth, session, API version)
  db.server.ts                # Prisma client (ONLY for session storage)
extensions/
  autosync-widgets/           # Theme App Extension
    blocks/                   # 8 Liquid widget blocks
      ymme-search.liquid      # Cascading vehicle search
      fitment-badge.liquid    # "Fits your vehicle" badge
      vehicle-compatibility.liquid # Full compatibility table
      floating-vehicle-bar.liquid  # Persistent vehicle bar
      plate-lookup.liquid     # UK reg plate lookup (Enterprise)
      wheel-finder.liquid     # PCD/offset/bore search (Business+)
      vin-decode.liquid       # VIN decoder
      vehicle-spec-detail.liquid   # Vehicle spec display
    shopify.extension.toml
```

---

## Authentication Pattern

Every route loader/action starts with:
```typescript
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  // All queries MUST be scoped by shopId
};
```

- `session.shop` returns the Shopify store domain (e.g., `performancehq-3.myshopify.com`)
- This is used as the tenant identifier in ALL database queries
- Admin detection: `isAdminShop(shopId)` in `admin.server.ts`

---

## Database Pattern

```typescript
import db from "../lib/db.server";

// Supabase client with service role key (full access, bypasses RLS)
// ALL tenant-scoped queries MUST filter by shop_id
const { data, error } = await db
  .from("products")
  .select("id, title, fitment_status")
  .eq("shop_id", shopId)
  .order("created_at", { ascending: false });
```

**Two separate database clients:**
1. `app/lib/db.server.ts` — Supabase client for ALL app data (products, providers, YMME, etc.)
2. `app/db.server.ts` — Prisma client for Shopify session storage ONLY

---

## Billing / Plan Gating

```typescript
import { assertFeature, getPlanLimits, getTenant } from "../lib/billing.server";

// Throw BillingGateError if feature not available
await assertFeature(shopId, "autoExtraction"); // Growth+ only

// Get plan limits for the tenant
const tenant = await getTenant(shopId);
const limits = getPlanLimits(tenant?.plan ?? "free");
```

---

## 6-Tier Pricing

| Tier | Price | Products | Fitments | Providers | Key Features |
|------|-------|----------|----------|-----------|-------------|
| Free | $0 | 50 | 200 | 0 | Manual mapping only |
| Starter | $19/mo | 1,000 | 5,000 | 1 | Push tags/metafields, YMME widget, fitment badge |
| Growth | $49/mo | 10,000 | 50,000 | 3 | Auto extraction, bulk ops, all 4 widgets, collections (make) |
| Professional | $99/mo | 50,000 | 250,000 | 5 | API integration, custom vehicles, My Garage, collections (make+model) |
| Business | $179/mo | 200,000 | 1,000,000 | 15 | FTP import, Wheel Finder, priority support |
| Enterprise | $299/mo | Unlimited | Unlimited | Unlimited | DVLA plate lookup, VIN decode, full CSS customisation |

---

## YMME Strategy (3-Tier)

Shopify limits: 250 tags/product, 128 items/list metafield.

| Tier | Storage | Data | Purpose |
|------|---------|------|---------|
| Tags | Shopify tags | `_autosync_{MakeName}`, `_autosync_{ModelName}` | Smart collections |
| Metafields | App-owned | make, model, generation, year_range (JSON) | Storefront display |
| YMME API | Supabase | Engines, exact years, full specs | Storefront filtering |

---

## Theme App Extension

8 Liquid blocks in `extensions/autosync-widgets/blocks/`:
- `ymme-search.liquid` — Cascading vehicle search dropdowns (with localStorage persistence + popover garage)
- `fitment-badge.liquid` — "Fits your vehicle" badge on product pages
- `vehicle-compatibility.liquid` — Full compatibility table
- `floating-vehicle-bar.liquid` — Persistent selected vehicle bar (Euro Car Parts style)
- `plate-lookup.liquid` — UK registration number lookup (Enterprise)
- `wheel-finder.liquid` — PCD/offset/bore search (Business+)
- `vin-decode.liquid` — VIN decoder
- `vehicle-spec-detail.liquid` — Vehicle specification display

All widgets communicate through the App Proxy route (`proxy.tsx`).

---

## Provider System

Providers are data sources (CSV, XML, JSON, API, FTP) that merchants connect to import products.

**Import flow:**
1. Merchant creates a provider (type + config)
2. For CSV/XML: upload a file via DropZone → `app.api.upload-preview.tsx`
3. For API: click "Fetch from API" → `app.api.provider-fetch.tsx` with `_action=fetch`
4. For FTP: click "Fetch from FTP" → same API, downloads file via `basic-ftp`
5. Preview shows rows + smart column mapping (with memory from previous imports)
6. Merchant adjusts mappings → starts import → `app.api.provider-import.tsx`
7. Import pipeline: parse → map columns → detect duplicates → create products in DB

**FTP works on Vercel serverless** — uses `basic-ftp` library with in-memory `Writable` stream buffer. Tested and proven in production (V1 had this working for years).

---

## Key Commands

```bash
# Development
shopify app dev              # Start dev server (Vite + ngrok tunnel)
npx react-router build       # Production build (MUST pass before committing)
npx tsc --noEmit             # TypeScript check (MUST be clean)

# Deployment
git push origin master       # Triggers Vercel deployment (auto)
shopify app deploy           # Deploy extensions to Shopify

# Type Generation
npx react-router typegen     # Generate route types
npx prisma generate          # Generate Prisma client (for sessions only)
```

---

## Environment Variables

```
SUPABASE_URL=<supabase-project-url>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SHOPIFY_API_KEY=<app-api-key>
SHOPIFY_API_SECRET=<app-secret>
DVLA_API_KEY=<dvla-ves-key>
MOT_API_KEY=<mot-history-key>
```

---

## Conventions

- **No hardcoded colors** — use Polaris tokens and CSS variables (`var(--p-color-*)`)
- **No Tailwind, no globals.css, no design-tokens.ts** — pure Polaris
- **App-prefixed tags** — `_autosync_` prefix prevents conflicts with merchant tags
- **App-owned metafields** — `$app:vehicle_fitment.*` namespace (Shopify-protected)
- **Engine data** — NEVER in tags or metafields — always via YMME API
- **No AI** — all extraction uses pattern matching, regex, coded rules
- **Relative imports** — `../lib/...` not `~/lib/...`
- **Flat route naming** — `app.products.$id.tsx` not nested folders
- **Multi-tenant** — every data query scoped by `shop_id` from `session.shop`
- **Badge children must be strings** — use template literals, never numbers or arrays
- **Badge tone "default" doesn't exist** — use `undefined` for neutral tone
- **Client-side fetch for complex flows** — `fetch("/app/api/...")` for uploads, multi-step wizards
- **`useFetcher` for simple mutations** — `fetcher.submit(formData, { method: "POST", action: "..." })`
- **`useLoaderData` for reading server data** — type-safe with `useLoaderData<typeof loader>()`

---

## Common Polaris Patterns Used

```typescript
// Polaris imports
import { Page, Card, BlockStack, InlineStack, Text, Badge, Button, Banner,
         DataTable, IndexTable, EmptyState, ProgressBar, Icon, Box } from "@shopify/polaris";
import { ProductIcon, ImportIcon } from "@shopify/polaris-icons";

// Page with primary action
<Page fullWidth title="Products" primaryAction={{ content: "Add", onAction: () => navigate("/app/new") }}>

// Cards with content
<Card><BlockStack gap="300">...</BlockStack></Card>

// Navigation
const navigate = useNavigate();
navigate("/app/products/123");
```

---

## What NOT To Do

1. **Don't use Next.js patterns** — no `app/page.tsx`, no `getServerSideProps`, no `'use client'`
2. **Don't install shadcn/ui or Tailwind** — we use Polaris exclusively
3. **Don't use Prisma for app data** — Prisma is ONLY for Shopify session storage
4. **Don't add `globals.css` or `design-tokens.ts`** — styling is Polaris components + CSS vars
5. **Don't use `useRouter` from Next.js** — use `useNavigate` from `react-router`
6. **Don't create nested route folders** — use flat dot-notation files
7. **Don't assume server components or client boundaries** — React Router 7 handles this differently
8. **Don't use `export default function` for API routes** — API routes export `action` only (no component)
