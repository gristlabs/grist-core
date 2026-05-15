import { isAffirmative } from "app/common/gutil";
import { matchesBaseDomain } from "app/server/lib/requestUtils";

/**
 * Helpers for the user-triggered outgoing-request surface: the REQUEST()
 * formula function and webhooks. Consolidated here so runtime callers and
 * the admin boot probe read the same env vars in the same way.
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

export function getAllowedWebhookDomains(): string[] {
  return (process.env.ALLOWED_WEBHOOK_DOMAINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
}

export function isAllowedWebhookWildcard(): boolean {
  return process.env.ALLOWED_WEBHOOK_DOMAINS === "*";
}

/**
 * Whether `urlString` is an allowed webhook target under the current
 * ALLOWED_WEBHOOK_DOMAINS setting. http is only accepted for localhost so
 * tests can run against a local fixture without a certificate.
 */
export function isUrlAllowed(urlString: string): boolean {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch (e) {
    return false;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }

  if (isAllowedWebhookWildcard()) {
    return true;
  }

  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    return false;
  }

  return getAllowedWebhookDomains().some(domain => matchesBaseDomain(url.host, domain));
}
