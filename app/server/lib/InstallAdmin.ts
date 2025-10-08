import {ApiError} from 'app/common/ApiError';
import {HomeDBManager, SUPPORT_EMAIL} from 'app/gen-server/lib/homedb/HomeDBManager';
import {InstallAdminInfo} from 'app/common/LoginSessionAPI';
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

  // Returns an administrator user to use as a last resort, needed
  // if a boot key is used.
  public abstract getAdminUser(): Promise<User>;

  // Clear any cached information.
  public abstract clearCaches(): void;

  // Returns all possible admin users
  public abstract getAdminUsers(req: express.Request): Promise<InstallAdminInfo[]>;

  // Returns true if req is authenticated (contains a user) and the user is authorized to manage
  // the Grist installation. This should not fail, only return true or false.
  public async isAdminReq(req: express.Request): Promise<boolean> {
    const user = (req as RequestWithLogin).user;
    return user ? (await this.isAdminUser(user)) : false;
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
// installation admin.
// If GRIST_DEFAULT_EMAIL is not given, we fall back on GRIST_SUPPORT_EMAIL,
// which defaults to support@getgrist.com
export class SimpleInstallAdmin extends InstallAdmin {
  private _installAdminEmail = appSettings.section('access').flag('installAdminEmail').readString({
    envVar: 'GRIST_DEFAULT_EMAIL',
  });

  public constructor(private _dbManager: HomeDBManager) {
    super();
  }

  public override async getAdminUser(): Promise<User> {
    return this._dbManager.getUserByLoginWithRetry(this._adminEmail);
  }

  public override async isAdminUser(user: User): Promise<boolean> {
    return user.loginEmail === this._adminEmail && this._adminEmail !== '';
  }

  public override clearCaches(): void {
  }

  private get _adminEmail(): string {
    return this._installAdminEmail || SUPPORT_EMAIL;
  }

  public override async getAdminUsers(req: express.Request): Promise<InstallAdminInfo[]> {
    if(!this._installAdminEmail) {
      return [{
        user: null,
        reason: req.t('admin.noDefaultEmail'),
      }];
    }

    const installAdmin = await this._dbManager.getUserByLogin(this._installAdminEmail);
    return [{
      user: installAdmin.toUserProfile(),
      reason: req.t('admin.accountByEmail', {defaultEmail: this._installAdminEmail})
    }];
  }
}
