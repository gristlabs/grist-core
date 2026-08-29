import { normalizeEmail } from "app/common/emails";
import { UserProfile } from "app/common/UserAPI";
import { GristLoginSystem, GristServer, setUserInSession } from "app/server/lib/GristServer";
import { getAdminEmail } from "app/server/lib/gristSettings";
import { getDefaultEmail } from "app/server/lib/InstallAdmin";
import { getFallbackLoginProvider } from "app/server/lib/loginSystemHelpers";

import { Request } from "express";

/**
 * Returns a login system that supports a single hard-coded user.
 */
async function buildMinimalLoginSystem(): Promise<GristLoginSystem> {
  return {
    async getMiddleware(gristServer: GristServer) {
      async function getLoginRedirectUrl(req: Request, url: URL) {
        await setUserInSession(req, gristServer, await resolveProfile(gristServer));
        return url.href;
      }
      return {
        getLoginRedirectUrl,
        getSignUpRedirectUrl: getLoginRedirectUrl,
        async getLogoutRedirectUrl(req: Request, url: URL) {
          return url.href;
        },
        async addEndpoints() {
          // If working without a login system, make sure the user exists.
          const dbManager = gristServer.getHomeDBManager();
          const profile = await resolveProfile(gristServer);
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

/**
 * The default user's identity: GRIST_DEFAULT_EMAIL (or you@example.com), named "You".
 */
export function getDefaultProfile(): UserProfile {
  return {
    email: getDefaultEmail() || "you@example.com",
    name: "You",
  };
}

/**
 * Returns the single user identity that everyone is signed in as.
 *
 * An installation that has been running without authentication keeps its identity:
 * as long as the default user -- at GRIST_DEFAULT_EMAIL, or you@example.com --
 * exists, it stays the identity, along with everything it owns. First-run setup
 * ends that user's existence by renaming it to the admin email (see Boot.ts), so
 * on installations set up since that flow shipped, the admin email is the
 * identity: the operator ends up signed in as the admin they specified during
 * setup, named after the email.
 */
async function resolveProfile(gristServer: GristServer): Promise<UserProfile> {
  const defaultProfile = getDefaultProfile();
  const adminEmail = getAdminEmail();
  const useDefault = (
    !adminEmail || normalizeEmail(adminEmail) === normalizeEmail(defaultProfile.email) ||
    // This last line is to avoid breaking older installations that have both a
    // GRIST_DEFAULT_EMAIL user (who owns resources) and a GRIST_ADMIN_EMAIL user.
    Boolean(await gristServer.getHomeDBManager().getExistingUserByLogin(defaultProfile.email))
  );

  return useDefault ? defaultProfile : {
    email: adminEmail,
    name: adminEmail.split("@")[0] || adminEmail,
  };
}
