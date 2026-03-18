export const ADMIN_SHOPS = [
  "autosync-9.myshopify.com",
  "performancehq-3.myshopify.com",
];

export function isAdminShop(shopId: string): boolean {
  return ADMIN_SHOPS.includes(shopId);
}
