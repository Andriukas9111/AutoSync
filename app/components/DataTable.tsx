/**
 * DataTable compatibility shim for Polaris v13+
 * Polaris removed DataTable in v13. This provides the same API
 * using a simple HTML table with Polaris-like styling.
 */

import { Text } from "@shopify/polaris";
import {
  dataTableWrapStyle,
  dataTableStyle,
  dataTableHeaderRowStyle,
  dataTableCellStyle,
  dataTableFooterRowStyle,
  dataTableFooterStyle,
} from "../lib/design";

interface DataTableProps {
  columnContentTypes: ("text" | "numeric")[];
  headings: string[];
  rows: (string | number | React.ReactNode)[][];
  totals?: (string | number | "")[];
  footerContent?: React.ReactNode;
}

export function DataTable({ columnContentTypes, headings, rows, totals, footerContent }: DataTableProps) {
  return (
    <div style={dataTableWrapStyle}>
      <table style={dataTableStyle}>
        <thead>
          <tr style={dataTableHeaderRowStyle}>
            {headings.map((h, i) => (
              <th
                key={i}
                style={{
                  ...dataTableCellStyle,
                  textAlign: columnContentTypes[i] === "numeric" ? "right" : "left",
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
                    ...dataTableCellStyle,
                    textAlign: columnContentTypes[ci] === "numeric" ? "right" : "left",
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
            <tr style={dataTableFooterRowStyle}>
              {totals.map((t, i) => (
                <td
                  key={i}
                  style={{
                    ...dataTableCellStyle,
                    textAlign: columnContentTypes[i] === "numeric" ? "right" : "left",
                  }}
                >
                  {t !== "" && <Text as="span" variant="bodyMd" fontWeight="bold">{String(t)}</Text>}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {footerContent && <div style={dataTableFooterStyle}>{footerContent}</div>}
    </div>
  );
}
