import {appSettings} from 'app/server/lib/AppSettings';
import log from 'app/server/lib/log';
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
    preload.push([namespace, lang, fullPath]);
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
    log.error("i18next failed unexpectedly", err);
  });
  if (errorDuringLoad) {
    log.error('i18next failed to load', errorDuringLoad);
    throw errorDuringLoad;
  }
  // Load all files synchronously.
  // First sort by ns, which will put "client" first. That lets us check for a
  // client key which, if absent, means the language should be ignored.
  preload.sort((a, b) => a[0].localeCompare(b[0]));
  const offerAll = appSettings.section('locale').flag('offerAllLanguages').readBool({
    envVar: 'GRIST_OFFER_ALL_LANGUAGES',
  });
  const shouldIgnoreLng = new Set<string>();
  for(const [ns, lng, fullPath] of preload) {
    const data = JSON.parse(readFileSync(fullPath, 'utf8'));
    // If the "Translators: please ..." key in "App" has not been translated,
    // ignore this language for this and later namespaces.
    if (!offerAll && ns === 'client' &&
      !Object.keys(data.App || {}).some(key => key.includes('Translators: please'))) {
      shouldIgnoreLng.add(lng);
      log.debug(`skipping incomplete language ${lng} (set GRIST_OFFER_ALL_LANGUAGES if you want it)`);
    }
    if (!shouldIgnoreLng.has(lng)) {
      instance.addResourceBundle(lng, ns, data);
    }
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
