import { UserProfile } from "app/common/UserAPI";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristLoginMiddleware, GristLoginSystem, GristServer, setUserInSession } from "app/server/lib/GristServer";
import log from "app/server/lib/log";
import { getFallbackLoginProvider } from "app/server/lib/loginSystemHelpers";

import express, { Express, Request, Response } from "express";

/**
 * A login system that authenticates a single admin user via a boot key.
 * Used as the fallback when GRIST_ADMIN_EMAIL is set but no real auth
 * system (OIDC, SAML, etc.) is configured. The admin enters the boot key
 * (printed to server logs on startup) and gets a real session.
 */
async function buildBootKeyLoginSystem(): Promise<GristLoginSystem> {
  return {
    async getMiddleware(gristServer: GristServer) {
      return new BootKeyLoginMiddleware(gristServer);
    },
    async deleteUser() {
      // nothing to do
    },
  };
}

export const getBootKeyLoginSystem = getFallbackLoginProvider(
  "boot-key",
  buildBootKeyLoginSystem,
);

function getAdminProfile(): UserProfile {
  const email = process.env.GRIST_ADMIN_EMAIL!;
  return {
    email,
    name: email.split("@")[0] || "Admin",
  };
}

class BootKeyLoginMiddleware implements GristLoginMiddleware {
  constructor(private _gristServer: GristServer) {}

  public async getLoginRedirectUrl(req: Request, target: URL): Promise<string> {
    const loginUrl = new URL("/auth/boot-key", target.origin);
    loginUrl.searchParams.set("next", target.href);
    return loginUrl.href;
  }

  public async getSignUpRedirectUrl(req: Request, target: URL): Promise<string> {
    return this.getLoginRedirectUrl(req, target);
  }

  public async getLogoutRedirectUrl(_req: Request, nextUrl: URL): Promise<string> {
    return nextUrl.href;
  }

  public async addEndpoints(app: Express): Promise<string> {
    const gristServer = this._gristServer;

    // Ensure admin user exists in the database.
    const dbManager = gristServer.getHomeDBManager();
    const profile = getAdminProfile();
    const user = await dbManager.getUserByLoginWithRetry(profile.email, { profile });
    if (user) {
      user.isFirstTimeUser = false;
      await user.save();
    }

    // Serve the boot key login form as a Grist-styled client page.
    app.get("/auth/boot-key", expressWrap(async (req, res) => {
      const next = String(req.query.next || "/");
      const error = String(req.query.error || "");
      await sendBootKeyPage(gristServer, req, res, next, error);
    }));

    // Validate the boot key and establish a session.
    app.post("/auth/boot-key", express.urlencoded({ extended: false }), expressWrap(async (req, res) => {
      const bootKey = req.body?.bootKey;
      const next = req.body?.next || "/";

      const serverBootKey = gristServer.getBootKey();
      if (!serverBootKey || bootKey !== serverBootKey) {
        const url = new URL("/auth/boot-key", gristServer.getHomeUrl(req));
        url.searchParams.set("next", next);
        url.searchParams.set("error", "Invalid boot key");
        return res.redirect(url.href);
      }

      const adminProfile = getAdminProfile();
      await setUserInSession(req, gristServer, adminProfile);
      log.info("Boot key login successful for %s", adminProfile.email);
      return res.redirect(next);
    }));

    return "boot-key-login";
  }
}

async function sendBootKeyPage(
  gristServer: GristServer,
  req: Request,
  res: Response,
  next: string,
  error: string,
) {
  return gristServer.sendAppPage(req, res, {
    path: "error.html",
    status: 200,
    config: {
      errPage: "boot-key-login",
      errDetails: {
        next,
        ...(error ? { error } : {}),
      },
    },
  });
}
