/**
 * API definitions for FileParser plugins.
 */

import {GristTables} from './GristTable';

export interface EditOptionsAPI {
  getParseOptions(parseOptions?: ParseOptions): Promise<ParseOptions>;
}

export interface ParseFileAPI {
  parseFile(file: FileSource, parseOptions?: ParseOptions): Promise<ParseFileResult>;
}

/**
 * ParseOptions contains parse options depending on plugin,
 * number of rows, which is special option that can be used for any plugin
 * and schema for generating parse options UI
 */
export interface ParseOptions {
  NUM_ROWS?: number;
  SCHEMA?: ParseOptionSchema[];
  WARNING?: string;     // Only on response, includes a warning from parsing, if any.
}

/**
 * ParseOptionSchema contains information for generaing parse options UI
 */
export interface ParseOptionSchema {
  name: string;
  label: string;
  type: string;
  visible: boolean;
}

export interface FileSource {
  /**
   * The path is often a temporary file, so its name is meaningless. Access to the file depends on
   * the type of plugin. For instance, for `safePython` plugins file is directly available at
   * `/importDir/path`.
   */
  path: string;

  /**
   * Plugins that want to know the original filename should use origName. Depending on the source
   * of the data, it may or may not be meaningful.
   */
  origName: string;
}

export interface ParseFileResult extends GristTables {
  parseOptions: ParseOptions;
}
