
import {ClientScope} from 'app/client/components/ClientScope';
import {SafeBrowser} from 'app/client/lib/SafeBrowser';
import {ActiveDocAPI} from 'app/common/ActiveDocAPI';
import {LocalPlugin} from 'app/common/plugin';
import {createRpcLogger, PluginInstance} from 'app/common/PluginInstance';
import {Rpc} from 'grain-rpc';

/**
 * DocPluginManager's Client side implementation.
 */
export class DocPluginManager {

  public pluginsList: PluginInstance[];

  constructor(localPlugins: LocalPlugin[], private _untrustedContentOrigin: string, private _docComm: ActiveDocAPI,
              private _clientScope: ClientScope) {
    this.pluginsList = [];
    for (const plugin of localPlugins) {
      try {
        const pluginInstance = new PluginInstance(plugin, createRpcLogger(console, `PLUGIN ${plugin.id}:`));
        const components = plugin.manifest.components || {};
        const safeBrowser = pluginInstance.safeBrowser = new SafeBrowser(pluginInstance,
          this._clientScope, this._untrustedContentOrigin, components.safeBrowser);
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
