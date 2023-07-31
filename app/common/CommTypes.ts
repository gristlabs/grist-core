import {ActionGroup} from 'app/common/ActionGroup';
import {DocAction} from 'app/common/DocActions';
import {FilteredDocUsageSummary} from 'app/common/DocUsage';
import {Product} from 'app/common/Features';
import {UserProfile} from 'app/common/LoginSessionAPI';
import {StringUnion} from 'app/common/StringUnion';

export const ValidEvent = StringUnion(
  'docListAction', 'docUserAction', 'docShutdown', 'docError',
  'docUsage', 'docChatter', 'clientConnect');
export type ValidEvent = typeof ValidEvent.type;


/**
 * A request in the appropriate form for sending to the server.
 */
export interface CommRequest {
  reqId: number;
  method: string;
  args: any[];
}

/**
 * A regular, successful response from the server.
 */
export interface CommResponse {
  reqId: number;
  data: any;
  error?: null;  // TODO: keep until sure server never sets this on regular responses.
}

/**
 * An exceptional response from the server when there is an error.
 */
export interface CommResponseError {
  reqId: number;
  error: string;
  errorCode?: string;
  shouldFork?: boolean;  // if set, the server suggests forking the document.
  details?: any;  // if set, error has extra details available. TODO - the treatment of
                  // details could do with some harmonisation between rest API and ws API,
                  // and between front-end and back-end types.
}

/**
 * A message pushed from the server, not in response to a request.
 */
export interface CommMessageBase {
  type: ValidEvent;
  docFD?: number;
  data?: unknown;
}

export type CommDocMessage = CommDocUserAction | CommDocUsage | CommDocShutdown | CommDocError | CommDocChatter;
export type CommMessage = CommDocMessage | CommDocListAction | CommClientConnect;

export type CommResponseBase = CommResponse | CommResponseError | CommMessage;

export type CommDocEventType = CommDocMessage['type'];

/**
 * Event for a change to the document list.
 * These are sent to all connected clients, regardless of which documents they have open.
 * TODO: This is entirely unused at the moment.
 */
export interface CommDocListAction extends CommMessageBase {
  type: 'docListAction';
  addDocs?: string[];        //  names of documents to add to the docList.
  removeDocs?: string[];     //  names of documents that got removed.
  renameDocs?: string[];     //  [oldName, newName] pairs for renamed docs.
  addInvites?: string[];     //  document invite names to add.
  removeInvites?: string[];  //  documents invite names to remove.
}

/**
 * Event for a user action on a document, or part of one. Sent to all clients that have this
 * document open.
 */
export interface CommDocUserAction extends CommMessageBase {
  type: 'docUserAction';
  docFD: number;           // The file descriptor of the open document, specific to each client.
  fromSelf?: boolean;      // Flag to indicate whether the action originated from this client.

  // ActionGroup object containing user action, and doc actions.
  data: {
    docActions: DocAction[];
    actionGroup: ActionGroup;
    docUsage: FilteredDocUsageSummary;
    error?: string;
  };
}


export enum WebhookMessageType {
  Update = 'webhookUpdate',
  Overflow = 'webhookOverflowError'
}
export interface CommDocChatter extends CommMessageBase {
  type: 'docChatter';
  docFD: number;
  data: {
    webhooks?: {
      type: WebhookMessageType,
      // If present, something happened related to webhooks.
      // Currently, we give no details, leaving it to client
      // to call back for details if it cares.
    },
    // This could also be a fine place to send updated info
    // about other users of the document.
  };
}

/**
 * Event for a change to document usage. Sent to all clients that have this document open.
 */
export interface CommDocUsage extends CommMessageBase {
  type: 'docUsage';
  docFD: number;           // The file descriptor of the open document, specific to each client.
  data: {
    docUsage: FilteredDocUsageSummary;  // Document usage summary.
    product?: Product;                  //Product that was used to compute `data.docUsage`
  };
}

/**
 * Event for when a document is forcibly shutdown, and requires the client to re-open it.
 */
export interface CommDocShutdown extends CommMessageBase {
  type: 'docShutdown';
  docFD: number;
  data: null;
}

/**
 * Event that signals an error while opening a doc.
 */
export interface CommDocError extends CommMessageBase {
  type: 'docError';
  docFD: number;
  data: {
    when: string;
    message: string;
  }
}

/**
 * Event sent by server received when a client first connects.
 */
export interface CommClientConnect extends CommMessageBase {
  type: 'clientConnect';

  // ID for the client, which may be reused if a client reconnects to reattach to its state on
  // the server.
  clientId: string;

  // If set, the reconnecting client cannot be sent all missed messages, and needs to reload.
  needReload?: boolean;

  // Array of serialized messages missed from the server while disconnected.
  missedMessages?: string[];

  // Which version the server reports for itself.
  serverVersion?: string;

  // Object containing server settings and features which should be used to initialize the client.
  settings?: {[key: string]: unknown};

  // Object containing session profile information if the user is signed in, or null otherwise.
  profile: UserProfile|null;

  dup?: boolean;  // Flag that's set to true when it's a duplicate clientConnect message.
}
