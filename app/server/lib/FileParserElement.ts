import {PluginInstance} from 'app/common/PluginInstance';
import {ParseFileAPI} from 'app/plugin/FileParserAPI';
import {checkers} from 'app/plugin/TypeCheckers';

import {FileParser} from 'app/plugin/PluginManifest';

import * as path from 'path';

/**
 * Encapsulates together a file parse contribution with its plugin instance and callable stubs for
 * `parseFile` implementation provided by the plugin.
 *
 * Implements as well a `getMatching` static method to get all file parsers matching a filename from
 * the list of plugin instances.
 *
 */
export class FileParserElement {

  /**
   * Get all file parser that matches fileName from the list of plugins instances.
   */
  public static getMatching(pluginInstances: PluginInstance[], fileName: string): FileParserElement[] {
    const fileParserElements: FileParserElement[] = [];
    for (const plugin of pluginInstances) {
      const fileParsers = plugin.definition.manifest.contributions.fileParsers;
      if (fileParsers) {
        for (const fileParser of fileParsers) {
          if (matchFileParser(fileParser, fileName)) {
            fileParserElements.push(new FileParserElement(plugin, fileParser));
          }
        }
      }
    }
    return fileParserElements;
  }

  public parseFileStub: ParseFileAPI;

  private constructor(public plugin: PluginInstance, public fileParser: FileParser) {
    this.parseFileStub = plugin.getStub<ParseFileAPI>(fileParser.parseFile, checkers.ParseFileAPI);
  }

}

function matchFileParser(fileParser: FileParser, fileName: string): boolean {
  const ext = path.extname(fileName).slice(1),
    fileExtensions = fileParser.fileExtensions;
  return fileExtensions && fileExtensions.includes(ext);
}
