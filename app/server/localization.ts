import {lstatSync, readdirSync, readFileSync} from 'fs';
import {createInstance, i18n} from 'i18next';
import {LanguageDetector} from 'i18next-http-middleware';
import path from 'path';

export function setupLocale(appRoot: string): i18n {
  // We are using custom instance and leave the global object intact.
  const instance = createInstance();
  // By default locales are located in the appRoot folder, unless the environment variable
  // GRIST_LOCALES_DIR is set.
  const localeDir = process.env.GRIST_LOCALES_DIR || path.join(appRoot, 'static', 'locales');
  const preload: [string, string, string][] = [];
  const supportedNamespaces: Set<string> = new Set();
  const supportedLngs: Set<string> = new Set();

  for(const fileName of readdirSync(localeDir)) {
    const fullPath = path.join(localeDir, fileName);
    const isDirectory = lstatSync(fullPath).isDirectory();
    if (isDirectory) {
      continue;
    }
    const baseName = path.basename(fileName, '.json');
    const lang = baseName.split('.')[0]?.replace(/_/g, '-');
    const namespace = baseName.split('.')[1];
    if (!lang || !namespace) {
      throw new Error("Unrecognized resource file " + fileName);
    }
    supportedNamespaces.add(namespace);
    preload.push([lang, namespace, fullPath]);
    supportedLngs.add(lang);
  }

  if (!supportedLngs.has('en') || !supportedNamespaces.has('server')) {
    throw new Error("Missing server English language file");
  }
  // Initialize localization language detector plugin that will read the language from the request.
  instance.use(LanguageDetector);

  let errorDuringLoad: Error | undefined;
  instance.init({
    defaultNS: 'server',
    ns: [...supportedNamespaces],
    fallbackLng: 'en',
    detection: {
      lookupCookie: 'grist_user_locale'
    }
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
    console.error('i18next failed to load', errorDuringLoad);
    throw errorDuringLoad;
  }
  // Load all files synchronously.
  for(const [lng, ns, fullPath] of preload) {
    instance.addResourceBundle(lng, ns, JSON.parse(readFileSync(fullPath, 'utf8')));
  }
  return instance;
}

export function readLoadedLngs(instance?: i18n): readonly string[] {
  if (!instance) { return []; }
  return Object.keys(instance?.services.resourceStore.data);
}

export function readLoadedNamespaces(instance?: i18n): readonly string[] {
  if (!instance) { return []; }
  if (Array.isArray(instance?.options.ns)) {
    return instance.options.ns;
  }
  return instance?.options.ns ? [instance.options.ns as string] : ['server'];
}
