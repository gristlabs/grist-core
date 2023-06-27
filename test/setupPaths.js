// enhance require() to support project paths and typescript.
const path = require('path');
const appModulePath = require('app-module-path');
// Root path can be complicated, pwd is more reliable for tests.
const root = process.cwd();
const nodePath = (process.env.NODE_PATH || '').split(path.delimiter);
const paths = [path.join(root, "_build"),
               path.join(root, "_build/core"),
               path.join(root, "_build/ext"),
               path.join(root, "_build/stubs")];
for (const p of paths) {
  appModulePath.addPath(p);
}
// add to path for any subprocesses also
process.env.NODE_PATH = [...nodePath, ...paths]
  .filter(p => p !== '')
  .join(path.delimiter);
