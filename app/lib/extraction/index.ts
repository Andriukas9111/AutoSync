/**
 * Extraction Engine — public API exports.
 *
 * V3 port of the V1 extraction engine. Removes V1-specific modules
 * (learning.ts, enrich.ts, ymme-model-index.ts) that don't exist in V3.
 */

// ── Pattern-based extraction (fast regex, no DB) ─────────────
export {
  extractVehiclePatterns,
  extractWheelPatterns,
  MODEL_PATTERNS,
} from "./patterns"
export type {
  VehicleExtractionResult,
  WheelExtractionResult,
  VehicleFitmentEntry,
  WheelFitmentData,
} from "./patterns"

// ── YMME In-Memory Index ─────────────────────────────────────
export { getYmmeIndex, invalidateYmmeIndex } from "./ymme-index"
export type {
  YmmeIndex,
  YmmeIndexMake,
  YmmeIndexModel,
  YmmeIndexEngine,
} from "./ymme-index"

// ── YMME Text Scanner (4-pass) ───────────────────────────────
export { scanTextForVehicles } from "./ymme-scanner"
export type { VehicleMention, ScanResult } from "./ymme-scanner"

// ── Multi-Signal Extractor ───────────────────────────────────
export { extractAllSignals } from "./signal-extractor"
export type {
  SignalSource,
  ExtractionSignal,
  MultiSignalResult,
} from "./signal-extractor"

// ── Signal Fuser ─────────────────────────────────────────────
export { fuseSignals } from "./signal-fuser"
export type { FusedFitment, FusionResult } from "./signal-fuser"

// ── YMME Resolver (structured CSV data) ──────────────────────
export {
  resolveStructuredFitment,
  resolveStructuredFitments,
} from "./ymme-resolver"
export type {
  StructuredFitmentInput,
  ResolvedFitment,
} from "./ymme-resolver"

// ── YMME-First Extraction V2 (orchestrator) ──────────────────
export { extractFitmentDataV2 } from "./ymme-extract"
export type {
  ExtractV2Input,
  ExtractV2Result,
  ExtractionResultV2,
  FitmentRowFields,
} from "./ymme-extract"

// ── Engine Display Format System ────────────────────────────
export {
  formatEngineDisplay,
  formatEngineDisplayBatch,
  extractEngineHints,
  scoreEngineMatch,
  ENGINE_FORMAT_PRESETS,
  DEFAULT_ENGINE_FORMAT,
} from "../engine-format"
export type {
  EngineDisplayData,
  EngineFormatPreset,
  EngineHint,
} from "../engine-format"
