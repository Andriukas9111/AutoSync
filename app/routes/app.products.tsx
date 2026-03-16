import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function Products() {
  return (
    <Page title="Products">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Products"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Fetch Products", onAction: () => {} }}
            >
              <p>
                Fetch, browse, and manage products from your Shopify store and
                providers.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
