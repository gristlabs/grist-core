
import {ClientScope} from 'app/client/components/ClientScope';
import {SafeBrowser} from 'app/client/lib/SafeBrowser';
import {ActiveDocAPI} from 'app/common/ActiveDocAPI';
import {LocalPlugin} from 'app/common/plugin';
import {createRpcLogger, PluginInstance} from 'app/common/PluginInstance';
import {Theme} from 'app/common/ThemePrefs';
import {Computed} from 'grainjs';
import {Rpc} from 'grain-rpc';

/**
 * DocPluginManager's Client side implementation.
 */
export class DocPluginManager {

  public pluginsList: PluginInstance[];

  private _clientScope = this._options.clientScope;
  private _docComm = this._options.docComm;
  private _localPlugins = this._options.plugins;
  private _theme = this._options.theme;
  private _untrustedContentOrigin = this._options.untrustedContentOrigin;

  constructor(private _options: {
    plugins: LocalPlugin[],
    untrustedContentOrigin: string,
    docComm: ActiveDocAPI,
    clientScope: ClientScope,
    theme: Computed<Theme>,
  }) {
    this.pluginsList = [];
    for (const plugin of this._localPlugins) {
      try {
        const pluginInstance = new PluginInstance(plugin, createRpcLogger(console, `PLUGIN ${plugin.id}:`));
        const components = plugin.manifest.components || {};
        const safeBrowser = pluginInstance.safeBrowser = new SafeBrowser({
          pluginInstance,
          clientScope: this._clientScope,
          untrustedContentOrigin: this._untrustedContentOrigin,
          mainPath: components.safeBrowser,
          theme: this._theme,
        });
        if (components.safeBrowser) {
          pluginInstance.rpc.registerForwarder(components.safeBrowser, safeBrowser);
        }

        // Forward calls to the server, if no matching forwarder.
        pluginInstance.rpc.registerForwarder('*', {
          forwardCall: (call) => this._docComm.forwardPluginRpc(plugin.id, call),
          forwardMessage: (msg) => this._docComm.forwardPluginRpc(plugin.id, msg),
        });
        this.pluginsList.push(pluginInstance);
      } catch (err) {
        console.error( // tslint:disable-line:no-console
          `DocPluginManager: failed to instantiate ${plugin.id}: ${err.message}`);
      }
    }
  }

  /**
   * `receiveAction` handles an action received from the server by forwarding it to all safe browser component.
   */
  public receiveAction(action: any[]) {
    for (const plugin of this.pluginsList) {
      const safeBrowser = plugin.safeBrowser as SafeBrowser;
      if (safeBrowser) {
        safeBrowser.receiveAction(action);
      }
    }
  }

  /**
   * Make an Rpc object to call server methods from a url-flavored custom view.
   */
  public makeAnonForwarder() {
    const rpc = new Rpc({});
    rpc.queueOutgoingUntilReadyMessage();
    rpc.registerForwarder('*', {
      forwardCall: (call) => this._docComm.forwardPluginRpc("builtIn/core", call),
      forwardMessage: (msg) => this._docComm.forwardPluginRpc("builtIn/core", msg),
    });
    return rpc;
  }
}
