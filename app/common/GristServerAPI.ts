import {BasketClientAPI} from 'app/common/BasketClientAPI';
import {DocListAPI} from 'app/common/DocListAPI';
import {LoginSessionAPI} from 'app/common/LoginSessionAPI';
import {EmailResult, Invite} from 'app/common/sharing';
import {UserConfig} from 'app/common/UserConfig';

export interface GristServerAPI extends
  DocListAPI,
  LoginSessionAPI,
  BasketClientAPI,
  ServerMetricsAPI,
  UserAPI,
  SharingAPI,
  MiscAPI {}


interface ServerMetricsAPI {
  /**
   * Registers the list of client metric names. The calls to pushClientMetrics() send metric
   * values as an array parallel to this list of names.
   */
  registerClientMetrics(clientMetricsList: string[]): Promise<void>;

  /**
   * Sends bucketed client metric data to the server. The .values arrays contain one value for
   * each of the registered metric names, as a parallel array.
   */
  pushClientMetrics(clientBuckets: Array<{startTime: number, values: number[]}>): Promise<void>;
}

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

  /**
   * Downloads a shared doc by creating a new doc and applying the snapshot actions associated
   * with the given docId on the sharing hub. Must be called from a logged in account and instance
   * invited to download the doc. Returns the actual non-conflicting docName used.
   */
  downloadSharedDoc(docId: string, docName: string): Promise<string>;
}

interface MiscAPI {
  showItemInFolder(docName: string): Promise<void>;
}
