// Special provider that uses default user, which effectively means no authentication.
export const MINIMAL_PROVIDER_KEY = "minimal";

// OpenID Connect provider key.
export const OIDC_PROVIDER_KEY = "oidc";

// ForwardAuth provider key.
export const FORWARD_AUTH_PROVIDER_KEY = "forward-auth";

// This provider is only available in grist-ee version.
export const GRIST_CONNECT_PROVIDER_KEY = "grist-connect";

// getgrist.com provider key.
export const GETGRIST_COM_PROVIDER_KEY = "getgrist.com";

// SAML provider key.
export const SAML_PROVIDER_KEY = "saml";

// Special provider that uses boot key to authenticate as install admin.
export const BOOT_KEY_PROVIDER_KEY = "boot-key";

// The provider key to switch to when deactivating authentication.
export const FALLBACK_PROVIDER_KEY = BOOT_KEY_PROVIDER_KEY;

// Deprecated/unmaintained providers, hidden unless already configured or active.
export const DEPRECATED_PROVIDERS: string[] = [
  GRIST_CONNECT_PROVIDER_KEY,
];

// Providers that are not "real" authentication — they don't involve a login flow.
const NON_AUTH_PROVIDERS = new Set([
  MINIMAL_PROVIDER_KEY,
  BOOT_KEY_PROVIDER_KEY,
  "no-logins",
  "no-auth",
  "",
]);

/**
 * Returns true if the given provider key represents a real authentication
 * system (OIDC, SAML, etc.) as opposed to a no-auth or internal-only mode.
 */
export function isRealProvider(key: string | undefined): boolean {
  return !!key && !NON_AUTH_PROVIDERS.has(key);
}
