import {GristLoginMiddleware, GristServer} from 'app/server/lib/GristServer';
import {getSamlLoginMiddleware} from 'app/server/lib/SamlConfig';

export async function getLoginMiddleware(gristServer: GristServer): Promise<GristLoginMiddleware> {
  const saml = await getSamlLoginMiddleware(gristServer);
  if (saml) { return saml; }
  return {
    async getLoginRedirectUrl()  { throw new Error('logins not implemented'); },
    async getLogoutRedirectUrl() { throw new Error('logins not implemented'); },
    async getSignUpRedirectUrl() { throw new Error('logins not implemented'); },
    addEndpoints() { return "no-logins"; }
  };
}
