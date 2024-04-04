import {ApiError} from 'app/common/ApiError';
import {appSettings} from 'app/server/lib/AppSettings';
import {getUser, RequestWithLogin} from 'app/server/lib/Authorizer';
import {User} from 'app/gen-server/entity/User';
import express from 'express';

/**
 * Class implementing the logic to determine whether a user is authorized to manage the Grist
 * installation.
 */
export abstract class InstallAdmin {

  // Returns true if user is authorized to manage the Grist installation.
  public abstract isAdminUser(user: User): Promise<boolean>;

  // Returns true if req is authenticated (contains a user) and the user is authorized to manage
  // the Grist installation. This should not fail, only return true or false.
  public async isAdminReq(req: express.Request): Promise<boolean> {
    const user = (req as RequestWithLogin).user;
    return user ? this.isAdminUser(user) : false;
  }

  // Returns middleware that fails unless the request includes an authenticated user and this user
  // is authorized to manage the Grist installation.
  public getMiddlewareRequireAdmin(): express.RequestHandler {
    return this._requireAdmin.bind(this);
  }

  private async _requireAdmin(req: express.Request, resp: express.Response, next: express.NextFunction) {
    try {
      // getUser() will fail with 401 if user is not present.
      if (!await this.isAdminUser(getUser(req))) {
        throw new ApiError('Access denied', 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  }
}

// Considers the user whose email matches GRIST_DEFAULT_EMAIL env var, if given, to be the
// installation admin. If not given, then there is no admin.
export class SimpleInstallAdmin extends InstallAdmin {
  private _installAdminEmail = appSettings.section('access').flag('installAdminEmail').readString({
    envVar: 'GRIST_DEFAULT_EMAIL',
  });

  public override async isAdminUser(user: User): Promise<boolean> {
    return this._installAdminEmail ? (user.loginEmail === this._installAdminEmail) : false;
  }
}
