import { FullUser, UserProfile } from "app/common/LoginSessionAPI";
import { UserOptions } from "app/common/UserAPI";
import * as roles from 'app/common/roles';
import { Document } from "app/gen-server/entity/Document";
import { Group } from "app/gen-server/entity/Group";
import { AccessOptionWithRole, Organization } from "app/gen-server/entity/Organization";
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
  options?: Partial<UserOptions>;
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

// Defines a subset of HomeDBManager used for logins. In practice we still just pass around
// the full HomeDBManager, but this makes it easier to know which of its methods matter.
export interface HomeDBAuth {
  getAnonymousUserId(): number;
  getSupportUserId(): number;
  getAnonymousUser(): User;
  getUser(userId: number, options?: {includePrefs?: boolean}): Promise<User|undefined>;
  getUserByKey(apiKey: string): Promise<User|undefined>;
  getUserByLogin(email: string, options?: GetUserOptions): Promise<User>;
  getUserByLoginWithRetry(email: string, options?: GetUserOptions): Promise<User>;
  getBestUserForOrg(users: AvailableUsers, org: number|string): Promise<AccessOptionWithRole|null>;
  makeFullUser(user: User): FullUser;
}
