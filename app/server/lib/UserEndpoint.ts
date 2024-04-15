import { ApiError } from 'app/common/ApiError';
import { User } from 'app/gen-server/entity/User';
import { NextFunction, Request, Response, Router } from 'express';
import { RequestWithLogin } from './Authorizer';

const userRoute = Router();

userRoute.post('/', async function (req, res) {
  res.status(200).json(req.body);
});

function checkPermissionToUserEndpoint(req: Request, res: Response, next: NextFunction) {
  const mreq = req as RequestWithLogin;
  const adminEmail = process.env.GRIST_DEFAULT_EMAIL;
  if (!adminEmail || mreq.user?.loginEmail !== adminEmail) {
    throw new ApiError('Permission denied', 403);
  }
  return next();
}

export { userRoute, checkPermissionToUserEndpoint };
