import { isAffirmative } from "app/common/gutil";

/**
 * Helpers for the user-triggered outgoing-request surface: the REQUEST()
 * formula function and webhooks. Consolidated here so runtime callers and
 * the admin boot probe read the same env vars in the same way.
 *
 * Whether a specific URL is an allowed webhook target lives in
 * requestUtils.isUrlAllowed() / Triggers.isWebhookUrlAllowed().
 */

/**
 * Env vars that configure the outgoing-request surface. Tests scrub these
 * to start from a known state; if you add a new knob to the probe, add it
 * here so tests stay deterministic.
 */
export const OUTGOING_REQUEST_ENV_VARS = [
  "GRIST_ENABLE_REQUEST_FUNCTION",
  "ALLOWED_WEBHOOK_DOMAINS",
  "GRIST_PROXY_FOR_UNTRUSTED_URLS",
  "GRIST_HTTPS_PROXY",
  "HTTPS_PROXY",
  "https_proxy",
];

export function isRequestFunctionEnabled(): boolean {
  return isAffirmative(process.env.GRIST_ENABLE_REQUEST_FUNCTION);
}

export function isAllowedWebhookWildcard(): boolean {
  return process.env.ALLOWED_WEBHOOK_DOMAINS === "*";
}

/**
 * The explicitly-listed webhook domains. The "*" wildcard is reported
 * separately by isAllowedWebhookWildcard(), so this returns [] for it
 * rather than treating "*" as a literal domain.
 */
export function getAllowedWebhookDomains(): string[] {
  if (isAllowedWebhookWildcard()) { return []; }
  return (process.env.ALLOWED_WEBHOOK_DOMAINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
}
