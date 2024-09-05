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

async function isAuthorizedAction(mreq: RequestWithLogin, installAdmin: InstallAdmin): Promise<boolean> {
  const isAdmin = await installAdmin.isAdminReq(mreq);
  const isScimUser = Boolean(process.env.GRIST_SCIM_EMAIL && mreq.user?.loginEmail === process.env.GRIST_SCIM_EMAIL);
  return isAdmin || isScimUser || WHITELISTED_PATHS_FOR_NON_ADMINS.includes(mreq.path);
}

const buildScimRouterv2 = (dbManager: HomeDBManager, installAdmin: InstallAdmin) => {
  const v2 = express.Router();

  SCIMMY.Resources.declare(SCIMMY.Resources.User, {
    egress: async (resource: any) => {
      const { filter } = resource;
      const id = parseInt(resource.id, 10);
      if (id) {
        const user = await dbManager.getUser(id);
        if (!user) {
          throw new SCIMMY.Types.Error(404, null!, `User with ID ${id} not found`);
        }
        return toSCIMMYUser(user);
      }
      const scimmyUsers = (await dbManager.getUsers()).map(user => toSCIMMYUser(user));
      return filter ? filter.match(scimmyUsers) : scimmyUsers;
    },
    ingress: async (resource: any, data: any) => {
      try {
        const id = parseInt(resource.id, 10);
        if (id) {
          const updatedUser = await dbManager.overrideUser(id, toUserProfile(data));
          return toSCIMMYUser(updatedUser);
        }
        const userProfileToInsert = toUserProfile(data);
        const maybeExistingUser = await dbManager.getExistingUserByLogin(userProfileToInsert.email);
        if (maybeExistingUser !== undefined) {
          throw new SCIMMY.Types.Error(409, 'uniqueness', 'An existing user with the passed email exist.');
        }
        const newUser = await dbManager.getUserByLoginWithRetry(userProfileToInsert.email, {
          profile: userProfileToInsert
        });
        return toSCIMMYUser(newUser!);
      } catch (ex) {
        if (ex instanceof ApiError) {
          if (ex.status === 409) {
            throw new SCIMMY.Types.Error(ex.status, 'uniqueness', ex.message);
          }
          throw new SCIMMY.Types.Error(ex.status, null!, ex.message);
        }

        // FIXME: Remove this part and find another way to detect a constraint error.
        if (ex.code?.startsWith('SQLITE')) {
          switch (ex.code) {
            case 'SQLITE_CONSTRAINT':
              // Return a 409 error if a conflict is detected (e.g. email already exists)
              // "uniqueness" is an error code expected by the SCIM RFC for this case.
              // FIXME: the emails are unique in the database, but this is not enforced in the schema.
              throw new SCIMMY.Types.Error(409, 'uniqueness', ex.message);
            default:
              throw new SCIMMY.Types.Error(500, 'serverError', ex.message);
          }
        }

        throw ex;
      }
    },
    degress: async (resource: any) => {
      const id = parseInt(resource.id, 10);
      const fakeScope: Scope = { userId: id }; // FIXME: deleteUser should probably better not requiring a scope.
      try {
        await dbManager.deleteUser(fakeScope, id);
      } catch (ex) {
        console.error('Error deleting user', ex);
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

      if (!await isAuthorizedAction(mreq, installAdmin)) {
        throw new SCIMMY.Types.Error(403, null!, 'Resource disallowed for non-admin users');
      }
      return String(mreq.userId); // HACK: SCIMMYRouters requires the userId to be a string.
    }
  }) as express.Router; // Have to cast it into express.Router. See https://github.com/scimmyjs/scimmy-routers/issues/24

  return v2.use('/', scimmyRouter);
};

export { buildScimRouterv2 };
