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
  // special permissions for creating, plugins, system, and share access
  mode?: 'nascent'|'plugin'|'system'|'share';
  authorizer?: Authorizer;
  forkingAsOwner?: boolean;  // Set if it is appropriate in a pre-fork state to become an owner.
}

export function makeOptDocSession(client: Client|null, browserSettings?: BrowserSettings): OptDocSession {
  if (client && !browserSettings) { browserSettings = client.browserSettings; }
  if (client && browserSettings && !browserSettings.locale) { browserSettings.locale = client.locale; }
  return {client, browserSettings};
}

/**
 * Create an OptDocSession with special access rights.
 *  - nascent: user is treated as owner (because doc is being created)
 *  - plugin: user is treated as editor (because plugin access control is crude)
 *  - system: user is treated as owner (because of some operation bypassing access control)
 */
export function makeExceptionalDocSession(mode: 'nascent'|'plugin'|'system'|'share',
                                          options: {client?: Client,
                                                    req?: RequestWithLogin,
                                                    browserSettings?: BrowserSettings} = {}): OptDocSession {
  const docSession = makeOptDocSession(options.client || null, options.browserSettings);
  docSession.mode = mode;
  docSession.req = options.req;
  return docSession;
}

/**
 * Create an OptDocSession from a request.  Request should have user and doc access
 * middleware.
 */
export function docSessionFromRequest(req: RequestWithLogin): OptDocSession {
  return {client: null, req};
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

  public forkingAsOwner?: boolean;

  constructor(
    public readonly activeDoc: ActiveDoc,
    public readonly client: Client,
    public readonly fd: number,
    public readonly authorizer: Authorizer
  ) {}

  // Browser settings (like timezone) obtained from the Client.
  public get browserSettings(): BrowserSettings { return this.client.browserSettings; }
}
