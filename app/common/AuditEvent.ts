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
     * The event details.
     */
    details: AuditEventDetails[Name] | {};
    /**
     * The context of the event.
     */
    context: AuditEventContext;
    /**
     * The source of the event.
     */
    source: AuditEventSource;
  };
  /**
   * ISO 8601 timestamp of when the event occurred.
   */
  timestamp: string;
}

export type AuditEventName =
  | 'createDocument'
  | 'moveDocument'
  | 'removeDocument'
  | 'deleteDocument'
  | 'restoreDocumentFromTrash'
  | 'runSQLQuery';

export type AuditEventUser =
  | User
  | Anonymous
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

interface Unknown {
  type: 'unknown';
}

export interface AuditEventDetails {
  /**
   * A new document was created.
   */
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
  /**
   * A document was moved to a new workspace.
   */
  moveDocument: {
    /**
     * The ID of the document.
     */
    id: string;
    /**
     * The previous workspace.
     */
    previous: {
      /**
       * The workspace the document was moved from.
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
     * The current workspace.
     */
    current: {
      /**
       * The workspace the document was moved to.
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
  };
  /**
   * A document was moved to the trash.
   */
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
  /**
   * A document was permanently deleted.
   */
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
  /**
   * A document was restored from the trash.
   */
  restoreDocumentFromTrash: {
    /**
     * The restored document.
     */
    document: {
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
     * The workspace of the restored document.
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
   * A SQL query was run against a document.
   */
  runSQLQuery: {
    /**
     * The SQL query.
     */
    query: string;
    /**
     * The arguments used for query parameters, if any.
     */
    arguments?: (string | number)[];
    /**
     * The duration in milliseconds until query execution should time out.
     */
    timeout?: number;
  };
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
   * The domain of the org tied to the originating request.
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
