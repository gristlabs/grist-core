import { UserProfile } from "app/common/UserAPI";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristLoginMiddleware, GristLoginSystem, GristServer, setUserInSession } from "app/server/lib/GristServer";
import log from "app/server/lib/log";
import { getFallbackLoginProvider } from "app/server/lib/loginSystemHelpers";

import express, { Express, Request } from "express";

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

    // Serve the boot key login form.
    app.get("/auth/boot-key", expressWrap(async (req, res) => {
      const next = String(req.query.next || "/");
      const error = String(req.query.error || "");
      res.send(renderBootKeyPage(next, error));
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderBootKeyPage(next: string, error: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Grist - Boot Key Login</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
           display: flex; align-items: center; justify-content: center;
           min-height: 100vh; margin: 0; background: #f7f7f7; }
    .container { background: #fff; padding: 32px; border-radius: 8px;
                 box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 400px; width: 100%; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { color: #666; font-size: 14px; margin: 0 0 16px; }
    .error { color: #d32f2f; font-size: 14px; margin-bottom: 12px; }
    input[type=text] { width: 100%; padding: 8px 10px; font-size: 14px;
                       border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
    input[type=text]:focus { border-color: #1565c0; outline: none; }
    button { margin-top: 12px; padding: 8px 20px; font-size: 14px; border: none;
             border-radius: 4px; background: #1565c0; color: #fff; cursor: pointer; }
    button:hover { background: #0d47a1; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Grist Setup</h1>
    <p>Enter the boot key from your server logs to sign in as the administrator.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="POST" action="/auth/boot-key">
      <input type="hidden" name="next" value="${escapeHtml(next)}">
      <div>
        <input type="text" name="bootKey" placeholder="Boot key" autofocus
               class="test-boot-key-input">
      </div>
      <div>
        <button type="submit" class="test-boot-key-submit">Sign In</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}
