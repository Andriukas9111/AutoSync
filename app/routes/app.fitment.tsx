import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function Fitment() {
  return (
    <Page title="Fitment">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Fitment"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Auto Extract", onAction: () => {} }}
              secondaryAction={{
                content: "Manual Mapping",
                onAction: () => {},
              }}
            >
              <p>
                Map your products to vehicles using auto extraction or manual
                mapping.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
