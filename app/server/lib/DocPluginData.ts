import {Promisified} from 'app/common/tpromisified';
import {Storage} from 'app/plugin/StorageAPI';
import {DocStorage} from 'app/server/lib/DocStorage';

/**
 * DocPluginData implements a document's `Storage` for plugin.
 */
export class DocPluginData implements Promisified<Storage> {
  constructor(private _docStorage: DocStorage, private _pluginId: string) {
    // nothing to do here
  }
  public async getItem(key: string): Promise<any> {
    const res = await this._docStorage.getPluginDataItem(this._pluginId, key);
    if (typeof res === 'string') {
      return JSON.parse(res);
    }
    return res;
  }
  public hasItem(key: string): Promise<boolean> {
    return this._docStorage.hasPluginDataItem(this._pluginId, key);
  }
  public setItem(key: string, value: any): Promise<void> {
    return this._docStorage.setPluginDataItem(this._pluginId, key, JSON.stringify(value));
  }
  public removeItem(key: string): Promise<void> {
    return this._docStorage.removePluginDataItem(this._pluginId, key);
  }
  public clear(): Promise<void> {
    return this._docStorage.clearPluginDataItem(this._pluginId);
  }

}
