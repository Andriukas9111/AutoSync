/**
 * Wheel Product Detection — bulletproof detection using scoring system.
 *
 * Used by:
 * - fetch.server.ts (auto-categorize during Shopify fetch)
 * - app.wheels.tsx (Detect Wheels button — re-scan all products)
 *
 * Detection uses a SCORING system: each signal adds points.
 * Score >= 3 = wheel. This prevents false positives (brake disc with diameter)
 * while catching all real wheels (even without the word "wheel" in title).
 */

// ── Known wheel brands — if title contains brand + any spec, it's a wheel ──
const WHEEL_BRANDS = new Set([
  "bbs", "oz racing", "oz ", "enkei", "rays", "volk", "volk racing",
  "work", "work wheels", "ssr", "rota", "rotiform", "hre", "forgiato",
  "adv.1", "adv1", "brixton", "avant garde", "ag ", "vmr", "neuspeed",
  "apex", "tsw", "konig", "motegi", "team dynamics", "ultralite",
  "3sdm", "fifteen52", "fifteen 52", "xxr", "cosmis", "cosmis racing",
  "japan racing", "jr wheels", "riviera", "axe", "zito", "zito wheels",
  "ispiri", "veemann", "vossen", "rohana", "stance", "stance wheels",
  "bc forged", "wci", "watercooled ind", "racingline", "act", "act wheels",
  "strom", "wedssport", "weds", "gram lights", "te37", "ce28",
  "rpf1", "nt03", "re30", "lm", "rs-05", "rs05",
]);

// ── Wheel-specific keywords (each adds to score) ──
const WHEEL_KEYWORDS = [
  "alloy wheel", "alloy wheels", "forged wheel", "forged wheels",
  "flow formed", "flow forged", "rotary forged",
  "monoblock", "one-piece wheel", "two-piece wheel", "three-piece wheel",
  "multi-piece", "split rim",
  "concave", "deep concave", "deep dish",
  "staggered", "staggered set", "staggered fitment",
  "spoke", "multi-spoke", "mesh wheel", "mesh design",
  "5-spoke", "6-spoke", "7-spoke", "10-spoke", "twin-spoke",
  "directional wheel", "lightweight wheel",
  "hub centric", "hubcentric",
  "bolt pattern", "bolt circle", "lug pattern",
];

// ── Product type matches ──
const WHEEL_PRODUCT_TYPES = [
  "alloy wheels", "alloy wheel", "wheels", "wheel", "rims", "rim",
  "alloy", "alloys", "forged wheels",
];

// ── Tag matches ──
const WHEEL_TAGS = [
  "wheels", "alloy wheels", "rims", "alloy wheel", "alloys", "forged wheels",
  "aftermarket wheels", "custom wheels",
];

/**
 * Detect if a product is a wheel using a scoring system.
 * Score >= 3 = wheel.
 *
 * @param title - lowercase product title
 * @param productType - lowercase product type
 * @param tags - lowercase tags array
 * @param description - optional lowercase description (stripped of HTML)
 */
export function detectWheelProduct(
  title: string,
  productType: string,
  tags: string[],
  description?: string,
): boolean {
  let score = 0;
  const allText = description ? `${title} ${description}` : title;

  // ── Product type match (strongest signal: +4) ──
  if (WHEEL_PRODUCT_TYPES.some(w => productType === w || productType.includes(w))) {
    score += 4;
  }

  // ── Spec detection (each is a strong signal) ──

  // Diameter × Width: "18x8.5", "19×10.5", "18x8.5j", "20 x 9.5"
  if (/\b\d{2}\s*[x×]\s*\d[\d.]*\s*j?\b/i.test(title)) score += 2;

  // PCD bolt pattern: "5x112", "5×114.3", "4x100", "5x120"
  if (/\b[4-6]\s*[x×]\s*\d{3}(?:\.\d{1,2})?\b/.test(title)) score += 2;

  // Offset: "ET45", "ET 10", "ET+35", "ET-5"
  if (/\bET\s*[+-]?\d{1,3}\b/i.test(title)) score += 2;

  // Center bore: "(57.1CB)", "CB 57.1", "57.1mm CB", "CB: 72.6"
  if (/\b\d{2,3}\.\d\s*(?:mm\s*)?CB\b/i.test(allText) || /\bCB\s*[:=]?\s*\d{2,3}\.\d/i.test(allText)) score += 1;

  // J-width notation: "8.5J", "9J", "10.5J"
  if (/\b\d{1,2}(?:\.\d)?\s*J\b/.test(title)) score += 1;

  // Inch notation: '18"', "18 inch", "19-inch"
  if (/\b\d{2}\s*(?:inch|")\b/i.test(title)) score += 1;

  // ── Keyword detection ──
  for (const kw of WHEEL_KEYWORDS) {
    if (allText.includes(kw)) {
      score += 2;
      break; // One keyword match is enough
    }
  }

  // ── Brand detection (brand + any spec = wheel) ──
  for (const brand of WHEEL_BRANDS) {
    if (title.includes(brand) || tags.some(t => t.includes(brand))) {
      score += 1; // Brand alone isn't enough, but brand + spec = wheel
      break;
    }
  }

  // ── Tag detection ──
  if (tags.some(t => WHEEL_TAGS.includes(t))) {
    score += 2;
  }

  // ── Negative signals (NOT a wheel) ──
  // Steering wheel
  if (allText.includes("steering wheel") || allText.includes("steering")) score -= 5;
  // Wheel spacer / wheel bolt / wheel nut (accessories, not wheels)
  if (/wheel\s*(spacer|bolt|nut|stud|lock|cap|center cap|bearing|hub)/i.test(allText)) score -= 5;
  // Brake disc/rotor
  if (allText.includes("brake disc") || allText.includes("brake rotor")) score -= 5;

  return score >= 3;
}
