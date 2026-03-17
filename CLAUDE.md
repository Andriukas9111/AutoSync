# CLAUDE.md — AutoSync V3

## Session Rules

1. Read this file before starting any work
2. Never ask "what's next" — check the plan and keep working
3. Quality over speed — no shortcuts, no placeholder code
4. Never stop working until the current phase is complete
5. Use relative imports (`../lib/...`) — no `~/` aliases configured

---

## Project Overview

AutoSync is a **multi-tenant SaaS Shopify App** for automotive e-commerce. Any Shopify merchant installs it from the App Store to manage vehicle fitment data (Year/Make/Model/Engine), collections, and storefront widgets.

- **Framework**: React Router 7 (`@shopify/shopify-app-react-router`)
- **UI**: Shopify Polaris React (NOT shadcn/ui)
- **Database**: Supabase (PostgreSQL, service role key, no RLS)
- **Auth**: Shopify OAuth via `authenticate.admin(request)` from `shopify.server.ts`
- **Billing**: 6-tier managed pricing via Shopify Billing API
- **Deployment**: Shopify CLI (`shopify app deploy`) or standalone via `react-router-serve`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Router 7 + Vite |
| UI | @shopify/polaris ^13.9.5 |
| Database | @supabase/supabase-js ^2.99.2 |
| Shopify | @shopify/shopify-app-react-router ^1.1.0 |
| App Bridge | @shopify/app-bridge-react ^4.2.4 |
| Session | Prisma session storage |
| Build | `npx react-router build` |
| Dev | `shopify app dev` |

---

## Key Architecture

### File Structure

```
app/
  routes/              # React Router file-based routes (flat dot notation)
    app._index.tsx      # Dashboard
    app.products.tsx    # Product browser
    app.products.$id.tsx # Single product editor
    app.fitment.tsx     # Fitment overview
    app.fitment.manual.tsx # Manual mapping queue
    app.push.tsx        # Push to Shopify page
    app.collections.tsx # Collection strategy
    app.vehicles.tsx    # YMME browser
    app.providers.tsx   # Provider list
    app.providers.new.tsx # New provider form
    app.plans.tsx       # Plan comparison (6 tiers)
    app.help.tsx        # Help documentation (10 sections)
    app.settings.tsx    # App settings
    app.admin.tsx       # Admin panel (owner-only)
    app.api.*.tsx       # API routes (fetch-products, auto-extract, push, upload, ymme)
    proxy.tsx           # App Proxy for storefront widgets
    webhooks.*.tsx      # Webhook handlers
  components/
    VehicleSelector.tsx  # Cascading Make→Model→Year→Engine dropdowns
    OnboardingChecklist.tsx # First-time merchant checklist
    PlanGate.tsx        # Feature gating UI component
  lib/
    db.server.ts        # Supabase admin client (exports `db`)
    billing.server.ts   # 6-tier plan limits, assertFeature, getTenant
    types.ts            # PlanTier, FitmentStatus, PlanLimits, Tenant
    extraction/         # YMME extraction engine (8 files, ~2000+ lines)
    pipeline/           # Server pipelines (fetch, extract, push, collections)
    providers/          # CSV/XML parsers, API/FTP fetchers
    scrapers/           # auto-data.net + NHTSA scrapers (admin-only)
    dvla/               # DVLA VES + MOT History API clients
  shopify.server.ts     # Shopify auth config
extensions/
  autosync-widgets/     # Theme App Extension
    blocks/             # 6 Liquid widget blocks
    shopify.extension.toml
```

### Authentication Pattern

Every route loader/action starts with:
```typescript
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  // ... tenant-scoped queries using shopId
};
```

### Database Pattern

```typescript
import db from "../lib/db.server";

// All tenant-scoped queries MUST filter by shop_id
const { data } = await db
  .from("products")
  .select("*")
  .eq("shop_id", shopId);
```

### Billing / Plan Gating

```typescript
import { assertFeature, getPlanLimits, getTenant } from "../lib/billing.server";

// Throw BillingGateError if feature not available
await assertFeature(shopId, "autoExtraction"); // Growth+ only
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

## Extraction Engine

Located in `app/lib/extraction/`. No AI — all pattern matching, regex, coded rules.

- `patterns.ts` — 55 make patterns, model patterns, engine code patterns
- `ymme-index.ts` — In-memory index builder from Supabase YMME tables
- `ymme-scanner.ts` — 4-pass text scanner (make→model→year→engine)
- `signal-extractor.ts` — 5-signal multi-source extraction
- `signal-fuser.ts` — Signal fusion with source weights and confidence scoring
- `ymme-resolver.ts` — Structured CSV resolver with 5 model resolution strategies
- `ymme-extract.ts` — V2 orchestrator with engine expansion rules
- `index.ts` — Public exports

---

## Theme App Extension

6 Liquid blocks in `extensions/autosync-widgets/blocks/`:
- `ymme-search.liquid` — Cascading vehicle search dropdowns
- `fitment-badge.liquid` — "Fits your vehicle" badge on product pages
- `vehicle-compatibility.liquid` — Full compatibility table
- `floating-vehicle-bar.liquid` — Persistent selected vehicle bar
- `plate-lookup.liquid` — UK registration number lookup (Enterprise)
- `wheel-finder.liquid` — PCD/offset/bore search (Business+)

All widgets communicate through the App Proxy route (`proxy.tsx`).

---

## Key Commands

```bash
# Development
shopify app dev          # Start dev server with ngrok tunnel
npx react-router build   # Production build (verify before committing)

# Deployment
shopify app deploy        # Deploy to Shopify (includes extensions)

# Database
# Supabase migrations in supabase/migrations/
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

- **No hardcoded colors** — use Polaris tokens and CSS variables
- **App-prefixed tags** — `_autosync_` prefix prevents conflicts
- **App-owned metafields** — `autosync_fitment.*` namespace
- **Engine data** — NEVER in tags or metafields — always via YMME API
- **No AI** — all extraction uses pattern matching
- **Relative imports** — `../lib/...` not `~/lib/...`
- **Flat route naming** — `app.products.$id.tsx` not `app/products/[id]/page.tsx`
- **Multi-tenant** — every data query scoped by `shop_id`
