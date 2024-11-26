import * as express from 'express';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import SCIMMY from "scimmy";
import SCIMMYRouters from "scimmy-routers";
import { RequestWithLogin } from 'app/server/lib/Authorizer';
import { InstallAdmin } from 'app/server/lib/InstallAdmin';
import { RequestContext } from 'app/server/lib/scim/v2/ScimTypes';
import { getScimUserConfig } from 'app/server/lib/scim/v2/ScimUserController';

const WHITELISTED_PATHS_FOR_NON_ADMINS = [ "/Me", "/Schemas", "/ResourceTypes", "/ServiceProviderConfig" ];

const buildScimRouterv2 = (dbManager: HomeDBManager, installAdmin: InstallAdmin) => {
  const v2 = express.Router();

  function checkAccess(context: RequestContext) {
    const {isAdmin, isScimUser, path } = context;
    if (!isAdmin && !isScimUser && !WHITELISTED_PATHS_FOR_NON_ADMINS.includes(path)) {
      throw new SCIMMY.Types.Error(403, null!, 'You are not authorized to access this resource');
    }
  }

  SCIMMY.Resources.declare(SCIMMY.Resources.User, getScimUserConfig(dbManager, checkAccess));

  const scimmyRouter = new SCIMMYRouters({
    type: 'bearer',
    handler: async (request: express.Request) => {
      const mreq = request as RequestWithLogin;
      if (mreq.userId === undefined) {
        // Note that any Error thrown here is automatically converted into a 403 response by SCIMMYRouters.
        throw new Error('You are not authorized to access this resource!');
      }

      if (mreq.userId === dbManager.getAnonymousUserId()) {
        throw new Error('Anonymous users cannot access SCIM resources');
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
