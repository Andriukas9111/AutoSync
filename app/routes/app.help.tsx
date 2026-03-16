import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function Help() {
  return (
    <Page title="Help & Documentation">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Help & Documentation"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Learn how to use AutoSync, understand features, and get support.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
