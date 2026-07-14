// Allowlisted, browser-safe error categories.
// No raw exception text, provider bodies, URLs, tokens, or codes may
// ever be added to a category or leaked past this module.

export const ERROR_CATEGORIES = [
  "access_denied",
  "missing_code_or_state",
  "state_expired",
  "state_mismatch",
  "missing_registration",
  "discovery_failed",
  "token_exchange_failed",
  "mcp_initialize_failed",
  "mcp_initialized_notification_failed",
  "mcp_tools_list_failed",
  "needs_reauth",
  "missing_configuration",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export function isErrorCategory(v: unknown): v is ErrorCategory {
  return typeof v === "string" && (ERROR_CATEGORIES as readonly string[]).includes(v);
}

/**
 * Typed exception carrying only an allowlisted category.
 * Its `message` intentionally equals the category — never a raw provider string.
 */
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
  // Intentionally no error message, no stack, no URL, no body.
  if (httpStatus !== undefined) {
    console.warn(`[n8n-oauth] ${where}: ${category} (status=${httpStatus})`);
  } else {
    console.warn(`[n8n-oauth] ${where}: ${category}`);
  }
}
