// Compatibility shim: pending OAuth state now lives in the database,
// keyed by the opaque `state` value. This module exports no-op cookie
// helpers so any lingering imports fail loudly.

export function clearPendingAuthCookie(): void {
  /* no-op: pending auth is DB-backed */
}
