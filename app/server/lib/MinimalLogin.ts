import {UserProfile} from 'app/common/UserAPI';
import {AppSettings} from 'app/server/lib/AppSettings';
import {getSelectedLoginSystemType} from 'app/server/lib/gristSettings';
import {GristLoginSystem, GristServer, setUserInSession} from 'app/server/lib/GristServer';
import {Request} from 'express';

/**
 * Minimal login system is always configured properly (we will use hard-coded user if nothing else is set). But
 * it can be disabled by selecting some other login system explicitly.
 */
export function isMinimalLoginEnabled(settings: AppSettings): boolean {
  const selectedType = getSelectedLoginSystemType(settings);
  if (selectedType === 'minimal') {
    // If minimal login is explicitly selected, it is enabled.
    return true;
  } else if (selectedType) {
    // If some other login system is explicitly selected, minimal login is not enabled.
    return false;
  } else {
    return Boolean(process.env.GRIST_DEFAULT_EMAIL || process.env.GRIST_MINIMAL_LOGIN);
  }
}


/**
 * Return a login system that supports a single hard-coded user, or undefined if minimal login is disabled.
 */
export async function getMinimalLoginSystem(settings: AppSettings): Promise<GristLoginSystem|undefined> {
  if (!isMinimalLoginEnabled(settings)) {
    return undefined;
  }
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

/**
 * Returns a fallback login system that blocks all authentication attempts.
 *
 * This is used as a last resort when no login system is selected explicitly or configured properly, so that
 * it can be selected automatically. It is a variant of the minimal login system that does not allow any logins at all.
 */
export async function getNoLoginSystem(): Promise<GristLoginSystem> {
  return {
    async getMiddleware(gristServer: GristServer) {
      async function getLoginRedirectUrl(req: Request, url: URL): Promise<string> {
        throw new Error('No login system is configured');
      }
      return {
        getLoginRedirectUrl,
        getSignUpRedirectUrl: getLoginRedirectUrl,
        getLogoutRedirectUrl: getLoginRedirectUrl,
        async addEndpoints() {
          return 'no-logins';
        },
      };
    },
    async deleteUser() {
      // nothing to do
    },
  };
}
