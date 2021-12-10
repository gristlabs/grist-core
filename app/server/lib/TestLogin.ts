import { GristLoginSystem, GristServer } from 'app/server/lib/GristServer';
import { Request } from 'express';

/**
 * Return a login system for testing. Just enough to use the test/login endpoint
 * available when GRIST_TEST_LOGIN=1 is set.
 */
export async function getTestLoginSystem(): Promise<GristLoginSystem> {
  return {
    async getMiddleware(gristServer: GristServer) {
      async function getLoginRedirectUrl(req: Request, url: URL)  {
          // The "gristlogin" query parameter does nothing except make tests
          // that expect hosted cognito happy (they check for gristlogin in url).
          const target = new URL(gristServer.getHomeUrl(req, 'test/login?gristlogin=1'));
          target.searchParams.append('next', url.href);
          return target.href || url.href;
      }
      return {
        getLoginRedirectUrl,
        async getLogoutRedirectUrl(req: Request, url: URL) {
          return url.href;
        },
        getSignUpRedirectUrl: getLoginRedirectUrl,
        async addEndpoints() {
          // Make sure support user has a test api key if needed.
          if (process.env.TEST_SUPPORT_API_KEY) {
            const dbManager = gristServer.getHomeDBManager();
            const user = await dbManager.getUserByLogin('support@getgrist.com');
            if (user) {
              user.apiKey = process.env.TEST_SUPPORT_API_KEY;
              await user.save();
            }
          }
          return "test-login";
        },
      };
    },
    async deleteUser() {
      // nothing to do
    },
  };
}
