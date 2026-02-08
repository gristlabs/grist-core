#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");

let codeRoot = path.resolve(__dirname, "..", "..", "..");
if (!fs.existsSync(path.join(codeRoot, "_build"))) {
  codeRoot = path.dirname(codeRoot);
}

process.env.DATA_PATH = path.join(path.dirname(__dirname), "data");

require("app-module-path").addPath(path.join(codeRoot, "_build"));
require("app-module-path").addPath(path.join(codeRoot, "_build", "core"));
require("app-module-path").addPath(path.join(codeRoot, "_build", "ext"));
require("app-module-path").addPath(path.join(codeRoot, "_build", "stubs"));
require("test/assistant/v1/runCompletion_impl").runCompletion().catch(console.error);
