/**
 * Custom Plan — Enterprise extension with scalable resources.
 *
 * The Custom plan starts at Enterprise limits ($299/mo) and lets users
 * scale resources ABOVE those limits for an additional cost.
 *
 * Shared between server (billing) and client (plans page sliders).
 */

export interface CustomPlanTier {
  value: number;
  label: string;
  addon: number;
}

export interface CustomPlanConfig {
  products: CustomPlanTier[];
  providers: CustomPlanTier[];
  fitments: CustomPlanTier[];
  scheduledFetches: CustomPlanTier[];
}

// Enterprise base price — Custom plan starts here
export const CUSTOM_PLAN_BASE_PRICE = 299;

// Each slider starts at Enterprise limits (addon: 0) and scales UP
export const CUSTOM_PLAN_TIERS: CustomPlanConfig = {
  // Enterprise gives 50,000 — scale up from there
  products: [
    { value: 50_000, label: "50K", addon: 0 },
    { value: 100_000, label: "100K", addon: 50 },
    { value: 250_000, label: "250K", addon: 120 },
    { value: 500_000, label: "500K", addon: 200 },
    { value: 1_000_000, label: "1M", addon: 350 },
    { value: 999_999_999, label: "Unlimited", addon: 600 },
  ],
  // Enterprise gives 5 — scale up from there
  providers: [
    { value: 5, label: "5", addon: 0 },
    { value: 10, label: "10", addon: 30 },
    { value: 25, label: "25", addon: 70 },
    { value: 50, label: "50", addon: 130 },
    { value: 100, label: "100", addon: 220 },
    { value: 999_999, label: "Unlimited", addon: 400 },
  ],
  // Enterprise gives 250,000 — scale up from there
  fitments: [
    { value: 250_000, label: "250K", addon: 0 },
    { value: 500_000, label: "500K", addon: 50 },
    { value: 1_000_000, label: "1M", addon: 120 },
    { value: 5_000_000, label: "5M", addon: 250 },
    { value: 999_999_999, label: "Unlimited", addon: 450 },
  ],
  // Enterprise gives 12/day — scale up from there
  scheduledFetches: [
    { value: 12, label: "12/day", addon: 0 },
    { value: 24, label: "24/day", addon: 30 },
    { value: 48, label: "48/day", addon: 60 },
    { value: 999_999, label: "Unlimited", addon: 120 },
  ],
};

/** Calculate the total monthly price from slider indices */
export function calculateCustomPrice(selections: {
  productsIndex: number;
  providersIndex: number;
  fitmentsIndex: number;
  scheduledFetchesIndex: number;
}): number {
  const p = CUSTOM_PLAN_TIERS.products[selections.productsIndex]?.addon ?? 0;
  const pr = CUSTOM_PLAN_TIERS.providers[selections.providersIndex]?.addon ?? 0;
  const f = CUSTOM_PLAN_TIERS.fitments[selections.fitmentsIndex]?.addon ?? 0;
  const s = CUSTOM_PLAN_TIERS.scheduledFetches[selections.scheduledFetchesIndex]?.addon ?? 0;
  return CUSTOM_PLAN_BASE_PRICE + p + pr + f + s;
}
