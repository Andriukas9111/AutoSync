import { useRouteError, isRouteErrorResponse } from "react-router";
import { Page, Card, BlockStack, Text, Button, Banner } from "@shopify/polaris";

/**
 * Reusable error boundary for individual routes.
 * Shows a user-friendly error message within the app layout.
 */
export function RouteError({ pageName }: { pageName: string }) {
  const error = useRouteError();
  const isResponse = isRouteErrorResponse(error);

  const title = isResponse
    ? `${pageName} — ${error.status === 404 ? "Not Found" : "Error"}`
    : `${pageName} — Something went wrong`;

  const message = isResponse
    ? error.status === 404
      ? "The page you're looking for doesn't exist or has been moved."
      : `Server returned ${error.status}: ${error.statusText || "Unknown error"}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred. Please try again.";

  return (
    <Page title={title} backAction={{ url: "/app" }}>
      <Card>
        <BlockStack gap="400">
          <Banner tone="critical">
            <p>{message}</p>
          </Banner>
          <Text as="p" variant="bodySm" tone="subdued">
            If this problem persists, please contact support.
          </Text>
          <Button onClick={() => window.location.reload()}>Reload Page</Button>
        </BlockStack>
      </Card>
    </Page>
  );
}
