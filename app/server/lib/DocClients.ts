/**
 * Module to manage the clients of an ActiveDoc. It keeps track of how many clients have the doc
 * open, and what FD they are using.
 */

import {VisibleUserProfile} from 'app/common/ActiveDocAPI';
import {CommDocEventType, CommMessage} from 'app/common/CommTypes';
import {arrayRemove} from 'app/common/gutil';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Client} from 'app/server/lib/Client';
import {DocSession, DocSessionPrecursor} from 'app/server/lib/DocSession';
import {LogMethods} from "app/server/lib/LogMethods";

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

  // TODO - See if we make DocSession more specific, when everything is working.
  public async listVisibleUserProfiles(viewingDocSession: DocSession): Promise<VisibleUserProfile[]> {
    const otherDocSessions = this._docSessions.filter(s => s.client.clientId !== viewingDocSession.client.clientId);
    const userProfiles = await Promise.all(
      otherDocSessions.map(s => getVisibleUserProfileFromDocSession(s, viewingDocSession))
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
    this.broadcastDocMessage(
      originSession.client,
      "docUserPresenceUpdate",
      undefined,
      // TODO - This being async means we've got a potential linear sequence of DB queries for every client.
      async (destSession: DocSession, messageData: any) => {
        // TODO - If a user has their access removed, they need to refresh their own user list
        const profile = await getVisibleUserProfileFromDocSession(originSession, destSession);
        if (!profile) { return Promise.resolve(); }
        return {
          id: getVisibleUserProfileId(originSession),
          profile
        };
      }
    ).catch(err => {
      this._log.error(originSession, "failed to broadcast user presence session update: %s", err);
    });
  }

  private _broadcastUserPresenceSessionRemoval(originSession: DocSession) {
    this.broadcastDocMessage(
      originSession.client,
      "docUserPresenceUpdate",
      undefined,
      async (destSession: DocSession, messageData: any) => {
        return {
          id: getVisibleUserProfileId(originSession),
          profile: undefined,
        };
      }
    ).catch(err => {
      this._log.error(originSession, "failed to broadcast user presence session removal: %s", err);
    });
  }
}

// TODO - It would be nice to decrease the abstraction level on these parameters when this is working,
//        and make them more specific.
async function getVisibleUserProfileFromDocSession(
  session: DocSession, viewingSession: DocSession
): Promise<VisibleUserProfile | undefined> {
  // TODO - I'm not sure we actually expose enough information anywhere in the auth code
  //        to know if a user is explicitly added to the document or not - specifically the
  //        "logged in, but not added to the doc" case.
  //        Ideally this would be cached in the DocAuthorizer!!
  //        `getDocAccess` could be an expensive workaround that needs removing before release!
  const isPublic = !viewingSession.client.authSession.userIsAuthorized;

  // Viewers without explicit access to the document (either directly or via orgs/groups/etc) can't
  // see other users.
  if (isPublic) {
    return undefined;
  }

  // Only owners and editors can see others.
  try {
    // TODO - It would be better to not be relying on an exception here as essential control flow...
    // TODO - If we could rely on cached auth here, or pre-cache the auth higher up,
    //        we could make this whole function non-async.
    await viewingSession.authorizer.assertAccess('editors');
  } catch (e) {
    return undefined;
  }

  // TODO - If session has a logged in user who isn't explicitly added, they should show as anonymous.
  //        That's not something we readily have access to here right now.
  const user = session.client.authSession.fullUser;
  const isAnonymous = !(session.client.authSession.userIsAuthorized && Boolean(user));
  return {
    id: getVisibleUserProfileId(session),
    name: (isAnonymous ? "Anonymous User" : user?.name) || "Unknown User",
    picture: user?.picture,
    isAnonymous,
  };
}

function getVisibleUserProfileId(session: DocSession): string {
  return session.client.publicClientId;
}
