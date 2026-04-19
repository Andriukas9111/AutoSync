/**
 * FilterBar — Unified filter row used across every list page.
 *
 * Ensures the TextField + Search button + dropdowns share the same height
 * and dropdown styling app-wide. Each instance renders inside a
 * .as-filter-bar container (styled globally in app.tsx) so height/dropdown
 * fixes apply uniformly.
 *
 * DROPDOWN CONSISTENCY RULE — matches VehicleSelector (manual mapping):
 *   - short list (≤10 options) → plain Polaris <Select>
 *   - long list  (>10 options) → type-ahead Combobox+Listbox
 * Callers can force the Combobox form by passing `searchable: true` even
 * when options are short (e.g., 8-item provider filters that will grow).
 * The switch happens automatically based on options.length when you don't
 * override, so dropdowns across the app stay consistent with the manual-
 * mapping experience without each caller having to know which widget to use.
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
 *       { label: "Provider", value: provider, options: providerOptions, onChange: setProvider, searchable: true },
 *     ]}
 *     onClearAll={hasActiveFilters ? resetFilters : undefined}
 *   />
 */
import { useMemo, useState, useCallback } from "react";
import {
  TextField,
  Select,
  Button,
  Icon,
  InlineStack,
  Card,
  BlockStack,
  Text,
  Combobox,
  Listbox,
} from "@shopify/polaris";
import { SearchIcon, FilterIcon } from "@shopify/polaris-icons";
import { IconBadge } from "./IconBadge";

export interface FilterBarSelect {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  minWidth?: number;
  /** Force the searchable Combobox form. Defaults to true when options.length > 10. */
  searchable?: boolean;
}

const SEARCHABLE_THRESHOLD = 10;

/**
 * Renders a single filter dropdown, auto-upgrading to a searchable Combobox
 * when the option list is long enough that scrolling becomes painful.
 * Uses the same Combobox/Listbox pattern as VehicleSelector so the app-wide
 * dropdown experience stays uniform.
 */
function FilterSelect({ s }: { s: FilterBarSelect }) {
  const shouldSearch = s.searchable ?? s.options.length > SEARCHABLE_THRESHOLD;

  if (!shouldSearch) {
    return (
      <div style={{ minWidth: `${s.minWidth ?? 160}px` }}>
        <Select
          label={s.label}
          labelHidden
          options={s.options}
          value={s.value}
          onChange={s.onChange}
        />
      </div>
    );
  }

  return <SearchableFilter s={s} />;
}

function SearchableFilter({ s }: { s: FilterBarSelect }) {
  const [input, setInput] = useState("");
  const currentLabel = useMemo(
    () => s.options.find((o) => o.value === s.value)?.label ?? "",
    [s.options, s.value],
  );

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return s.options;
    return s.options.filter((o) => o.label.toLowerCase().includes(q));
  }, [input, s.options]);

  const handleSelect = useCallback((val: string) => {
    s.onChange(val);
    setInput("");
  }, [s]);

  return (
    <div style={{ minWidth: `${s.minWidth ?? 200}px` }}>
      <Combobox
        activator={
          <Combobox.TextField
            label={s.label}
            labelHidden
            value={input || currentLabel}
            placeholder={s.label}
            onChange={setInput}
            onFocus={() => setInput("")}
            prefix={<Icon source={SearchIcon} />}
            autoComplete="off"
          />
        }
      >
        {filtered.length > 0 ? (
          <Listbox onSelect={handleSelect}>
            {filtered.slice(0, 200).map((o) => (
              <Listbox.Option key={o.value} value={o.value} selected={o.value === s.value}>
                {o.label}
              </Listbox.Option>
            ))}
          </Listbox>
        ) : (
          <div style={{ padding: "8px 12px" }}>
            <Text as="p" variant="bodySm" tone="subdued">No matches</Text>
          </div>
        )}
      </Combobox>
    </div>
  );
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
              <FilterSelect key={i} s={s} />
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
