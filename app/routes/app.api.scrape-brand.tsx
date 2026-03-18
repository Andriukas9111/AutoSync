/**
 * Scrape Single Brand API
 * POST /app/api/scrape-brand — processes one brand from auto-data.net
 *
 * Body (FormData):
 * - brand_index: number (0-based index into the brand list)
 * - scrape_specs: "true" | "false"
 * - delay_ms: number (delay between sub-requests)
 *
 * Returns: { ok, brand_name, brand_index, total_brands, models, engines, specs, errors, done }
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import {
  fetchBrandList,
  fetchModelsForBrand,
  fetchEnginesForModel,
  fetchSpecsForEngine,
  upsertMake,
  upsertModel,
  upsertEngine,
  upsertVehicleSpecs,
  resolveLogoUrl,
  sleep,
} from "../lib/scrapers/autodata.server";
import { isAdminShop } from "../lib/admin.server";

const DELAY_MS = 500;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  try {
    const formData = await request.formData();
    const brandIndex = parseInt(formData.get("brand_index") as string || "0", 10);
    const scrapeSpecs = (formData.get("scrape_specs") as string) !== "false";
    const delayMs = parseInt(formData.get("delay_ms") as string || String(DELAY_MS), 10);

    // Fetch the full brand list
    const brands = await fetchBrandList();
    const totalBrands = brands.length;

    // If brand_index is beyond the list, we're done
    if (brandIndex >= totalBrands) {
      return data({ ok: true, done: true, brand_name: "", brand_index: brandIndex, total_brands: totalBrands, models: 0, engines: 0, specs: 0, errors: [] });
    }

    const brand = brands[brandIndex];
    const errors: string[] = [];
    let modelsCount = 0;
    let enginesCount = 0;
    let specsCount = 0;

    // Resolve logo and upsert make
    brand.logoUrl = resolveLogoUrl(brand.name, brand.logoUrl);
    const makeId = await upsertMake(brand);

    if (!makeId) {
      errors.push(`Failed to upsert make: ${brand.name}`);
      return data({
        ok: true,
        done: false,
        brand_name: brand.name,
        brand_index: brandIndex,
        total_brands: totalBrands,
        models: 0,
        engines: 0,
        specs: 0,
        errors,
      });
    }

    // Fetch models for this brand
    await sleep(delayMs);
    const models = await fetchModelsForBrand(brand.pageUrl);
    modelsCount = models.length;

    // Process each model
    for (const model of models) {
      const modelId = await upsertModel(makeId, model);
      if (!modelId) {
        errors.push(`Failed to upsert model: ${model.name}`);
        continue;
      }

      // Fetch engines for this model
      await sleep(delayMs);
      const engines = await fetchEnginesForModel(model.pageUrl);
      enginesCount += engines.length;

      // Process each engine
      for (const engine of engines) {
        const engineId = await upsertEngine(modelId, engine);
        if (!engineId) {
          errors.push(`Failed to upsert engine: ${engine.name}`);
          continue;
        }

        // Optionally fetch specs
        if (scrapeSpecs && engine.specPageUrl) {
          try {
            await sleep(delayMs);
            const specs = await fetchSpecsForEngine(engine.specPageUrl);
            await upsertVehicleSpecs(engineId, specs, engine.specPageUrl);
            specsCount++;
          } catch (specErr) {
            errors.push(`Spec error for ${engine.name}: ${specErr instanceof Error ? specErr.message : String(specErr)}`);
          }
        }
      }
    }

    return data({
      ok: true,
      done: false,
      brand_name: brand.name,
      brand_index: brandIndex,
      total_brands: totalBrands,
      models: modelsCount,
      engines: enginesCount,
      specs: specsCount,
      errors,
    });
  } catch (err) {
    return data({
      ok: false,
      done: false,
      error: err instanceof Error ? err.message : "Unknown error",
      brand_name: "",
      brand_index: 0,
      total_brands: 0,
      models: 0,
      engines: 0,
      specs: 0,
      errors: [err instanceof Error ? err.message : "Unknown error"],
    });
  }
};
