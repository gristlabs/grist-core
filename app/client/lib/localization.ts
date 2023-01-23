import {hooks} from 'app/client/Hooks';
import {getGristConfig} from 'app/common/urlUtils';
import {DomContents} from 'grainjs';
import i18next from 'i18next';
import {G} from 'grainjs/dist/cjs/lib/browserGlobals';

export async function setupLocale() {
  const now = Date.now();
  const supportedLngs = getGristConfig().supportedLngs ?? ['en'];
  const lng = detectCurrentLang();
  const ns = getGristConfig().namespaces ?? ['client'];
  // Initialize localization plugin
  try {
    // We don't await this promise, as it is resolved synchronously due to initImmediate: false.
    i18next.init({
      // By default we use english language.
      fallbackLng: 'en',
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
      ns
    }).catch((err: any) => {
      // This should not happen, the promise should be resolved synchronously, without
      // any errors reported.
      console.error("i18next failed unexpectedly", err);
    });
    // Detect what is resolved languages to load.
    const languages = i18next.languages;
    // Fetch all json files (all of which should be already preloaded);
    const loadPath = `${hooks.baseURI || document.baseURI}locales/{{lng}}.{{ns}}.json`;
    const pathsToLoad: Promise<any>[] = [];
    async function load(lang: string, n: string) {
      const resourceUrl = loadPath.replace('{{lng}}', lang.replace("-", "_")).replace('{{ns}}', n);
      const response = await fetch(resourceUrl);
      if (!response.ok) {
        // Throw only if we don't have any fallbacks.
        if (lang === i18next.options.fallbackLng && n === i18next.options.defaultNS) {
          throw new Error(`Failed to load ${resourceUrl}`);
        } else {
          console.warn(`Failed to load ${resourceUrl}`);
          return;
        }
      }
      i18next.addResourceBundle(lang, n, await response.json());
    }
    for (const lang of languages.filter((l) => supportedLngs.includes(l))) {
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

export function detectCurrentLang() {
  const { userLocale, supportedLngs } = getGristConfig();
  const detected = userLocale
    || document.cookie.match(/grist_user_locale=([^;]+)/)?.[1]
    || window.navigator.language
    || 'en';
  const supportedList = supportedLngs ?? ['en'];
  // If we have this language in the list (or more general version) mark it as selected.
  // Compare languages in lower case, as navigator.language can return en-US, en-us (for older Safari).
  const selected = supportedList.find(supported => supported.toLowerCase() === detected.toLowerCase()) ??
    supportedList.find(supported => supported === detected.split(/[-_]/)[0]) ?? 'en';
  return selected;
}

export function setAnonymousLocale(lng: string) {
  document.cookie = lng ? `grist_user_locale=${lng}; path=/; max-age=31536000`
                        : 'grist_user_locale=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC';
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

// We will try to infer result from the arguments passed to `t` function.
// For plain objects we expect string as a result. If any property doesn't look as a plain value
// we assume that it might be a dom node and the result is DomContents.
type InferResult<T> = T extends Record<string, string | number | boolean>|undefined|null ? string : DomContents;

/**
 * Resolves the translation of the given key and substitutes. Supports dom elements interpolation.
 */
export function t<T extends Record<string, any>>(key: string, args?: T|null, instance = i18next): InferResult<T> {
  return domT(key, args, instance.t);
}

function domT(key: string, args: any, tImpl: typeof i18next.t) {
  // If there are any DomElements in args, handle it with missingInterpolationHandler.
  const domElements = !args ? [] : Object.entries(args).filter(([_, value]) => isLikeDomContents(value));
  if (!args || !domElements.length) {
    return tImpl(key, args || undefined);
  } else {
    // Make a copy of the arguments, and remove any dom elements from it. It will instruct
    // i18next library to use `missingInterpolationHandler` handler.
    const copy = {...args};
    domElements.forEach(([prop]) => delete copy[prop]);

    // Passing `missingInterpolationHandler` will allow as to resolve all missing keys
    // and replace them with a marker.
    const result: string = tImpl(key, {...copy, missingInterpolationHandler});

    // Now replace all markers with dom elements passed as arguments.
    const parts = result.split(/(\[\[\[[^\]]+?\]\]\])/);
    for (let i = 1; i < parts.length; i += 2) { // Every second element is our dom element.
      const propName = parts[i].substring(3, parts[i].length - 3);
      const domElement = args[propName] ?? `{{${propName}}}`; // If the prop is not there, simulate default behavior.
      parts[i] = domElement;
    }
    return parts.filter(p => p !== '') as any; // Remove empty parts.
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

/**
 * Helper function to create a scoped t function. Scoped t function is bounded to a specific
 * namespace and a key prefix (a scope).
 */
export function makeT(scope: string, instance?: typeof i18next) {
  // Can't create the scopedInstance yet as it might not be initialized.
  let scopedInstance: null|typeof i18next = null;
  let scopedResolver: null|typeof i18next.t = null;
  return function<T extends Record<string, any>>(key: string, args?: T|null) {
    // Create a scoped instance with disabled namespace and nested features.
    // This enables keys like `key1.key2:key3` to be resolved properly.
    if (!scopedInstance) {
      scopedInstance = (instance ?? i18next).cloneInstance({
        keySeparator: false,
        nsSeparator: false,
        saveMissing: true,
        missingKeyHandler: (lng, ns, _key) => console.warn(`Missing translation for key: ${_key}`)
      });

      // Create a version of `t` function that will use the provided prefix as default.
      const fixedResolver = scopedInstance.getFixedT(null, null, scope);

      // Override the resolver with a custom one, that will use the argument as a default.
      // This will remove all the overloads from the function, but we don't need them.
      scopedResolver = (_key: string, _args?: any) => fixedResolver(_key, {defaultValue: _key, ..._args});
    }
    return domT(key, args, scopedResolver!);
  };
}
