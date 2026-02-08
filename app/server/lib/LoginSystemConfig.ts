import { GristLoginSystem } from "app/server/lib/GristServer";

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

  /** Function that builds an instance of the login system based on app settings. */
  builder: (settings: AppSettings) => Promise<GristLoginSystem | null>;

  /**
   * Optional function that returns metadata about the provider.
   *
   * This is only used to read the owner from GetGrist.com configuration for
   * sending to the client. We can't currently send configuration directly to
   * the client because they may contain sensitive values, like the client
   * secret. But it should be possible to do so if we add filtering or censoring,
   * and it seems useful in general to share most configuration values with the
   * client.
   *
   * TODO: Remove this and send filtered/censored configuration returned by `reader`
   * to the client instead.
   */
  metadataReader?: (settings: AppSettings) => Record<string, any>;
}
