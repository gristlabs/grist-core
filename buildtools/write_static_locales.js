const fs = require("fs");
const path = require("path");

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
