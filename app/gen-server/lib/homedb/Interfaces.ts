import { UserProfile } from "app/common/LoginSessionAPI";
import { UserOptions } from "app/common/UserAPI";
import * as roles from 'app/common/roles';
import { Document } from "app/gen-server/entity/Document";
import { Group } from "app/gen-server/entity/Group";
import { Organization } from "app/gen-server/entity/Organization";
import { User } from "app/gen-server/entity/User";
import { Workspace } from "app/gen-server/entity/Workspace";

import { EntityManager } from "typeorm";

export interface QueryResult<T> {
  status: number;
  data?: T;
  errMessage?: string;
}

export interface PreviousAndCurrent<T> {
  previous: T;
  current: T;
}

export interface GetUserOptions {
  manager?: EntityManager;
  profile?: UserProfile;
  userOptions?: UserOptions;
}

export interface UserProfileChange {
  name?: string;
  isFirstTimeUser?: boolean;
}

// A specification of the users available during a request.  This can be a single
// user, identified by a user id, or a collection of profiles (typically drawn from
// the session).
export type AvailableUsers = number | UserProfile[];

export type NonGuestGroup = Group & { name: roles.NonGuestRole };

export type Resource = Organization|Workspace|Document;

export type RunInTransaction = <T>(
  transaction: EntityManager|undefined,
  op: ((manager: EntityManager) => Promise<T>)
) => Promise<T>;

export interface DocumentAccessChanges {
  document: Document;
  accessChanges: Partial<AccessChanges>;
}

export interface WorkspaceAccessChanges {
  workspace: Workspace;
  accessChanges: Partial<Omit<AccessChanges, "publicAccess">>;

}

export interface OrgAccessChanges {
  org: Organization;
  accessChanges: Omit<AccessChanges, "publicAccess" | "maxInheritedAccess">;
}

export interface GroupDescriptor {
  readonly name: roles.Role;
  readonly permissions: number;
  readonly nestParent: boolean;
  readonly orgOnly?: boolean;
}

interface AccessChanges {
  publicAccess: roles.NonGuestRole | null;
  maxInheritedAccess: roles.BasicRole | null;
  users: Array<
    Pick<User, "id" | "name"> & { email?: string } & {
      access: roles.NonGuestRole | null;
    }
  >;
}

