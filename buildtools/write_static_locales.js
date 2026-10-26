const fs = require("fs");
const path = require("path");
const appModulePath = require("app-module-path");

// Set up module paths here rather than with NODE_PATH, whose separator differs on Windows.
for (const p of ["_build", "_build/ext", "_build/stubs", "ext/node_modules"]) {
  appModulePath.addPath(path.resolve(p));
}

const { setupLocale } = require("app/server/localization");

const outDir = "static/locales";
const instance = setupLocale(process.argv.slice(2), { offerAllLanguages: true });

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const [lng, namespaces] of Object.entries(instance.services.resourceStore.data)) {
  for (const [ns, data] of Object.entries(namespaces)) {
    fs.writeFileSync(path.join(outDir, `${lng.replace(/-/g, "_")}.${ns}.json`), JSON.stringify(data));
  }
}
