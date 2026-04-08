/**
 * Shared error response builder — consistent error format across all API routes.
 */

import { data } from "react-router";

export interface AppError {
  error: string;
  code?: string;
  field?: string;
  status: number;
}

/**
 * Create a consistent error response.
 * Usage: return apiError("Product not found", 404, "NOT_FOUND");
 */
export function apiError(message: string, status = 500, code?: string, field?: string) {
  return data(
    { error: message, code: code ?? undefined, field: field ?? undefined },
    { status },
  );
}

/**
 * Create a billing gate error response.
 */
export function billingError(feature: string, currentPlan: string, requiredPlan: string) {
  return data(
    {
      error: `This feature requires the ${requiredPlan} plan or higher.`,
      feature,
      currentPlan,
      requiredPlan,
    },
    { status: 403 },
  );
}

/**
 * Safe error message extraction.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unexpected error occurred";
}
