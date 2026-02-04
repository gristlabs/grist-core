import { Login } from "app/gen-server/entity/Login";
import { User } from "app/gen-server/entity/User";
import { HomeDBManager, Scope } from "app/gen-server/lib/homedb/HomeDBManager";
import { BaseController } from "app/server/lib/scim/v2/BaseController";
import { RequestContext } from "app/server/lib/scim/v2/ScimTypes";
import { toSCIMMYUser, toUserProfile } from "app/server/lib/scim/v2/ScimUtils";

import SCIMMY from "scimmy";
import { Filter } from "scimmy/types";
import {
  FindOptionsWhere, LessThan, LessThanOrEqual, MoreThan, MoreThanOrEqual,
  Not, ObjectLiteral, Raw,
} from "typeorm";

type UserSchema = SCIMMY.Schemas.User;
type UserResource = SCIMMY.Resources.User;

class ScimUserController extends BaseController {
  public constructor(
    dbManager: HomeDBManager,
    checkAccess: (context: RequestContext) => void,
  ) {
    super(dbManager, checkAccess);
    this.invalidIdError = "Invalid passed user ID";
  }

  /**
   * Gets a single login user with the passed ID.
   *
   * @param resource The SCIMMY user resource performing the operation
   * @param context The request context
   */
  public async getSingleUser(resource: UserResource, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      const user = await this.dbManager.getUser(id);
      if (user?.type !== "login") {
        throw new SCIMMY.Types.Error(404, null!, `User with ID ${id} not found`);
      }
      return toSCIMMYUser(user);
    });
  }

  /**
   * Gets all login users or filters them based on the passed filter.
   *
   * @param resource The SCIMMY user resource performing the operation
   * @param context The request context
   */
  public async getUsers(resource: UserResource, context: RequestContext): Promise<UserSchema[]> {
    return this.runAndHandleErrors(context, async (): Promise<UserSchema[]> => {
      let users: User[];

      const match = this._extractOpAndEmailFromSimpleFilter(resource.filter);

      if (match) {
        const { op, value } = match;
        users = await this.dbManager.getExistingUsersFiltered(
          {
            logins: this._filterByLoginEmail(op, value),
            type: "login",
          },
        );
      } else {
        users = await this.dbManager.getUsers({ type: "login" });
      }

      const scimmyUsers = users.map(user => toSCIMMYUser(user));
      return this.maybeApplyFilter(scimmyUsers, resource.filter, {
        alreadyFiltered: Boolean(match),
      });
    });
  }

  /**
   * Creates a new user with the passed data.
   *
   * @param data The data to create the user with
   * @param context The request context
   */
  public async createUser(data: UserSchema, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      await this._checkEmailCanBeUsed(data.userName);
      const userProfile = toUserProfile(data);
      const newUser = await this.dbManager.getUserByLoginWithRetry(userProfile.email, {
        profile: userProfile,
      });
      return toSCIMMYUser(newUser);
    });
  }

  /**
   * Overwrite a user with the passed data.
   *
   * @param resource The SCIMMY user resource performing the operation
   * @param data The data to overwrite the user with
   * @param context The request context
   */
  public async overwriteUser(resource: UserResource, data: UserSchema, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      if (this.dbManager.getSpecialUserIds().includes(id)) {
        throw new SCIMMY.Types.Error(403, null!, "System user modification not permitted.");
      }
      const user = await this.dbManager.getUser(id);
      if (user?.type !== "login") {
        throw new SCIMMY.Types.Error(404, null!, "unable to find user to update");
      }
      await this._checkEmailCanBeUsed(data.userName, id);
      const updatedUser = await this.dbManager.overwriteUser(id, toUserProfile(data));
      return toSCIMMYUser(updatedUser);
    });
  }

  /**
   * Deletes a user with the passed ID.
   *
   * @param resource The SCIMMY user resource performing the operation
   * @param context The request context
   */
  public async deleteUser(resource: UserResource, context: RequestContext) {
    return this.runAndHandleErrors(context, async () => {
      const id = this.getIdFromResource(resource);
      if (this.dbManager.getSpecialUserIds().includes(id)) {
        throw new SCIMMY.Types.Error(403, null!, "System user deletion not permitted.");
      }
      const user = await this.dbManager.getUser(id);
      if (user?.type !== "login") {
        throw new SCIMMY.Types.Error(404, null!, "user not found");
      }
      const fakeScope: Scope = { userId: id };
      // FIXME: deleteUser should probably be rewritten to not require a scope. We should move
      //        the scope creation to a controller.
      await this.dbManager.deleteUser(fakeScope, id);
    });
  }

  protected maybeApplyFilter<T extends SCIMMY.Types.Schema>(
    prefilteredResults: T[], filter?: SCIMMY.Types.Filter, { alreadyFiltered } = { alreadyFiltered: false },
  ): T[] {
    return alreadyFiltered ? prefilteredResults : super.maybeApplyFilter(prefilteredResults, filter);
  }

  /**
   * Checks if the passed email can be used for a new user or by the existing user.
   *
   * @param email The email to check
   * @param userIdToUpdate The ID of the user to update. Pass this when updating a user,
   * so it won't raise an error if the passed email is already used by this user.
   */
  private async _checkEmailCanBeUsed(email: string, userIdToUpdate?: number) {
    const existingUser = await this.dbManager.getExistingUserByLogin(email);
    if (existingUser !== undefined && existingUser.id !== userIdToUpdate) {
      throw new SCIMMY.Types.Error(409, "uniqueness", "An existing user with the passed email exist.");
    }
  }

  private _extractOpAndEmailFromSimpleFilter(
    filter?: SCIMMY.Types.Filter,
  ): { op: Filter.ValidComparisonStrings, value: string } | null {
    // Ensure we only have a simple filter, with no logical operators (AND / OR / NOT)
    // If the filter has a OR operator, the filter array would have more than one element
    // (in which case we don't treat the case and let scimmy do that).
    const firstFilter = filter?.[0];
    // Also if the filter has a AND operator, the object would have more than one property.
    const propNames = firstFilter && typeof firstFilter === "object" ? Object.keys(firstFilter) : [];
    if (filter?.length !== 1 || propNames.length !== 1) {
      return null;
    }
    // Convert the keys to lowercase
    const propName = propNames[0];
    // NOTE: Have to convert the property name to lower case. See this issue:
    // https://github.com/scimmyjs/scimmy/issues/97
    if (propName.toLowerCase() === "username") {
      return { op: firstFilter[propName][0], value: firstFilter[propName][1] };
    }
    if (propName.toLowerCase() === "email") {
      const emailFilter = firstFilter[propName];
      const emailKeys = Object.keys(emailFilter);
      if (emailKeys.length === 1 && emailKeys[0].toLowerCase() === "value") {
        const emailValueComp = emailFilter[emailKeys[0]];
        return { op: emailValueComp[0], value: emailValueComp[1] };
      }
    }
    return null;
  }

  private _filterByLoginEmail(
    operator: Filter.ValidComparisonStrings, value: string,
  ): FindOptionsWhere<Login> | undefined {
    const escapeLikePattern = (value: string) => value.replace(/[\\%_]/g, "\\$&");
    const likeWithEscape = (params: ObjectLiteral) => Raw(col => `${col} LIKE :value ESCAPE '\\'`, params);

    switch (operator) {
      case "eq":
        return { email: value };
      case "ne":
        return { email: Not(value) };
      case "pr":
        return undefined; // Email is not null, so don't filter anything
      case "sw":
        return { email: likeWithEscape({ value: `${escapeLikePattern(value)}%` }) };
      case "ew":
        return { email: likeWithEscape({ value: `%${escapeLikePattern(value)}` }) };
      case "co":
        return { email: likeWithEscape({ value: `%${escapeLikePattern(value)}%` }) };
      case "lt":
        return { email: LessThan(value) };
      case "le":
        return { email: LessThanOrEqual(value) };
      case "gt":
        return { email: MoreThan(value) };
      case "ge":
        return { email: MoreThanOrEqual(value) };
      case "np": // Surprisingly seems supported by Scimmy but not specified in RFC. We don't support it.
      default:
        throw new SCIMMY.Types.Error(500, null!, "Unknown operator: " + operator);
    }
  }
}

export function getScimUserConfig(
  dbManager: HomeDBManager, checkAccess: (context: RequestContext) => void,
) {
  const controller = new ScimUserController(dbManager, checkAccess);

  return {
    egress: async (
      resource: UserResource, context: RequestContext,
    ): Promise<UserSchema | UserSchema[]> => {
      if (resource.id) {
        return await controller.getSingleUser(resource, context);
      }
      return await controller.getUsers(resource, context);
    },
    ingress: async (
      resource: UserResource, data: UserSchema, context: RequestContext,
    ): Promise<UserSchema> => {
      if (resource.id) {
        return await controller.overwriteUser(resource, data, context);
      }
      return await controller.createUser(data, context);
    },
    degress: async (resource: UserResource, context: RequestContext): Promise<void> => {
      return await controller.deleteUser(resource, context);
    },
  };
}
