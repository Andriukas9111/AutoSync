import type { LoaderFunctionArgs } from "react-router";
import { Page, Layout, Card, EmptyState } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return {};
};

export default function Providers() {
  return (
    <Page title="Providers">
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Providers"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Add Provider", onAction: () => {} }}
            >
              <p>
                Manage data sources — CSV uploads, API integrations, and FTP
                imports.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
