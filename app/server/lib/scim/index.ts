import * as express from 'express';

import { buildScimRouterv2 } from './v2/ScimV2Api';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { InstallAdmin } from '../InstallAdmin';

const buildScimRouter = (dbManager: HomeDBManager, installAdmin: InstallAdmin) => {
  const v2 = buildScimRouterv2(dbManager, installAdmin);
  const scim = express.Router();
  scim.use('/v2', v2);
  return scim;
};

export { buildScimRouter };
