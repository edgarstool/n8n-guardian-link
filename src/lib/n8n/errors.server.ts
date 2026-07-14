// Server-only helpers around the isomorphic ErrorCategory type.
// No raw exception text, provider bodies, URLs, tokens, or codes may leak past this module.

import { ERROR_CATEGORIES, type ErrorCategory, isErrorCategory } from "./errors";

export { ERROR_CATEGORIES, isErrorCategory };
export type { ErrorCategory };

export class CategorizedError extends Error {
  readonly category: ErrorCategory;
  readonly httpStatus?: number;
  constructor(category: ErrorCategory, httpStatus?: number) {
    super(category);
    this.name = "CategorizedError";
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

export function toCategory(err: unknown, fallback: ErrorCategory): ErrorCategory {
  if (err instanceof CategorizedError) return err.category;
  return fallback;
}

/** Server-side log helper: sanitized category + optional HTTP status only. */
export function logCategory(
  where: string,
  category: ErrorCategory,
  httpStatus?: number,
): void {
  if (httpStatus !== undefined) {
    console.warn(`[n8n-oauth] ${where}: ${category} (status=${httpStatus})`);
  } else {
    console.warn(`[n8n-oauth] ${where}: ${category}`);
  }
}
