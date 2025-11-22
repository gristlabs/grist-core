import { FullUser } from "app/common/LoginSessionAPI";
import { BasicRole, NonGuestRole } from "app/common/roles";
import { StringUnion } from "app/common/StringUnion";
import { Config } from "app/gen-server/entity/Config";
import { Document } from "app/gen-server/entity/Document";
import { Organization } from "app/gen-server/entity/Organization";
import { User } from "app/gen-server/entity/User";
import { Workspace } from "app/gen-server/entity/Workspace";
import { PreviousAndCurrent } from "app/gen-server/lib/homedb/Interfaces";

export interface AuditEvent<
  Action extends AuditEventAction = AuditEventAction
> {
  /**
   * The event ID.
   */
  id: string;
  /**
   * The action that was performed.
   */
  action: Action;
  /**
   * Who performed the `action` in the event.
   */
  actor: AuditEventActor;
  /**
   * Where the event originated from.
   */
  context: AuditEventContext;
  /**
   * When the event occurred, in RFC 3339 format.
   */
  timestamp: string;
  /**
   * Additional details about the event.
   */
  details?: AuditEventDetails[Action];
}

export const AuditEventAction = StringUnion(
  "config.create",
  "config.delete",
  "config.update",
  "document.change_access",
  "document.clear_all_webhook_queues",
  "document.clear_webhook_queue",
  "document.create",
  "document.delete",
  "document.deliver_webhook_events",
  "document.disable",
  "document.duplicate",
  "document.enable",
  "document.fork",
  "document.modify",
  "document.move",
  "document.move_to_trash",
  "document.open",
  "document.pin",
  "document.reload",
  "document.rename",
  "document.replace",
  "document.restore_from_trash",
  "document.run_sql_query",
  "document.send_to_google_drive",
  "document.truncate_history",
  "document.unpin",
  "site.change_access",
  "site.create",
  "site.delete",
  "site.rename",
  "user.change_name",
  "user.create_api_key",
  "user.delete",
  "user.delete_api_key",
  "workspace.change_access",
  "workspace.create",
  "workspace.delete",
  "workspace.move_to_trash",
  "workspace.rename",
  "workspace.restore_from_trash"
);

export type AuditEventAction = typeof AuditEventAction.type;

export type AuditEventActor =
  | UserActor
  | GuestActor
  | SystemActor
  | UnknownActor;

interface UserActor {
  type: "user";
  user: Pick<FullUser, "id" | "name" | "email">;
}

interface GuestActor {
  type: "guest";
}

interface SystemActor {
  type: "system";
}

interface UnknownActor {
  type: "unknown";
}

export interface AuditEventContext {
  site?: Pick<Organization, "id"> &
    Partial<Pick<Organization, "name" | "domain">>;
  ip_address?: string;
  user_agent?: string;
  session_id?: string;
}

export interface AuditEventDetails {
  "config.create": {
    config: Pick<Config, "id" | "key" | "value"> & {
      site?: Pick<Organization, "id" | "name" | "domain">;
    };
  };
  "config.delete": {
    config: Pick<Config, "id" | "key" | "value"> & {
      site?: Pick<Organization, "id" | "name" | "domain">;
    };
  };
  "config.update": PreviousAndCurrent<{
    config: Pick<Config, "id" | "key" | "value"> & {
      site?: Pick<Organization, "id" | "name" | "domain">;
    };
  }>;
  "document.change_access": {
    document: Pick<Document, "id" | "name">;
    access_changes: {
      public_access?: NonGuestRole | null;
      max_inherited_access?: BasicRole | null;
      users?: Array<
        Pick<User, "id" | "name"> & { email?: string } & {
          access: NonGuestRole | null;
        }
      >;
    };
  };
  "document.clear_all_webhook_queues": {
    document: Pick<Document, "id">;
  };
  "document.clear_webhook_queue": {
    document: Pick<Document, "id">;
    webhook: {
      id: string;
    };
  };
  "document.create": {
    document: Pick<Document, "id" | "name"> & {
      workspace?: Pick<Workspace, "id" | "name">;
    };
  };
  "document.enable": {
    document: Pick<Document, "id" | "name"> & {
      workspace: Pick<Workspace, "id" | "name">;
    };
  };
  "document.delete": {
    document: Pick<Document, "id" | "name">;
  };
  "document.disable": {
    document: Pick<Document, "id" | "name"> & {
      workspace: Pick<Workspace, "id" | "name">;
    };
  };
  "document.deliver_webhook_events": {
    document: Pick<Document, "id">;
    webhook: {
      id: string;
      events: {
        delivered_to: string;
        quantity: number;
      };
    };
  };
  "document.duplicate": {
    original: {
      document: Pick<Document, "id" | "name">;
    };
    duplicate: {
      document: Pick<Document, "id" | "name"> & {
        workspace: Pick<Workspace, "id">;
      };
    };
    options: {
      as_template: boolean;
    };
  };
  "document.fork": {
    document: Pick<Document, "id" | "name">;
    fork: {
      id: string;
      document_id: string;
      url_id: string;
    };
  };
  "document.modify": {
    action: {
      num: number;
      hash: string | null;
    };
    document: Pick<Document, "id">;
  };
  "document.move": PreviousAndCurrent<{
    document: Pick<Document, "id" | "name"> & {
      workspace: Pick<Workspace, "id" | "name">;
    };
  }>;
  "document.move_to_trash": {
    document: Pick<Document, "id" | "name">;
  };
  "document.open": {
    document: Pick<Document, "id" | "name"> & {
      url_id: string;
      fork_id?: string;
      snapshot_id?: string;
    };
  };
  "document.pin": {
    document: Pick<Document, "id" | "name">;
  };
  "document.reload": {
    document: Pick<Document, "id">;
  };
  "document.rename": PreviousAndCurrent<{
    document: Pick<Document, "id" | "name">;
  }>;
  "document.replace": {
    document: Pick<Document, "id">;
    fork?: {
      document_id: string;
    };
    snapshot?: {
      id: string;
    };
  };
  "document.restore_from_trash": {
    document: Pick<Document, "id" | "name"> & {
      workspace: Pick<Workspace, "id" | "name">;
    };
  };
  "document.run_sql_query": {
    document: Pick<Document, "id">;
    sql_query: {
      statement: string;
      arguments?: Array<string | number> | null;
    };
    options: {
      timeout_ms?: number;
    };
  };
  "document.send_to_google_drive": {
    document: Pick<Document, "id">;
  };
  "document.truncate_history": {
    document: Pick<Document, "id">;
    options: {
      keep_n_most_recent: number;
    };
  };
  "document.unpin": {
    document: Pick<Document, "id" | "name">;
  };
  "site.change_access": {
    site: Pick<Organization, "id" | "name" | "domain">;
    access_changes: {
      users: Array<
        Pick<User, "id" | "name"> & { email?: string } & {
          access: NonGuestRole | null;
        }
      >;
    };
  };
  "site.create": {
    site: Pick<Organization, "id" | "name" | "domain">;
  };
  "site.delete": {
    site: Pick<Organization, "id" | "name" | "domain">;
    error?: string;
  };
  "site.rename": PreviousAndCurrent<{
    site: Pick<Organization, "id" | "name" | "domain">;
  }>;
  "user.change_name": PreviousAndCurrent<{
    user: Pick<User, "id" | "name"> & {
      email?: string;
    };
  }>;
  "user.create_api_key": {
    user: Pick<User, "id" | "name"> & {
      email?: string;
    };
  };
  "user.delete": {
    user: Pick<User, "id" | "name"> & {
      email?: string;
    };
  };
  "user.delete_api_key": {
    user: Pick<User, "id" | "name"> & {
      email?: string;
    };
  };
  "workspace.change_access": {
    workspace: Pick<Workspace, "id" | "name">;
    access_changes: {
      max_inherited_access?: BasicRole | null;
      users?: Array<
        Pick<User, "id" | "name"> & { email?: string } & {
          access: NonGuestRole | null;
        }
      >;
    };
  };
  "workspace.create": {
    workspace: Pick<Workspace, "id" | "name">;
  };
  "workspace.delete": {
    workspace: Pick<Workspace, "id" | "name">;
    error?: string;
  };
  "workspace.move_to_trash": {
    workspace: Pick<Workspace, "id" | "name">;
  };
  "workspace.rename": PreviousAndCurrent<{
    workspace: Pick<Workspace, "id" | "name">;
  }>;
  "workspace.restore_from_trash": {
    workspace: Pick<Workspace, "id" | "name">;
  };
}
