/**
 * Module to manage the clients of an ActiveDoc. It keeps track of how many clients have the doc
 * open, and what FD they are using.
 */

import {CommDocEventType} from 'app/common/CommTypes';
import {arrayRemove} from 'app/common/gutil';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Authorizer} from 'app/server/lib/Authorizer';
import {Client} from 'app/server/lib/Client';
import {sendDocMessage} from 'app/server/lib/Comm';
import {DocSession, OptDocSession} from 'app/server/lib/DocSession';
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
  public addClient(client: Client, authorizer: Authorizer): DocSession {
    const docSession = client.addDocSession(this.activeDoc, authorizer);
    this._docSessions.push(docSession);
    this._log.debug(docSession, "now %d clients; new client is %s (fd %s)",
      this._docSessions.length, client.clientId, docSession.fd);
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
  }

  /**
   * Removes all active clients from this document, i.e. closes all DocSessions.
   */
  public removeAllClients(): void {
    this._log.debug(null, "removeAllClients() removing %s docSessions", this._docSessions.length);
    const docSessions = this._docSessions.splice(0);
    for (const docSession of docSessions) {
      docSession.client.removeDocSession(docSession.fd);
    }
  }

  public interruptAllClients() {
    this._log.debug(null, "interruptAllClients() interrupting %s docSessions", this._docSessions.length);
    for (const docSession of this._docSessions) {
      docSession.client.interruptConnection();
    }
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
                                   filterMessage?: (docSession: OptDocSession,
                                                    messageData: any) => Promise<any>): Promise<void> {
    const send = (curr: DocSession) => this._send(curr, client, type, messageData, filterMessage);
    if (Deps.BROADCAST_ORDER === 'parallel') {
      await Promise.all(this._docSessions.map(send));
    } else {
      for (const session of this._docSessions) {
        await send(session);
      }
    }
    if (type === "docUserAction" && messageData.docActions) {
      for (const action of messageData.docActions) {
        this.activeDoc.docPluginManager.receiveAction(action);
      }
    }
  }

  /**
   * Send a message to a single client. See broadcastDocMessage for parameters.
   */
  private async _send(target: DocSession, client: Client|null, type: CommDocEventType, messageData: any,
                      filterMessage?: (docSession: OptDocSession,
                                       messageData: any) => Promise<any>): Promise<void> {
    const fromSelf = (target.client === client);
    try {
      // Make sure user still has view access.
      await target.authorizer.assertAccess('viewers');
      if (!filterMessage) {
        sendDocMessage(target.client, target.fd, type, messageData, fromSelf);
      } else {
        try {
          const filteredMessageData = await filterMessage(target, messageData);
          if (filteredMessageData) {
            sendDocMessage(target.client, target.fd, type, filteredMessageData, fromSelf);
          } else {
            this._log.debug(target, 'skip broadcastDocMessage because it is not allowed for this client');
          }
        } catch (e) {
          if (e.code && e.code === 'NEED_RELOAD') {
            sendDocMessage(target.client, target.fd, 'docShutdown', null, fromSelf);
          } else {
            sendDocMessage(target.client, target.fd, 'docUserAction', {error: String(e)}, fromSelf);
          }
        }
      }
    } catch (e) {
      if (e.code === 'AUTH_NO_VIEW') {
        // Skip sending data to this user, they have no view access.
        this._log.debug(target, 'skip broadcastDocMessage because AUTH_NO_VIEW');
        // Go further and trigger a shutdown for this user, in case they are granted
        // access again later.
        sendDocMessage(target.client, target.fd, 'docShutdown', null, fromSelf);
      } else {
        throw(e);
      }
    }
  }
}
