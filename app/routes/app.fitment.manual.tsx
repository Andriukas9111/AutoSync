import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function FitmentManual() {
  return (
    <Page title="Manual Fitment Mapping" backAction={{ url: "/app/fitment" }}>
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Manual Fitment Mapping"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Map products to vehicles one at a time with the manual mapping
                queue.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
