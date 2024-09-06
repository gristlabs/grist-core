import * as express from 'express';
import { HomeDBManager, Scope } from 'app/gen-server/lib/homedb/HomeDBManager';
import SCIMMY from "scimmy";
import SCIMMYRouters from "scimmy-routers";
import { RequestWithLogin } from '../../Authorizer';
import { InstallAdmin } from '../../InstallAdmin';
import { toSCIMMYUser, toUserProfile } from './ScimUserUtils';
import { ApiError } from 'app/common/ApiError';
import { parseInt } from 'lodash';

const WHITELISTED_PATHS_FOR_NON_ADMINS = [ "/Me", "/Schemas", "/ResourceTypes", "/ServiceProviderConfig" ];

interface RequestContext {
  path: string;
  isAdmin: boolean;
  isScimUser: boolean;
}

function checkAccess(context: RequestContext) {
  const {isAdmin, isScimUser, path } = context;
  if (!isAdmin && !isScimUser && !WHITELISTED_PATHS_FOR_NON_ADMINS.includes(path)) {
    throw new SCIMMY.Types.Error(403, null!, 'You are not authorized to access this resource');
  }
}

async function checkEmailIsUnique(dbManager: HomeDBManager, email: string, id?: number) {
  const existingUser = await dbManager.getExistingUserByLogin(email);
  if (existingUser !== undefined && existingUser.id !== id) {
    throw new SCIMMY.Types.Error(409, 'uniqueness', 'An existing user with the passed email exist.');
  }
}

const buildScimRouterv2 = (dbManager: HomeDBManager, installAdmin: InstallAdmin) => {
  const v2 = express.Router();

  SCIMMY.Resources.declare(SCIMMY.Resources.User, {
    egress: async (resource: any, context: RequestContext) => {
      checkAccess(context);

      const { filter } = resource;
      const id = parseInt(resource.id, 10);
      if (!isNaN(id)) {
        const user = await dbManager.getUser(id);
        if (!user) {
          throw new SCIMMY.Types.Error(404, null!, `User with ID ${id} not found`);
        }
        return toSCIMMYUser(user);
      }
      const scimmyUsers = (await dbManager.getUsers()).map(user => toSCIMMYUser(user));
      return filter ? filter.match(scimmyUsers) : scimmyUsers;
    },
    ingress: async (resource: any, data: any, context: RequestContext) => {
      checkAccess(context);

      try {
        const id = parseInt(resource.id, 10);
        if (!isNaN(id)) {
          await checkEmailIsUnique(dbManager, data.userName, id);
          const updatedUser = await dbManager.overrideUser(id, toUserProfile(data));
          return toSCIMMYUser(updatedUser);
        }
        await checkEmailIsUnique(dbManager, data.userName);
        const userProfileToInsert = toUserProfile(data);
        const newUser = await dbManager.getUserByLoginWithRetry(userProfileToInsert.email, {
          profile: userProfileToInsert
        });
        return toSCIMMYUser(newUser);
      } catch (ex) {
        if (ex instanceof ApiError) {
          if (ex.status === 409) {
            throw new SCIMMY.Types.Error(ex.status, 'uniqueness', ex.message);
          }
          throw new SCIMMY.Types.Error(ex.status, null!, ex.message);
        }

        throw ex;
      }
    },
    degress: async (resource: any, context: RequestContext) => {
      checkAccess(context);

      const id = parseInt(resource.id, 10);
      if (isNaN(id)) {
        throw new SCIMMY.Types.Error(400, null!, 'Invalid ID');
      }
      const fakeScope: Scope = { userId: id }; // FIXME: deleteUser should probably better not requiring a scope.
      try {
        await dbManager.deleteUser(fakeScope, id);
      } catch (ex) {
        if (ex instanceof ApiError) {
          throw new SCIMMY.Types.Error(ex.status, null!, ex.message);
        }

        throw new SCIMMY.Types.Error(500, 'serverError', ex.message);
      }
    }
  });

  const scimmyRouter = new SCIMMYRouters({
    type: 'bearer',
    handler: async (request: express.Request) => {
      const mreq = request as RequestWithLogin;
      if (mreq.userId === undefined) {
        // Note that any Error thrown here is automatically converted into a 403 response by SCIMMYRouters.
        throw new Error('You are not authorized to access this resource!');
      }

      if (mreq.userId === dbManager.getAnonymousUserId()) {
        throw new Error('Anonymous user cannot access SCIM resources');
      }

      return String(mreq.userId); // SCIMMYRouters requires the userId to be a string.
    },
    context: async (mreq: RequestWithLogin): Promise<RequestContext> => {
      const isAdmin = await installAdmin.isAdminReq(mreq);
      const isScimUser = Boolean(
        process.env.GRIST_SCIM_EMAIL && mreq.user?.loginEmail === process.env.GRIST_SCIM_EMAIL
      );
      const path = mreq.path;
      return { isAdmin, isScimUser, path };
    }
  }) as express.Router; // Have to cast it into express.Router. See https://github.com/scimmyjs/scimmy-routers/issues/24

  return v2.use('/', scimmyRouter);
};

export { buildScimRouterv2 };
