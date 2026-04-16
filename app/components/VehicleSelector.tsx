import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { BlockStack, Button, InlineStack, Combobox, Listbox, Text, Icon } from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VehicleSelection {
  makeId: string;
  makeName: string;
  modelId: string;
  modelName: string;
  year: number | null;
  engineId: string | null;
  engineName: string | null;
  engineYearFrom: number | null;
  engineYearTo: number | null;
  /** Engine details from YMME — stored alongside fitment for consistent display */
  engineCode: string | null;
  fuelType: string | null;
}

interface Make { id: string; name: string; country: string | null; logo_url: string | null; }
interface Model { id: string; name: string; generation: string | null; year_from: number; year_to: number | null; body_type: string | null; }
interface Engine { id: string; code: string | null; name: string; displacement_cc: number | null; fuel_type: string | null; power_hp: number | null; year_from: number; year_to: number | null; aspiration: string | null; }

interface VehicleSelectorProps {
  onChange: (selection: VehicleSelection) => void;
  initialSelection?: Partial<VehicleSelection>;
}

// ── Searchable Combobox ─────────────────────────────────────────────────────

function SearchableDropdown({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
  loading,
}: {
  label: string;
  placeholder: string;
  options: Array<{ id: string; label: string; sublabel?: string; searchText: string; icon?: string }>;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [inputValue, setInputValue] = useState("");

  const filtered = useMemo(() => {
    if (!inputValue) return options;
    const lower = inputValue.toLowerCase();
    return options.filter((o) => o.searchText.toLowerCase().includes(lower));
  }, [options, inputValue]);

  const handleSelect = useCallback((selected: string) => {
    const match = options.find((o) => o.id === selected);
    if (match) { setInputValue(match.label); onChange(selected); }
  }, [options, onChange]);

  useEffect(() => {
    if (!value) setInputValue("");
    else { const m = options.find((o) => o.id === value); if (m) setInputValue(m.label); }
  }, [value, options]);

  return (
    <Combobox
      activator={
        <Combobox.TextField
          label={label}
          value={inputValue}
          onChange={setInputValue}
          placeholder={loading ? "Loading..." : placeholder}
          disabled={disabled || loading}
          autoComplete="off"
          prefix={<Icon source={SearchIcon} />}
        />
      }
      onScrolledToBottom={() => {}}
    >
      {filtered.length > 0 ? (
        <Listbox onSelect={handleSelect}>
          {filtered.map((opt) => (
            <Listbox.Option key={opt.id} value={opt.id} selected={opt.id === value} accessibilityLabel={opt.label}>
              <Listbox.TextOption selected={opt.id === value}>
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  {opt.icon && (
                    <img src={opt.icon} alt="" style={{ width: 24, height: 24, objectFit: "contain", flexShrink: 0 }} />
                  )}
                  <span>{opt.label}</span>
                  {opt.sublabel && (
                    <span style={{ color: "var(--p-color-text-secondary)", fontSize: "12px" }}>{opt.sublabel}</span>
                  )}
                </InlineStack>
              </Listbox.TextOption>
            </Listbox.Option>
          ))}
        </Listbox>
      ) : (
        <Listbox onSelect={() => {}}>
          <Listbox.Action value="empty">
            {inputValue ? `No results for "${inputValue}"` : "Type to search..."}
          </Listbox.Action>
        </Listbox>
      )}
    </Combobox>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function VehicleSelector({ onChange, initialSelection }: VehicleSelectorProps) {
  const makesFetcher = useFetcher<{ makes?: Make[] }>();
  const modelsFetcher = useFetcher<{ models?: Model[] }>();
  const enginesFetcher = useFetcher<{ engines?: Engine[] }>();

  const [selectedMakeId, setSelectedMakeId] = useState(initialSelection?.makeId ?? "");
  const [selectedModelId, setSelectedModelId] = useState(initialSelection?.modelId ?? "");
  const [selectedEngineId, setSelectedEngineId] = useState(initialSelection?.engineId ?? "");

  // Load makes on mount
  useEffect(() => {
    if (makesFetcher.state === "idle" && !makesFetcher.data) makesFetcher.load("/app/api/ymme?level=makes");
  }, []); // eslint-disable-line

  // Load cascade for initial selection
  useEffect(() => {
    if (initialSelection?.makeId && makesFetcher.data) modelsFetcher.load(`/app/api/ymme?level=models&make_id=${initialSelection.makeId}`);
  }, [initialSelection?.makeId, makesFetcher.data]); // eslint-disable-line
  useEffect(() => {
    if (initialSelection?.modelId && modelsFetcher.data) enginesFetcher.load(`/app/api/ymme?level=engines&model_id=${initialSelection.modelId}`);
  }, [initialSelection?.modelId, modelsFetcher.data]); // eslint-disable-line

  const makes = makesFetcher.data?.makes ?? [];
  const models = modelsFetcher.data?.models ?? [];
  const engines = enginesFetcher.data?.engines ?? [];

  // ── Options ──────────────────────────────────────────────────────────────

  const makeOptions = useMemo(() => makes.map((m) => ({
    id: m.id,
    label: m.name,
    sublabel: m.country ?? undefined,
    searchText: `${m.name} ${m.country ?? ""}`,
    icon: m.logo_url ?? undefined,
  })), [makes]);

  const modelOptions = useMemo(() => models.map((m) => {
    const yr = m.year_from && m.year_to ? `${m.year_from}–${m.year_to}` : m.year_from ? `${m.year_from}+` : "";
    const gen = m.generation && !m.generation.includes(" | ") && !m.generation.startsWith(m.name) ? m.generation : "";
    const parts = [m.name, gen, yr].filter(Boolean);
    return {
      id: m.id,
      label: parts.join(" · "),
      sublabel: m.body_type ?? undefined,
      searchText: `${m.name} ${gen} ${m.body_type ?? ""}`,
    };
  }), [models]);

  const engineOptions = useMemo(() => engines.map((e) => {
    const parts = [e.name];
    if (e.fuel_type) parts.push(e.fuel_type);
    if (e.power_hp) parts.push(`${e.power_hp}hp`);
    const yr = e.year_from && e.year_to ? `${e.year_from}–${e.year_to}` : e.year_from ? `${e.year_from}+` : "";
    return {
      id: e.id,
      label: parts.join(" — "),
      sublabel: yr || undefined,
      searchText: `${e.name} ${e.code ?? ""} ${e.fuel_type ?? ""}`,
    };
  }), [engines]);

  // ── Emit selection ───────────────────────────────────────────────────────

  const emitChange = useCallback((makeId: string, modelId: string, engineId: string) => {
    if (!makeId || !modelId) return;
    const make = makes.find((m) => m.id === makeId);
    const model = models.find((m) => m.id === modelId);
    const engine = engineId ? engines.find((e) => e.id === engineId) : null;
    onChange({
      makeId, makeName: make?.name ?? "",
      modelId, modelName: model?.name ?? "",
      year: engine?.year_from ?? model?.year_from ?? null,
      engineId: engine?.id ?? null,
      engineName: engine?.name ?? null,
      engineYearFrom: engine?.year_from ?? model?.year_from ?? null,
      engineYearTo: engine?.year_to ?? model?.year_to ?? null,
      engineCode: engine?.code ?? null,
      fuelType: engine?.fuel_type ?? null,
    });
  }, [onChange, makes, models, engines]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleMakeChange = useCallback((v: string) => {
    setSelectedMakeId(v); setSelectedModelId(""); setSelectedEngineId("");
    if (v) modelsFetcher.load(`/app/api/ymme?level=models&make_id=${v}`);
  }, []); // eslint-disable-line

  const handleModelChange = useCallback((v: string) => {
    setSelectedModelId(v); setSelectedEngineId("");
    if (v) { enginesFetcher.load(`/app/api/ymme?level=engines&model_id=${v}`); emitChange(selectedMakeId, v, ""); }
  }, [selectedMakeId, emitChange]); // eslint-disable-line

  const handleEngineChange = useCallback((v: string) => {
    setSelectedEngineId(v);
    emitChange(selectedMakeId, selectedModelId, v);
  }, [selectedMakeId, selectedModelId, emitChange]);

  const handleClear = useCallback(() => {
    setSelectedMakeId(""); setSelectedModelId(""); setSelectedEngineId("");
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <BlockStack gap="300">
      <SearchableDropdown
        label="Make"
        placeholder="Search makes..."
        options={makeOptions}
        value={selectedMakeId}
        onChange={handleMakeChange}
        loading={makesFetcher.state === "loading"}
      />
      <SearchableDropdown
        label="Model"
        placeholder="Search models..."
        options={modelOptions}
        value={selectedModelId}
        onChange={handleModelChange}
        disabled={!selectedMakeId}
        loading={modelsFetcher.state === "loading"}
      />
      <SearchableDropdown
        label="Engine (optional)"
        placeholder="Search engines or skip..."
        options={engineOptions}
        value={selectedEngineId}
        onChange={handleEngineChange}
        disabled={!selectedModelId}
        loading={enginesFetcher.state === "loading"}
      />
      {selectedMakeId && (
        <InlineStack align="end">
          <Button onClick={handleClear} variant="plain">Clear selection</Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}
