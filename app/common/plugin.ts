/**
 * Plugin's utilities common to server and client.
 */
import {BarePlugin, Implementation} from 'app/plugin/PluginManifest';

export type LocalPluginKind = "installed"|"builtIn";

export interface ImplDescription {
  localPluginId: string;
  implementation: Implementation;
}

export interface FileParser {
  fileExtensions: string[];
  parseOptions?: ImplDescription;
  fileParser: ImplDescription;
}

// Deprecated, use FileParser or ImportSource instead.
export interface FileImporter {
  id: string;
  fileExtensions?: string[];
  script?: string;
  scriptFullPath?: string;
  filePicker?: string;
  filePickerFullPath?: string;
}

/**
 * Manifest parsing error.
 */
export interface ManifestParsingError {
  yamlError?: any;
  jsonError?: any;
  cannotReadError?: any;
  missingEntryErrors?: string;
}

/**
 * Whether the importer provides a file picker.
 */
export function isPicker(importer: FileImporter): boolean {
  return importer.filePicker !== undefined;
}

/**
 * A Plugin that was found in the system, either installed or builtin.
 */
export interface LocalPlugin {
  /**
   * the plugin's manifest
   */
  manifest: BarePlugin;
  /**
   * The path to the plugin's folder.
   */
  path: string;
  /**
   * A name to uniquely identify a LocalPlugin.
   */
  readonly id: string;
}

export interface DirectoryScanEntry {
  manifest?: BarePlugin;
  /**
   * User-friendly error messages.
   */
  errors?: any[];
  path: string;
  id: string;
}

/**
 * The contributions type.
 */
export type Contribution = "importSource" | "fileParser";
