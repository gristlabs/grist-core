import { localeCodes } from "app/common/LocaleCodes";
import { locales } from "app/common/Locales";
import log from "app/server/lib/log";

import { IncomingMessage } from "http";

import { parse as languageParser } from "accept-language-parser";

const fallbackLocale = "en-US";

export function getDefautLocale() {
  let locale = process.env.GRIST_DEFAULT_LOCALE;
  if (locale && !localeCodes.includes(locale)) {
    log.warn(`Invalid GRIST_DEFAULT_LOCALE, falling back to ${fallbackLocale}. Check app/common/LocaleCodes.ts for supported locales.`);
    locale = fallbackLocale;
  }
  return locale ?? fallbackLocale;
}

/**
 * Returns the locale from a request, falling back to `defaultLocale`
 * if unable to determine the locale.
 */
export function localeFromRequest(req: IncomingMessage, defaultLocale: string = getDefautLocale()) {
  const language = languageParser(req.headers["accept-language"]!)[0];
  if (!language) { return defaultLocale; }

  const locale = `${language.code}-${language.region}`;
  const supports = locales.some(l => l.code === locale);
  return supports ? locale : defaultLocale;
}
