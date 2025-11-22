import { ApiError } from 'app/common/ApiError';
import { FullUser, UserProfile } from "app/common/LoginSessionAPI";
import { UserOptions } from "app/common/UserAPI";
import * as roles from 'app/common/roles';
import { Document } from "app/gen-server/entity/Document";
import { Group } from "app/gen-server/entity/Group";
import { AccessOptionWithRole, Organization } from "app/gen-server/entity/Organization";
import { User } from "app/gen-server/entity/User";
import { Workspace } from "app/gen-server/entity/Workspace";

import { EntityManager } from "typeorm";
import { GroupTypes } from "app/gen-server/lib/homedb/GroupsManager";
import { ServiceAccount } from 'app/gen-server/entity/ServiceAccount';

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
  disabledAt?: Date|null;
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

export interface RoleGroupDescriptor {
  readonly name: roles.Role;
  readonly permissions: number;
  readonly nestParent: boolean;
  readonly orgOnly?: boolean;
}

export interface GroupWithMembersDescriptor {
  readonly type: GroupTypes;
  readonly name: string;
  readonly memberUsers?: number[];
  readonly memberGroups?: number[];
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

export type ServiceAccountProperties = Partial<Pick<ServiceAccount, 'label' | 'description' | 'expiresAt'>>;

// Identifies a request to access a document. This combination of values is also used for caching
// DocAuthResult for DOC_AUTH_CACHE_TTL.  Other request scope information is passed along.
export interface DocAuthKey {
  urlId: string;              // May be docId. Must be unambiguous in the context of the org.
  userId: number;             // The user accessing this doc. (Could be the ID of Anonymous.)
  org?: string;               // Undefined if unknown (e.g. in API calls, but needs unique urlId).
}

// Document auth info. This is the minimum needed to resolve user access checks. For anything else
// (e.g. doc title), the uncached getDoc() call should be used.
export interface DocAuthResult {
  docId: string|null;         // The unique identifier of the document. Null on error.
  access: roles.Role|null;    // The access level for the requesting user. Null on error.
  removed: boolean|null;      // Set if the doc is soft-deleted. Users may still have access
                              // to removed documents for some purposes. Null on error.
  disabled: boolean|null;     // Removes most user read access and all
                              // write access. Null on error.
  error?: ApiError;
  cachedDoc?: Document;       // For cases where stale info is ok.
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
  getServiceAccountByLoginWithOwner(login: string): Promise<ServiceAccount|null>;
  makeFullUser(user: User): FullUser;
}

// Defines a subset of HomeDBManager needed for doc authorization. In practice we still just pass
// around the full HomeDBManager, but this makes it easier to know which of its methods matter.
export interface HomeDBDocAuth {
  getDocAuthCached(key: DocAuthKey): Promise<DocAuthResult>;
  getAnonymousUserId(): number;
}
