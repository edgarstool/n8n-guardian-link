// Isomorphic: safe to import from both client and server code.
// Contains only the allowlisted error category strings — no logic, no secrets.

export const ERROR_CATEGORIES = [
  "access_denied",
  "missing_code_or_state",
  "state_expired",
  "state_mismatch",
  "missing_registration",
  "invalid_mcp_url",
  "discovery_failed",
  "token_exchange_failed",
  "mcp_initialize_failed",
  "mcp_initialized_notification_failed",
  "mcp_tools_list_failed",
  "needs_reauth",
  "missing_configuration",
  "mcp_tools_call_failed",
  "unauthorized",
  "invalid_request",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export function isErrorCategory(v: unknown): v is ErrorCategory {
  return typeof v === "string" && (ERROR_CATEGORIES as readonly string[]).includes(v);
}
