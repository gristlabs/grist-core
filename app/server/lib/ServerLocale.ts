import { localeCodes } from "app/common/LocaleCodes";

import { IncomingMessage } from "http";

import { parse as languageParser } from "accept-language-parser";

const fallbackLocale = "en-US";

export function getDefaultLocale() {
  const envLocale = process.env.GRIST_DEFAULT_LOCALE;
  return envLocale && localeCodes.includes(envLocale) ? envLocale : fallbackLocale;
}

/**
 * Returns the locale from a request, falling back to `defaultLocale`
 * if unable to determine the locale.
 */
export function localeFromRequest(req: IncomingMessage, defaultLocale: string = getDefaultLocale()) {
  const languages = languageParser(req.headers["accept-language"]!);
  const match = languages.find(l => l.code && l.region && localeCodes.includes(`${l.code}-${l.region}`));
  return match ? `${match.code}-${match.region}` : defaultLocale;
}
