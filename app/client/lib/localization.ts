import {getGristConfig} from 'app/common/urlUtils';
import i18next from 'i18next';

export async function setupLocale() {
  const now = Date.now();
  const supportedLngs = getGristConfig().supportedLngs ?? ['en'];
  let lng = window.navigator.language || 'en';
  // If user agent language is not in the list of supported languages, use the default one.
  if (!supportedLngs.includes(lng)) {
    // Test if server supports general language.
    if (lng.includes("-") && supportedLngs.includes(lng.split("-")[0])) {
      lng = lng.split("-")[0]!;
    } else {
      lng = 'en';
    }
  }

  const ns = getGristConfig().namespaces ?? ['core'];
  // Initialize localization plugin
  try {
    // We don't await this promise, as it is resolved synchronously due to initImmediate: false.
    i18next.init({
      // By default we use english language.
      fallbackLng: 'en',
      // Fallback from en-US, en-GB, etc to en.
      nonExplicitSupportedLngs: true,
      // We will load resources ourselves.
      initImmediate: false,
      // Read language from navigator object.
      lng,
      // By default we use core namespace.
      defaultNS: 'core',
      // Read namespaces that are supported by the server.
      // TODO: this can be converted to a dynamic list of namespaces, for async components.
      // for now just import all what server offers.
      // We can fallback to core namespace for any addons.
      fallbackNS: 'core',
      ns,
      supportedLngs
    }).catch((err: any) => {
      // This should not happen, the promise should be resolved synchronously, without
      // any errors reported.
      console.error("i18next failed unexpectedly", err);
    });
    // Detect what is resolved languages to load.
    const languages = i18next.languages;
    // Fetch all json files (all of which should be already preloaded);
    const loadPath = `${document.baseURI}locales/{{lng}}.{{ns}}.json`;
    const pathsToLoad: Promise<any>[] = [];
    async function load(lang: string, n: string) {
      const resourceUrl = loadPath.replace('{{lng}}', lang).replace('{{ns}}', n);
      const response = await fetch(resourceUrl);
      if (!response.ok) {
        throw new Error(`Failed to load ${resourceUrl}`);
      }
      i18next.addResourceBundle(lang, n, await response.json());
    }
    for (const lang of languages) {
      for (const n of ns) {
        pathsToLoad.push(load(lang, n));
      }
    }
    await Promise.all(pathsToLoad);
    console.log("Localization initialized in " + (Date.now() - now) + "ms");
  } catch (error: any) {
    reportError(error);
  }
}

/**
 * Resolves the translation of the given key, using the given options.
 */
export function t(key: string, args?: any): string {
  if (!i18next.exists(key)) {
    const error = new Error(`Missing translation for key: ${key} and language: ${i18next.language}`);
    reportError(error);
  }
  return i18next.t(key, args);
}

/**
 * Checks if the given key exists in the any supported language.
 */
export function hasTranslation(key: string) {
  return i18next.exists(key);
}
