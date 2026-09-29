import { ApiError } from "app/common/ApiError";
import { normalizeEmail } from "app/common/emails";
import { InstallAdminInfo } from "app/common/LoginSessionAPI";
import { User } from "app/gen-server/entity/User";
import { HomeDBManager, SUPPORT_EMAIL } from "app/gen-server/lib/homedb/HomeDBManager";
import { appSettings } from "app/server/lib/AppSettings";
import { getUser, RequestWithLogin } from "app/server/lib/Authorizer";
import { getAdminEmail } from "app/server/lib/gristSettings";
import log from "app/server/lib/log";

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

// Considers the user whose email matches getEffectiveAdminEmail() to be the installation
// admin, falling back to GRIST_SUPPORT_EMAIL (default support@getgrist.com) when no admin
// email is configured.
export class SimpleInstallAdmin extends InstallAdmin {
  public constructor(private _dbManager: HomeDBManager) {
    super();
    if (!getEffectiveAdminEmail()) {
      log.warn("No install admin email configured (set GRIST_ADMIN_EMAIL)");
    }
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
    return getEffectiveAdminEmail() || SUPPORT_EMAIL;
  }

  public override async getAdminUsers(req: express.Request): Promise<InstallAdminInfo[]> {
    const email = getEffectiveAdminEmail();
    if (!email) {
      return [{
        user: null,
        reason: req.t("admin.noAdminEmail"),
      }];
    }
    const admin = await this._dbManager.getUserByLogin(email);
    // Label which variable supplied the email; the resolution itself is
    // getEffectiveAdminEmail()'s job.
    const reason = getAdminEmail() ?
      req.t("admin.accountByAdminEmail", { adminEmail: email }) :
      req.t("admin.accountByEmail", { defaultEmail: email });
    return [{ user: admin.toUserProfile(), reason }];
  }
}

/**
 * Returns the email of the effective install admin: `GRIST_ADMIN_EMAIL` if configured,
 * falling back to `GRIST_DEFAULT_EMAIL`. This is the single definition of who the install
 * admin is; code that needs to match it should use it rather than duplicate the
 * resolution.
 */
export function getEffectiveAdminEmail(): string | undefined {
  return getAdminEmail() || getDefaultEmail();
}

/**
 * Returns the value of `GRIST_DEFAULT_EMAIL` from {@link appSettings}.
 */
export function getDefaultEmail() {
  return appSettings.section("access").flag("defaultEmail").readString({
    envVar: "GRIST_DEFAULT_EMAIL",
  });
}
