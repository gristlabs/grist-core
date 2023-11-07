import { ApiError } from 'app/common/ApiError';
import { appSettings } from 'app/server/lib/AppSettings';
import { getRequestProfile } from 'app/server/lib/Authorizer';
import { expressWrap } from 'app/server/lib/expressWrap';
import { GristLoginMiddleware, GristLoginSystem, GristServer, setUserInSession } from 'app/server/lib/GristServer';
import log from 'app/server/lib/log';
import { optStringParam } from 'app/server/lib/requestUtils';
import * as express from 'express';
import trimEnd = require('lodash/trimEnd');
import trimStart = require('lodash/trimStart');

/**
 * Return a login system that can work in concert with middleware that
 * does authentication and then passes identity in a header.
 * There are two modes of operation, distinguished by whether GRIST_IGNORE_SESSION is set.
 *
 * 1. With sessions, and forward-auth on login endpoints.
 *
 *    For example, using traefik reverse proxy with traefik-forward-auth middleware:
 *
 *      https://github.com/thomseddon/traefik-forward-auth
 *
 *    Grist environment:
 *    - GRIST_FORWARD_AUTH_HEADER: set to a header that will contain
 *      authorized user emails, say "x-forwarded-user"
 *    - GRIST_FORWARD_AUTH_LOGOUT_PATH: set to a path that will trigger
 *      a logout (for traefik-forward-auth by default that is /_oauth/logout).
 *    - GRIST_FORWARD_AUTH_LOGIN_PATH: optionally set to override the default (/auth/login).
 *    - GRIST_IGNORE_SESSION: do NOT set, or set to a falsy value.
 *
 *    Reverse proxy:
 *    - Make sure your reverse proxy applies the forward auth middleware to
 *      GRIST_FORWARD_AUTH_LOGIN_PATH and GRIST_FORWARD_AUTH_LOGOUT_PATH.
 *    - If you want to allow anonymous access in some cases, make sure all
 *      other paths are free of the forward auth middleware - Grist will
 *      trigger it as needed by redirecting to /auth/login.
 *    - Grist only uses the configured header at login/logout. Once the user is logged in, Grist
 *      will use the session info to identify the user, until logout.
 *    - Optionally, tell the middleware where to forward back to after logout.
 *      (For traefik-forward-auth, you'd run it with LOGOUT_REDIRECT set to .../signed-out)
 *
 * 2. With no sessions, and forward-auth on all endpoints.
 *
 *    For example, using HTTP Basic Auth and server configuration that sets a header to the
 *    logged-in user (e.g. to REMOTE_USER with Apache).
 *
 *    Grist environment:
 *   - GRIST_IGNORE_SESSION: set to true. Grist sessions will not be used.
 *   - GRIST_FORWARD_AUTH_HEADER: set to to a header that will contain authorized user emails, say
 *     "x-remote-user".
 *
 *   Reverse proxy:
 *   - Make sure your reverse proxy sets the header you specified for all requests that may need
 *     login information. It is imperative that this header cannot be spoofed by the user, since
 *     Grist will trust whatever is in it.
 *
 * GRIST_PROXY_AUTH_HEADER is deprecated in favor of GRIST_FORWARD_AUTH_HEADER. It is currently
 * interpreted as a synonym, with a warning, but support for it may be dropped.
 *
 * Redirection logic currently assumes a single-site installation.
 */
export async function getForwardAuthLoginSystem(): Promise<GristLoginSystem|undefined> {
  const section = appSettings.section('login').section('system').section('forwardAuth');
  const headerSetting = section.flag('header');
  const header = headerSetting.readString({
    envVar: ['GRIST_FORWARD_AUTH_HEADER', 'GRIST_PROXY_AUTH_HEADER']
  });
  if (!header) {
    return;
  }

  if (headerSetting.describe().foundInEnvVar === 'GRIST_PROXY_AUTH_HEADER') {
    log.warn("GRIST_PROXY_AUTH_HEADER is deprecated; interpreted as a synonym of GRIST_FORWARD_AUTH_HEADER");
  }

  section.flag('active').set(true);
  const logoutPath = section.flag('logoutPath').readString({
    envVar: 'GRIST_FORWARD_AUTH_LOGOUT_PATH'
  }) || '';
  const loginPath = section.flag('loginPath').requireString({
    envVar: 'GRIST_FORWARD_AUTH_LOGIN_PATH',
    defaultValue: '/auth/login',
  });

  const skipSession = appSettings.section('login').flag('skipSession').readBool({
    envVar: 'GRIST_IGNORE_SESSION',
  });

  return {
    async getMiddleware(gristServer: GristServer) {
      async function getLoginRedirectUrl(req: express.Request, url: URL)  {
        const target = new URL(trimEnd(gristServer.getHomeUrl(req), '/') +
          '/' + trimStart(loginPath, '/'));
        // In lieu of sanitizing the next url, we include only the path
        // component. This will only work for single-domain installations.
        target.searchParams.append('next', url.pathname);
        return target.href;
      }
      const middleware: GristLoginMiddleware = {
        getLoginRedirectUrl,
        getSignUpRedirectUrl: getLoginRedirectUrl,
        async getLogoutRedirectUrl(req: express.Request) {
          return trimEnd(gristServer.getHomeUrl(req), '/') + '/' +
            trimStart(logoutPath, '/');
        },
        async addEndpoints(app: express.Express) {
          app.get(loginPath, expressWrap(async (req, res) => {
            const profile = getRequestProfile(req, header);
            if (!profile) {
              throw new ApiError('cannot find user', 401);
            }
            await setUserInSession(req, gristServer, profile);
            const target = new URL(gristServer.getHomeUrl(req));
            const next = optStringParam(req.query.next, 'next');
            if (next) {
              target.pathname = next;
            }
            res.redirect(target.href);
          }));
          return skipSession ? "forward-auth-skip-session" : "forward-auth";
        },
      };
      if (skipSession) {
        // With GRIST_IGNORE_SESSION, respect the header for all requests.
        middleware.overrideProfile = async (req) => getRequestProfile(req, header);
      }
      return middleware;
    },
    async deleteUser() {
      // If we could delete the user account in the external
      // authentication system, this is our chance - but we can't.
    },
  };
}
