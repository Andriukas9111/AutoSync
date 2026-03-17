import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Mandatory GDPR webhook: customers/redact
 *
 * Shopify sends this when a customer requests erasure of their data.
 * AutoSync does NOT store customer PII — we only store product/fitment data.
 * We acknowledge the request.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}: ${shop} — No customer PII to redact`);

  // AutoSync stores zero customer data. Nothing to redact.
  return new Response(JSON.stringify({ message: "No customer data to redact" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
