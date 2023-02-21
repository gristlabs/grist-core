import {UserProfile} from 'app/common/UserAPI';
import {GristLoginSystem, GristServer, setUserInSession} from 'app/server/lib/GristServer';
import {Request} from 'express';

/**
 * Return a login system that supports a single hard-coded user.
 */
export async function getMinimalLoginSystem(): Promise<GristLoginSystem> {
  // Login and logout, redirecting immediately back.  Signup is treated as login,
  // no nuance here.
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
          const user = await dbManager.getUserByLoginWithRetry(profile.email, {profile});
          if (user) {
            // No need to survey this user!
            user.isFirstTimeUser = false;
            await user.save();
          }
          return 'no-logins';
        },
      };
    },
    async deleteUser() {
      // nothing to do
    },
  };
}

export function getDefaultProfile(): UserProfile {
  return {
    email: process.env.GRIST_DEFAULT_EMAIL || 'you@example.com',
    name: 'You',
  };
}
