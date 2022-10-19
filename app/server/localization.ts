import {lstatSync, readdirSync} from 'fs';
import {createInstance, i18n} from 'i18next';
import i18fsBackend from 'i18next-fs-backend';
import {LanguageDetector} from 'i18next-http-middleware';
import path from 'path';

export function setupLocale(appRoot: string): i18n {
  // We are using custom instance and leave the global object intact.
  const instance = createInstance();
  // By default locales are located in the appRoot folder, unless the environment variable
  // GRIST_LOCALES_DIR is set.
  const localeDir = process.env.GRIST_LOCALES_DIR || path.join(appRoot, 'static', 'locales');
  const supportedNamespaces: Set<string> = new Set();
  const supportedLngs: Set<string> = new Set(readdirSync(localeDir).map((fileName) => {
    const fullPath = path.join(localeDir, fileName);
    const isDirectory = lstatSync(fullPath).isDirectory();
    if (isDirectory) {
      return "";
    }
    const baseName = path.basename(fileName, '.json');
    const lang = baseName.split('.')[0];
    const namespace = baseName.split('.')[1];
    if (!lang || !namespace) {
      throw new Error("Unrecognized resource file " + fileName);
    }
    supportedNamespaces.add(namespace);
    return lang;
  }).filter((lang) => lang));
  if (!supportedLngs.has('en') || !supportedNamespaces.has('server')) {
    throw new Error("Missing server English language file");
  }
  // Initialize localization filesystem plugin that will read the locale files from the localeDir.
  instance.use(i18fsBackend);
  // Initialize localization language detector plugin that will read the language from the request.
  instance.use(LanguageDetector);

  let errorDuringLoad: Error | undefined;
  instance.init({
    // Load all files synchronously.
    initImmediate: false,
    preload: [...supportedLngs],
    supportedLngs: [...supportedLngs],
    defaultNS: 'server',
    ns: [...supportedNamespaces],
    fallbackLng: 'en',
    backend: {
      loadPath: `${localeDir}/{{lng}}.{{ns}}.json`
    },
  }, (err: any) => {
    if (err) {
      errorDuringLoad = err;
    }
  }).catch((err: any) => {
    // This should not happen, the promise should be resolved synchronously, without
    // any errors reported.
    console.error("i18next failed unexpectedly", err);
  });
  if (errorDuringLoad) {
    throw errorDuringLoad;
  }
  return instance;
}

export function readLoadedLngs(instance?: i18n): readonly string[] {
  if (!instance) { return []; }
  return instance?.options.preload || ['en'];
}

export function readLoadedNamespaces(instance?: i18n): readonly string[] {
  if (!instance) { return []; }
  if (Array.isArray(instance?.options.ns)) {
    return instance.options.ns;
  }
  return instance?.options.ns ? [instance.options.ns as string] : ['server'];
}
