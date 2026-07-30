import { ApiError } from "app/common/ApiError";
import { normalizeEmail } from "app/common/emails";
import { isEmail } from "app/common/gutil";
import { UserProfile } from "app/common/UserAPI";
import { makeAdminPageConfig } from "app/server/lib/adminPageConfig";
import { appSettings } from "app/server/lib/AppSettings";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { expressWrap, secureJsonErrorHandler } from "app/server/lib/expressWrap";
import { GristLoginMiddleware, GristLoginSystem, GristServer, setUserInSession } from "app/server/lib/GristServer";
import { getAdminEmail, getBootKey, invalidateReloadableSettings } from "app/server/lib/gristSettings";
import { getFallbackLoginProvider } from "app/server/lib/loginSystemHelpers";
import { stringParam } from "app/server/lib/requestUtils";

import express, { Express, Request } from "express";

/**
 * Returns a login system that authenticates a user via a boot key: a secret whose value is only
 * obtainable by an installation operator.
 *
 * By default, all new Grist installations generate a random boot key on first startup and print
 * them to the console:
 *
 * ```
 *   ┌──────────────────────────────────────────┐
 *   │                                          │
 *   │   BOOT KEY: •••••••••••••••••••••        │
 *   │                                          |
 *   |   ...                                    │
 *   |                                          │
 *   └──────────────────────────────────────────┘
 * ```
 *
 * A custom value for the boot key may be specified by an operator via the `GRIST_BOOT_KEY` env
 * variable.
 *
 * To authenticate, a user is first redirected to `/boot` to enter the boot key. After
 * submitting a valid boot key, the user must then enter or confirm the admin email address
 * (`GRIST_ADMIN_EMAIL`). Upon submitting the admin email, a user with the submitted email is
 * created (if needed) and set as the value of `GRIST_ADMIN_EMAIL`, and the user is authenticated
 * as the admin user and redirected to the Admin Panel.
 */
export const getBootKeyLoginSystem = getFallbackLoginProvider(
  "boot-key",
  buildBootKeyLoginSystem,
);

async function buildBootKeyLoginSystem(): Promise<GristLoginSystem> {
  return {
    async getMiddleware(server: GristServer) {
      return new BootKeyLoginMiddleware(server);
    },
    async deleteUser() {},
  };
}

export class BootKeyLoginMiddleware implements GristLoginMiddleware {
  constructor(private _server: GristServer) {}

  public async getLoginRedirectUrl(req: Request, _target: URL): Promise<string> {
    const loginUrl = new URL("/boot", this._server.getHomeUrl(req));
    return loginUrl.href;
  }

  public async getSignUpRedirectUrl(req: Request, target: URL): Promise<string> {
    return this.getLoginRedirectUrl(req, target);
  }

  public async getLogoutRedirectUrl(_req: Request, nextUrl: URL): Promise<string> {
    return nextUrl.href;
  }

  public async addEndpoints(app: Express): Promise<string> {
    app.get("/boot", expressWrap(async (req, res) => {
      await this._server.sendAppPage(req, res, {
        path: "app.html",
        status: 200,
        config: makeAdminPageConfig(this._server),
      });
    }));

    app.post("/boot/verify-boot-key", express.json(), expressWrap(async (req, res) => {
      const bootKey = stringParam(req.body.bootKey, "bootKey");
      const serverBootKey = getBootKey();
      if (bootKey !== serverBootKey?.value) {
        throw new ApiError("Invalid boot key", 401, {
          userError: "Invalid boot key. Please try again.",
        });
      }

      return res.json({ adminEmail: getAdminEmail() ?? null });
    }), secureJsonErrorHandler);

    app.post("/boot/login", express.json(), expressWrap(async (req, res) => {
      const bootKey = stringParam(req.body.bootKey, "bootKey");
      const adminEmail = stringParam(req.body.adminEmail, "adminEmail");
      if (!isEmail(adminEmail)) {
        throw new ApiError("Invalid admin email", 400);
      }

      const serverBootKey = getBootKey();
      if (bootKey !== serverBootKey?.value) {
        throw new ApiError("Invalid boot key", 401);
      }

      const profile = getAdminProfile();
      if (!profile || normalizeEmail(profile.email) !== normalizeEmail(adminEmail)) {
        const activations = this._server.getActivations();
        const envVars = (await activations.current()).prefs?.envVars || {};
        const newEnvVars = { GRIST_ADMIN_EMAIL: adminEmail };
        await activations.updateEnvVars(newEnvVars);
        appSettings.setEnvVars({ ...envVars, ...newEnvVars });
        invalidateReloadableSettings("GRIST_ADMIN_EMAIL");
      }

      // Clear session prior to setting admin user in session so that we have a clean
      // slate. Leaving the session uncleared can result in unpredictable behavior
      // when the setup gate is up due to user-org scoping. For example, routes where
      // the request user is scoped to a user that isn't the admin will result in a
      // redirect to `/boot` even when the session includes the install admin in
      // the users array.
      const sessions = this._server.getSessions();
      const scopedSession = sessions.getOrCreateSessionFromRequest(req);
      const expressSession = (req as RequestWithLogin).session;
      if (expressSession) { expressSession.users = []; expressSession.orgToUser = {}; }
      await scopedSession.clearScopedSession(req);
      sessions.clearCacheIfNeeded();

      await setUserInSession(req, this._server, getRequiredAdminProfile());

      res.sendStatus(204);
    }), secureJsonErrorHandler);

    return "boot-key";
  }
}

function getAdminProfile(): UserProfile | undefined {
  const email = getAdminEmail();
  if (!email) { return undefined; }

  return {
    email,
    name: email.split("@")[0] || "Admin",
  };
}

function getRequiredAdminProfile(): UserProfile {
  const profile = getAdminProfile();
  if (!profile) {
    throw new Error("No admin user found");
  }

  return profile;
}
