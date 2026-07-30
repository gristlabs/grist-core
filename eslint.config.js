const fs = require("fs");
const path = require("path");

// Relevant when building SaaS, which places grist-core in core/ of a larger checkout. Defer to
// that wrapper's config when present, so that files in and out of core/ share a single tsconfig
// path, so that the eslint_d daemon ends up holding a single TS Program (two cause double
// memory usage and risk of OOM'ing).
const parent = path.join(__dirname, "..");
const embeddedAsCore =
  fs.existsSync(`${parent}/eslint.config.js`) &&
  fs.existsSync(`${parent}/core`) &&
  fs.realpathSync(`${parent}/core`) === fs.realpathSync(__dirname);

module.exports = embeddedAsCore
  ? require(`${parent}/eslint.config.js`)
  : require("./eslint.config.shared.js").makeConfig({ projectRoot: __dirname, lintExt: false });
