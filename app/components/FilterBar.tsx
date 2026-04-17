/**
 * FilterBar — Unified filter row used across every list page.
 *
 * Ensures the TextField + Search button + Select dropdowns share the same
 * height and dropdown styling app-wide. Each instance renders inside a
 * .as-filter-bar container (styled globally in app.tsx) so height/dropdown
 * fixes apply uniformly.
 *
 * Usage:
 *   <FilterBar
 *     searchValue={searchValue}
 *     onSearchChange={setSearchValue}
 *     onSearchSubmit={handleSubmit}
 *     onSearchClear={handleClear}
 *     placeholder="Search by title..."
 *     selects={[
 *       { label: "Status", value: status, options: STATUS_OPTIONS, onChange: setStatus, minWidth: 170 },
 *       { label: "Source", value: source, options: SOURCE_OPTIONS, onChange: setSource, minWidth: 150 },
 *     ]}
 *     onClearAll={hasActiveFilters ? resetFilters : undefined}
 *   />
 */
import {
  TextField,
  Select,
  Button,
  Icon,
  InlineStack,
  Card,
  BlockStack,
  Text,
} from "@shopify/polaris";
import { SearchIcon, FilterIcon } from "@shopify/polaris-icons";
import { IconBadge } from "./IconBadge";

export interface FilterBarSelect {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  minWidth?: number;
}

export interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onSearchClear?: () => void;
  placeholder?: string;
  selects?: FilterBarSelect[];
  onClearAll?: () => void;
  showHeader?: boolean;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  onSearchSubmit,
  onSearchClear,
  placeholder = "Search...",
  selects = [],
  onClearAll,
  showHeader = true,
}: FilterBarProps) {
  return (
    <Card padding="400">
      <BlockStack gap="400">
        {showHeader && (
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={FilterIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingMd">Filters</Text>
          </InlineStack>
        )}
        {/* .as-filter-bar ensures height + dropdown styling is consistent */}
        <div className="as-filter-bar">
          <InlineStack gap="300" align="start" blockAlign="center" wrap>
            {/* Search: TextField + connected Search button share the same height
                via Polaris's connectedRight slot, so the button stretches to the
                field's height instead of rendering shorter. */}
            <div style={{ flexGrow: 1, maxWidth: "400px", minWidth: "240px" }}>
              <TextField
                label="Search"
                labelHidden
                value={searchValue}
                onChange={onSearchChange}
                placeholder={placeholder}
                clearButton
                onClearButtonClick={onSearchClear ?? (() => onSearchChange(""))}
                autoComplete="off"
                onBlur={onSearchSubmit}
                prefix={<Icon source={SearchIcon} />}
                connectedRight={
                  <Button onClick={onSearchSubmit} variant="primary">
                    Search
                  </Button>
                }
              />
            </div>
            {selects.map((s, i) => (
              <div key={i} style={{ minWidth: `${s.minWidth ?? 160}px` }}>
                <Select
                  label={s.label}
                  labelHidden
                  options={s.options}
                  value={s.value}
                  onChange={s.onChange}
                />
              </div>
            ))}
            {onClearAll && (
              <Button onClick={onClearAll} variant="plain">
                Clear all
              </Button>
            )}
          </InlineStack>
        </div>
      </BlockStack>
    </Card>
  );
}
