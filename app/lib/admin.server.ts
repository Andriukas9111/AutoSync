const DEFAULT_ADMIN_SHOPS = [
  "autosync-9.myshopify.com",
  "performancehq-3.myshopify.com",
];

export const ADMIN_SHOPS: string[] = process.env.ADMIN_SHOPS
  ? process.env.ADMIN_SHOPS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_ADMIN_SHOPS;

export function isAdminShop(shopId: string): boolean {
  return ADMIN_SHOPS.includes(shopId);
}
