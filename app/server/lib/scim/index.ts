import * as express from 'express';
import { buildUsersRoute, checkPermissionToUsersEndpoint } from './v2/users';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import SCIMMY from "scimmy";
import SCIMMYRouters from "scimmy-routers";

type SCIMMYResource = typeof SCIMMY.Types.Resource;

const buildScimRouter = (dbManager: HomeDBManager) => {
  const v2 = express.Router();
  v2.use('/Users', checkPermissionToUsersEndpoint, buildUsersRoute(dbManager));

  SCIMMY.Resources.User.ingress(handler)
  SCIMMY.Resources.declare(SCIMMY.Resources.User)
    .ingress((resource: SCIMMYResource, data) => {


    });
  const scim = express.Router();
  scim.use('/v2', v2);
  return scim;
};

export { buildScimRouter };
