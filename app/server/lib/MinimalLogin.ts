import { UserProfile } from "app/common/UserAPI";
import { GristLoginSystem, GristServer, setUserInSession } from "app/server/lib/GristServer";
import { getFallbackLoginProvider } from "app/server/lib/loginSystemHelpers";

import { Request } from "express";

/**
 * Returns a login system that supports a single hard-coded user, or undefined if minimal login is disabled.
 */
async function buildMinimalLoginSystem(): Promise<GristLoginSystem> {
  return {
    async getMiddleware(gristServer: GristServer) {
      async function getLoginRedirectUrl(req: Request, url: URL) {
        await setUserInSession(req, gristServer, getDefaultProfile());
        return url.href;
      }
      return {
        getLoginRedirectUrl,
        getSignUpRedirectUrl: getLoginRedirectUrl,
        async getLogoutRedirectUrl(req: Request, url: URL) {
          return url.href;
        },
        async addEndpoints() {
          // If working without a login system, make sure default user exists.
          const dbManager = gristServer.getHomeDBManager();
          const profile = getDefaultProfile();
          const user = await dbManager.getUserByLoginWithRetry(profile.email, { profile });
          if (user) {
            // No need to survey this user!
            user.isFirstTimeUser = false;
            await user.save();
          }
          return "no-logins";
        },
      };
    },
    async deleteUser() {
      // nothing to do
    },
  };
}

/**
 * Minimal login system is a fallback login system that allows logging in as a single default user. It is
 * always configured.
 */
export const getMinimalLoginSystem = getFallbackLoginProvider(
  "minimal",
  buildMinimalLoginSystem,
);

function getDefaultProfile(): UserProfile {
  return {
    email: process.env.GRIST_DEFAULT_EMAIL || "you@example.com",
    name: "You",
  };
}
