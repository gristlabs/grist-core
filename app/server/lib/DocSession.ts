import {BrowserSettings} from 'app/common/BrowserSettings';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Authorizer, RequestWithLogin} from 'app/server/lib/Authorizer';
import {Client} from 'app/server/lib/Client';

/**
 * OptDocSession allows for certain ActiveDoc operations to work with or without an open document.
 * It is useful in particular for actions when importing a file to create a new document.
 */
export interface OptDocSession {
  client: Client|null;
  shouldBundleActions?: boolean;
  linkId?: number;
  browserSettings?: BrowserSettings;
  req?: RequestWithLogin;
}

export function makeOptDocSession(client: Client|null, browserSettings?: BrowserSettings): OptDocSession {
  if (client && !browserSettings) { browserSettings = client.browserSettings; }
  return {client, browserSettings};
}

/**
 * DocSession objects maintain information for a single session<->doc instance.
 */
export class DocSession implements OptDocSession {
  /**
   * Flag to indicate that user actions 'bundle' process is started and in progress (`true`),
   * otherwise it's `false`
   */
  public shouldBundleActions?: boolean;

  /**
   * Indicates the actionNum of the previously applied action
   * to which the first action in actions should be linked.
   * Linked actions appear as one action and can be undone/redone in a single step.
   */
  public linkId?: number;

  constructor(
    public readonly activeDoc: ActiveDoc,
    public readonly client: Client,
    public readonly fd: number,
    public readonly authorizer: Authorizer
  ) {}

  // Browser settings (like timezone) obtained from the Client.
  public get browserSettings(): BrowserSettings { return this.client.browserSettings; }
}
