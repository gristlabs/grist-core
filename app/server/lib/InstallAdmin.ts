import { ApiError } from "app/common/ApiError";
import { normalizeEmail } from "app/common/emails";
import { InstallAdminInfo } from "app/common/LoginSessionAPI";
import { User } from "app/gen-server/entity/User";
import { HomeDBManager, SUPPORT_EMAIL } from "app/gen-server/lib/homedb/HomeDBManager";
import { appSettings } from "app/server/lib/AppSettings";
import { getUser, RequestWithLogin } from "app/server/lib/Authorizer";
import { getAdminEmail } from "app/server/lib/gristSettings";

import express from "express";

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
        throw new ApiError("Access denied", 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  }
}

// Considers the user whose email matches GRIST_ADMIN_EMAIL env var, if set, to be the
// installation admin.
// If GRIST_ADMIN_EMAIL is not set, we fall back on GRIST_DEFAULT_EMAIL, and finally
// GRIST_SUPPORT_EMAIL, which defaults to support@getgrist.com.
export class SimpleInstallAdmin extends InstallAdmin {
  private _defaultEmail = getDefaultEmail();

  public constructor(private _dbManager: HomeDBManager) {
    super();
  }

  public override async getAdminUser(): Promise<User> {
    return this._dbManager.getUserByLoginWithRetry(this._adminOrDefaultEmail);
  }

  public override async isAdminUser(user: User): Promise<boolean> {
    if (!user.loginEmail || !this._adminOrDefaultEmail) { return false; }
    return normalizeEmail(user.loginEmail) === normalizeEmail(this._adminOrDefaultEmail);
  }

  public override clearCaches(): void {}

  private get _adminOrDefaultEmail(): string {
    return this._adminEmail || this._defaultEmail || SUPPORT_EMAIL;
  }

  private get _adminEmail(): string | undefined {
    return getAdminEmail();
  }

  public override async getAdminUsers(req: express.Request): Promise<InstallAdminInfo[]> {
    const adminEmail = this._adminEmail;
    if (adminEmail) {
      const admin = await this._dbManager.getUserByLogin(adminEmail);
      return [{
        user: admin.toUserProfile(),
        reason: req.t("admin.accountByAdminEmail", { adminEmail }),
      }];
    } else if (this._defaultEmail) {
      const admin = await this._dbManager.getUserByLogin(this._defaultEmail);
      return [{
        user: admin.toUserProfile(),
        reason: req.t("admin.accountByEmail", { defaultEmail: this._defaultEmail }),
      }];
    } else {
      return [{
        user: null,
        reason: req.t("admin.noAdminEmail"),
      }];
    }
  }
}

/**
 * Returns the value of `GRIST_DEFAULT_EMAIL` from {@link appSettings}.
 */
export function getDefaultEmail() {
  return appSettings.section("access").flag("defaultEmail").readString({
    envVar: "GRIST_DEFAULT_EMAIL",
  });
}
