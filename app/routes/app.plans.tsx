import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function Plans() {
  return (
    <Page title="Plans & Pricing">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Plans & Pricing"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                View your current plan, features, and upgrade options.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
