import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function Collections() {
  return (
    <Page title="Collections">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Collections"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Configure how smart collections are created and managed on your
                Shopify store.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
