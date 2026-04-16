import { useState, useCallback, useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useNavigate, useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Divider,
  Button,
  Banner,
  Collapsible,
  TextField,
  Box,
  List,
} from "@shopify/polaris";
import { BookOpenIcon } from "@shopify/polaris-icons";

import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { authenticate } from "../shopify.server";
import { RouteError } from "../components/RouteError";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // Generate plan summaries from billing source of truth (never hardcode prices)
  const { getPlanLimits, getPlanPriceLabel } = await import("../lib/billing.server");
  const tiers = ["free", "starter", "growth", "professional", "business", "enterprise"] as const;
  const planSummaries = tiers.map((tier) => {
    const limits = getPlanLimits(tier);
    const price = getPlanPriceLabel(tier);
    const products = limits.products === Infinity ? "Unlimited" : limits.products.toLocaleString();
    const fitments = limits.fitments === Infinity ? "Unlimited" : limits.fitments.toLocaleString();
    return { tier, name: tier.charAt(0).toUpperCase() + tier.slice(1), price, products, fitments };
  });
  return { planSummaries };
};

// ---------------------------------------------------------------------------
// Help sections content
// ---------------------------------------------------------------------------

interface HelpSection {
  id: string;
  title: string;
  keywords: string[];
  content: JSX.Element;
}

function buildSections(navigate: ReturnType<typeof useNavigate>, planSummaries: Array<{ tier: string; name: string; price: string; products: string; fitments: string }>): HelpSection[] {
  return [
    {
      id: "getting-started",
      title: "1. Getting Started",
      keywords: ["start", "begin", "setup", "install", "first", "overview", "introduction"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            AutoSync helps you manage vehicle fitment data for your Shopify store. Here is how
            to get up and running:
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Step 1: Fetch your products
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Import your existing Shopify products into AutoSync so you can start mapping
              vehicle fitment data to them. Go to Products and click "Fetch Products".
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Step 2: Map fitment data
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Use auto-extraction to automatically detect vehicle compatibility from your product
              titles and descriptions, or manually map fitment in the queue.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Step 3: Push to Shopify
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Once fitment is mapped, push tags and metafields to your Shopify products so your
              storefront can display vehicle compatibility information.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Step 4: Add storefront widgets
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Install the theme app extension to add Year/Make/Model search, fitment badges,
              and compatibility tables to your storefront.
            </Text>
          </BlockStack>
          <Button onClick={() => navigate("/app")}>Go to Dashboard</Button>
        </BlockStack>
      ),
    },
    {
      id: "fetching-products",
      title: "2. Fetching Products",
      keywords: ["fetch", "import", "products", "shopify", "sync", "pull"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            Fetching imports your Shopify products into AutoSync's database for fitment mapping.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              How it works
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              AutoSync uses the Shopify Admin API to pull your products, including their titles,
              descriptions, variants, tags, and images. Products are stored locally so fitment
              data can be matched and managed without repeated API calls.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Product limits
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              The number of products you can fetch depends on your plan tier. Check your current
              plan usage on the Dashboard or visit the Plans page to upgrade.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Re-fetching
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              You can re-fetch products at any time to pick up new items or changes from Shopify.
              Existing fitment mappings are preserved when re-fetching.
            </Text>
          </BlockStack>
          <Button onClick={() => navigate("/app/products")}>Go to Products</Button>
        </BlockStack>
      ),
    },
    {
      id: "auto-extraction",
      title: "3. Auto Fitment Extraction",
      keywords: ["auto", "extraction", "pattern", "matching", "regex", "automatic", "detect"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            Auto-extraction analyses your product titles and descriptions to automatically
            detect vehicle compatibility information.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Pattern matching engine
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              The engine uses a library of regex patterns and coded rules (no AI) to identify
              make, model, year range, and engine references in your product data. It matches
              against our global vehicle database containing thousands of makes and models.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Confidence levels
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Each extraction gets a confidence score. High-confidence matches are auto-approved,
              while lower-confidence matches are queued for manual review in the fitment queue.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Plan requirement
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Auto-extraction is available on the Growth plan and above. Free and Starter plans
              use manual fitment mapping only.
            </Text>
          </BlockStack>
          <Button onClick={() => navigate("/app/fitment")}>Go to Fitment</Button>
        </BlockStack>
      ),
    },
    {
      id: "manual-mapping",
      title: "4. Manual Fitment Mapping",
      keywords: ["manual", "mapping", "queue", "fitment", "map", "assign", "vehicle"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            The manual fitment queue lets you review and assign vehicle compatibility to
            products one by one.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              The queue workflow
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Products without fitment data appear in the queue. For each product, you can
              search and select vehicles (year, make, model, engine) from the global database.
              You can assign multiple vehicles to a single product.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Reviewing auto-extractions
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Products that were auto-extracted with lower confidence also appear in the queue
              for manual review. You can approve, modify, or reject the suggested fitments.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Statuses
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Products move through statuses: unmapped, auto_mapped, smart_mapped, manual_mapped, partial,
              and flagged. You can filter the queue by status to focus on what needs attention.
            </Text>
          </BlockStack>
          <Button onClick={() => navigate("/app/fitment/manual")}>Go to Manual Mapping</Button>
        </BlockStack>
      ),
    },
    {
      id: "push-to-shopify",
      title: "5. Push to Shopify",
      keywords: ["push", "sync", "tags", "metafields", "collections", "shopify", "publish"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            Pushing sends your fitment data back to Shopify as tags, metafields, and smart
            collections so your storefront can use it.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Tags
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Vehicle make and model names are pushed as app-prefixed tags (e.g.,
              "_autosync_BMW", "_autosync_3 Series"). These power smart collections that
              automatically group products by vehicle. Tags are limited to 250 per product by
              Shopify.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Metafields
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Structured fitment data (make, model, generation, year range) is stored in
              app-owned metafields under the "$app:vehicle_fitment" namespace. These are
              protected and only manageable through AutoSync.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Smart Collections
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              AutoSync can create and manage smart collections that automatically include
              products matching specific vehicles. Available on Growth plan and above with
              varying levels of granularity.
            </Text>
          </BlockStack>
          <Button onClick={() => navigate("/app/push")}>Go to Push</Button>
        </BlockStack>
      ),
    },
    {
      id: "data-sync",
      title: "6. Automatic Data Sync & Cleanup",
      keywords: ["sync", "cleanup", "delete", "stale", "ghost", "automatic", "webhook", "orphan", "metafield", "collection", "vehicle page", "YMME", "dropdown"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            AutoSync automatically keeps your Shopify store in sync with your fitment data.
            When products or fitments are deleted, all related data is cleaned up automatically
            — tags, metafields, collections, vehicle pages, and YMME dropdowns stay accurate
            with zero manual work.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              How It Works
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Every time you delete products or fitments — whether in AutoSync or directly
              on Shopify — the system automatically detects the change and cleans up
              everything downstream. This happens in three ways:
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              1. Instant Cleanup (When You Delete in AutoSync)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Deleting products or fitments from any page in AutoSync immediately recounts
              your totals, removes empty vehicle makes from your YMME dropdowns, marks
              orphaned vehicle pages for removal, and schedules a background job to remove
              stale tags and metafields from your Shopify products.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              2. Webhook Detection (When You Delete on Shopify)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              If you delete products directly on Shopify (e.g., through Shopify Admin or a
              bulk delete), AutoSync receives a webhook notification within seconds.
              The product is removed from our database, and a cleanup job is automatically
              created to sync all related data. Multiple rapid deletions are batched into
              a single cleanup for efficiency.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              3. Hourly Safety Net (Automatic Background Check)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Every hour, the system automatically scans all stores to detect any data
              drift — miscounted totals, stale vehicle makes, orphaned vehicle pages,
              or products with outdated Shopify data. If anything is out of sync, it is
              corrected automatically. This catches edge cases like webhook failures or
              network timeouts.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              What Gets Cleaned Up
            </Text>
            <List type="bullet">
              <List.Item>Product and fitment counts on your dashboard</List.Item>
              <List.Item>YMME dropdowns — makes with zero products are automatically removed</List.Item>
              <List.Item>Shopify tags — "_autosync_" prefixed tags are removed from affected products</List.Item>
              <List.Item>Shopify metafields — vehicle fitment data is removed from products that no longer have fitments</List.Item>
              <List.Item>Smart collections — empty collections for makes/models with zero products are cleaned up</List.Item>
              <List.Item>Vehicle pages — specification pages for engines with zero products are marked for removal</List.Item>
              <List.Item>Wheel fitments — automatically removed when wheel products are deleted (database cascade)</List.Item>
            </List>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Bulk Operations
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Cleanup uses Shopify&apos;s Bulk Operations API for maximum speed. Instead of
              updating products one-by-one, AutoSync scans your entire catalog, builds a
              single batch file, and uploads it to Shopify for server-side processing. This
              means cleaning up 10,000 products takes minutes, not hours.
            </Text>
          </BlockStack>
          <Banner tone="info">
            <p>
              You never need to manually clean up stale data. The system handles everything
              automatically — whether you delete 1 product or 10,000.
            </p>
          </Banner>
        </BlockStack>
      ),
    },
    {
      id: "providers",
      title: "7. Providers",
      keywords: ["provider", "csv", "xml", "api", "ftp", "import", "source", "feed"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            Providers are external data sources that supply product or fitment information
            to AutoSync.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Supported source types
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              CSV: Upload or link to a CSV file containing product/fitment data.
              XML: Parse XML feeds from suppliers.
              API: Connect to supplier REST APIs.
              FTP: Connect to FTP/SFTP servers for scheduled imports (Business plan and above).
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Scheduled fetches
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Depending on your plan, you can schedule automatic imports from your providers.
              Growth gets 1 per day, Professional gets 2, Business gets 6, and Enterprise has
              unlimited scheduled fetches.
            </Text>
          </BlockStack>
          <Button onClick={() => navigate("/app/providers")}>Go to Providers</Button>
        </BlockStack>
      ),
    },
    {
      id: "storefront-widgets",
      title: "8. Storefront Widgets",
      keywords: [
        "widget", "storefront", "theme", "ymme", "search", "badge", "compatibility",
        "table", "floating", "bar", "install", "extension",
      ],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            AutoSync includes a theme app extension with 4 storefront widgets that customers
            can interact with on your store.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              YMME Search Widget
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A Year/Make/Model/Engine search bar that lets customers filter products by their
              vehicle. Cascading dropdowns query your fitment database in real-time. Available
              on Starter plan and above.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Fitment Badge
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Shows a "Fits your vehicle" or "Does not fit" badge on product pages based on
              the customer's selected vehicle. Available on Starter plan and above.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Compatibility Table
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Displays a full list of compatible vehicles on product pages. Shows make, model,
              year range, and engine details. Available on Growth plan and above.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Floating Vehicle Bar
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A persistent bar at the top of the page showing the customer's currently selected
              vehicle. Available on Growth plan and above.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Installation
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Go to your Shopify theme editor (Online Store &gt; Themes &gt; Customize), click
              "App embeds" in the left sidebar, and enable the AutoSync widgets you want to use.
              Each widget can be positioned and configured from the theme editor.
            </Text>
          </BlockStack>
        </BlockStack>
      ),
    },
    {
      id: "wheel-finder",
      title: "9. Wheel Finder",
      keywords: ["wheel", "pcd", "offset", "bolt", "pattern", "diameter", "bore", "staggered", "alloy"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            The Wheel Finder lets customers search for compatible wheels by PCD (bolt pattern),
            offset, diameter, and centre bore.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              How it works
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Customers select their vehicle's bolt pattern (e.g., 5x112), wheel diameter (e.g., 18"),
              and offset range. AutoSync queries your wheel fitment database and returns matching
              products. The search supports all common PCD patterns from 4x100 to 5x130.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Wheel fitment data
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Wheel specifications (PCD, offset range, centre bore, diameter, width) are stored
              per product in the wheel_fitments table. You can add this data via CSV import or
              through your provider feeds.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Plan requirement
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Wheel Finder is available on the Professional plan and above.
            </Text>
          </BlockStack>
        </BlockStack>
      ),
    },
    {
      id: "dvla-mot",
      title: "10. DVLA/MOT Plate Lookup",
      keywords: ["dvla", "mot", "plate", "registration", "uk", "number", "lookup", "vehicle"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            The plate lookup feature allows UK customers to enter their vehicle registration
            number and automatically identify their vehicle.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              How it works
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              When a customer enters a UK registration number, AutoSync queries the DVLA
              Vehicle Enquiry Service (VES) API to retrieve vehicle details including make,
              model, year, fuel type, and engine size. It also queries the DVSA MOT History
              API for additional vehicle history.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Compatible products
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              After identifying the vehicle, AutoSync automatically searches your fitment database
              for compatible products and returns them alongside the vehicle details. This creates
              a seamless "enter your reg → see matching parts" experience.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Plan requirement
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              DVLA/MOT plate lookup is an Enterprise-exclusive feature. It requires
              valid DVLA VES and MOT History API credentials to be configured.
            </Text>
          </BlockStack>
        </BlockStack>
      ),
    },
    {
      id: "vin-decode",
      title: "11. VIN Decode",
      keywords: ["vin", "decode", "vehicle", "identification", "number", "17", "chassis"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            VIN Decode translates a 17-character Vehicle Identification Number into full vehicle
            details — make, model, year, engine, body type, drive type, and more.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              How it works
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              AutoSync decodes VINs using industry-standard vehicle identification databases.
              The VIN is validated (17 characters, no I/O/Q), decoded into 100+ vehicle
              attributes, and matched against your fitment database to find compatible products.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              What data is returned
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Make, Model, Model Year, Body Class, Drive Type, Engine Cylinders, Engine
              Displacement, Fuel Type, Transmission Style, Trim, Manufacturer, Plant Country,
              and compatible products from your store.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Plan requirement
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              VIN Decode is an Enterprise-exclusive feature. No additional API
              credentials or setup are needed — it works out of the box.
            </Text>
          </BlockStack>
        </BlockStack>
      ),
    },
    {
      id: "wheel-finder",
      title: "12. Wheel Finder Widget",
      keywords: ["wheel", "finder", "pcd", "bolt", "pattern", "offset", "diameter", "width", "center", "bore", "alloy", "rim"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            The Wheel Finder widget lets your customers search for compatible alloy wheels
            by their vehicle's bolt pattern (PCD), diameter, width, and offset.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              How it works
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Customers select from cascading dropdowns: PCD (e.g. 5x112) → Diameter (e.g. 18") →
              Width (e.g. 8J) → Offset (e.g. ET35). Each dropdown dynamically loads options based on
              your actual inventory. Matching wheels are displayed with images and prices.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Importing wheel data
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Import wheel products from any provider (CSV, XML, API). The column mapper automatically
              recognizes PCD, diameter, width, center bore, and offset columns. Wheel specifications
              are extracted and stored in a dedicated database for fast search.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              PCD (Bolt Pattern)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              PCD stands for Pitch Circle Diameter — the bolt pattern of the wheel (e.g. 5x112 means
              5 bolts on a 112mm circle). Customers need to match their vehicle's PCD to find compatible wheels.
            </Text>
          </BlockStack>
          <Text as="p" variant="bodySm" tone="subdued">
            Wheel Finder is available on the Professional plan and above.
          </Text>
        </BlockStack>
      ),
    },
    {
      id: "analytics",
      title: "13. Analytics Dashboard",
      keywords: ["analytics", "fitment", "coverage", "popular", "makes", "models", "supplier", "performance", "inventory", "gap", "export", "report"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            The Analytics dashboard provides insights into your fitment coverage, popular
            vehicles, supplier performance, and inventory gaps.
          </Text>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Fitment coverage
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              See what percentage of your products have vehicle fitment data mapped. Track
              coverage progress over time and identify products that still need mapping.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Popular makes and models
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              View your top 15 makes and models by fitment count. Understand which vehicles
              have the most product coverage and where you might want to expand.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Supplier performance
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Monitor your providers — see product counts, last fetch dates, and sync job
              success rates to ensure your data pipeline is healthy.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Inventory gap analysis
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Discover how many vehicle makes in the global database have no products in your
              store. This highlights opportunities to expand your catalogue.
            </Text>
          </BlockStack>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Plan availability
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Basic analytics (coverage + status) available on Starter. Full analytics (tables,
              gaps, supplier metrics) on Growth+. Data export (JSON/CSV) on Business+.
            </Text>
          </BlockStack>
          <Button onClick={() => navigate("/app/analytics")}>Go to Analytics</Button>
        </BlockStack>
      ),
    },
    {
      id: "plan-comparison",
      title: "14. Plan Comparison",
      keywords: ["plan", "pricing", "tier", "upgrade", "downgrade", "billing", "subscription"],
      content: (
        <BlockStack gap="300">
          <Text as="p" variant="bodyMd">
            AutoSync offers 6 tiers to fit businesses of every size.
          </Text>
          <BlockStack gap="200">
            {planSummaries.map((p) => (
              <Text key={p.tier} as="p" variant="bodySm">
                <strong>{`${p.name} (${p.price})`}</strong>{` — ${p.products} products, ${p.fitments} fitments.`}
              </Text>
            ))}
          </BlockStack>
          <Button onClick={() => navigate("/app/plans")}>View Full Plan Details</Button>
        </BlockStack>
      ),
    },
    {
      id: "faq",
      title: "15. FAQ",
      keywords: ["faq", "question", "answer", "help", "common", "troubleshoot"],
      content: (
        <BlockStack gap="400">
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: How often should I re-fetch products?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: Re-fetch whenever you add new products to Shopify. Your existing fitment
              mappings will not be lost. If you have a provider set up with scheduled fetches,
              this happens automatically.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: Will pushing tags affect my existing Shopify tags?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: No. AutoSync only manages tags with the "_autosync_" prefix. Your existing
              tags remain untouched.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: What happens if I downgrade my plan?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: Your existing data is preserved, but features above your new plan limit will
              be disabled. You will not be able to push or fetch beyond your new limits until
              you upgrade again.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: Can I use AutoSync with any Shopify theme?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: Yes. The theme app extension works with all Shopify Online Store 2.0 themes.
              The widgets are added through the theme editor as app blocks.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: Is AI used for fitment extraction?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: No. AutoSync uses pattern matching, regex rules, and coded logic to extract
              fitment data. This provides consistent, predictable, and transparent results.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: How do metafields work?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: AutoSync uses app-owned metafields under the "$app:vehicle_fitment" namespace.
              These are protected by Shopify and can only be read/written by AutoSync. They are
              accessible on the storefront via Liquid or the Storefront API.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: What vehicle databases does AutoSync support?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: AutoSync maintains its own comprehensive global vehicle database covering
              makes and models worldwide. The database is professionally curated and
              continuously expanding with new vehicles and specifications.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: Does VIN Decode work for non-US vehicles?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: VIN Decode works best with vehicles sold in the US market. For UK
              vehicles, the DVLA plate lookup is more reliable. VINs from other markets may
              return partial data.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: How do I add wheel fitment data for my products?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: Wheel specifications (PCD, offset, diameter, centre bore, width) can be imported
              via CSV upload or through provider feeds. Each product can have multiple wheel
              fitment entries to support different sizes and configurations.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: What happens if I delete products from Shopify directly?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: AutoSync detects the deletion via Shopify webhooks within seconds. The product
              and its fitments are removed from our database automatically. A background cleanup
              job then recounts your totals, removes empty makes from YMME dropdowns, and cleans
              up any stale tags or metafields on other products. No manual action needed.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: Why do my YMME dropdowns still show makes/models with no products?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: This should not happen — AutoSync automatically removes makes with zero products
              from your YMME widget. If you see empty makes, try waiting a few minutes for the
              automatic cleanup to complete. The system also runs an hourly background check that
              catches any edge cases. If the issue persists, go to Settings and use the
              &quot;Delete All Fitments&quot; option to reset, then re-map your products.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: Do I need to manually clean up old data after deleting products?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: No. AutoSync handles all cleanup automatically. When products or fitments are
              deleted, the system removes stale tags, metafields, empty collections, and orphaned
              vehicle pages from your Shopify store. Dashboard counts, YMME dropdowns, and all
              widgets update automatically. There is nothing you need to do manually.
            </Text>
          </BlockStack>
          <Divider />
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              Q: How long does cleanup take after deleting products?
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              A: Dashboard counts and YMME dropdowns update within seconds. Shopify tag and
              metafield cleanup uses bulk operations and typically completes within 2-5 minutes
              for stores with up to 50,000 products. You can continue using the app normally
              while cleanup runs in the background.
            </Text>
          </BlockStack>
        </BlockStack>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Help() {
  const { planSummaries } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const sections = useMemo(() => buildSections(navigate, planSummaries ?? []), [navigate, planSummaries]);

  const toggleSection = useCallback((id: string) => {
    setOpenSections((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const filteredSections = useMemo(() => {
    if (!searchQuery.trim()) return sections;
    const query = searchQuery.toLowerCase();
    return sections.filter(
      (section) =>
        section.title.toLowerCase().includes(query) ||
        section.keywords.some((kw) => kw.includes(query)),
    );
  }, [searchQuery, sections]);

  const expandAll = useCallback(() => {
    const allOpen: Record<string, boolean> = {};
    sections.forEach((s) => {
      allOpen[s.id] = true;
    });
    setOpenSections(allOpen);
  }, [sections]);

  const collapseAll = useCallback(() => {
    setOpenSections({});
  }, []);

  return (
    <Page
      fullWidth
      title="Help & Documentation"
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
    >
      <BlockStack gap="600">
        {/* How It Works */}
        <HowItWorks
          title="Getting Started"
          steps={[
            { number: 1, title: "Import Products", description: "Fetch your Shopify products or upload from providers. All products sync automatically.", linkText: "Products", linkUrl: "/app/products" },
            { number: 2, title: "Map Fitments", description: "Use auto-extraction or manual mapping to assign vehicle compatibility to products.", linkText: "Fitment", linkUrl: "/app/fitment" },
            { number: 3, title: "Push to Shopify", description: "Send tags, metafields, and collections to your store. Activate the YMME widget.", linkText: "Push", linkUrl: "/app/push" },
            { number: 4, title: "Go Live", description: "Customers can now search parts by vehicle. Check analytics to monitor performance.", linkText: "Analytics", linkUrl: "/app/analytics" },
          ]}
        />

        {/* Search and controls */}
        <Card>
          <BlockStack gap="400">
            <TextField
              label="Search help topics"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Type to filter topics (e.g., 'widget', 'push', 'plan')..."
              clearButton
              onClearButtonClick={() => setSearchQuery("")}
              autoComplete="off"
            />
            <InlineStack gap="200">
              <Button onClick={expandAll} size="slim">
                Expand All
              </Button>
              <Button onClick={collapseAll} size="slim">
                Collapse All
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* No results */}
        {filteredSections.length === 0 && (
          <Banner title="No matching topics" tone="warning">
            <p>
              No help topics match "{searchQuery}". Try a different search term or{" "}
              <Button variant="plain" onClick={() => setSearchQuery("")}>
                clear the filter
              </Button>
              .
            </p>
          </Banner>
        )}

        {/* Help sections */}
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {filteredSections.map((section) => {
                const isOpen = !!openSections[section.id];
                return (
                  <Card key={section.id}>
                    <BlockStack gap="0">
                      <div
                        onClick={() => toggleSection(section.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSection(section.id);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        style={{ cursor: "pointer" }}
                      >
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={BookOpenIcon} color="var(--p-color-icon-emphasis)" />
                            <Text as="h2" variant="headingMd">
                              {section.title}
                            </Text>
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {isOpen ? "\u25B2" : "\u25BC"}
                          </Text>
                        </InlineStack>
                      </div>
                      <Collapsible
                        open={isOpen}
                        id={`help-section-${section.id}`}
                        transition={{
                          duration: "var(--p-motion-duration-200)",
                          timingFunction: "var(--p-motion-ease)",
                        }}
                      >
                        <Box paddingBlockStart="400">
                          {section.content}
                        </Box>
                      </Collapsible>
                    </BlockStack>
                  </Card>
                );
              })}
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* Support footer */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={BookOpenIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingMd">
                Need more help?
              </Text>
            </InlineStack>
            <Divider />
            <Text as="p" variant="bodySm" tone="subdued">
              If you cannot find what you are looking for, check the Plans page for feature
              availability or contact support. We are here to help you get the most out of
              AutoSync.
            </Text>
            <InlineStack gap="200">
              <Button onClick={() => navigate("/app/plans")}>View Plans</Button>
              <Button onClick={() => navigate("/app")} variant="plain">
                Back to Dashboard
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Help" />;
}
