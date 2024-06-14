import { UserProfile } from "app/common/LoginSessionAPI";
import { UserOptions } from "app/common/UserAPI";
import { Group } from "app/gen-server/entity/Group";
import { EntityManager } from "typeorm";
import * as roles from 'app/common/roles';
import { Organization } from "app/gen-server/entity/Organization";
import { Workspace } from "app/gen-server/entity/Workspace";
import { Document } from "app/gen-server/entity/Document";

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

export type NonGuestGroup = Group & { name: roles.NonGuestRole };

export type Resource = Organization|Workspace|Document;
