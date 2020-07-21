import {GristLoginMiddleware} from 'app/server/lib/GristServer';

export async function getLoginMiddleware(): Promise<GristLoginMiddleware> {
  return {
    async getLoginRedirectUrl(target: URL)  { throw new Error('logins not implemented'); },
    async getLogoutRedirectUrl(target: URL) { throw new Error('logins not implemented'); },
    async getSignUpRedirectUrl(target: URL) { throw new Error('logins not implemented'); },
    addEndpoints(...args: any[]) {
      return "no-logins";
    }
  };
}
