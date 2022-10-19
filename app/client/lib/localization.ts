import {getGristConfig} from 'app/common/urlUtils';
import {DomContents} from 'grainjs';
import i18next from 'i18next';
import {G} from 'grainjs/dist/cjs/lib/browserGlobals';

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

  const ns = getGristConfig().namespaces ?? ['client'];
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
      // By default we use client namespace.
      defaultNS: 'client',
      // Read namespaces that are supported by the server.
      // TODO: this can be converted to a dynamic list of namespaces, for async components.
      // for now just import all what server offers.
      // We can fallback to client namespace for any addons.
      fallbackNS: 'client',
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
 * Resolves the translation of the given key using the given options.
 */
export function tString(key: string, args?: any, instance = i18next): string {
  if (!instance.exists(key, args || undefined)) {
    const error = new Error(`Missing translation for key: ${key} and language: ${i18next.language}`);
    reportError(error);
  }
  return instance.t(key, args);
}


/**
 * Resolves the translation of the given key and substitutes. Supports dom elements interpolation.
 */
 export function t(key: string, args?: any, instance = i18next): DomContents {
  if (!instance.exists(key, args || undefined)) {
    const error = new Error(`Missing translation for key: ${key} and language: ${i18next.language}`);
    reportError(error);
  }
  // If there are any DomElements in args, handle it with missingInterpolationHandler.
  const domElements = !args ? [] : Object.entries(args).filter(([_, value]) => isLikeDomContents(value));
  if (!args || !domElements.length) {
    return instance.t(key, args || undefined) as string;
  } else {
    // Make a copy of the arguments, and remove any dom elements from it. It will instruct
    // i18next library to use `missingInterpolationHandler` handler.
    const copy = {...args};
    domElements.forEach(([prop]) => delete copy[prop]);

    // Passing `missingInterpolationHandler` will allow as to resolve all missing keys
    // and replace them with a marker.
    const result: string = instance.t(key, {...copy, missingInterpolationHandler});

    // Now replace all markers with dom elements passed as arguments.
    const parts = result.split(/(\[\[\[[^\]]+?\]\]\])/);
    for (let i = 1; i < parts.length; i += 2) { // Every second element is our dom element.
      const propName = parts[i].substring(3, parts[i].length - 3);
      const domElement = args[propName] ?? `{{${propName}}}`; // If the prop is not there, simulate default behavior.
      parts[i] = domElement;
    }
    return parts;
  }
}

/**
 * Checks if the given key exists in the any supported language.
 */
export function hasTranslation(key: string) {
  return i18next.exists(key);
}

function missingInterpolationHandler(key: string, value: any) {
  return `[[[${value[1]}]]]`;
}

/**
 * Very naive detection if an element has DomContents type.
 */
function isLikeDomContents(value: any): boolean {
  // As null and undefined are valid DomContents values, we don't treat them as such.
  if (value === null || value === undefined) { return false; }
  return value instanceof G.Node || // Node
    (Array.isArray(value) && isLikeDomContents(value[0])) || // DomComputed
    typeof value === 'function'; // DomMethod
}
