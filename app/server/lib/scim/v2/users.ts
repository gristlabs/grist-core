import express, { NextFunction, Request, Response } from 'express';
import { HomeDBManager } from 'app/gen-server/lib/homedb/HomeDBManager';
import { expressWrap } from '../../expressWrap';
import { integerParam } from '../../requestUtils';
import { ApiError } from 'app/common/ApiError';
import { RequestWithLogin } from '../../Authorizer';

function checkPermissionToUsersEndpoint(req: Request, res: Response, next: NextFunction) {
  const mreq = req as RequestWithLogin;
  const adminEmail = process.env.GRIST_DEFAULT_EMAIL;
  if (!adminEmail || mreq.user?.loginEmail !== adminEmail) {
    throw new ApiError('Permission denied', 403);
  }
  return next();
}

const buildUsersRoute = (dbManager: HomeDBManager) => {
  const userRoute = express.Router();

  async function findUserOrFail(userId: number) {
    const user = await dbManager.getUser(userId);
    if (!user) {
      throw new ApiError('User not found', 404);
    }
    return user;
  }


  userRoute.get('/:id', expressWrap(async (req, res) => {
    const userId = integerParam(req.params.id, 'id');
    const user = await findUserOrFail(userId);
    res.status(200).json(user);
  }));
  return userRoute;
};

export { buildUsersRoute, checkPermissionToUsersEndpoint };
