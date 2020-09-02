/**
 * Module to manage the clients of an ActiveDoc. It keeps track of how many clients have the doc
 * open, and what FD they are using.
 */

import {arrayRemove} from 'app/common/gutil';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {Authorizer} from 'app/server/lib/Authorizer';
import {Client} from 'app/server/lib/Client';
import {sendDocMessage} from 'app/server/lib/Comm';
import {DocSession} from 'app/server/lib/DocSession';
import * as log from 'app/server/lib/log';

export class DocClients {
  private _docSessions: DocSession[] = [];

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
    log.debug("DocClients (%s) now has %d clients; new client is %s (fd %s)", this.activeDoc.docName,
      this._docSessions.length, client.clientId, docSession.fd);
    return docSession;
  }

  /**
   * Removes a client from the list of connected clients for this document. In other words, closes
   * this DocSession.
   */
  public removeClient(docSession: DocSession): void {
    log.debug("DocClients.removeClient", docSession.client.clientId);
    docSession.client.removeDocSession(docSession.fd);

    if (arrayRemove(this._docSessions, docSession)) {
      log.debug("DocClients (%s) now has %d clients", this.activeDoc.docName, this._docSessions.length);
    }
  }

  /**
   * Removes all active clients from this document, i.e. closes all DocSessions.
   */
  public removeAllClients(): void {
    log.debug("DocClients.removeAllClients() removing %s docSessions", this._docSessions.length);
    const docSessions = this._docSessions.splice(0);
    for (const docSession of docSessions) {
      docSession.client.removeDocSession(docSession.fd);
    }
  }

  public interruptAllClients() {
    log.debug("DocClients.interruptAllClients() interrupting %s docSessions", this._docSessions.length);
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
   */
  public async broadcastDocMessage(client: Client|null, type: string, messageData: any): Promise<void> {
    await Promise.all(this._docSessions.map(async curr => {
      const fromSelf = (curr.client === client);
      try {
        // Make sure user still has view access.
        await curr.authorizer.assertAccess('viewers');
        sendDocMessage(curr.client, curr.fd, type, messageData, fromSelf);
      } catch (e) {
        if (e.code === 'AUTH_NO_VIEW') {
          // Skip sending data to this user, they have no view access.
          log.rawDebug('skip broadcastDocMessage because AUTH_NO_VIEW', {
            docId: curr.authorizer.getDocId(),
            ...curr.client.getLogMeta()
          });
          // Go further and trigger a shutdown for this user, in case they are granted
          // access again later.
          sendDocMessage(curr.client, curr.fd, 'docShutdown', null, fromSelf);
        } else {
          throw(e);
        }
      }
    }));
    if (type === "docUserAction" && messageData.docActions) {
      for (const action of messageData.docActions) {
        this.activeDoc.docPluginManager.receiveAction(action);
      }
    }
  }
}
