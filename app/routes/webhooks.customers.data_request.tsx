import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Mandatory GDPR webhook: customers/data_request
 *
 * Shopify sends this when a customer requests their data.
 * AutoSync does NOT store customer PII — we only store product/fitment data.
 * We acknowledge the request and respond with an empty payload.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}: ${shop} — No customer PII stored by AutoSync`);

  // AutoSync stores zero customer data.
  // Product fitment data is merchant data, not customer data.
  return new Response(JSON.stringify({ message: "No customer data stored" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
