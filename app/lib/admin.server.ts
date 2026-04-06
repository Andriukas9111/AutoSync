// Override via ADMIN_SHOPS env var (comma-separated shop domains).
// Fallback: hardcoded owner shops used when env var is not set.
const DEFAULT_ADMIN_SHOPS = [
  "autosync-9.myshopify.com",
];

export const ADMIN_SHOPS: string[] = process.env.ADMIN_SHOPS
  ? process.env.ADMIN_SHOPS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_ADMIN_SHOPS;

export function isAdminShop(shopId: string): boolean {
  return ADMIN_SHOPS.includes(shopId);
}
