import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function ProductDetails() {
  return (
    <Page title="Product Details" backAction={{ url: "/app/products" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Product Details"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                View product details and manage vehicle fitment mappings.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
