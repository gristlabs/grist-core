import { GristLoginMiddleware, GristServer } from 'app/server/lib/GristServer';
import { getMinimalLoginMiddleware } from 'app/server/lib/MinimalLogin';
import { getSamlLoginMiddleware } from 'app/server/lib/SamlConfig';

export async function getLoginMiddleware(gristServer: GristServer): Promise<GristLoginMiddleware> {
  const saml = await getSamlLoginMiddleware(gristServer);
  if (saml) { return saml; }
  return getMinimalLoginMiddleware(gristServer);
}
