import {BarePlugin} from 'app/plugin/PluginManifest';
import PluginManifestTI from 'app/plugin/PluginManifest-ti';
import * as fse from 'fs-extra';
import * as yaml from 'js-yaml';
import * as path from 'path';
import {createCheckers} from "ts-interface-checker";

const manifestChecker = createCheckers(PluginManifestTI).BarePlugin;
/**
 * Validate the manifest and generate appropriate errors.
 */
// TODO: should validate that the resources referenced within the manifest are located within the
// plugin folder
// TODO: Need a comprehensive test that triggers every notices;
function isValidManifest(manifest: any, notices: string[]): boolean {
  if (!manifest) {
    notices.push("missing manifest");
    return false;
  }
  try {
    manifestChecker.check(manifest);
  } catch (e) {
    notices.push(`Invalid manifest: ${e.message}`);
    return false;
  }
  try {
    manifestChecker.strictCheck(manifest);
  } catch (e) {
    notices.push(`WARNING: ${e.message}` );
    /* but don't fail */
  }
  if (Object.keys(manifest.contributions).length === 0) {
    notices.push("WARNING: no valid contributions");
  }
  return true;
}

/**
 * A ManifestError is an error caused by a wrongly formatted manifest or missing manifest. The
 * `notices` property holds a user-friendly description of the error(s).
 */
export class ManifestError extends Error {
  constructor(public notices: string[], message: string = "") {
    super(message);
  }
}

/**
 * Parse the manifest. Look first for a Yaml manifest and then if missing for a Json manifest.
 */
export async function readManifest(pluginPath: string): Promise<BarePlugin> {
  const notices: string[] = [];
  const manifest: any = await _readManifest(pluginPath);
  // We allow contributions and components to be omitted as shorthand
  // for being the empty object.
  if (!manifest.contributions) { manifest.contributions = {}; }
  if (!manifest.components) { manifest.components = {}; }
  if (isValidManifest(manifest, notices)) {
    return manifest as BarePlugin;
  }
  throw new ManifestError(notices);
}

async function _readManifest(pluginPath: string): Promise<object> {
  async function readManifestFile(fileExtension: string): Promise<string> {
    return await fse.readFile(path.join(pluginPath, "manifest." + fileExtension), "utf8");
  }
  try {
    return yaml.safeLoad(await readManifestFile("yml"));
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      throw new Error('error parsing yaml manifest: ' + e.message);
    }
  }
  try {
    return JSON.parse(await readManifestFile("json"));
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error('error parsing json manifest' + e.message);
    }
    throw new Error('cannot read manifest file: ' + e.message);
  }
}
