# AutoSync V3 — Architecture Design Document

**Date:** 2026-03-17
**Status:** Approved
**Version:** 3.0 (clean-slate rebuild)

---

## 1. Overview

AutoSync is a Shopify App Store SaaS application for Year/Make/Model/Engine (YMME) vehicle fitment management. Merchants fetch products into the system, map each product to compatible vehicles (automatically or manually), then push structured data back to Shopify — tags, metafields, and smart collections. Storefront widgets let customers find parts by vehicle selection or registration plate lookup.

This is V3 — a complete rebuild from scratch using Shopify's official React Router 7 app framework. V1 and V2 (both Next.js) are scrapped. The only asset carried forward is the existing YMME vehicle database (66 makes, 2,229 models, 20,397 engines in Supabase).

## 2. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | React Router 7 (Shopify official) | Built-in OAuth, sessions, billing, webhooks. Eliminates entire class of V1/V2 auth/billing security bugs. Required path to "Built for Shopify" badge. |
| API | GraphQL Admin API only | REST deprecated. GraphQL required for new apps since April 2025. Better rate limiting (points-based). |
| Database | Supabase (PostgreSQL) | Keep existing YMME data. RLS for multi-tenancy. Real-time subscriptions for progress tracking. |
| Session storage | Prisma → Supabase PostgreSQL | Works across serverless instances (SQLite would not). |
| Billing | Shopify Managed Pricing | Configured in Partner Dashboard. No billing code in app. Up to 4 public plans + 10 private. |
| UI | Shopify Polaris React | BFS requirement. Web Components still in preview. |
| Storefront widgets | Theme App Extensions (Liquid blocks) | BFS requirement. No script injection or theme file modification. |
| Storefront data | App Proxy | Avoids CORS. Shopify proxies requests through store domain. |
| Deployment | Vercel | Serverless, low cost, auto-scaling, good React Router 7 support. |

## 3. Project Structure

```
autosync-v3/
├── app/
│   ├── routes/
│   │   ├── app._index.tsx          # Dashboard (home)
│   │   ├── app.products.tsx        # Product browser
│   │   ├── app.products.$id.tsx    # Single product fitment editor
│   │   ├── app.fitment.tsx         # Auto/Manual fitment overview
│   │   ├── app.fitment.manual.tsx  # Manual mapping queue
│   │   ├── app.push.tsx            # Push to Shopify
│   │   ├── app.providers.tsx       # Provider management
│   │   ├── app.providers.new.tsx   # Add provider (CSV/API/FTP)
│   │   ├── app.collections.tsx     # Collection strategy config
│   │   ├── app.vehicles.tsx        # YMME browser (select active makes)
│   │   ├── app.settings.tsx        # App settings
│   │   ├── app.plans.tsx           # Plan info & upgrade
│   │   ├── app.help.tsx            # Feature documentation
│   │   ├── app.tsx                 # Layout (Polaris AppProvider + nav)
│   │   ├── webhooks.tsx            # Webhook handler
│   │   ├── auth.$.tsx              # OAuth catch-all
│   │   └── proxy.tsx               # App Proxy handler (storefront API)
│   ├── lib/
│   │   ├── db.server.ts            # Supabase client (server-only)
│   │   ├── shopify.server.ts       # shopifyApp() configuration
│   │   ├── billing.server.ts       # Plan tier logic, limits, enforcement
│   │   ├── extraction/             # YMME extraction engine (ported from V1)
│   │   │   ├── patterns.ts         # 55-make regex, model patterns, engine codes
│   │   │   ├── signal-extractor.ts # 5-signal multi-source extraction
│   │   │   ├── signal-fuser.ts     # Signal fusion + confidence scoring
│   │   │   ├── ymme-scanner.ts     # 4-pass YMME-validated text scanner
│   │   │   ├── ymme-resolver.ts    # Database lookup for extracted signals
│   │   │   └── index.ts            # Public extraction API
│   │   ├── pipeline/               # Fetch→Extract→Enrich→Push pipeline
│   │   │   ├── fetch.ts            # Shopify product fetch (GraphQL, cursor pagination)
│   │   │   ├── extract.ts          # Run extraction on fetched products
│   │   │   ├── enrich.ts           # Cross-reference YMME DB
│   │   │   ├── push.ts             # Push tags + metafields + collections to Shopify
│   │   │   ├── collections.ts      # Smart collection creation with SEO + images
│   │   │   └── runner.ts           # Pipeline orchestration with progress tracking
│   │   ├── providers/              # Provider adapters
│   │   │   ├── csv-parser.ts       # CSV/TSV file parsing with column mapping
│   │   │   ├── xml-parser.ts       # XML file parsing
│   │   │   ├── api-fetcher.ts      # External API integration
│   │   │   ├── ftp-fetcher.ts      # FTP/SFTP file download
│   │   │   └── forge.ts            # Forge Motorsport adapter (ported from V1)
│   │   ├── ymme/                   # YMME utilities
│   │   │   ├── resolver.ts         # Make→Model→Year→Engine resolution
│   │   │   └── fuzzy-match.ts      # Fuzzy string matching for vehicle names
│   │   ├── scrapers/               # Vehicle database scrapers
│   │   │   ├── autodata.ts         # auto-data.net scraper (resumable)
│   │   │   └── nhtsa.ts            # NHTSA vPIC API integration
│   │   └── dvla/                   # UK vehicle lookup
│   │       ├── ves-client.ts       # DVLA VES API client
│   │       └── mot-client.ts       # DVSA MOT History API client
│   └── components/                 # Shared Polaris-based components
│       ├── ProductCard.tsx
│       ├── VehicleSelector.tsx     # Cascading YMME dropdowns
│       ├── ProgressTracker.tsx     # Real-time job progress
│       ├── PlanGate.tsx            # Feature gating by plan
│       └── EmptyState.tsx          # Onboarding empty states
├── extensions/
│   └── phq-widgets/                # Theme app extension
│       ├── blocks/
│       │   ├── ymme-search.liquid
│       │   ├── plate-lookup.liquid
│       │   ├── wheel-finder.liquid
│       │   ├── vehicle-compatibility.liquid
│       │   ├── fitment-badge.liquid
│       │   └── floating-vehicle-bar.liquid
│       ├── assets/
│       │   ├── autosync-widgets.js
│       │   └── autosync-widgets.css
│       └── shopify.extension.toml
├── prisma/
│   └── schema.prisma               # Session storage only
├── supabase/
│   └── migrations/                  # All business data migrations
├── shopify.app.toml                 # App config (scopes, webhooks, proxy)
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 4. Database Architecture

### 4.1 Session Storage (Prisma)

Prisma manages Shopify session data in the same Supabase PostgreSQL instance. This is the only Prisma-managed table.

```prisma
model Session {
  id          String   @id
  shop        String
  state       String
  isOnline    Boolean  @default(false)
  scope       String?
  expires     DateTime?
  accessToken String
  userId      BigInt?
}
```

### 4.2 Business Data (Supabase — tenant-scoped)

Every tenant table has `shop_id TEXT NOT NULL` as a foreign key to `tenants.shop_id`, with RLS policies enforcing `shop_id = current_setting('app.current_shop')`.

#### Tenant Management
```sql
CREATE TABLE tenants (
  shop_id TEXT PRIMARY KEY,          -- e.g. "store.myshopify.com"
  shop_domain TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free', -- free|starter|growth|professional|business|enterprise
  plan_status TEXT NOT NULL DEFAULT 'active',
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ,
  scopes TEXT,
  product_count INT DEFAULT 0,
  fitment_count INT DEFAULT 0
);
```

#### Products
```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  shopify_product_id BIGINT,
  title TEXT NOT NULL,
  description TEXT,
  handle TEXT,
  image_url TEXT,
  price DECIMAL(10,2),
  vendor TEXT,
  product_type TEXT,
  tags TEXT[],
  variants JSONB DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'shopify',  -- shopify|csv|api|ftp
  provider_id UUID REFERENCES providers(id),
  fitment_status TEXT NOT NULL DEFAULT 'unmapped',  -- unmapped|auto_mapped|manual_mapped|partial|flagged
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, shopify_product_id)
);
CREATE INDEX idx_products_shop_status ON products(shop_id, fitment_status);
CREATE INDEX idx_products_shop_provider ON products(shop_id, provider_id);
```

#### Vehicle Fitments
```sql
CREATE TABLE vehicle_fitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ymme_make_id INT REFERENCES ymme_makes(id),
  ymme_model_id INT REFERENCES ymme_models(id),
  ymme_engine_id INT REFERENCES ymme_engines(id),
  year_start INT,
  year_end INT,
  method TEXT NOT NULL DEFAULT 'manual',  -- manual|auto|import
  confidence DECIMAL(3,2) DEFAULT 1.0,
  reviewed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, product_id, ymme_make_id, ymme_model_id, ymme_engine_id, year_start, year_end)
);
CREATE INDEX idx_fitments_shop_product ON vehicle_fitments(shop_id, product_id);
CREATE INDEX idx_fitments_shop_make ON vehicle_fitments(shop_id, ymme_make_id);
```

#### Wheel Fitments
```sql
CREATE TABLE wheel_fitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pcd TEXT,            -- e.g. "5x112"
  offset_min INT,
  offset_max INT,
  center_bore DECIMAL(5,2),
  diameter INT,        -- inches
  width DECIMAL(4,1),  -- inches
  bolt_pattern TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Providers
```sql
CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'csv',  -- csv|xml|api|ftp
  config JSONB DEFAULT '{}',         -- connection details, column mappings
  schedule_cron TEXT,                 -- e.g. "0 0 * * *" for daily
  last_fetch TIMESTAMPTZ,
  product_count INT DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Sync Jobs
```sql
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  type TEXT NOT NULL,       -- fetch|extract|push|provider_import|scrape
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|running|completed|failed|cancelled
  progress INT DEFAULT 0,  -- 0-100
  total_items INT,
  processed_items INT DEFAULT 0,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Extraction Results
```sql
CREATE TABLE extraction_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  signals JSONB NOT NULL,        -- {title: [...], description: [...], tags: [...], sku: [...]}
  matched_vehicles JSONB,        -- [{make_id, model_id, engine_id, confidence}]
  confidence DECIMAL(3,2),
  needs_review BOOLEAN DEFAULT FALSE,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Collection Mappings
```sql
CREATE TABLE collection_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  shopify_collection_id BIGINT,
  ymme_make_id INT REFERENCES ymme_makes(id),
  ymme_model_id INT REFERENCES ymme_models(id),
  type TEXT NOT NULL,          -- make|model|year|custom
  seo_title TEXT,
  seo_description TEXT,
  image_url TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, ymme_make_id, ymme_model_id, type)
);
```

#### App Settings
```sql
CREATE TABLE app_settings (
  shop_id TEXT PRIMARY KEY REFERENCES tenants(shop_id),
  engine_display_format TEXT DEFAULT 'code',  -- code|full|displacement
  tag_prefix TEXT DEFAULT '_autosync_',
  push_tags BOOLEAN DEFAULT TRUE,
  push_metafields BOOLEAN DEFAULT TRUE,
  push_collections BOOLEAN DEFAULT TRUE,
  collection_strategy TEXT DEFAULT 'make_model',  -- make|make_model|make_model_year
  active_widgets JSONB DEFAULT '[]',
  notification_email TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Tenant Vehicle Selections
```sql
CREATE TABLE tenant_active_makes (
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  ymme_make_id INT NOT NULL REFERENCES ymme_makes(id),
  PRIMARY KEY (shop_id, ymme_make_id)
);

CREATE TABLE tenant_custom_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id),
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_start INT,
  year_end INT,
  engine TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.3 Global Vehicle Database (NOT tenant-scoped)

```sql
CREATE TABLE ymme_makes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  country TEXT
);

CREATE TABLE ymme_models (
  id SERIAL PRIMARY KEY,
  make_id INT NOT NULL REFERENCES ymme_makes(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  image_url TEXT,
  year_start INT,
  year_end INT,
  UNIQUE(make_id, slug)
);

CREATE TABLE ymme_generations (
  id SERIAL PRIMARY KEY,
  model_id INT NOT NULL REFERENCES ymme_models(id),
  name TEXT,
  year_start INT NOT NULL,
  year_end INT,
  UNIQUE(model_id, name, year_start)
);

CREATE TABLE ymme_engines (
  id SERIAL PRIMARY KEY,
  generation_id INT NOT NULL REFERENCES ymme_generations(id),
  code TEXT,
  displacement TEXT,
  fuel_type TEXT,
  power_hp INT,
  torque_nm INT,
  cylinders INT,
  aspiration TEXT,
  UNIQUE(generation_id, code, displacement)
);
```

## 5. Pricing Tiers

### 5.1 Tier Definitions

| | Free (Sandbox) | Starter | Growth | Professional | Business | Enterprise |
|---|---|---|---|---|---|---|
| Price | $0/mo | $19/mo | $49/mo | $99/mo | $179/mo | $299/mo |
| Annual | — | $182/yr | $470/yr | $950/yr | $1,716/yr | $2,868/yr |
| Trial | — | 14 days | 14 days | 14 days | 14 days | 30 days |
| Products | 50 | 1,000 | 10,000 | 50,000 | 200,000 | Unlimited |
| Fitment rows | 200 | 5,000 | 50,000 | 250,000 | 1,000,000 | Unlimited |

### 5.2 Feature Matrix

| Feature | Free | Starter | Growth | Pro | Business | Enterprise |
|---------|------|---------|--------|-----|----------|------------|
| Manual fitment mapping | Y | Y | Y | Y | Y | Y |
| YMME dropdowns | Y | Y | Y | Y | Y | Y |
| Browse vehicle DB | Y | Y | Y | Y | Y | Y |
| Fetch from Shopify | Y | Y | Y | Y | Y | Y |
| Push tags | N | Y | Y | Y | Y | Y |
| Push metafields | N | Y | Y | Y | Y | Y |
| Auto fitment extraction | N | N | Y | Y | Y | Y |
| Bulk operations | N | N | Y | Y | Y | Y |
| Smart collections (auto) | N | N | By Make | Make+Model | Full YMME | Full YMME |
| Collection SEO + images | N | N | N | Y | Y | Y |
| Custom vehicle entries | N | N | N | Y | Y | Y |
| CSV/XML upload | N | 1 | 3 | 5 | 15 | Unlimited |
| API integration | N | N | N | Y | Y | Y |
| FTP/SFTP import | N | N | N | N | Y | Y |
| Scheduled fetches | N | Manual | 1x/day | 2x/day | 6x/day | Real-time |
| YMME search widget | N | Y | Y | Y | Y | Y |
| Fitment badge | N | Y | Y | Y | Y | Y |
| Compatibility table | N | N | Y | Y | Y | Y |
| Floating vehicle bar | N | N | Y | Y | Y | Y |
| My Garage | N | N | N | Y | Y | Y |
| Wheel Finder widget | N | N | N | N | Y | Y |
| Reg Plate Lookup (DVLA+MOT) | N | N | N | N | N | Y |
| VIN Decode | N | N | N | N | N | Y |
| Active makes | All (view) | 10 | 30 | Unlimited | Unlimited | Unlimited |
| Priority support | N | N | N | N | Y | Y |
| Dedicated manager | N | N | N | N | N | Y |

### 5.3 Plan Enforcement

Plans are enforced at three levels:
1. **Database**: RPC functions check counts before inserts
2. **API**: Server-side `assertWithinLimits()` on every write operation
3. **UI**: `<PlanGate>` component disables and visually greys out locked features with upgrade prompt

Plan detection: Subscribe to `APP_SUBSCRIPTIONS_UPDATE` webhook + query billing API on app load.

## 6. Authentication & Security

Handled entirely by `@shopify/shopify-app-react-router`:
- OAuth with HMAC verification (automatic)
- Session token validation (automatic)
- Automatic token refresh
- CSRF protection

No hand-rolled authentication code.

## 7. App Proxy (Storefront API)

Theme app extension widgets communicate with our server through Shopify's App Proxy, avoiding CORS entirely.

**Configuration in shopify.app.toml:**
```
Subpath prefix: apps
Subpath: autosync
Proxy URL: https://our-app.vercel.app/proxy
```

**Routes:**
- `/apps/autosync/api/makes` — List active makes for tenant
- `/apps/autosync/api/models` — Models for a make
- `/apps/autosync/api/years` — Year range for a model
- `/apps/autosync/api/engines` — Engines for year+model
- `/apps/autosync/api/search` — Find products matching vehicle
- `/apps/autosync/api/plate-lookup` — DVLA + MOT lookup
- `/apps/autosync/api/wheel-search` — Wheel fitment search
- `/apps/autosync/api/garage` — Customer saved vehicles

All proxy routes verify Shopify's HMAC signature before processing.

## 8. Built for Shopify Compliance

| Requirement | Implementation |
|------------|----------------|
| Embedded in admin | React Router 7 template (auto-embedded) |
| Session token auth | Built into authenticate.admin() |
| App Bridge latest | Included in template |
| Polaris UI | All pages use Polaris React components |
| Theme app extensions | Liquid blocks only, no script injection |
| GraphQL Admin API only | No REST API calls anywhere |
| Managed Pricing | Partner Dashboard configuration |
| LCP < 2.5s | Lightweight Polaris pages, code splitting |
| CLS < 0.1 | Skeleton screens, proper loading states |
| INP < 200ms | React optimized rendering, minimal re-renders |
| Storefront < 10pt impact | Minimal widget JS, lazy loaded, no jQuery |
| No theme file modification | Theme app extensions only |
| Contextual Save Bar | App Bridge CSB for all settings forms |
| Mobile responsive | Polaris responsive by default |
| Error handling | Red errors, contextual, non-auto-dismissing |
| APP_UNINSTALLED webhook | Cleanup tenant data on uninstall |
| No dark patterns | Clean, honest UI throughout |
| Plan-gated features disabled | Visually + functionally disabled with upgrade prompt |

## 9. Core Feature Flows

### 9.1 Product Fetch
Merchant clicks "Fetch Products" → GraphQL `products(first: 250)` with cursor pagination → Store in products table → Track via sync_jobs with real-time progress → Rate limited to 1,000 points/second.

### 9.2 Auto Fitment Extraction
Scan title + description + tags + SKU → 5-signal extraction (regex patterns, no AI) → Match against YMME database (exact + fuzzy) → High confidence: auto-link → Low confidence: flag for manual review.

### 9.3 Manual Fitment Queue
Show unmapped/flagged products one at a time → Display product image + details → Cascading dropdowns (Make → Model → Year → Engine) → Save & next (no page reload) → Progress bar: "142 of 1,000 mapped".

### 9.4 Push to Shopify
For each mapped product → Add app-prefixed tags → Set app-owned metafields → Create/update smart collections with SEO + brand images → Track via sync_jobs.

### 9.5 Storefront Widgets
Widget renders in theme → JS calls App Proxy → Server verifies signature, queries Supabase → Returns vehicle data → Widget renders dropdowns/results.

## 10. Assets Carried Forward from V1/V2

| Keep | Details |
|------|---------|
| YMME database | 66 makes, 2,229 models, 20,397 engines in Supabase |
| Extraction logic | Pattern matching, regex rules, signal fusion algorithms |
| Supabase project | Same connection, redesigned schema |
| DVLA/MOT credentials | API keys for UK vehicle lookup |
| Theme extension Liquid | 6 widget blocks (adapted for App Proxy) |
| Provider adapters | Forge Motorsport, Milltek parsing logic |
| Scraper logic | auto-data.net crawling, NHTSA API integration |

Everything else — framework, OAuth, session management, billing, middleware, routing — is built new from scratch.
