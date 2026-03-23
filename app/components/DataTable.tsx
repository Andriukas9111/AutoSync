/**
 * DataTable compatibility shim for Polaris v13+
 * Polaris removed DataTable in v13. This provides the same API
 * using a simple HTML table with Polaris-like styling.
 */

import { Text } from "@shopify/polaris";

interface DataTableProps {
  columnContentTypes: ("text" | "numeric")[];
  headings: string[];
  rows: (string | number | React.ReactNode)[][];
  totals?: (string | number | "")[];
  footerContent?: React.ReactNode;
}

export function DataTable({ columnContentTypes, headings, rows, totals, footerContent }: DataTableProps) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--p-color-border-secondary)" }}>
            {headings.map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: columnContentTypes[i] === "numeric" ? "right" : "left",
                  padding: "8px 12px",
                  whiteSpace: "nowrap",
                }}
              >
                <Text as="span" variant="bodySm" fontWeight="semibold">{h}</Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              style={{
                borderBottom: "1px solid var(--p-color-border-secondary)",
              }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{
                    textAlign: columnContentTypes[ci] === "numeric" ? "right" : "left",
                    padding: "8px 12px",
                  }}
                >
                  {typeof cell === "string" || typeof cell === "number" ? (
                    <Text as="span" variant="bodyMd">{String(cell)}</Text>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr style={{ borderTop: "2px solid var(--p-color-border-secondary)", fontWeight: 600 }}>
              {totals.map((t, i) => (
                <td
                  key={i}
                  style={{
                    textAlign: columnContentTypes[i] === "numeric" ? "right" : "left",
                    padding: "8px 12px",
                  }}
                >
                  {t !== "" && <Text as="span" variant="bodyMd" fontWeight="bold">{String(t)}</Text>}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {footerContent && <div style={{ padding: "8px 12px" }}>{footerContent}</div>}
    </div>
  );
}
