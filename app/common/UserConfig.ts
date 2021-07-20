/*
 * Interface for the user's config found in config.json.
 */
export interface UserConfig {
  docListSortBy?: string;
  docListSortDir?: number;
  features?: ISupportedFeatures;

  /*
   * The host serving the untrusted content: on dev environment could be
   * "http://getgrist.localtest.me". Port is added at runtime and should not be included.
   */
  untrustedContentOrigin?: string;
}

export interface ISupportedFeatures {
  signin?: boolean;
  sharing?: boolean;
  proxy?: boolean;  // If true, Grist will accept login information via http headers
  // X-Forwarded-User and X-Forwarded-Email.  Set to true only if
  // Grist is behind a reverse proxy that is managing those headers,
  // otherwise they could be spoofed.
  formulaBar?: boolean;

  // Plugin views, REPL, and Validations all need work, but are exposed here to allow existing
  // tests to continue running. These only affect client-side code.
  customViewPlugin?: boolean;
  validationsTool?: boolean;
}
