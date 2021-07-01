import {BasketClientAPI} from 'app/common/BasketClientAPI';
import {DocListAPI} from 'app/common/DocListAPI';
import {LoginSessionAPI} from 'app/common/LoginSessionAPI';
import {EmailResult, Invite} from 'app/common/sharing';
import {UserConfig} from 'app/common/UserConfig';

export interface GristServerAPI extends
  DocListAPI,
  LoginSessionAPI,
  BasketClientAPI,
  UserAPI,
  SharingAPI,
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

interface SharingAPI {
  /**
   * Looks up a user account by email, return an object with basic user profile information.
   */
  lookupEmail(email: string): Promise<EmailResult|null>;

  /**
   * Fetches and saves invites from the hub which are not already present locally.
   * Returns the new invites from the hub only.
   */
  getNewInvites(): Promise<Invite[]>;

  /**
   * Fetches local invites and marks them all as read.
   */
  getLocalInvites(): Promise<Invite[]>;

  /**
   * Marks the stored local invite belonging to the calling instance as ignored.
   * Called when the user declines an invite.
   */
  ignoreLocalInvite(docId: string): Promise<void>;

}

interface MiscAPI {
  showItemInFolder(docName: string): Promise<void>;
}
