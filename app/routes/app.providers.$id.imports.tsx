/**
 * Provider Import History — list of all imports for a provider
 */

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  EmptyState,
  Box,
  Pagination,
} from "@shopify/polaris";

import { ClockIcon } from "@shopify/polaris-icons";
import { IconBadge } from "../components/IconBadge";

import { authenticate } from "../shopify.server";
import { formatDate } from "../lib/design";
import db from "../lib/db.server";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

const STATUS_TONES: Record<string, "info" | "success" | "warning" | "critical" | undefined> = {
  pending: undefined,
  processing: "info",
  completed: "success",
  failed: "critical",
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;

  if (!providerId) {
    throw new Response("Provider ID required", { status: 400 });
  }

  const { data: provider } = await db
    .from("providers")
    .select("id, name")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!provider) {
    throw new Response("Provider not found", { status: 404 });
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;

  const { data: imports, count } = await db
    .from("provider_imports")
    .select("id, file_name, file_type, total_rows, imported_rows, skipped_rows, duplicate_rows, error_rows, status, created_at, completed_at", { count: "exact" })
    .eq("shop_id", shopId)
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const totalImports = count ?? 0;
  const totalPages = Math.ceil(totalImports / PAGE_SIZE);

  return {
    provider,
    imports: imports ?? [],
    totalImports,
    totalPages,
    currentPage: page,
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProviderImportHistory() {
  const { provider, imports, totalImports, totalPages, currentPage } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  function formatDuration(start: string | null, end: string | null): string {
    if (!start || !end) return "—";
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return "< 1s";
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m`;
  }

  return (
    <Page
      fullWidth
      title={`${provider.name} — Import History`}
      subtitle={`${totalImports} total imports`}
      backAction={{
        content: "Back to Provider",
        onAction: () => navigate(`/app/providers/${provider.id}`),
      }}
      primaryAction={{
        content: "New Import",
        onAction: () => navigate(`/app/providers/${provider.id}/import`),
      }}
    >
      <BlockStack gap="400">
        <InlineStack gap="200" blockAlign="center">
          <IconBadge icon={ClockIcon} color="var(--p-color-icon-emphasis)" />
          <Text as="h2" variant="headingMd">{`Import History (${totalImports})`}</Text>
        </InlineStack>
        {imports.length === 0 ? (
          <Card>
            <EmptyState
              heading="No imports yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Import Data",
                onAction: () => navigate(`/app/providers/${provider.id}/import`),
              }}
            >
              <p>Import products from a file to see your import history here.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "import", plural: "imports" }}
              itemCount={imports.length}
              headings={[
                { title: "Date" },
                { title: "File" },
                { title: "Format" },
                { title: "Total" },
                { title: "Imported" },
                { title: "Skipped" },
                { title: "Errors" },
                { title: "Duration" },
                { title: "Status" },
              ]}
              selectable={false}
            >
              {imports.map((imp: Record<string, unknown>, index: number) => {
                const id = imp.id as string;
                const statusTone = STATUS_TONES[(imp.status as string) ?? "pending"];

                return (
                  <IndexTable.Row
                    id={id}
                    key={id}
                    position={index}
                    onClick={() =>
                      navigate(
                        `/app/providers/${provider.id}/imports/${id}`,
                      )
                    }
                  >
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">
                        {formatDate(imp.created_at as string)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {(imp.file_name as string) || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge>
                        {((imp.file_type as string) || "unknown").toUpperCase()}
                      </Badge>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">
                        {String(imp.total_rows ?? 0)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="success">
                        {String(imp.imported_rows ?? 0)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {String(imp.skipped_rows ?? 0)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text
                        as="span"
                        variant="bodySm"
                        tone={
                          (imp.error_rows as number) > 0
                            ? "critical"
                            : "subdued"
                        }
                      >
                        {String(imp.error_rows ?? 0)}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {formatDuration(
                          imp.created_at as string,
                          imp.completed_at as string,
                        )}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Badge tone={statusTone}>
                        {((imp.status as string) ?? "pending").charAt(0).toUpperCase() +
                          ((imp.status as string) ?? "pending").slice(1)}
                      </Badge>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </Card>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <Box paddingBlock="400">
            <InlineStack align="center" gap="400">
              <Pagination
                hasPrevious={currentPage > 1}
                hasNext={currentPage < totalPages}
                onPrevious={() =>
                  navigate(
                    `/app/providers/${provider.id}/imports?page=${currentPage - 1}`,
                  )
                }
                onNext={() =>
                  navigate(
                    `/app/providers/${provider.id}/imports?page=${currentPage + 1}`,
                  )
                }
              />
              <Text as="span" variant="bodySm" tone="subdued">
                {`Page ${currentPage} of ${totalPages}`}
              </Text>
            </InlineStack>
          </Box>
        )}
      </BlockStack>
    </Page>
  );
}
