/**
 * Describes the settings that a browser sends to the server.
 */
export interface BrowserSettings {
  // The browser's timezone, must be one of `momet.tz.names()`.
  timezone?: string;
  // The browser's locale, should be read from Accept-Language header.
  locale?: string;
}
