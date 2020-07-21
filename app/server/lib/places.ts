/**
 * Utilities related to the layout of the application and where parts are stored.
 */

import * as path from 'path';

/**
 * codeRoot is the directory containing ./app with all the JS code.
 */
export const codeRoot = path.dirname(path.dirname(path.dirname(__dirname)));

/**
 * Returns the appRoot, i.e. the directory containing ./sandbox, ./node_modules, ./ormconfig.js,
 * etc.
 */
export function getAppRoot(): string {
  if (codeRoot.endsWith('/_build/core')) { return path.dirname(path.dirname(codeRoot)); }
  return codeRoot.endsWith('/_build') ? path.dirname(codeRoot) : codeRoot;
}

/**
 * When packaged as an electron application, most files are stored in a .asar
 * archive.  Most, but not all.  This method takes the "application root"
 * which is that .asar file in packaged form, and returns a directory where
 * remaining files are available on the regular filesystem.
 */
export function getUnpackedAppRoot(appRoot: string): string {
  return path.resolve(path.dirname(appRoot), path.basename(appRoot, '.asar'));
}

/**
 * Return the correct root for a given subdirectory.
 */
export function getAppRootFor(appRoot: string, subdirectory: string): string {
  if (['sandbox', 'plugins', 'public-api'].includes(subdirectory)) {
    return getUnpackedAppRoot(appRoot);
  }
  return appRoot;
}

/**
 * Return the path to a given subdirectory, from the correct appRoot.
 */
export function getAppPathTo(appRoot: string, subdirectory: string): string {
  return path.resolve(getAppRootFor(appRoot, subdirectory), subdirectory);
}
