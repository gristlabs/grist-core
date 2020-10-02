import { SafeBrowser, ViewProcess } from 'app/client/lib/SafeBrowser';
import { PluginInstance } from 'app/common/PluginInstance';

export { ViewProcess } from 'app/client/lib/SafeBrowser';

/**
 * A PluginCustomSection identifies one custom section in a plugin.
 */
export interface PluginCustomSection {
  pluginId: string;
  sectionId: string;
}

export class CustomSectionElement {

  /**
   * Get the list of all available custom sections in all plugins' contributions.
   */
  public static getSections(plugins: PluginInstance[]): PluginCustomSection[] {
    return plugins.reduce<PluginCustomSection[]>((acc, plugin) => {
      const customSections = plugin.definition.manifest.contributions.customSections;
      const pluginId = plugin.definition.id;
      if (customSections) {
        // collect identifiers
        const sectionIds = customSections.map(section => ({sectionId: section.name, pluginId}));
        // concat to the accumulator
        return acc.concat(sectionIds);
      }
      return acc;
    }, []);
  }

  /**
   * Find a section matching sectionName in the plugin instances' constributions and returns
   * it. Returns `undefined` if not found.
   */
  public static find(plugin: PluginInstance, sectionName: string): ViewProcess|undefined {
    const customSections = plugin.definition.manifest.contributions.customSections;
    if (customSections) {
      const section = customSections.find(({ name }) => name === sectionName);
      if (section) {
        const safeBrowser = plugin.safeBrowser as SafeBrowser;
        return safeBrowser.createViewProcess(section.path);
      }
    }
  }
}
