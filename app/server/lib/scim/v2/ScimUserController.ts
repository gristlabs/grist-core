import { ApiError } from 'app/common/ApiError';
import { HomeDBManager, Scope } from 'app/gen-server/lib/homedb/HomeDBManager';
import SCIMMY from 'scimmy';
import { toSCIMMYUser, toUserProfile } from 'app/server/lib/scim/v2/ScimUserUtils';
import { RequestContext } from 'app/server/lib/scim/v2/ScimTypes';
import log from 'app/server/lib/log';

class ScimUserController {
  private static _getIdFromResource(resource: any) {
    const id = parseInt(resource.id, 10);
    if (Number.isNaN(id)) {
      throw new SCIMMY.Types.Error(400, 'invalidValue', 'Invalid passed user ID');
    }
    return id;
  }

  constructor(
    private _dbManager: HomeDBManager,
    private _checkAccess: (context: RequestContext) => void
  ) {}

  /**
   * Gets a single user with the passed ID.
   *
   * @param resource The SCIMMY user resource performing the operation
   * @param context The request context
   */
  public async getSingleUser(resource: any, context: RequestContext) {
    return this._runAndHandleErrors(context, async () => {
      const id = ScimUserController._getIdFromResource(resource);
      const user = await this._dbManager.getUser(id);
      if (!user) {
        throw new SCIMMY.Types.Error(404, null!, `User with ID ${id} not found`);
      }
      return toSCIMMYUser(user);
    });
  }

  /**
   * Gets all users or filters them based on the passed filter.
   *
   * @param resource The SCIMMY user resource performing the operation
   * @param context The request context
   */
  public async getUsers(resource: any, context: RequestContext) {
    return this._runAndHandleErrors(context, async () => {
      const { filter } = resource;
      const scimmyUsers = (await this._dbManager.getUsers()).map(user => toSCIMMYUser(user));
      return filter ? filter.match(scimmyUsers) : scimmyUsers;
    });
  }

  /**
   * Creates a new user with the passed data.
   *
   * @param data The data to create the user with
   * @param context The request context
   */
  public async createUser(data: any, context: RequestContext) {
    return this._runAndHandleErrors(context, async () => {
      await this._checkEmailCanBeUsed(data.userName);
      const userProfile = toUserProfile(data);
      const newUser = await this._dbManager.getUserByLoginWithRetry(userProfile.email, {
        profile: userProfile
      });
      return toSCIMMYUser(newUser);
    });
  }

  /**
   * Overrides a user with the passed data.
   *
   * @param resource The SCIMMY user resource performing the operation
   * @param data The data to override the user with
   * @param context The request context
   */
  public async overwriteUser(resource: any, data: any, context: RequestContext) {
    return this._runAndHandleErrors(context, async () => {
      const id = ScimUserController._getIdFromResource(resource);
      if (this._dbManager.getSpecialUserIds().includes(id)) {
        throw new SCIMMY.Types.Error(403, null!, 'System user modification not permitted.');
      }
      await this._checkEmailCanBeUsed(data.userName, id);
      const updatedUser = await this._dbManager.overwriteUser(id, toUserProfile(data));
      return toSCIMMYUser(updatedUser);
    });
  }

  /**
   * Deletes a user with the passed ID.
   *
   * @param resource The SCIMMY user resource performing the operation
   * @param context The request context
   */
  public async deleteUser(resource: any, context: RequestContext) {
    return this._runAndHandleErrors(context, async () => {
      const id = ScimUserController._getIdFromResource(resource);
      if (this._dbManager.getSpecialUserIds().includes(id)) {
        throw new SCIMMY.Types.Error(403, null!, 'System user deletion not permitted.');
      }
      const fakeScope: Scope = { userId: id };
      // FIXME: deleteUser should probably be rewritten to not require a scope. We should move
      //        the scope creation to a controller.
      await this._dbManager.deleteUser(fakeScope, id);
    });
  }

  /**
   * Runs the passed callback and handles any errors that might occur.
   * Also checks if the user has access to the operation.
   * Any public method of this class should be run through this method.
   *
   * @param context The request context to check access for the user
   * @param cb The callback to run
   */
  private async _runAndHandleErrors<T>(context: RequestContext, cb: () => Promise<T>): Promise<T> {
    try {
      this._checkAccess(context);
      return await cb();
    } catch (err) {
      if (err instanceof ApiError) {
        log.error('[ScimUserController] ApiError: ', err.status, err.message);
        if (err.status === 409) {
          throw new SCIMMY.Types.Error(err.status, 'uniqueness', err.message);
        }
        throw new SCIMMY.Types.Error(err.status, null!, err.message);
      }
      if (err instanceof SCIMMY.Types.Error) {
        log.error('[ScimUserController] SCIMMY.Types.Error: ', err.message);
        throw err;
      }
      // By default, return a 500 error
      log.error('[ScimUserController] Error: ', err.message);
      throw new SCIMMY.Types.Error(500, null!, err.message);
    }
  }

  /**
   * Checks if the passed email can be used for a new user or by the existing user.
   *
   * @param email The email to check
   * @param userIdToUpdate The ID of the user to update. Pass this when updating a user,
   * so it won't raise an error if the passed email is already used by this user.
   */
  private async _checkEmailCanBeUsed(email: string, userIdToUpdate?: number) {
    const existingUser = await this._dbManager.getExistingUserByLogin(email);
    if (existingUser !== undefined && existingUser.id !== userIdToUpdate) {
      throw new SCIMMY.Types.Error(409, 'uniqueness', 'An existing user with the passed email exist.');
    }
  }
}

export const getScimUserConfig = (
  dbManager: HomeDBManager, checkAccess: (context: RequestContext) => void
) => {
  const controller = new ScimUserController(dbManager, checkAccess);

  return {
    egress: async (resource: any, context: RequestContext) => {
      if (resource.id) {
        return await controller.getSingleUser(resource, context);
      }
      return await controller.getUsers(resource, context);
    },
    ingress: async (resource: any, data: any, context: RequestContext) => {
      if (resource.id) {
        return await controller.overwriteUser(resource, data, context);
      }
      return await controller.createUser(data, context);
    },
    degress: async (resource: any, context: RequestContext) => {
      return await controller.deleteUser(resource, context);
    }
  };
};
