/**
 * Debug System — logging, health checks, and error tracking.
 *
 * Usage:
 *   import { log, logError, logWarn } from "../lib/debug";
 *   log("push", "Processing product", { id: "123", tags: 5 });
 *   logError("push", "Failed to push", error);
 */

const IS_DEV = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

type LogLevel = "info" | "warn" | "error" | "debug";

interface LogEntry {
  level: LogLevel;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

function formatLog(entry: LogEntry): string {
  const prefix = `[${entry.module}]`;
  const data = entry.data ? ` ${JSON.stringify(entry.data)}` : "";
  return `${prefix} ${entry.message}${data}`;
}

/**
 * Structured info log — visible in Vercel function logs
 */
export function log(module: string, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = { level: "info", module, message, data, timestamp: new Date().toISOString() };
  console.log(formatLog(entry));
}

/**
 * Structured warning log
 */
export function logWarn(module: string, message: string, data?: Record<string, unknown>) {
  const entry: LogEntry = { level: "warn", module, message, data, timestamp: new Date().toISOString() };
  console.warn(formatLog(entry));
}

/**
 * Structured error log — extracts message from Error objects
 */
export function logError(module: string, message: string, error?: unknown, data?: Record<string, unknown>) {
  const errorMsg = error instanceof Error ? error.message : String(error ?? "");
  const entry: LogEntry = {
    level: "error",
    module,
    message: `${message}${errorMsg ? `: ${errorMsg}` : ""}`,
    data,
    timestamp: new Date().toISOString(),
  };
  console.error(formatLog(entry));
}

/**
 * Debug log — only visible in development
 */
export function logDebug(module: string, message: string, data?: Record<string, unknown>) {
  if (!IS_DEV) return;
  const entry: LogEntry = { level: "debug", module, message, data, timestamp: new Date().toISOString() };
  console.debug(formatLog(entry));
}

/**
 * Measure execution time of an async operation
 */
export async function measureTime<T>(
  module: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    log(module, `${operation} completed`, { elapsedMs: elapsed });
    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    logError(module, `${operation} failed after ${elapsed}ms`, error);
    throw error;
  }
}
