import {BasketClientAPI} from 'app/common/BasketClientAPI';
import {DocListAPI} from 'app/common/DocListAPI';
import {LoginSessionAPI} from 'app/common/LoginSessionAPI';
import {UserConfig} from 'app/common/UserConfig';

export interface GristServerAPI extends
  DocListAPI,
  LoginSessionAPI,
  BasketClientAPI,
  UserAPI,
  MiscAPI {}


interface UserAPI {
  /**
   * Gets the Grist configuration from the server.
   */
  getConfig(): Promise<UserConfig>;

  /**
   * Updates the user configuration and saves it to the server.
   * @param {Object} config - Configuration object to save.
   * @returns {Promise:Object} Configuration object as persisted by the server. You can use it to
   * validate the configuration.
   */
  updateConfig(config: UserConfig): Promise<UserConfig>;

  /**
   * Re-load plugins.
   */
  reloadPlugins(): Promise<void>;
}

interface MiscAPI {
  showItemInFolder(docName: string): Promise<void>;
}
