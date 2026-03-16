import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function Push() {
  return (
    <Page title="Push to Shopify">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Push to Shopify"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Start Push", onAction: () => {} }}
            >
              <p>
                Push tags, metafields, and smart collections to your Shopify
                store.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
