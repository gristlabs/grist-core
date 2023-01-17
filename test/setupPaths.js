// enhance require() to support project paths and typescript.
const path = require('path');
const appModulePath = require('app-module-path');
const root = path.dirname(__dirname);
appModulePath.addPath(path.join(root, "_build"));
appModulePath.addPath(path.join(root, "_build/core"));
appModulePath.addPath(path.join(root, "_build/ext"));
