import type { AppSettings } from "app/server/lib/AppSettings";

/**
 * Configuration for a login system provider. It is used by the ConfigBackendAPI to list the providers
 * and check if they are properly configured.
 */
export interface LoginSystemConfig {
  /** Unique identifier key for the login provider (e.g., 'oidc', 'saml'). */
  key: string;

  /** Human-readable name of the login system (e.g., 'OIDC', 'SAML'). */
  name: string;

  /** Function that reads and parses the provider's configuration from app settings. */
  reader: (settings: AppSettings) => any;
}
