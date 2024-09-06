import { ApiError } from 'app/common/ApiError';
import { HomeDBManager, Scope } from 'app/gen-server/lib/homedb/HomeDBManager';
import SCIMMY from 'scimmy';
import { toSCIMMYUser, toUserProfile } from './ScimUserUtils';
import { RequestContext } from './ScimTypes';

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

  public async getSingleUser(resource: any, context: RequestContext) {
    this._checkAccess(context);

    const id = ScimUserController._getIdFromResource(resource);
    const user = await this._dbManager.getUser(id);
    if (!user) {
      throw new SCIMMY.Types.Error(404, null!, `User with ID ${id} not found`);
    }
    return toSCIMMYUser(user);
  }

  public async getUsers(resource: any, context: RequestContext) {
    this._checkAccess(context);

    const { filter } = resource;
    const scimmyUsers = (await this._dbManager.getUsers()).map(user => toSCIMMYUser(user));
    return filter ? filter.match(scimmyUsers) : scimmyUsers;
  }

  public async createUser(data: any, context: RequestContext) {
    this._checkAccess(context);

    try {
      await this._checkEmailIsUnique(data.userName);
      const userProfile = toUserProfile(data);
      const newUser = await this._dbManager.getUserByLoginWithRetry(userProfile.email, {
        profile: userProfile
      });
      return toSCIMMYUser(newUser);
    } catch (ex) {
      return this._toScimError(ex);
    }
  }

  public async overrideUser(resource: any, data: any, context: RequestContext) {
    this._checkAccess(context);

    try {
      const id = ScimUserController._getIdFromResource(resource);
      await this._checkEmailIsUnique(data.userName, id);
      const updatedUser = await this._dbManager.overrideUser(id, toUserProfile(data));
      return toSCIMMYUser(updatedUser);
    } catch (ex) {
      return this._toScimError(ex);
    }
  }

  public async deleteUser(resource: any, context: RequestContext) {
    this._checkAccess(context);

    const id = ScimUserController._getIdFromResource(resource);
    try {
      const fakeScope: Scope = { userId: id };
      // FIXME: deleteUser should probably better not requiring a scope.
      await this._dbManager.deleteUser(fakeScope, id);
    } catch (ex) {
      return this._toScimError(ex);
    }
  }

  private async _toScimError(ex: Error) {
    if (ex instanceof ApiError) {
      if (ex.status === 409) {
        throw new SCIMMY.Types.Error(ex.status, 'uniqueness', ex.message);
      }
      throw new SCIMMY.Types.Error(ex.status, null!, ex.message);
    }
    throw ex;
  }

  private async _checkEmailIsUnique(email: string, id?: number) {
    const existingUser = await this._dbManager.getExistingUserByLogin(email);
    if (existingUser !== undefined && existingUser.id !== id) {
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
        return await controller.overrideUser(resource, data, context);
      }
      return await controller.createUser(data, context);
    },
    degress: async (resource: any, context: RequestContext) => {
      return await controller.deleteUser(resource, context);
    }
  };
};
