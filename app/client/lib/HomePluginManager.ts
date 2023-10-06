import {ClientScope} from 'app/client/components/ClientScope';
import {SafeBrowser} from 'app/client/lib/SafeBrowser';
import {LocalPlugin} from 'app/common/plugin';
import {createRpcLogger, PluginInstance} from 'app/common/PluginInstance';
import {Theme} from 'app/common/ThemePrefs';
import {Computed} from 'grainjs';

/**
 * Home plugins are all plugins that contributes to a general Grist management tasks.
 * They operate on Grist as a whole, without current document context.
 * TODO: currently it is used primary for importing documents on home screen and supports
 * only safeBrowser components without any access to Grist.
 */
export class HomePluginManager {

  public pluginsList: PluginInstance[];

  constructor(options: {
    localPlugins: LocalPlugin[],
    untrustedContentOrigin: string,
    clientScope: ClientScope,
    theme: Computed<Theme>,
  }) {
    const {localPlugins, untrustedContentOrigin, clientScope, theme} = options;
    this.pluginsList = [];
    for (const plugin of localPlugins) {
      try {
        const components = plugin.manifest.components || {};
        // Home plugins supports only safeBrowser components
        if (components.safePython || components.unsafeNode) {
          continue;
        }
        // and currently implements only safe imports
        const importSources = plugin.manifest.contributions.importSources;
        if (!importSources?.some(i => i.safeHome)) {
          continue;
        }
        const pluginInstance = new PluginInstance(plugin, createRpcLogger(console, `HOME PLUGIN ${plugin.id}:`));
        const safeBrowser = pluginInstance.safeBrowser = new SafeBrowser({
          pluginInstance,
          clientScope,
          untrustedContentOrigin,
          mainPath: components.safeBrowser,
          theme,
        });
        if (components.safeBrowser) {
          pluginInstance.rpc.registerForwarder(components.safeBrowser, safeBrowser);
        }
        const forwarder = new NotAvailableForwarder();
        // Block any calls to internal apis.
        pluginInstance.rpc.registerForwarder('*', {
          forwardCall: (call) => forwarder.forwardPluginRpc(plugin.id, call),
          forwardMessage: (msg) => forwarder.forwardPluginRpc(plugin.id, msg),
        });
        this.pluginsList.push(pluginInstance);
      } catch (err) {
        console.error( // tslint:disable-line:no-console
          `HomePluginManager: failed to instantiate ${plugin.id}: ${err.message}`);
      }
    }
  }
}

class NotAvailableForwarder {
  public async forwardPluginRpc(pluginId: string, msg: any) {
    throw new Error("This api is not available");
  }
}
