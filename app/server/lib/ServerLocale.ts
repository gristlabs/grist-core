import {parse as languageParser} from "accept-language-parser";
import {IncomingMessage} from 'http';
import {locales} from 'app/common/Locales';

/**
 * Returns the locale from a request, falling back to `defaultLocale`
 * if unable to determine the locale.
 */
export function localeFromRequest(req: IncomingMessage, defaultLocale: string = 'en-US') {
  const language = languageParser(req.headers["accept-language"] as string)[0];
  if (!language) { return defaultLocale; }

  const locale = `${language.code}-${language.region}`;
  const supports = locales.some(l => l.code === locale);
  return supports ? locale : defaultLocale;
}
