import { UserProfile } from "app/common/LoginSessionAPI";
import { UserOptions } from "app/common/UserAPI";
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

