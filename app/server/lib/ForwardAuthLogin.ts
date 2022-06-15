import { ApiError } from 'app/common/ApiError';
import { UserProfile } from 'app/common/LoginSessionAPI';
import { appSettings } from 'app/server/lib/AppSettings';
import { getRequestProfile } from 'app/server/lib/Authorizer';
import { expressWrap } from 'app/server/lib/expressWrap';
import { GristLoginSystem, GristServer, setUserInSession } from 'app/server/lib/GristServer';
import { optStringParam } from 'app/server/lib/requestUtils';
import * as express from 'express';
import { IncomingMessage } from 'http';
import trimEnd = require('lodash/trimEnd');
import trimStart = require('lodash/trimStart');

/**
 * Return a login system that can work in concert with middleware that
 * does authentication and then passes identity in a header. An example
 * of such middleware is traefik-forward-auth:
 *
 *   https://github.com/thomseddon/traefik-forward-auth
 *
 * To make it function:
 *   - Set GRIST_FORWARD_AUTH_HEADER to a header that will contain
 *     authorized user emails, say "x-forwarded-user"
 *   - Make sure /auth/login is processed by forward auth middleware
 *   - Set GRIST_FORWARD_AUTH_LOGOUT_PATH to a path that will trigger
 *     a logout (for traefik-forward-auth by default that is /_oauth/logout).
 *   - Make sure that logout path is processed by forward auth middleware
 *   - If you want to allow anonymous access in some cases, make sure all
 *     other paths are free of the forward auth middleware - Grist will
 *     trigger it as needed.
 *   - Optionally, tell the middleware where to forward back to after logout.
 *     (For traefik-forward-auth, you'd set LOGOUT_REDIRECT to .../signed-out)
 *
 * Redirection logic currently assumes a single-site installation.
 */
export async function getForwardAuthLoginSystem(): Promise<GristLoginSystem|undefined> {
  const section = appSettings.section('login').section('system').section('forwardAuth');
  const header = section.flag('header').readString({
    envVar: 'GRIST_FORWARD_AUTH_HEADER',
  });
  if (!header) { return; }
  section.flag('active').set(true);
  const logoutPath = section.flag('logoutPath').readString({
    envVar: 'GRIST_FORWARD_AUTH_LOGOUT_PATH'
  }) || '';
  const loginPath = section.flag('loginPath').requireString({
    envVar: 'GRIST_FORWARD_AUTH_LOGIN_PATH',
    defaultValue: '/auth/login',
  }) || '';
  return {
    async getMiddleware(gristServer: GristServer) {
      async function getLoginRedirectUrl(req: express.Request, url: URL)  {
        const target = new URL(trimEnd(gristServer.getHomeUrl(req), '/') +
          '/' + trimStart(loginPath, '/'));
        // In lieu of sanatizing the next url, we include only the path
        // component. This will only work for single-domain installations.
        target.searchParams.append('next', url.pathname);
        return target.href;
      }
      return {
        getLoginRedirectUrl,
        getSignUpRedirectUrl: getLoginRedirectUrl,
        async getLogoutRedirectUrl(req: express.Request) {
          return trimEnd(gristServer.getHomeUrl(req), '/') + '/' +
            trimStart(logoutPath, '/');
        },
        async addEndpoints(app: express.Express) {
          app.get('/auth/login', expressWrap(async (req, res) => {
            const profile = getRequestProfile(req, header);
            if (!profile) {
              throw new ApiError('cannot find user', 401);
            }
            await setUserInSession(req, gristServer, profile);
            const target = new URL(gristServer.getHomeUrl(req));
            const next = optStringParam(req.query.next);
            if (next) {
              target.pathname = next;
            }
            res.redirect(target.href);
          }));
          return "forward-auth";
        },
        async getProfile(req: express.Request|IncomingMessage): Promise<UserProfile|null|undefined> {
          return getRequestProfile(req, header);
        },
      };
    },
    async deleteUser() {
      // If we could delete the user account in the external
      // authentication system, this is our chance - but we can't.
    },
  };
}
