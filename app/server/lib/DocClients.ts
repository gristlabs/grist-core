/**
 * Module to manage the clients of an ActiveDoc. It keeps track of how many clients have the doc
 * open, and what FD they are using.
 */

import {VisibleUserProfile} from 'app/common/ActiveDocAPI';
import {CommDocEventType, CommDocUserPresenceUpdate, CommMessage} from 'app/common/CommTypes';
import {arrayRemove} from 'app/common/gutil';
import * as roles from 'app/common/roles';
import {getRealAccess} from 'app/common/UserAPI';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Client} from 'app/server/lib/Client';
import {DocSession, DocSessionPrecursor} from 'app/server/lib/DocSession';
import {LogMethods} from "app/server/lib/LogMethods";

import {fromPairs} from 'lodash';
import {appSettings} from 'app/server/lib/AppSettings';
import {parseUrlId} from 'app/common/gristUrls';

// Allow tests to impose a serial order for broadcasts if they need that for repeatability.
export const Deps = {
  BROADCAST_ORDER: 'parallel' as 'parallel' | 'series',
};

export class DocClients {
  private _docSessions: DocSession[] = [];
  private _log = new LogMethods('DocClients ', (s: DocSession|null) => this.activeDoc.getLogMeta(s));

  constructor(
    public readonly activeDoc: ActiveDoc
  ) {}

  /**
   * Returns the number of connected clients.
   */
  public clientCount(): number {
    return this._docSessions.length;
  }

  /**
   * Adds a client's open file to the list of connected clients.
   */
  public addClient(client: Client, docSessionPrecursor: DocSessionPrecursor): DocSession {
    const docSession = client.addDocSession(this.activeDoc, docSessionPrecursor);
    this._docSessions.push(docSession);
    this._log.debug(docSession, "now %d clients; new client is %s (fd %s)",
      this._docSessions.length, client.clientId, docSession.fd);
    this._broadcastUserPresenceSessionUpdate(docSession);
    return docSession;
  }

  /**
   * Removes a client from the list of connected clients for this document. In other words, closes
   * this DocSession.
   */
  public removeClient(docSession: DocSession): void {
    this._log.debug(docSession, "removeClient", docSession.client.clientId);
    docSession.client.removeDocSession(docSession.fd);

    if (arrayRemove(this._docSessions, docSession)) {
      this._log.debug(docSession, "now %d clients", this._docSessions.length);
    }

    this._broadcastUserPresenceSessionRemoval(docSession);
  }

  /**
   * Removes all active clients from this document, i.e. closes all DocSessions.
   */
  public removeAllClients(): void {
    this._log.debug(null, "removeAllClients() removing %s docSessions", this._docSessions.length);
    const docSessions = this._docSessions.splice(0);
    for (const docSession of docSessions) {
      docSession.client.removeDocSession(docSession.fd);
      this._broadcastUserPresenceSessionRemoval(docSession);
    }
  }

  public interruptAllClients() {
    this._log.debug(null, "interruptAllClients() interrupting %s docSessions", this._docSessions.length);
    for (const docSession of this._docSessions) {
      docSession.client.interruptConnection();
    }
  }

  public async listVisibleUserProfiles(viewingDocSession: DocSession): Promise<VisibleUserProfile[]> {
    if (isUserPresenceDisabled()) { return []; }
    const otherDocSessions = this._docSessions.filter(s => s.client.clientId !== viewingDocSession.client.clientId);
    const docUserRoles = await this._getDocUserRoles();
    const userProfiles = otherDocSessions.map(
      s => getVisibleUserProfileFromDocSession(s, viewingDocSession, docUserRoles)
    );
    return userProfiles.filter((s?: VisibleUserProfile): s is VisibleUserProfile => s !== undefined);
  }

  /**
   * Broadcasts a message to all clients of this document using Comm.sendDocMessage. Also sends all
   * docAction to active doc's plugin manager.
   * @param {Object} client: Originating client used to set the `fromSelf` flag in the message.
   * @param {String} type: The type of the message, e.g. 'docUserAction'.
   * @param {Object} messageData: The data for this type of message.
   * @param {Object} filterMessage: Optional callback to filter message per client.
   */
  public async broadcastDocMessage(client: Client|null, type: CommDocEventType, messageData: any,
                                   filterMessage?: (docSession: DocSession,
                                                    messageData: any) => Promise<any>): Promise<void> {
    const send = async (target: DocSession) => {
      const msg = await this._prepareMessage(target, type, messageData, filterMessage);
      if (msg) {
        const fromSelf = (target.client === client);
        await target.client.sendMessageOrInterrupt({...msg, docFD: target.fd, fromSelf} as CommMessage);
      }
    };

    if (Deps.BROADCAST_ORDER === 'parallel') {
      await Promise.all(this._docSessions.map(send));
    } else {
      for (const session of this._docSessions) {
        await send(session);
      }
    }
    if (type === "docUserAction" && messageData.docActions) {
      for (const action of messageData.docActions) {
        this.activeDoc.docPluginManager?.receiveAction(action);
      }
    }
  }

  /**
   * Prepares a message to a single client. See broadcastDocMessage for parameters.
   */
  private async _prepareMessage(
    target: DocSession, type: CommDocEventType, messageData: any,
    filterMessage?: (docSession: DocSession, messageData: any) => Promise<any>
  ): Promise<{type: CommDocEventType, data: unknown}|undefined> {
    try {
      // Make sure user still has view access.
      await target.authorizer.assertAccess('viewers');
      if (!filterMessage) {
        return {type, data: messageData};
      } else {
        try {
          const filteredMessageData = await filterMessage(target, messageData);
          if (filteredMessageData) {
            return {type, data: filteredMessageData};
          } else {
            this._log.debug(target, 'skip broadcastDocMessage because it is not allowed for this client');
          }
        } catch (e) {
          if (e.code && e.code === 'NEED_RELOAD') {
            return {type: 'docShutdown', data: null};
          } else {
            return {type: 'docUserAction', data: {error: String(e)}};
          }
        }
      }
    } catch (e) {
      if (e.code === 'AUTH_NO_VIEW') {
        // Skip sending data to this user, they have no view access.
        this._log.debug(target, 'skip broadcastDocMessage because AUTH_NO_VIEW');
        // Go further and trigger a shutdown for this user, in case they are granted
        // access again later.
        return {type: 'docShutdown', data: null};
      } else {
        // Propagate any totally unexpected exceptions.
        throw e;
      }
    }
  }

  private _broadcastUserPresenceSessionUpdate(originSession: DocSession) {
    if (isUserPresenceDisabled()) { return; }
    // Loading the doc user roles first allows the callback to be quick + synchronous,
    // avoiding a potentially linear series of async calls.
    this._getDocUserRoles()
      .then(docUserRoles => this.broadcastDocMessage(
        originSession.client,
        "docUserPresenceUpdate",
        undefined,
        async (destSession: DocSession, messageData: any): Promise<CommDocUserPresenceUpdate["data"] | undefined> => {
          if (originSession === destSession) { return; }
          const profile = getVisibleUserProfileFromDocSession(originSession, destSession, docUserRoles);
          if (!profile) { return; }
          return {
            id: getVisibleUserProfileId(originSession),
            profile
          };
        }
      ))
      .catch(err => {
        this._log.error(originSession, "failed to broadcast user presence session update: %s", err);
      });
  }

  private _broadcastUserPresenceSessionRemoval(originSession: DocSession) {
    if (isUserPresenceDisabled()) { return; }
    this.broadcastDocMessage(
      originSession.client,
      "docUserPresenceUpdate",
      undefined,
      async (destSession: DocSession, messageData: any): Promise<CommDocUserPresenceUpdate["data"] | undefined> => {
        return {
          id: getVisibleUserProfileId(originSession),
          profile: null,
        };
      }
    ).catch(err => {
      this._log.error(originSession, "failed to broadcast user presence session removal: %s", err);
    });
  }

  private async _getDocUserRoles(): Promise<UserIdRoleMap> {
    const homeDb = this.activeDoc.getHomeDbManager();
    const authCache = homeDb?.caches;
    const docId = this.activeDoc.doc?.id;

    // Not enough information - no useful data to be had here.
    if (!homeDb || !docId || !authCache) {
      return {};
    }

    // TODO - Forks error when fetching auth
    if (parseUrlId(docId).forkId) {
      return {};
    }

    const queryResult = await authCache.getDocAccess(docId);
    const { users, maxInheritedRole } = homeDb.unwrapQueryResult(queryResult);

    return fromPairs(users.map(user => [user.id, getRealAccess(user, { maxInheritedRole })]));
  }
}

interface UserIdRoleMap {
  [id: string]: roles.Role | null
}

function getVisibleUserProfileFromDocSession(
  session: DocSession, viewingSession: DocSession, docUserRoles: UserIdRoleMap,
): VisibleUserProfile | undefined {
  // To see other users, you need to be a non-public user (i.e. added to the document), and have
  // at least editor permissions.
  if (!viewingSession.client.authSession.userId) {
    return undefined;
  }

  const viewerRole = docUserRoles[viewingSession.client.authSession.userId];
  if (!roles.canEdit(viewerRole)) {
    return undefined;
  }

  const user = session.client.authSession.fullUser;
  const userId = session.client.authSession.userId;
  const explicitUserRole = userId ? docUserRoles[userId] : null;
  // Only signed-in users that have explicit document access or are a member of the org / workspace
  // have visible details by default.
  const isAnonymous = !explicitUserRole;
  return {
    id: getVisibleUserProfileId(session),
    name: (isAnonymous ? "Anonymous User" : user?.name) || "Unknown User",
    picture: isAnonymous ? undefined : user?.picture,
    isAnonymous,
  };
}

function getVisibleUserProfileId(session: DocSession): string {
  return session.client.publicClientId;
}

export function isUserPresenceDisabled(): boolean {
  return appSettings.section('userPresence').flag('disable').readBool({
    envVar: 'GRIST_USER_PRESENCE_DISABLE',
  }) ?? false;
}
