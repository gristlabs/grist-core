import {BasicRole, NonGuestRole} from 'app/common/roles';
import {StringUnion} from 'app/common/StringUnion';

export interface AuditEvent<Name extends AuditEventName> {
  /**
   * The event.
   */
  event: {
    /**
     * The name of the event.
     */
    name: Name;
    /**
     * The user that triggered the event.
     */
    user: AuditEventUser;
    /**
     * Event-specific details (e.g. IDs of affected resources).
     */
    details: AuditEventDetails[Name] | {};
    /**
     * The context that the event occurred in (e.g. workspace, document).
     */
    context: AuditEventContext;
    /**
     * Information about the source of the event (e.g. IP address).
     */
    source: AuditEventSource;
  };
  /**
   * ISO 8601 timestamp (e.g. `2024-09-04T14:54:50Z`) of when the event occurred.
   */
  timestamp: string;
}

export const SiteAuditEventName = StringUnion(
  'createDocument',
  'sendToGoogleDrive',
  'renameDocument',
  'pinDocument',
  'unpinDocument',
  'moveDocument',
  'removeDocument',
  'deleteDocument',
  'restoreDocumentFromTrash',
  'changeDocumentAccess',
  'openDocument',
  'duplicateDocument',
  'forkDocument',
  'replaceDocument',
  'reloadDocument',
  'truncateDocumentHistory',
  'deliverWebhookEvents',
  'clearWebhookQueue',
  'clearAllWebhookQueues',
  'runSQLQuery',
  'createWorkspace',
  'renameWorkspace',
  'removeWorkspace',
  'deleteWorkspace',
  'restoreWorkspaceFromTrash',
  'changeWorkspaceAccess',
  'renameSite',
  'changeSiteAccess',
);

export type SiteAuditEventName = typeof SiteAuditEventName.type;

export const AuditEventName = StringUnion(
  ...SiteAuditEventName.values,
  'createSite',
  'deleteSite',
  'changeUserName',
  'createUserAPIKey',
  'deleteUserAPIKey',
  'deleteUser',
);

export type AuditEventName = typeof AuditEventName.type;

export type AuditEventUser =
  | User
  | Anonymous
  | System
  | Unknown;

interface User {
  type: 'user';
  id: number;
  email: string;
  name: string;
}

interface Anonymous {
  type: 'anonymous';
}

interface System {
  type: 'system';
}

interface Unknown {
  type: 'unknown';
}

export interface AuditEventDetails {
  createDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The name of the document.
     */
    name?: string;
  };
  sendToGoogleDrive: {
    /**
     * The ID of the document.
     */
    id: string;
  };
  renameDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The previous name of the document.
     */
    previousName: string;
    /**
     * The current name of the document.
     */
    currentName: string;
  };
  pinDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The name of the document.
     */
    name: string;
  };
  unpinDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The name of the document.
     */
    name: string;
  };
  moveDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The workspace the document was moved from.
     */
    previousWorkspace: {
      /**
       * The ID of the workspace.
       */
      id: number;
      /**
       * The name of the workspace.
       */
      name: string;
    };
    /**
     * The workspace the document was moved to.
     */
    newWorkspace: {
      /**
       * The ID of the workspace.
       */
      id: number;
      /**
       * The name of the workspace.
       */
      name: string;
    };
  };
  removeDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The name of the document.
     */
    name: string;
  };
  deleteDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The name of the document.
     */
    name: string;
  };
  restoreDocumentFromTrash: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The name of the document.
     */
    name: string;
    /**
     * The workspace of the document.
     */
    workspace: {
      /**
       * The ID of the workspace.
       */
      id: number;
      /**
       * The name of the workspace.
       */
      name: string;
    };
  };
  changeDocumentAccess: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The access level of the document.
     */
    access: {
      /**
       * The max inherited role.
       */
      maxInheritedRole?: BasicRole | null;
      /**
       * The access level by user ID.
       */
      users?: Record<string, NonGuestRole | null>;
    };
  };
  openDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The name of the document.
     */
    name: string;
    /**
     * The URL ID of the document.
     */
    urlId: string;
    /**
     * The ID of the fork, if the document is a fork.
     */
    forkId?: string;
    /**
     * The ID of the snapshot, if the document is a snapshot.
     */
    snapshotId?: string;
  };
  duplicateDocument: {
    /**
     * The document that was duplicated.
     */
    original: {
      /**
       * The ID of the document.
       */
      id: string;
      /**
       * The name of the document.
       */
      name: string;
      /**
       * The workspace of the document.
       */
      workspace: {
        /**
         * The ID of the workspace.
         */
        id: number;
        /**
         * The name of the workspace.
         */
        name: string;
      };
    };
    /**
     * The newly-duplicated document.
     */
    duplicate: {
      /**
       * The ID of the document.
       */
      id: string;
      /**
       * The name of the document.
       */
      name: string;
    };
    /**
     * If the document was duplicated without any data from the original document.
     */
    asTemplate: boolean;
  };
  forkDocument: {
    /**
     * The document that was forked.
     */
    original: {
      /**
       * The ID of the document.
       */
      id: string;
      /**
       * The name of the document.
       */
      name: string;
    };
    /**
     * The newly-forked document.
     */
    fork: {
      /**
       * The ID of the fork.
       */
      id: string;
      /**
       * The ID of the fork with the trunk ID.
       */
      documentId: string;
      /**
       * The ID of the fork with the trunk URL ID.
       */
      urlId: string;
    };
  };
  replaceDocument: {
    /**
     * The document that was replaced.
     */
    previous: {
      /**
       * The ID of the document.
       */
      id: string;
    };
    /**
     * The newly-replaced document.
     */
    current: {
      /**
       * The ID of the document.
       */
      id: string;
      /**
       * The ID of the snapshot, if the document was replaced with one.
       */
      snapshotId?: string;
    };
  };
  reloadDocument: {},
  truncateDocumentHistory: {
    /**
     * The number of history items kept.
     */
    keep: number;
  },
  deliverWebhookEvents: {
    /**
     * The ID of the webhook.
     */
    id: string;
    /**
     * The host the webhook events were delivered to.
     */
    host: string;
    /**
     * The number of webhook events delivered.
     */
    quantity: number;
  },
  clearWebhookQueue: {
    /**
     * The ID of the webhook.
     */
    id: string;
  },
  clearAllWebhookQueues: {},
  runSQLQuery: {
    /**
     * The SQL query.
     */
    query: string;
    /**
     * The arguments used for query parameters, if any.
     */
    arguments?: Array<string | number>;
    /**
     * The query execution timeout duration in milliseconds.
     */
    timeoutMs?: number;
  };
  createWorkspace: {
    /**
     * The ID of the workspace.
     */
    id: number;
    /**
     * The name of the workspace.
     */
    name: string;
  };
  renameWorkspace: {
    /**
     * The ID of the workspace.
     */
    id: number;
    /**
     * The previous name of the workspace.
     */
    previousName: string;
    /**
     * The current name of the workspace.
     */
    currentName: string;
  };
  removeWorkspace: {
    /**
     * The ID of the workspace.
     */
    id: number;
    /**
     * The name of the workspace.
     */
    name: string;
  };
  deleteWorkspace: {
    /**
     * The ID of the workspace.
     */
    id: number;
    /**
     * The name of the workspace.
     */
    name: string;
  };
  restoreWorkspaceFromTrash: {
    /**
     * The ID of the workspace.
     */
    id: number;
    /**
     * The name of the workspace.
     */
    name: string;
  };
  changeWorkspaceAccess: {
    /**
     * The ID of the workspace.
     */
    id: number;
    /**
     * The access level of the workspace.
     */
    access: {
      /**
       * The max inherited role.
       */
      maxInheritedRole?: BasicRole | null;
      /**
       * The access level by user ID.
       */
      users?: Record<string, NonGuestRole | null>;
    };
  };
  createSite: {
    /**
     * The ID of the site.
     */
    id: number;
    /**
     * The name of the site.
     */
    name: string;
    /**
     * The domain of the site.
     */
    domain: string;
  };
  renameSite: {
    /**
     * The ID of the site.
     */
    id: number;
    /**
     * The previous name and domain of the site.
     */
    previous: {
      /**
       * The name of the site.
       */
      name: string;
      /**
       * The domain of the site.
       */
      domain: string;
    };
    /**
     * The current name and domain of the site.
     */
    current: {
      /**
       * The name of the site.
       */
      name: string;
      /**
       * The domain of the site.
       */
      domain: string;
    };
  };
  deleteSite: {
    /**
     * The ID of the site.
     */
    id: number;
    /**
     * The name of the site.
     */
    name: string;
  };
  changeSiteAccess: {
    /**
     * The ID of the site.
     */
    id: number;
    /**
     * The access level of the site.
     */
    access: {
      /**
       * The access level by user ID.
       */
      users?: Record<string, NonGuestRole | null>;
    };
  };
  changeUserName: {
    /**
     * The previous name of the user.
     */
    previousName: string;
    /**
     * The current name of the user.
     */
    currentName: string;
  };
  createUserAPIKey: {};
  deleteUserAPIKey: {};
  deleteUser: {};
}

export interface AuditEventContext {
  /**
   * The ID of the workspace the event occurred in.
   */
  workspaceId?: number;
  /**
   * The ID of the document the event occurred in.
   */
  documentId?: string;
}

export interface AuditEventSource {
  /**
   * The domain of the site tied to the originating request.
   */
  org?: string;
  /**
   * The IP address of the originating request.
   */
  ipAddress?: string;
  /**
   * The User-Agent HTTP header of the originating request.
   */
  userAgent?: string;
  /**
   * The ID of the session tied to the originating request.
   */
  sessionId?: string;
}
