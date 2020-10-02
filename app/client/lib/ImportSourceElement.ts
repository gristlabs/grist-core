import {PluginInstance} from 'app/common/PluginInstance';
import {InternalImportSourceAPI} from 'app/plugin/InternalImportSourceAPI';
import {ImportSource} from 'app/plugin/PluginManifest';
import {checkers} from 'app/plugin/TypeCheckers';

/**
 * Encapsulate together an import source contribution with its plugin instance and a callable stub
 * for the ImportSourceAPI. Exposes as well a `fromArray` static method to get all the import
 * sources from an array of plugins instances.
 */
export class ImportSourceElement {

  /**
   * Get all import sources from an array of plugin instances.
   */
  public static fromArray(pluginInstances: PluginInstance[]): ImportSourceElement[] {
    const importSources: ImportSourceElement[] = [];
    for (const plugin of pluginInstances) {
      const definitions = plugin.definition.manifest.contributions.importSources;
      if (definitions) {
        for (const importSource of definitions) {
          importSources.push(new ImportSourceElement(plugin, importSource));
        }
      }
    }
    return importSources;
  }

  public importSourceStub: InternalImportSourceAPI;

  private constructor(public plugin: PluginInstance, public importSource: ImportSource) {
    this.importSourceStub = plugin.getStub<InternalImportSourceAPI>(importSource.importSource,
      checkers.InternalImportSourceAPI);
  }
}
