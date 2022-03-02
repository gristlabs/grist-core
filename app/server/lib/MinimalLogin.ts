import { UserProfile } from 'app/common/UserAPI';
import { GristLoginSystem, GristServer } from 'app/server/lib/GristServer';
import { fromCallback } from 'app/server/lib/serverUtils';
import { Request } from 'express';

/**
 * Return a login system that supports a single hard-coded user.
 */
export async function getMinimalLoginSystem(): Promise<GristLoginSystem> {
  // Login and logout, redirecting immediately back.  Signup is treated as login,
  // no nuance here.
  return {
    async getMiddleware(gristServer: GristServer) {
      return {
        async getLoginRedirectUrl(req: Request, url: URL)  {
          await setSingleUser(req, gristServer);
          return url.href;
        },
        async getLogoutRedirectUrl(req: Request, url: URL) {
          return url.href;
        },
        async getSignUpRedirectUrl(req: Request, url: URL) {
          await setSingleUser(req, gristServer);
          return url.href;
        },
        async addEndpoints() {
          // If working without a login system, make sure default user exists.
          const dbManager = gristServer.getHomeDBManager();
          const profile = getDefaultProfile();
          const user = await dbManager.getUserByLoginWithRetry(profile.email, profile);
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
 * Set the user in the current session to the single hard-coded user.
 */
async function setSingleUser(req: Request, gristServer: GristServer) {
  const scopedSession = gristServer.getSessions().getOrCreateSessionFromRequest(req);
  // Make sure session is up to date before operating on it.
  // Behavior on a completely fresh session is a little awkward currently.
  const reqSession = (req as any).session;
  if (reqSession?.save) {
    await fromCallback(cb => reqSession.save(cb));
  }
  await scopedSession.operateOnScopedSession(req, async (user) => Object.assign(user, {
    profile: getDefaultProfile()
  }));
}

function getDefaultProfile(): UserProfile {
  return {
    email: process.env.GRIST_DEFAULT_EMAIL || 'you@example.com',
    name: 'You',
  };
}
