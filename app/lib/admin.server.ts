// Admin shops MUST be set via ADMIN_SHOPS env var in production.
// Format: comma-separated list of shop domains (e.g., "store1.myshopify.com,store2.myshopify.com")
// Dev fallback only used when env var is not set (local development).
const DEV_ADMIN_SHOPS = process.env.NODE_ENV === "production" ? [] : [
  "autosync-9.myshopify.com",
  "performancehq-3.myshopify.com",
];

export const ADMIN_SHOPS: string[] = process.env.ADMIN_SHOPS
  ? process.env.ADMIN_SHOPS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEV_ADMIN_SHOPS;

export function isAdminShop(shopId: string): boolean {
  return ADMIN_SHOPS.includes(shopId);
}
