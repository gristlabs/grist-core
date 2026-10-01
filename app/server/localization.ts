import { appSettings } from "app/server/lib/AppSettings";
import log from "app/server/lib/log";

import { existsSync, lstatSync, readdirSync, readFileSync } from "fs";
import path from "path";

import { createInstance, i18n } from "i18next";
import { LanguageDetector } from "i18next-http-middleware";
import merge from "lodash/merge";

export function setupLocale(localeDirs: string[]): i18n {
  // We are using custom instance and leave the global object intact.
  const instance = createInstance();
  // The first directory holds the core files and must exist, unless the environment variable
  // GRIST_LOCALES_DIR replaces it. The others (ext, saas) are read only if present. Files with
  // the same name are merged into one resource, later directories overriding earlier ones.
  const [coreDir, ...layerDirs] = localeDirs;
  const dirs = [process.env.GRIST_LOCALES_DIR || coreDir, ...layerDirs.filter(dir => existsSync(dir))];
  const resources = new Map<string, Resource>();

  for (const dir of dirs) {
    for (const fileName of readdirSync(dir).sort()) {
      const fullPath = path.join(dir, fileName);
      if (lstatSync(fullPath).isDirectory()) {
        continue;
      }
      const baseName = path.basename(fileName, ".json");
      const lang = baseName.split(".")[0]?.replace(/_/g, "-");
      const namespace = baseName.split(".")[1];
      if (!lang || !namespace) {
        throw new Error("Unrecognized resource file " + fileName);
      }
      const data = JSON.parse(readFileSync(fullPath, "utf8"));
      const resource = resources.get(baseName) ?? { namespace, lang, data: {} };
      resource.data = merge(resource.data, data);
      resources.set(baseName, resource);
    }
  }
  const supportedNamespaces = new Set([...resources.values()].map(r => r.namespace));
  const supportedLngs = new Set([...resources.values()].map(r => r.lang));

  if (!supportedLngs.has("en") || !supportedNamespaces.has("server")) {
    throw new Error("Missing server English language file");
  }
  // Initialize localization language detector plugin that will read the language from the request.
  instance.use(LanguageDetector);

  let errorDuringLoad: Error | undefined;
  instance.init({
    defaultNS: "server",
    ns: [...supportedNamespaces],
    fallbackLng: "en",
    detection: {
      lookupCookie: "grist_user_locale",
    },
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
    log.error("i18next failed to load", errorDuringLoad);
    throw errorDuringLoad;
  }
  // First sort by ns, which will put "client" first. That lets us check for a
  // client key which, if absent, means the language should be ignored.
  const preload = [...resources.values()].sort((a, b) => a.namespace.localeCompare(b.namespace));
  const offerAll = appSettings.section("locale").flag("offerAllLanguages").readBool({
    envVar: "GRIST_OFFER_ALL_LANGUAGES",
  });
  const shouldIgnoreLng = new Set<string>();
  for (const { namespace: ns, lang: lng, data } of preload) {
    // If the "Translators: please ..." key in "App" has not been translated,
    // ignore this language for this and later namespaces.
    if (!offerAll && ns === "client" &&
      !Object.keys(data.App || {}).some(key => key.includes("Translators: please"))) {
      shouldIgnoreLng.add(lng);
      log.debug(`skipping incomplete language ${lng} (set GRIST_OFFER_ALL_LANGUAGES if you want it)`);
    }
    if (!shouldIgnoreLng.has(lng)) {
      instance.addResourceBundle(lng, ns, data);
    }
  }
  return instance;
}

interface Resource {
  namespace: string;
  lang: string;
  data: any;
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
  return instance?.options.ns ? [instance.options.ns as string] : ["server"];
}
