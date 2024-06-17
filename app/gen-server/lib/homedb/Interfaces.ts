import { UserProfile } from "app/common/LoginSessionAPI";
import { UserOptions } from "app/common/UserAPI";
import { Group } from "app/gen-server/entity/Group";
import * as roles from 'app/common/roles';
import { Organization } from "app/gen-server/entity/Organization";
import { Workspace } from "app/gen-server/entity/Workspace";
import { Document } from "app/gen-server/entity/Document";
import { EntityManager } from "typeorm";

export interface QueryResult<T> {
  status: number;
  data?: T;
  errMessage?: string;
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

export type RunInTransaction = (
  transaction: EntityManager|undefined,
  op: ((manager: EntityManager) => Promise<any>)
) => Promise<any>;
