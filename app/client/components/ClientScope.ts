import * as dispose from 'app/client/lib/dispose';
import {Storage} from 'app/plugin/StorageAPI';
import {checkers} from 'app/plugin/TypeCheckers';
import {Rpc} from 'grain-rpc';

/**
 * Implementation of interfaces whose lifetime is that of the client.
 */
export class ClientScope extends dispose.Disposable {
  private _pluginStorage = new Map<string, Storage>();

  public create() {
    // nothing to do
  }

  /**
   * Make interfaces available for a plugin with a given name.  Implementations
   * are attached directly to the supplied rpc object.
   */
  public servePlugin(pluginId: string, rpc: Rpc) {
    // We have just one interface right now, storage.  We want to keep ownership
    // of storage, so it doesn't go away when the plugin is closed.  So we cache
    // it.
    let storage = this._pluginStorage.get(pluginId);
    if (!storage) {
      storage = this._implementStorage();
      this._pluginStorage.set(pluginId, storage);
    }
    rpc.registerImpl<Storage>("storage", storage, checkers.Storage);
  }

  /**
   * Create an implementation of the Storage interface.
   */
  private _implementStorage(): Storage {
    const data = new Map<string, any>();
    return {
      getItem(key: string): any {
        return data.get(key);
      },
      hasItem(key: string): boolean {
        return data.has(key);
      },
      setItem(key: string, value: any) {
        data.set(key, value);
      },
      removeItem(key: string) {
        data.delete(key);
      },
      clear() {
        data.clear();
      },
    };
  }
}
