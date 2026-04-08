# AutoSync V3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a complete Shopify App Store SaaS for YMME vehicle fitment management — from zero to published, using Shopify's official React Router 7 framework.

**Architecture:** React Router 7 + Supabase (PostgreSQL) + Shopify GraphQL Admin API + Theme App Extensions. Multi-tenant from the ground up. 6-tier pricing with Shopify Managed Pricing. App Proxy for storefront widget data.

**Tech Stack:** React Router 7, @shopify/shopify-app-react-router, Prisma (sessions), Supabase (business data), Shopify Polaris React, Vite, TypeScript, Shopify CLI.

**Design Doc:** `docs/plans/2026-03-17-autosync-v3-architecture-design.md`

---

## Phase A: Project Scaffold & Foundation (Tasks 1-5)

### Task 1: Initialize Shopify App from Official Template

**Files:**
- Create: entire project via `shopify app init`

**Step 1: Scaffold the project**

```bash
cd "C:/Users/feara/Desktop/PHQ PRODUCT"
npx @shopify/create-app@latest --template https://github.com/Shopify/shopify-app-template-react-router --name autosync-v3
```

If the directory already exists from our design doc, remove the git history first and re-init after scaffolding.

**Step 2: Verify project scaffolded correctly**

```bash
cd "C:/Users/feara/Desktop/PHQ PRODUCT/autosync-v3"
ls app/routes/app.tsx
ls app/shopify.server.ts
ls prisma/schema.prisma
ls shopify.app.toml
ls vite.config.ts
ls package.json
```

All files must exist.

**Step 3: Install dependencies**

```bash
npm install
```

**Step 4: Verify it builds**

```bash
npm run build
```

Expected: Clean build, no errors.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: scaffold V3 from Shopify React Router 7 template"
```

---

### Task 2: Configure Shopify App (TOML + Environment)

**Files:**
- Modify: `shopify.app.toml`
- Create: `.env` (local only, gitignored)

**Step 1: Update shopify.app.toml with our app config**

```toml
# shopify.app.toml
name = "AutoSync"
client_id = "3d4144a7a7c710f6845015c9d54098f8"
application_url = "https://autosync-v3.vercel.app"
embedded = true

[access_scopes]
scopes = "write_products,read_products,read_themes,write_themes,read_content,write_content"

[auth]
redirect_urls = [
  "https://autosync-v3.vercel.app/auth/callback",
  "http://localhost:3000/auth/callback"
]

[webhooks]
api_version = "2026-01"

[[webhooks.subscriptions]]
topics = ["app/uninstalled"]
uri = "/webhooks/app/uninstalled"

[[webhooks.subscriptions]]
topics = ["app_subscriptions/update"]
uri = "/webhooks/app/subscriptions-update"

[[webhooks.subscriptions]]
topics = ["products/create", "products/update", "products/delete"]
uri = "/webhooks/products"

[app_proxy]
url = "https://autosync-v3.vercel.app/proxy"
subpath = "autosync"
prefix = "apps"

[pos]
embedded = false
```

**Step 2: Create .env file** (from V1 credentials — NEVER committed)

```bash
SHOPIFY_API_KEY=3d4144a7a7c710f6845015c9d54098f8
SHOPIFY_API_SECRET=<from V1 .env.local>
SCOPES=write_products,read_products,read_themes,write_themes,read_content,write_content
SHOPIFY_APP_URL=http://localhost:3000

# Supabase (same as V1)
SUPABASE_URL=https://yljgamqudcvvbvidzxqc.supabase.co
SUPABASE_ANON_KEY=<from V1>
SUPABASE_SERVICE_ROLE_KEY=<from V1>

# Prisma (use Supabase PostgreSQL for sessions)
DATABASE_URL=postgresql://<supabase-connection-string>

# DVLA & MOT (Enterprise tier only)
DVLA_API_KEY=<from V1>
MOT_CLIENT_ID=4d6feed2-008a-4c53-8a45-76c2ad5d7ad4
MOT_CLIENT_SECRET=<from V1>
MOT_TENANT_ID=a455b827-244f-4c97-b5b4-ce5d13b4d00c
```

**Step 3: Add .env to .gitignore** (should already be there from template)

```bash
grep ".env" .gitignore || echo ".env" >> .gitignore
```

**Step 4: Commit**

```bash
git add shopify.app.toml .gitignore
git commit -m "feat: configure Shopify app settings and webhook subscriptions"
```

---

### Task 3: Switch Session Storage to Supabase PostgreSQL

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `app/shopify.server.ts`

**Step 1: Update Prisma datasource to PostgreSQL**

In `prisma/schema.prisma`, change the datasource from SQLite to PostgreSQL:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  id                    String    @id
  shop                  String
  state                 String
  isOnline              Boolean   @default(false)
  scope                 String?
  expires               DateTime?
  accessToken           String
  refreshToken          String?
  refreshTokenExpires   DateTime?
  userId                BigInt?
  firstName             String?
  lastName              String?
  email                 String?
  locale                String?
  accountOwner          Boolean   @default(false)
  collaborator          Boolean   @default(false)
  emailVerified         Boolean   @default(false)
}
```

**Step 2: Run Prisma migration**

```bash
npx prisma migrate dev --name init-sessions
```

**Step 3: Verify Prisma client generates**

```bash
npx prisma generate
```

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: switch session storage from SQLite to Supabase PostgreSQL"
```

---

### Task 4: Set Up Supabase Client for Business Data

**Files:**
- Create: `app/lib/db.server.ts`
- Install: `@supabase/supabase-js`

**Step 1: Install Supabase client**

```bash
npm install @supabase/supabase-js
```

**Step 2: Create server-only Supabase client**

Create `app/lib/db.server.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
  );
}

// Server-side admin client — uses service role key for full access.
// All tenant-scoped queries MUST filter by shop_id.
export const db = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Get a tenant-scoped query helper.
 * Usage: const { data } = await tenantQuery(shopId).from("products").select("*")
 *
 * Note: This does NOT use RLS — it uses the service role key.
 * Tenant isolation is enforced by always filtering on shop_id.
 */
export function tenantDb(shopId: string) {
  return {
    from: (table: string) => db.from(table).eq("shop_id", shopId),
  };
}

export default db;
```

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add app/lib/db.server.ts package.json package-lock.json
git commit -m "feat: add Supabase client for business data"
```

---

### Task 5: Create Supabase Database Schema (Migration Files)

**Files:**
- Create: `supabase/migrations/001_tenants.sql`
- Create: `supabase/migrations/002_products.sql`
- Create: `supabase/migrations/003_vehicle_fitments.sql`
- Create: `supabase/migrations/004_wheel_fitments.sql`
- Create: `supabase/migrations/005_providers.sql`
- Create: `supabase/migrations/006_sync_jobs.sql`
- Create: `supabase/migrations/007_extraction_results.sql`
- Create: `supabase/migrations/008_collection_mappings.sql`
- Create: `supabase/migrations/009_app_settings.sql`
- Create: `supabase/migrations/010_tenant_vehicles.sql`

NOTE: The YMME tables (ymme_makes, ymme_models, ymme_generations, ymme_engines) already exist in Supabase from V1. Do NOT recreate them. These migrations are for the new tenant-scoped business tables only.

**Step 1: Create migration directory**

```bash
mkdir -p supabase/migrations
```

**Step 2: Write each migration file**

Use the exact SQL from the design document Section 4.2. Each file should be self-contained with `CREATE TABLE IF NOT EXISTS`, proper foreign keys, indexes, and comments.

Key rules:
- Every tenant table has `shop_id TEXT NOT NULL REFERENCES tenants(shop_id)`
- Every tenant table has an index on `(shop_id, ...)`
- Use `gen_random_uuid()` for UUID primary keys
- Use `TIMESTAMPTZ` for all timestamps
- Add `ON DELETE CASCADE` where appropriate (fitments → products)

**Step 3: Run migrations against Supabase**

These should be run through the Supabase dashboard SQL editor or via `supabase db push`. Since we're using the hosted Supabase, we store migration files for reference and version control, then apply them manually or via CI.

```bash
# If using Supabase CLI:
supabase db push
```

**Step 4: Verify tables exist**

Query Supabase to confirm all tables were created.

**Step 5: Commit**

```bash
git add supabase/
git commit -m "feat: add V3 database schema — 10 tenant-scoped tables"
```

---

## Phase B: Billing & Plan Enforcement (Tasks 6-8)

### Task 6: Define Plan Tiers and Limits

**Files:**
- Create: `app/lib/billing.server.ts`
- Create: `app/lib/types.ts`

**Step 1: Create shared types**

Create `app/lib/types.ts`:

```typescript
export type PlanTier = "free" | "starter" | "growth" | "professional" | "business" | "enterprise";

export type FitmentStatus = "unmapped" | "auto_mapped" | "manual_mapped" | "partial" | "flagged";

export type SyncJobType = "fetch" | "extract" | "push" | "provider_import" | "scrape";
export type SyncJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type ProviderType = "csv" | "xml" | "api" | "ftp";

export type CollectionStrategy = "make" | "make_model" | "make_model_year";

export interface PlanLimits {
  products: number;
  fitments: number;
  providers: number;
  scheduledFetchesPerDay: number;
  activeMakes: number;
  features: {
    pushTags: boolean;
    pushMetafields: boolean;
    autoExtraction: boolean;
    bulkOperations: boolean;
    smartCollections: false | "make" | "make_model" | "full";
    collectionSeoImages: boolean;
    customVehicles: boolean;
    apiIntegration: boolean;
    ftpImport: boolean;
    ymmeWidget: boolean;
    fitmentBadge: boolean;
    compatibilityTable: boolean;
    floatingBar: boolean;
    myGarage: boolean;
    wheelFinder: boolean;
    plateLookup: boolean;
    vinDecode: boolean;
    widgetCustomisation: "none" | "basic" | "full" | "full_css";
    dashboardAnalytics: "none" | "basic" | "full" | "full_export";
    prioritySupport: boolean;
  };
}

export interface Tenant {
  shop_id: string;
  shop_domain: string;
  plan: PlanTier;
  plan_status: string;
  installed_at: string;
  product_count: number;
  fitment_count: number;
}
```

**Step 2: Create billing enforcement module**

Create `app/lib/billing.server.ts`:

```typescript
import type { PlanTier, PlanLimits } from "./types";
import db from "./db.server";

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    products: 50,
    fitments: 200,
    providers: 0,
    scheduledFetchesPerDay: 0,
    activeMakes: 999999, // all (view only)
    features: {
      pushTags: false,
      pushMetafields: false,
      autoExtraction: false,
      bulkOperations: false,
      smartCollections: false,
      collectionSeoImages: false,
      customVehicles: false,
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: false,
      fitmentBadge: false,
      compatibilityTable: false,
      floatingBar: false,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      widgetCustomisation: "none",
      dashboardAnalytics: "none",
      prioritySupport: false,
    },
  },
  starter: {
    products: 1000,
    fitments: 5000,
    providers: 1,
    scheduledFetchesPerDay: 0,
    activeMakes: 10,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: false,
      bulkOperations: false,
      smartCollections: false,
      collectionSeoImages: false,
      customVehicles: false,
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: false,
      floatingBar: false,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      widgetCustomisation: "basic",
      dashboardAnalytics: "basic",
      prioritySupport: false,
    },
  },
  growth: {
    products: 10000,
    fitments: 50000,
    providers: 3,
    scheduledFetchesPerDay: 1,
    activeMakes: 30,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "make",
      collectionSeoImages: false,
      customVehicles: false,
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      floatingBar: true,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      widgetCustomisation: "full",
      dashboardAnalytics: "full",
      prioritySupport: false,
    },
  },
  professional: {
    products: 50000,
    fitments: 250000,
    providers: 5,
    scheduledFetchesPerDay: 2,
    activeMakes: 999999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "make_model",
      collectionSeoImages: true,
      customVehicles: true,
      apiIntegration: true,
      ftpImport: false,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      floatingBar: true,
      myGarage: true,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      widgetCustomisation: "full",
      dashboardAnalytics: "full",
      prioritySupport: false,
    },
  },
  business: {
    products: 200000,
    fitments: 1000000,
    providers: 15,
    scheduledFetchesPerDay: 6,
    activeMakes: 999999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "full",
      collectionSeoImages: true,
      customVehicles: true,
      apiIntegration: true,
      ftpImport: true,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      floatingBar: true,
      myGarage: true,
      wheelFinder: true,
      plateLookup: false,
      vinDecode: false,
      widgetCustomisation: "full",
      dashboardAnalytics: "full_export",
      prioritySupport: true,
    },
  },
  enterprise: {
    products: Infinity,
    fitments: Infinity,
    providers: Infinity,
    scheduledFetchesPerDay: Infinity,
    activeMakes: 999999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "full",
      collectionSeoImages: true,
      customVehicles: true,
      apiIntegration: true,
      ftpImport: true,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      floatingBar: true,
      myGarage: true,
      wheelFinder: true,
      plateLookup: true,
      vinDecode: true,
      widgetCustomisation: "full_css",
      dashboardAnalytics: "full_export",
      prioritySupport: true,
    },
  },
};

export function getPlanLimits(plan: PlanTier): PlanLimits {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

export class BillingGateError extends Error {
  constructor(
    public feature: string,
    public currentPlan: PlanTier,
    public requiredPlan: PlanTier
  ) {
    super(`Feature "${feature}" requires ${requiredPlan} plan (current: ${currentPlan})`);
    this.name = "BillingGateError";
  }
}

export async function getTenant(shopId: string): Promise<Tenant | null> {
  const { data, error } = await db
    .from("tenants")
    .select("*")
    .eq("shop_id", shopId)
    .single();

  if (error || !data) return null;
  return data as Tenant;
}

export async function assertProductLimit(shopId: string): Promise<void> {
  const tenant = await getTenant(shopId);
  if (!tenant) throw new Error("Tenant not found");

  const limits = getPlanLimits(tenant.plan);
  if (tenant.product_count >= limits.products) {
    throw new BillingGateError("products", tenant.plan, getNextPlan(tenant.plan));
  }
}

export async function assertFeature(
  shopId: string,
  feature: keyof PlanLimits["features"]
): Promise<void> {
  const tenant = await getTenant(shopId);
  if (!tenant) throw new Error("Tenant not found");

  const limits = getPlanLimits(tenant.plan);
  if (!limits.features[feature]) {
    throw new BillingGateError(feature, tenant.plan, getMinimumPlanForFeature(feature));
  }
}

function getNextPlan(plan: PlanTier): PlanTier {
  const order: PlanTier[] = ["free", "starter", "growth", "professional", "business", "enterprise"];
  const idx = order.indexOf(plan);
  return idx < order.length - 1 ? order[idx + 1] : plan;
}

function getMinimumPlanForFeature(feature: keyof PlanLimits["features"]): PlanTier {
  const order: PlanTier[] = ["free", "starter", "growth", "professional", "business", "enterprise"];
  for (const plan of order) {
    if (PLAN_LIMITS[plan].features[feature]) return plan;
  }
  return "enterprise";
}

export async function incrementProductCount(shopId: string, count: number = 1): Promise<void> {
  await db.rpc("increment_product_count", { p_shop_id: shopId, p_count: count });
}
```

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add app/lib/billing.server.ts app/lib/types.ts
git commit -m "feat: add 6-tier billing enforcement with plan limits"
```

---

### Task 7: Create PlanGate UI Component

**Files:**
- Create: `app/components/PlanGate.tsx`

**Step 1: Create the component**

```typescript
import { Banner, Button, BlockStack, Text } from "@shopify/polaris";
import type { PlanTier, PlanLimits } from "~/lib/types";

interface PlanGateProps {
  feature: keyof PlanLimits["features"];
  currentPlan: PlanTier;
  limits: PlanLimits;
  children: React.ReactNode;
  /** What to show when gated — defaults to a Banner */
  fallback?: React.ReactNode;
}

const PLAN_NAMES: Record<PlanTier, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

const FEATURE_NAMES: Record<string, string> = {
  pushTags: "Push Tags to Shopify",
  pushMetafields: "Push Metafields",
  autoExtraction: "Auto Fitment Extraction",
  bulkOperations: "Bulk Operations",
  smartCollections: "Smart Collections",
  collectionSeoImages: "Collection SEO & Images",
  customVehicles: "Custom Vehicle Entries",
  apiIntegration: "API Integration",
  ftpImport: "FTP/SFTP Import",
  ymmeWidget: "YMME Search Widget",
  fitmentBadge: "Fitment Badge",
  compatibilityTable: "Compatibility Table",
  floatingBar: "Floating Vehicle Bar",
  myGarage: "My Garage",
  wheelFinder: "Wheel Finder",
  plateLookup: "Reg Plate Lookup (DVLA + MOT)",
  vinDecode: "VIN Decode",
  prioritySupport: "Priority Support",
};

export function PlanGate({ feature, currentPlan, limits, children, fallback }: PlanGateProps) {
  const isEnabled = !!limits.features[feature];

  if (isEnabled) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  // Find the minimum plan that enables this feature
  const requiredPlan = findMinPlan(feature);

  return (
    <Banner tone="warning">
      <BlockStack gap="200">
        <Text as="p" variant="bodyMd">
          <Text as="span" fontWeight="semibold">{FEATURE_NAMES[feature] ?? feature}</Text>
          {" "}is available on the{" "}
          <Text as="span" fontWeight="semibold">{PLAN_NAMES[requiredPlan]}</Text>
          {" "}plan and above.
        </Text>
        <Button url="/app/plans">View Plans</Button>
      </BlockStack>
    </Banner>
  );
}

function findMinPlan(feature: string): PlanTier {
  // This mirrors the server-side logic but is used client-side for display
  const featurePlans: Record<string, PlanTier> = {
    pushTags: "starter",
    pushMetafields: "starter",
    ymmeWidget: "starter",
    fitmentBadge: "starter",
    autoExtraction: "growth",
    bulkOperations: "growth",
    smartCollections: "growth",
    compatibilityTable: "growth",
    floatingBar: "growth",
    collectionSeoImages: "professional",
    customVehicles: "professional",
    apiIntegration: "professional",
    myGarage: "professional",
    ftpImport: "business",
    wheelFinder: "business",
    plateLookup: "enterprise",
    vinDecode: "enterprise",
    prioritySupport: "business",
  };
  return featurePlans[feature] ?? "enterprise";
}

export default PlanGate;
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add app/components/PlanGate.tsx
git commit -m "feat: add PlanGate component for feature gating UI"
```

---

### Task 8: Webhook Handlers (Subscriptions + Uninstall + Products)

**Files:**
- Create: `app/routes/webhooks.app.uninstalled.tsx`
- Create: `app/routes/webhooks.app.subscriptions-update.tsx`
- Create: `app/routes/webhooks.products.tsx`

**Step 1: Create uninstall webhook handler**

```typescript
// app/routes/webhooks.app.uninstalled.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import db from "~/lib/db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticate.webhook(request);

  console.log(`[webhook] APP_UNINSTALLED: ${shop}`);

  // Mark tenant as uninstalled (don't delete data — they might reinstall)
  await db
    .from("tenants")
    .update({ uninstalled_at: new Date().toISOString(), plan_status: "cancelled" })
    .eq("shop_id", shop);

  return new Response("OK", { status: 200 });
}
```

**Step 2: Create subscription update webhook handler**

```typescript
// app/routes/webhooks.app.subscriptions-update.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import db from "~/lib/db.server";
import type { PlanTier } from "~/lib/types";

// Maps Shopify charge names to our plan tiers
const CHARGE_NAME_TO_PLAN: Record<string, PlanTier> = {
  "AutoSync Starter": "starter",
  "AutoSync Growth": "growth",
  "AutoSync Professional": "professional",
  "AutoSync Business": "business",
  "AutoSync Enterprise": "enterprise",
};

export async function action({ request }: ActionFunctionArgs) {
  const { shop, payload } = await authenticate.webhook(request);

  console.log(`[webhook] APP_SUBSCRIPTIONS_UPDATE: ${shop}`, JSON.stringify(payload));

  const subscription = payload?.app_subscription;
  if (!subscription) return new Response("OK", { status: 200 });

  const status = subscription.status; // "active" | "cancelled" | "declined" | "expired" | "frozen" | "pending"
  const name = subscription.name;
  const plan = CHARGE_NAME_TO_PLAN[name] ?? "free";

  await db
    .from("tenants")
    .update({
      plan: status === "active" ? plan : "free",
      plan_status: status,
    })
    .eq("shop_id", shop);

  console.log(`[webhook] Tenant ${shop} plan updated: ${plan} (${status})`);

  return new Response("OK", { status: 200 });
}
```

**Step 3: Create products webhook handler**

```typescript
// app/routes/webhooks.products.tsx
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import db from "~/lib/db.server";

export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}: ${shop} product ${payload?.id}`);

  switch (topic) {
    case "PRODUCTS_CREATE":
    case "PRODUCTS_UPDATE":
      // If the product exists in our DB, update it
      if (payload?.id) {
        const { data: existing } = await db
          .from("products")
          .select("id")
          .eq("shop_id", shop)
          .eq("shopify_product_id", payload.id)
          .single();

        if (existing) {
          await db
            .from("products")
            .update({
              title: payload.title,
              description: payload.body_html,
              handle: payload.handle,
              image_url: payload.image?.src ?? null,
              price: payload.variants?.[0]?.price ?? null,
              vendor: payload.vendor,
              product_type: payload.product_type,
              tags: payload.tags?.split(", ") ?? [],
              updated_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
        }
      }
      break;

    case "PRODUCTS_DELETE":
      if (payload?.id) {
        await db
          .from("products")
          .delete()
          .eq("shop_id", shop)
          .eq("shopify_product_id", payload.id);
      }
      break;
  }

  return new Response("OK", { status: 200 });
}
```

**Step 4: Verify build**

```bash
npm run build
```

**Step 5: Commit**

```bash
git add app/routes/webhooks.*.tsx
git commit -m "feat: add webhook handlers for uninstall, billing, and product sync"
```

---

## Phase C: App Shell & Navigation (Tasks 9-11)

### Task 9: App Layout with Polaris + Navigation

**Files:**
- Modify: `app/routes/app.tsx`

**Step 1: Update the app layout**

Replace the template's default layout with our full navigation structure. The `<s-app-nav>` component uses Shopify's native app navigation:

```typescript
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "~/shopify.server";
import db from "~/lib/db.server";
import { getPlanLimits } from "~/lib/billing.server";
import type { PlanTier } from "~/lib/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Ensure tenant record exists
  const { data: tenant } = await db
    .from("tenants")
    .select("*")
    .eq("shop_id", shopId)
    .single();

  if (!tenant) {
    // First-time install — create tenant record
    await db.from("tenants").upsert({
      shop_id: shopId,
      shop_domain: shopId,
      plan: "free",
      plan_status: "active",
      installed_at: new Date().toISOString(),
    });
  }

  const plan = (tenant?.plan ?? "free") as PlanTier;
  const limits = getPlanLimits(plan);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopId,
    plan,
    limits,
    isFirstTime: !tenant,
  };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Dashboard</s-link>
        <s-link href="/app/products">Products</s-link>
        <s-link href="/app/fitment">Fitment</s-link>
        <s-link href="/app/push">Push to Shopify</s-link>
        <s-link href="/app/providers">Providers</s-link>
        <s-link href="/app/collections">Collections</s-link>
        <s-link href="/app/vehicles">Vehicles</s-link>
        <s-link href="/app/settings">Settings</s-link>
        <s-link href="/app/plans">Plans</s-link>
        <s-link href="/app/help">Help</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add app/routes/app.tsx
git commit -m "feat: add full navigation structure with tenant initialization"
```

---

### Task 10: Dashboard Page (Home)

**Files:**
- Modify: `app/routes/app._index.tsx`

**Step 1: Create the dashboard page**

This page shows: welcome (first-time), stats overview, quick actions, and the onboarding checklist for new users.

The dashboard shows real data from Supabase: product count, fitment coverage, sync status, and plan info. For first-time users, it shows the onboarding steps.

Use Polaris components: `Page`, `Layout`, `Card`, `BlockStack`, `InlineStack`, `Text`, `Badge`, `Button`, `ProgressBar`, `Banner`, `EmptyState`.

Key elements:
- "Welcome to AutoSync" banner for first-time users
- Stats cards: Products fetched, Fitments mapped, Coverage %, Last sync
- Onboarding checklist: 1. Fetch products 2. Map fitment 3. Push to Shopify 4. Add widgets
- Quick action buttons: Fetch Products, Map Fitment, Push to Shopify
- Plan info card with upgrade CTA

**Step 2: Verify build and commit**

```bash
npm run build
git add app/routes/app._index.tsx
git commit -m "feat: add dashboard page with stats and onboarding checklist"
```

---

### Task 11: Stub All Route Pages

**Files:**
- Create: `app/routes/app.products.tsx`
- Create: `app/routes/app.products.$id.tsx`
- Create: `app/routes/app.fitment.tsx`
- Create: `app/routes/app.fitment.manual.tsx`
- Create: `app/routes/app.push.tsx`
- Create: `app/routes/app.providers.tsx`
- Create: `app/routes/app.providers.new.tsx`
- Create: `app/routes/app.collections.tsx`
- Create: `app/routes/app.vehicles.tsx`
- Create: `app/routes/app.settings.tsx`
- Create: `app/routes/app.plans.tsx`
- Create: `app/routes/app.help.tsx`

**Step 1: Create each route as a minimal Polaris page**

Each page gets a proper `loader` (with `authenticate.admin(request)`) and a basic Polaris `<Page>` component with the page title and a placeholder `<EmptyState>`. This ensures:
1. All navigation links work
2. Authentication is enforced on every page
3. We can build each page incrementally

Example template for each stub:

```typescript
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "~/shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function PageName() {
  return (
    <Page title="Page Title">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Page Title"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>This page is under construction.</p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
```

**Step 2: Verify build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add app/routes/app.*.tsx
git commit -m "feat: stub all route pages with Polaris layout and auth"
```

---

## Phase D: Product Fetch & Browse (Tasks 12-14)

### Task 12: Product Fetch Pipeline (GraphQL)

**Files:**
- Create: `app/lib/pipeline/fetch.server.ts`

This module fetches all products from a merchant's Shopify store using the GraphQL Admin API with cursor-based pagination. It stores them in our `products` table and tracks progress via `sync_jobs`.

Key implementation details:
- GraphQL query: `products(first: 250, after: $cursor)` — 250 is the max per page
- Fields: id, title, descriptionHtml, handle, featuredImage.url, priceRangeV2.minVariantPrice.amount, vendor, productType, tags, variants(first: 100) { edges { node { id title price sku } } }
- Rate limiting: respect `throttleStatus.currentlyAvailable` from GraphQL response extensions
- Progress: update `sync_jobs.processed_items` after each page
- Dedup: use `UPSERT` on `(shop_id, shopify_product_id)` so re-fetching updates existing records
- Update `tenants.product_count` when complete

**Step 1: Write the fetch module with GraphQL queries and pagination logic**

**Step 2: Verify build**

**Step 3: Commit**

```bash
git add app/lib/pipeline/fetch.server.ts
git commit -m "feat: add GraphQL product fetch with cursor pagination"
```

---

### Task 13: Product Fetch API Route

**Files:**
- Create: `app/routes/app.api.fetch-products.tsx`

This is the action route that the dashboard's "Fetch Products" button calls. It:
1. Authenticates the admin
2. Checks billing limits (`assertProductLimit`)
3. Creates a `sync_jobs` record
4. Calls the fetch pipeline
5. Returns progress data

Since fetching can be long-running, consider using a streaming approach or polling pattern:
- The action starts the fetch and returns the job ID
- The frontend polls `/app/api/fetch-status?jobId=X` for progress updates
- Use Supabase real-time subscriptions (optional enhancement later)

**Step 1: Write the action handler**

**Step 2: Create a status polling route**

Create `app/routes/app.api.fetch-status.tsx` that returns the current `sync_jobs` record.

**Step 3: Verify build and commit**

```bash
git add app/routes/app.api.*.tsx
git commit -m "feat: add product fetch API with job tracking"
```

---

### Task 14: Products Page (Browse, Search, Filter)

**Files:**
- Modify: `app/routes/app.products.tsx`

Replace the stub with a full product browser. Use Polaris `IndexTable` for the main table.

Features:
- Loader fetches products from Supabase with pagination (50 per page)
- Search by title
- Filter by fitment_status (All, Unmapped, Auto Mapped, Manual, Partial, Flagged)
- Filter by source (Shopify, CSV, API, FTP)
- Sort by title, created_at, fitment_status
- Each row shows: image thumbnail, title, vendor, price, fitment status badge, source, actions
- Clicking a row navigates to `app.products.$id`
- Bulk actions: select multiple → bulk assign fitment, bulk push, bulk delete

Use Polaris: `Page`, `IndexTable`, `IndexFilters`, `Badge`, `Thumbnail`, `Pagination`, `Button`.

**Step 1: Build the loader with search/filter/pagination**

**Step 2: Build the IndexTable UI**

**Step 3: Verify build and commit**

```bash
git add app/routes/app.products.tsx
git commit -m "feat: build product browser with search, filter, and pagination"
```

---

## Phase E: Fitment Mapping (Tasks 15-19)

### Task 15: Vehicle Selector Component (Cascading Dropdowns)

**Files:**
- Create: `app/components/VehicleSelector.tsx`

A reusable cascading dropdown component: Make → Model → Year Range → Engine.

Each dropdown triggers a fetch to load the next level's options from Supabase (YMME tables). The component accepts an `onChange` callback that fires when a complete selection is made.

Use Polaris: `Select`, `InlineStack`, `BlockStack`, `Button`.

**Step 1: Create the component with cascading fetches**

**Step 2: Create the API routes for YMME data**

- Create: `app/routes/app.api.ymme.tsx` — handles GET with query params: `?level=makes`, `?level=models&make_id=X`, `?level=engines&model_id=X&year=Y`

**Step 3: Verify build and commit**

```bash
git add app/components/VehicleSelector.tsx app/routes/app.api.ymme.tsx
git commit -m "feat: add cascading YMME vehicle selector component"
```

---

### Task 16: Single Product Fitment Editor

**Files:**
- Modify: `app/routes/app.products.$id.tsx`

Replace the stub with a full product fitment editor:
- Loader: fetch product details + existing fitments from Supabase
- Display: product image, title, description, price, variants, tags
- Fitment section: list all currently mapped vehicles with delete option
- Add fitment: VehicleSelector component with year range inputs
- Save action: inserts into `vehicle_fitments` table

Use Polaris: `Page`, `Layout`, `Card`, `FormLayout`, `MediaCard`, `ResourceList`, `Button`.

**Step 1: Build the loader**

**Step 2: Build the UI**

**Step 3: Build the save action**

**Step 4: Verify build and commit**

```bash
git add app/routes/app.products.\\$id.tsx
git commit -m "feat: build single product fitment editor"
```

---

### Task 17: Manual Fitment Queue

**Files:**
- Modify: `app/routes/app.fitment.manual.tsx`

The "next, next, next" workflow for mapping unmapped products:
- Loader: fetch the next unmapped product (ordered by created_at)
- Display: product image, title, description prominently
- VehicleSelector for adding fitments
- "Save & Next" button — saves fitment and loads next product
- "Skip" button — moves to next without saving
- Progress bar: "142 of 1,000 mapped — 858 remaining"
- Counter updates in real-time as user progresses

Use Polaris: `Page`, `Layout`, `Card`, `ProgressBar`, `Button`, `InlineStack`, `Text`.

**Step 1: Build the loader with next-product logic and count**

**Step 2: Build the UI with progress tracking**

**Step 3: Build the save-and-advance action**

**Step 4: Verify build and commit**

```bash
git add app/routes/app.fitment.manual.tsx
git commit -m "feat: build manual fitment queue with save-and-next workflow"
```

---

### Task 18: Port Extraction Engine from V1

**Files:**
- Create: `app/lib/extraction/patterns.ts` (from `V1/lib/extraction/patterns.ts`)
- Create: `app/lib/extraction/signal-extractor.ts`
- Create: `app/lib/extraction/signal-fuser.ts`
- Create: `app/lib/extraction/ymme-scanner.ts`
- Create: `app/lib/extraction/ymme-resolver.ts`
- Create: `app/lib/extraction/index.ts`

Port the extraction engine from V1. These files contain:
- 55-make regex pattern matching
- Model pattern recognition
- Engine code extraction
- 5-signal multi-source extraction (title, description structured, description natural, tags, SKU)
- 4-pass YMME-validated text scanning
- Signal fusion with confidence scoring

Key changes from V1:
1. Update imports to use `~/lib/db.server` instead of `@/lib/supabase/admin`
2. Remove any `SupabaseClient<Database>` generics — use plain `SupabaseClient`
3. Remove references to V1-specific modules that won't exist in V3
4. Keep all regex patterns and matching logic identical

**Step 1: Copy and adapt each file**

**Step 2: Create the public extraction API in index.ts**

```typescript
// app/lib/extraction/index.ts
export { extractVehicleFitment } from "./signal-extractor";
export { fuseSignals } from "./signal-fuser";
export { scanForYMME } from "./ymme-scanner";
export { resolveYMME } from "./ymme-resolver";
```

**Step 3: Verify build**

```bash
npm run build
```

**Step 4: Commit**

```bash
git add app/lib/extraction/
git commit -m "feat: port YMME extraction engine from V1 (patterns, signals, fusion)"
```

---

### Task 19: Auto Fitment Pipeline

**Files:**
- Create: `app/lib/pipeline/extract.server.ts`
- Create: `app/routes/app.api.auto-extract.tsx`

The auto extraction pipeline:
1. Query all products with `fitment_status = 'unmapped'` for a tenant
2. For each product, run the extraction engine
3. Store extraction results in `extraction_results` table
4. If high confidence (>= 0.8): create fitment links, set status to `auto_mapped`
5. If medium confidence (0.5-0.8): set status to `flagged`, add to review queue
6. If low confidence (< 0.5): leave as `unmapped`
7. Track progress via `sync_jobs`

The API route starts the extraction job and returns the job ID for progress polling.

Plan gate: check `assertFeature(shopId, "autoExtraction")` — Growth+ only.

**Step 1: Write the extraction pipeline**

**Step 2: Write the API route**

**Step 3: Verify build and commit**

```bash
git add app/lib/pipeline/extract.server.ts app/routes/app.api.auto-extract.tsx
git commit -m "feat: add auto fitment extraction pipeline with plan gating"
```

---

## Phase F: Push to Shopify (Tasks 20-22)

### Task 20: Tag & Metafield Push

**Files:**
- Create: `app/lib/pipeline/push.server.ts`

Push mapped fitment data back to Shopify using GraphQL mutations:
1. **Tags**: Use `tagsAdd` mutation — add app-prefixed tags like `_autosync_BMW`, `_autosync_3_Series_E90`
2. **Metafields**: Use `metafieldsSet` mutation — set app-owned metafields under `autosync_fitment` namespace
3. Rate limiting: track `throttleStatus.currentlyAvailable`, pause when below 100 points
4. Batch: process up to 25 products per mutation using `productUpdate` bulk

Key GraphQL mutations:
```graphql
mutation tagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) {
    userErrors { field message }
  }
}

mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) {
    userErrors { field message }
  }
}
```

Metafield structure per product:
- `autosync_fitment.vehicles` (JSON list): `[{make, model, year_start, year_end, engine}]`
- `autosync_fitment.make_names` (list): `["BMW", "Audi"]`
- `autosync_fitment.model_names` (list): `["3 Series", "A4"]`

**Step 1: Write the push module**

**Step 2: Verify build and commit**

```bash
git add app/lib/pipeline/push.server.ts
git commit -m "feat: add tag and metafield push pipeline (GraphQL)"
```

---

### Task 21: Smart Collection Creation

**Files:**
- Create: `app/lib/pipeline/collections.server.ts`

Create smart collections based on the tenant's collection strategy:
- `make`: One collection per make (e.g., "BMW Parts")
- `make_model`: Collections per make + per model (e.g., "BMW Parts", "BMW 3 Series Parts")
- `make_model_year`: Full YMME collections (Growth+, Professional+, Business+)

GraphQL mutation:
```graphql
mutation collectionCreate($input: CollectionInput!) {
  collectionCreate(input: $input) {
    collection { id handle title }
    userErrors { field message }
  }
}
```

Smart collection rules use tags: `tag:_autosync_BMW` or `tag:_autosync_BMW AND tag:_autosync_3_Series`.

Each collection gets:
- SEO title: "{Make} Parts | {Store Name}" (Professional+)
- SEO description: auto-generated (Professional+)
- Image: brand logo or model photo from ymme_makes/ymme_models (Professional+)

Plan gate: collections require Growth+ plan.

**Step 1: Write the collection creation module**

**Step 2: Verify build and commit**

```bash
git add app/lib/pipeline/collections.server.ts
git commit -m "feat: add smart collection creation with SEO and images"
```

---

### Task 22: Push Page UI

**Files:**
- Modify: `app/routes/app.push.tsx`

Replace stub with the Push to Shopify page:
- Summary: "X products ready to push" with breakdown
- Options: checkboxes for what to push (tags, metafields, collections) — each gated by plan
- Preview: show sample of what will be pushed (first 5 products with their tags)
- Push button: starts the push job
- Progress: real-time progress bar with status updates
- History: list of past push jobs with timestamps and results

**Step 1: Build the page**

**Step 2: Verify build and commit**

```bash
git add app/routes/app.push.tsx
git commit -m "feat: build Push to Shopify page with progress tracking"
```

---

## Phase G: Providers & Import (Tasks 23-25)

### Task 23: Provider Management Page

**Files:**
- Modify: `app/routes/app.providers.tsx`
- Modify: `app/routes/app.providers.new.tsx`

Providers page: list all configured providers with status, product count, last fetch time.
New provider page: form to add CSV/XML upload, API, or FTP/SFTP source.

Plan gate: providers are limited by tier (0 for Free, 1 for Starter, etc.).

**Step 1: Build the providers list page**

**Step 2: Build the new provider form**

**Step 3: Verify build and commit**

```bash
git add app/routes/app.providers.tsx app/routes/app.providers.new.tsx
git commit -m "feat: build provider management pages"
```

---

### Task 24: CSV/XML File Upload & Column Mapping

**Files:**
- Create: `app/lib/providers/csv-parser.server.ts`
- Create: `app/lib/providers/xml-parser.server.ts`
- Create: `app/routes/app.api.upload.tsx`

Upload handling:
1. Accept file via multipart form data
2. Parse CSV/XML to extract column headers
3. Show mapping preview (similar to Shopify's CSV import)
4. Merchant confirms mapping
5. Import products into our `products` table under that provider

**Step 1: Build the parsers**

**Step 2: Build the upload API route**

**Step 3: Verify build and commit**

```bash
git add app/lib/providers/ app/routes/app.api.upload.tsx
git commit -m "feat: add CSV/XML upload with column mapping preview"
```

---

### Task 25: API & FTP Provider Fetching

**Files:**
- Create: `app/lib/providers/api-fetcher.server.ts`
- Create: `app/lib/providers/ftp-fetcher.server.ts`

API fetcher: configurable endpoint + auth + response mapping.
FTP fetcher: connect, download file, parse as CSV/XML.

Both support scheduled execution (cron-like) based on plan limits.

Plan gate: API requires Professional+, FTP requires Business+.

**Step 1: Build the API fetcher**

**Step 2: Build the FTP fetcher**

**Step 3: Verify build and commit**

```bash
git add app/lib/providers/
git commit -m "feat: add API and FTP/SFTP provider fetchers"
```

---

## Phase H: Collections & Vehicles (Tasks 26-28)

### Task 26: Collections Page

**Files:**
- Modify: `app/routes/app.collections.tsx`

Collection strategy configuration:
- Select strategy: by Make, by Make + Model, by Make + Model + Year
- Preview what collections will be created
- Toggle auto-create on push
- View existing collections pushed to Shopify
- SEO settings (title template, description template)
- Image settings (use brand logos, use model images)

Plan gate: Growth+ for basic collections, Professional+ for SEO + images.

**Step 1: Build the page**

**Step 2: Verify build and commit**

---

### Task 27: Vehicles Page (YMME Browser)

**Files:**
- Modify: `app/routes/app.vehicles.tsx`

Browse the global vehicle database and select which makes/models are active for this tenant:
- Searchable list of all makes with logos
- Toggle to enable/disable each make
- Expand make to see models
- Count of products mapped to each make
- Plan gate: active makes limited by tier (10/30/unlimited)
- Custom vehicle entry form (Professional+)

**Step 1: Build the page with make browser and toggle**

**Step 2: Build the custom vehicle entry form**

**Step 3: Verify build and commit**

---

### Task 28: Settings Page

**Files:**
- Modify: `app/routes/app.settings.tsx`

App configuration:
- Engine display format (code, full name, displacement)
- Tag prefix customization
- Push behavior toggles (tags, metafields, collections)
- Collection strategy selection
- Notification email
- Danger zone: disconnect store, delete all data

All forms use Shopify Contextual Save Bar (App Bridge CSB).

**Step 1: Build the settings page**

**Step 2: Verify build and commit**

---

## Phase I: Theme App Extensions & App Proxy (Tasks 29-33)

### Task 29: App Proxy Route

**Files:**
- Create: `app/routes/proxy.tsx`

Handle all storefront widget API requests through Shopify's App Proxy:
- Verify HMAC signature on every request
- Extract shop domain from proxy params
- Route to sub-handlers based on path

Sub-routes:
- `GET /apps/autosync/api/makes` — active makes for tenant
- `GET /apps/autosync/api/models?make_id=X` — models
- `GET /apps/autosync/api/years?model_id=X` — year range
- `GET /apps/autosync/api/engines?model_id=X&year=Y` — engines
- `GET /apps/autosync/api/search?make=X&model=Y&year=Z` — matching products
- `POST /apps/autosync/api/plate-lookup` — DVLA+MOT (Enterprise only)
- `GET /apps/autosync/api/wheel-search?pcd=X&offset=Y` — wheel fitment

**Step 1: Build the proxy route with signature verification**

**Step 2: Build each sub-handler**

**Step 3: Verify build and commit**

```bash
git add app/routes/proxy.tsx
git commit -m "feat: add App Proxy route for storefront widget data"
```

---

### Task 30: YMME Search Widget (Theme Extension)

**Files:**
- Create: `extensions/phq-widgets/blocks/ymme-search.liquid`
- Create: `extensions/phq-widgets/assets/autosync-widgets.js`
- Create: `extensions/phq-widgets/assets/autosync-widgets.css`
- Create: `extensions/phq-widgets/shopify.extension.toml`

The YMME search widget: cascading dropdowns (Make → Model → Year → Engine) that filters products or redirects to the matching collection.

Theme editor settings: heading text, button text, colors, layout (horizontal/vertical), redirect behavior.

All API calls go through App Proxy (`/apps/autosync/api/...`).

**Step 1: Create the extension TOML config**

```toml
api_version = "2026-01"
type = "theme_app_extension"

[[extensions]]
name = "AutoSync Widgets"
handle = "phq-widgets"

[[extensions.blocks]]
name = "YMME Vehicle Search"
target = "section"
template = "blocks/ymme-search.liquid"

# Additional blocks added in later tasks
```

**Step 2: Build the Liquid block with schema settings**

**Step 3: Build the shared JS (fetch from App Proxy, render dropdowns)**

**Step 4: Build the shared CSS**

**Step 5: Verify and commit**

```bash
git add extensions/
git commit -m "feat: add YMME search theme app extension widget"
```

---

### Task 31: Fitment Badge & Compatibility Table Widgets

**Files:**
- Create: `extensions/phq-widgets/blocks/fitment-badge.liquid`
- Create: `extensions/phq-widgets/blocks/vehicle-compatibility.liquid`

Fitment badge: shows "Fits your vehicle ✓" or "Does not fit" when customer has a vehicle selected (stored in localStorage).

Compatibility table: shows all vehicles a product fits, read from product metafields.

**Step 1: Build both Liquid blocks**

**Step 2: Update extension TOML**

**Step 3: Verify and commit**

---

### Task 32: Floating Vehicle Bar Widget

**Files:**
- Create: `extensions/phq-widgets/blocks/floating-vehicle-bar.liquid`

Persistent bar showing the customer's selected vehicle. Appears at top/bottom of page. Shows "Your vehicle: 2019 BMW 3 Series 320i" with a change/remove button.

**Step 1: Build the Liquid block**

**Step 2: Verify and commit**

---

### Task 33: Plate Lookup & Wheel Finder Widgets

**Files:**
- Create: `extensions/phq-widgets/blocks/plate-lookup.liquid`
- Create: `extensions/phq-widgets/blocks/wheel-finder.liquid`
- Create: `app/lib/dvla/ves-client.server.ts`
- Create: `app/lib/dvla/mot-client.server.ts`

Plate lookup: text input for UK registration number → calls DVLA VES API + DVSA MOT History API → shows vehicle details → links to YMME to find parts.

Wheel finder: dropdowns for PCD, offset, bore, diameter → searches wheel_fitments table.

Port DVLA/MOT client code from V1. Plan gate: Enterprise only.

**Step 1: Port and adapt DVLA/MOT client**

**Step 2: Build the Liquid blocks**

**Step 3: Update extension TOML with all blocks**

**Step 4: Verify and commit**

```bash
git add extensions/ app/lib/dvla/
git commit -m "feat: add plate lookup and wheel finder widgets"
```

---

## Phase J: Plans, Help & Onboarding (Tasks 34-36)

### Task 34: Plans Page

**Files:**
- Modify: `app/routes/app.plans.tsx`

Show all 6 tiers with features, current plan highlighted, upgrade/downgrade buttons.

Since we use Managed Pricing, upgrading redirects to Shopify's plan selection page:
`https://admin.shopify.com/store/{handle}/charges/{app_handle}/pricing_plans`

Use Polaris: `Page`, `Layout`, `Card`, `BlockStack`, `InlineStack`, `Text`, `Badge`, `Button`, `Divider`, `Icon`.

**Step 1: Build the plans comparison page**

**Step 2: Verify build and commit**

---

### Task 35: Help / Documentation Page

**Files:**
- Modify: `app/routes/app.help.tsx`

In-app documentation covering every feature:
- Getting Started guide
- How Auto Fitment works
- How Manual Fitment works
- Understanding Collections
- Provider Setup (CSV, API, FTP)
- Widget Installation guide
- DVLA/MOT Plate Lookup explained
- FAQ

Use Polaris: `Page`, `Layout`, `Card`, `Collapsible`, `Text`, `BlockStack`, `Divider`.

**Step 1: Build the help page with collapsible sections**

**Step 2: Verify build and commit**

---

### Task 36: First-Time Onboarding Flow

**Files:**
- Create: `app/components/OnboardingChecklist.tsx`
- Modify: `app/routes/app._index.tsx`

For first-time merchants, the dashboard shows a step-by-step onboarding:
1. "Welcome to AutoSync" — brief intro cards explaining what the app does
2. Checklist with progress:
   - [ ] Fetch your products from Shopify
   - [ ] Map fitment to your products
   - [ ] Push data to Shopify
   - [ ] Add widgets to your theme
3. Each step has a CTA button and links to the relevant page
4. Steps auto-complete as the merchant progresses (check product_count > 0, fitment_count > 0, etc.)

**Step 1: Build the OnboardingChecklist component**

**Step 2: Integrate into dashboard**

**Step 3: Verify build and commit**

---

## Phase K: Scrapers & YMME Expansion (Tasks 37-39)

### Task 37: Port auto-data.net Scraper

**Files:**
- Create: `app/lib/scrapers/autodata.server.ts`

Port the V1 auto-data.net scraper. This is admin-only functionality (not tenant-facing) used to populate the global YMME database.

Key features:
- Resumable scraping (tracks last processed brand/model)
- Crawl all brands → all models → all generations → all engines
- Store in ymme_makes/ymme_models/ymme_generations/ymme_engines
- Download brand logos and model images
- Rate limiting to avoid IP blocks

This does NOT need a merchant-facing UI — it's run by us (app owners) to build the database.

**Step 1: Port and adapt the scraper**

**Step 2: Verify build and commit**

---

### Task 38: NHTSA vPIC API Integration

**Files:**
- Create: `app/lib/scrapers/nhtsa.server.ts`

NHTSA vPIC API (free, no auth required):
- `https://vpic.nhtsa.dot.gov/api/vehicles/GetAllMakes?format=json`
- `https://vpic.nhtsa.dot.gov/api/vehicles/GetModelsForMakeId/{makeId}?format=json`

Use to cross-reference and fill gaps in our YMME database. US vehicle data source.

**Step 1: Build the NHTSA client**

**Step 2: Verify build and commit**

---

### Task 39: Admin Panel (App Owner Management)

**Files:**
- Create: `app/routes/app.admin.tsx` (protected by shop_id check — only our store)

Admin panel for us to manage all tenants:
- List all installed merchants with plan, status, product count
- View tenant details
- Trigger YMME database scraper
- View error logs
- System health dashboard

This page is only accessible to our admin shop (performancehq-3.myshopify.com).

**Step 1: Build the admin page with tenant list**

**Step 2: Add admin protection middleware**

**Step 3: Verify build and commit**

---

## Phase L: Fitment Overview & Remaining Pages (Tasks 40-41)

### Task 40: Fitment Overview Page

**Files:**
- Modify: `app/routes/app.fitment.tsx`

Overview of fitment mapping status:
- Stats: total products, mapped, unmapped, partial, flagged
- Donut chart or progress visualization
- Two CTAs: "Run Auto Extraction" (Growth+) and "Start Manual Mapping"
- Recent activity: last 10 fitment changes
- Filter/search to find specific products by fitment status

**Step 1: Build the page**

**Step 2: Verify build and commit**

---

### Task 41: CLAUDE.md & Memory Updates

**Files:**
- Create: `CLAUDE.md` in project root

Save the complete project plan, architecture decisions, credentials reference, and development conventions to CLAUDE.md. This becomes the single source of truth for all future sessions.

**Step 1: Write CLAUDE.md with full project reference**

**Step 2: Update memory files in `~/.claude/projects/` to reference V3**

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md project reference"
```

---

## Phase M: Deploy & Polish (Tasks 42-44)

### Task 42: Vercel Deployment Configuration

**Files:**
- Create: `vercel.json`

Configure Vercel for React Router 7:
- Build command: `npm run build`
- Output directory: `build`
- Environment variables: all from `.env`
- Custom domains

**Step 1: Configure Vercel**

**Step 2: Deploy and verify**

**Step 3: Test OAuth flow with development store**

**Step 4: Commit**

---

### Task 43: End-to-End Testing

Test the complete flow:
1. Install app on dev store (performancehq-3.myshopify.com)
2. Onboarding flow appears
3. Fetch products from Shopify
4. Run auto extraction
5. Manually map remaining products
6. Push tags + metafields + collections to Shopify
7. Verify data appears in Shopify admin
8. Add YMME widget to theme
9. Test widget filters products correctly
10. Test plate lookup (Enterprise feature)

**Step 1: Run through each test scenario**

**Step 2: Fix any issues found**

**Step 3: Document results**

---

### Task 44: Shopify App Store Submission Preparation

Prepare for App Store submission:
1. App listing content (description, screenshots, feature list)
2. Configure Managed Pricing in Partner Dashboard (6 tiers)
3. Privacy policy URL
4. Support URL
5. Compliance webhooks (customer data request/deletion, shop redaction)
6. Built for Shopify checklist verification

**Step 1: Create compliance webhook handlers**

**Step 2: Prepare listing content**

**Step 3: Submit for review**

---

## Execution Order Summary

| Phase | Tasks | What | Priority |
|-------|-------|------|----------|
| **A** | 1-5 | Project scaffold, Supabase, schema | **FIRST — Foundation** |
| **B** | 6-8 | Billing, plan enforcement, webhooks | **SECOND — Business logic** |
| **C** | 9-11 | App shell, navigation, page stubs | **THIRD — App skeleton** |
| **D** | 12-14 | Product fetch & browse | **FOURTH — Core feature** |
| **E** | 15-19 | Fitment mapping (manual + auto) | **FIFTH — Core feature** |
| **F** | 20-22 | Push to Shopify | **SIXTH — Core feature** |
| **G** | 23-25 | Providers & import | Seventh |
| **H** | 26-28 | Collections, vehicles, settings | Eighth |
| **I** | 29-33 | Theme extensions & App Proxy | Ninth |
| **J** | 34-36 | Plans, help, onboarding | Tenth |
| **K** | 37-39 | Scrapers & admin panel | Eleventh |
| **L** | 40-41 | Remaining pages & docs | Twelfth |
| **M** | 42-44 | Deploy, test, submit | **LAST** |

**Total: 44 tasks across 13 phases.**

Phases A-F are the critical path — without them, nothing works. Phases G-M layer features on top of a working foundation.
