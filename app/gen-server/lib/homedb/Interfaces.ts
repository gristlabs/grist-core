import { UserProfile } from "app/common/LoginSessionAPI";
import { UserOptions } from "app/common/UserAPI";
import { Group } from "app/gen-server/entity/Group";
import { EntityManager } from "typeorm";
import * as roles from 'app/common/roles';

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

export type NonGuestGroup = Group & { name: roles.NonGuestRole };

