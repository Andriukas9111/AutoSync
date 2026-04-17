declare module "*.css";

// Shopify App Bridge global — injected into every embedded page by the
// Shopify admin shell. Previously TypeScript didn't know about it, so
// routes that called shopify.toast.show(...) or shopify.modal.show(...)
// failed type-checking even though they work at runtime.
declare global {
  interface ShopifyAppBridge {
    toast: {
      show: (message: string, options?: { isError?: boolean; duration?: number }) => void;
    };
    modal: {
      show: (id: string) => void;
      hide: (id: string) => void;
    };
    loading: (show: boolean) => void;
    environment: Record<string, unknown>;
    [key: string]: unknown;
  }
  // eslint-disable-next-line no-var
  var shopify: ShopifyAppBridge;
}
export {};
