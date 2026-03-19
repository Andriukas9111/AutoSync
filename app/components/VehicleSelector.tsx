import { useCallback, useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { BlockStack, Button, InlineStack, Select } from "@shopify/polaris";

// ── Types ────────────────────────────────────────────────────────────────────

export interface VehicleSelection {
  makeId: string;
  makeName: string;
  modelId: string;
  modelName: string;
  year: number | null;
  engineId: string | null;
  engineName: string | null;
}

interface Make {
  id: string;
  name: string;
  country: string | null;
  logo_url: string | null;
}

interface Model {
  id: string;
  name: string;
  generation: string | null;
  year_from: number;
  year_to: number | null;
  body_type: string | null;
}

interface Engine {
  id: string;
  code: string | null;
  name: string;
  displacement_cc: number | null;
  fuel_type: string | null;
  power_hp: number | null;
  power_kw: number | null;
  torque_nm: number | null;
  year_from: number;
  year_to: number | null;
  cylinders: number | null;
  cylinder_config: string | null;
  aspiration: string | null;
  modification: string | null;
}

interface VehicleSelectorProps {
  /** Fires when all required fields (make + model) are filled. */
  onChange: (selection: VehicleSelection) => void;
  /** Pre-populate for editing an existing fitment. */
  initialSelection?: Partial<VehicleSelection>;
  /** Compact inline layout (vs. vertical stacked). */
  compact?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function VehicleSelector({
  onChange,
  initialSelection,
  compact = false,
}: VehicleSelectorProps) {
  // Fetchers for each cascading level
  const makesFetcher = useFetcher<{ makes?: Make[] }>();
  const modelsFetcher = useFetcher<{ models?: Model[] }>();
  const yearsFetcher = useFetcher<{ years?: number[] }>();
  const enginesFetcher = useFetcher<{ engines?: Engine[] }>();

  // Selected values
  const [selectedMakeId, setSelectedMakeId] = useState(
    initialSelection?.makeId ?? "",
  );
  const [selectedModelId, setSelectedModelId] = useState(
    initialSelection?.modelId ?? "",
  );
  const [selectedYear, setSelectedYear] = useState<string>(
    initialSelection?.year != null ? String(initialSelection.year) : "",
  );
  const [selectedEngineId, setSelectedEngineId] = useState(
    initialSelection?.engineId ?? "",
  );

  // ── Load makes on mount ──────────────────────────────────────────────────

  useEffect(() => {
    if (makesFetcher.state === "idle" && !makesFetcher.data) {
      makesFetcher.load("/app/api/ymme?level=makes");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load initial cascade when initialSelection is provided ───────────────

  useEffect(() => {
    if (initialSelection?.makeId && makesFetcher.data) {
      modelsFetcher.load(
        `/app/api/ymme?level=models&make_id=${initialSelection.makeId}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelection?.makeId, makesFetcher.data]);

  useEffect(() => {
    if (initialSelection?.modelId && modelsFetcher.data) {
      yearsFetcher.load(
        `/app/api/ymme?level=years&model_id=${initialSelection.modelId}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelection?.modelId, modelsFetcher.data]);

  useEffect(() => {
    if (initialSelection?.modelId && yearsFetcher.data) {
      const yearParam = initialSelection.year
        ? `&year=${initialSelection.year}`
        : "";
      enginesFetcher.load(
        `/app/api/ymme?level=engines&model_id=${initialSelection.modelId}${yearParam}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelection?.modelId, initialSelection?.year, yearsFetcher.data]);

  // ── Derived option lists ─────────────────────────────────────────────────

  const makes = makesFetcher.data?.makes ?? [];
  const models = modelsFetcher.data?.models ?? [];
  const years = yearsFetcher.data?.years ?? [];
  const engines = enginesFetcher.data?.engines ?? [];

  const makeOptions = useMemo(
    () => [
      { label: "Select make...", value: "" },
      ...makes.map((m) => ({ label: m.name, value: m.id })),
    ],
    [makes],
  );

  const modelOptions = useMemo(
    () => [
      { label: "Select model...", value: "" },
      ...models.map((m) => {
        const yearRange =
          m.year_from && m.year_to
            ? ` (${m.year_from}–${m.year_to})`
            : m.year_from
              ? ` (${m.year_from}+)`
              : "";
        const gen = m.generation ? ` ${m.generation}` : "";
        return { label: `${m.name}${gen}${yearRange}`, value: m.id };
      }),
    ],
    [models],
  );

  const yearOptions = useMemo(
    () => [
      { label: "Select year...", value: "" },
      ...years.map((y) => ({ label: String(y), value: String(y) })),
    ],
    [years],
  );

  const engineOptions = useMemo(
    () => [
      { label: "Select engine...", value: "" },
      ...engines.map((e) => {
        const name = e.name || "Unknown Engine";
        const parts = [name];
        if (e.fuel_type) parts.push(e.fuel_type);
        if (e.power_hp) parts.push(`${String(e.power_hp)}hp`);
        return { label: parts.join(" \u2014 "), value: e.id };
      }),
    ],
    [engines],
  );

  // ── Helpers ──────────────────────────────────────────────────────────────

  const findMakeName = useCallback(
    (id: string) => makes.find((m) => m.id === id)?.name ?? "",
    [makes],
  );

  const findModelName = useCallback(
    (id: string) => {
      const m = models.find((mod) => mod.id === id);
      if (!m) return "";
      return m.generation ? `${m.name} ${m.generation}` : m.name;
    },
    [models],
  );

  const findEngineName = useCallback(
    (id: string) => engines.find((e) => e.id === id)?.name ?? null,
    [engines],
  );

  const emitChange = useCallback(
    (
      makeId: string,
      modelId: string,
      year: string,
      engineId: string,
    ) => {
      if (makeId && modelId) {
        onChange({
          makeId,
          makeName: findMakeName(makeId),
          modelId,
          modelName: findModelName(modelId),
          year: year ? parseInt(year, 10) : null,
          engineId: engineId || null,
          engineName: engineId ? findEngineName(engineId) : null,
        });
      }
    },
    [onChange, findMakeName, findModelName, findEngineName],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleMakeChange = useCallback(
    (value: string) => {
      setSelectedMakeId(value);
      setSelectedModelId("");
      setSelectedYear("");
      setSelectedEngineId("");

      if (value) {
        modelsFetcher.load(`/app/api/ymme?level=models&make_id=${value}`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      setSelectedModelId(value);
      setSelectedYear("");
      setSelectedEngineId("");

      if (value) {
        yearsFetcher.load(`/app/api/ymme?level=years&model_id=${value}`);
        emitChange(selectedMakeId, value, "", "");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMakeId, emitChange],
  );

  const handleYearChange = useCallback(
    (value: string) => {
      setSelectedYear(value);
      setSelectedEngineId("");

      if (value) {
        enginesFetcher.load(
          `/app/api/ymme?level=engines&model_id=${selectedModelId}&year=${value}`,
        );
      }
      emitChange(selectedMakeId, selectedModelId, value, "");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedMakeId, selectedModelId, emitChange],
  );

  const handleEngineChange = useCallback(
    (value: string) => {
      setSelectedEngineId(value);
      emitChange(selectedMakeId, selectedModelId, selectedYear, value);
    },
    [selectedMakeId, selectedModelId, selectedYear, emitChange],
  );

  const handleClear = useCallback(() => {
    setSelectedMakeId("");
    setSelectedModelId("");
    setSelectedYear("");
    setSelectedEngineId("");
  }, []);

  // ── Loading states ───────────────────────────────────────────────────────

  const makesLoading = makesFetcher.state === "loading";
  const modelsLoading = modelsFetcher.state === "loading";
  const yearsLoading = yearsFetcher.state === "loading";
  const enginesLoading = enginesFetcher.state === "loading";

  // ── Render ───────────────────────────────────────────────────────────────

  const selects = (
    <>
      <Select
        label="Make"
        options={makeOptions}
        value={selectedMakeId}
        onChange={handleMakeChange}
        disabled={makesLoading}
        placeholder={makesLoading ? "Loading makes..." : undefined}
      />
      <Select
        label="Model"
        options={modelOptions}
        value={selectedModelId}
        onChange={handleModelChange}
        disabled={!selectedMakeId || modelsLoading}
        placeholder={modelsLoading ? "Loading models..." : undefined}
      />
      <Select
        label="Year"
        options={yearOptions}
        value={selectedYear}
        onChange={handleYearChange}
        disabled={!selectedModelId || yearsLoading}
        placeholder={yearsLoading ? "Loading years..." : undefined}
      />
      <Select
        label="Engine"
        options={engineOptions}
        value={selectedEngineId}
        onChange={handleEngineChange}
        disabled={!selectedModelId || enginesLoading}
        placeholder={enginesLoading ? "Loading engines..." : undefined}
      />
    </>
  );

  const hasSelection = selectedMakeId !== "";

  if (compact) {
    return (
      <InlineStack gap="300" align="start" blockAlign="end" wrap>
        {selects}
        {hasSelection && (
          <Button onClick={handleClear} variant="plain">
            Clear
          </Button>
        )}
      </InlineStack>
    );
  }

  return (
    <BlockStack gap="300">
      {selects}
      {hasSelection && (
        <InlineStack align="end">
          <Button onClick={handleClear} variant="plain">
            Clear selection
          </Button>
        </InlineStack>
      )}
    </BlockStack>
  );
}
