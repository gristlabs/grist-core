import { getForwardAuthLoginSystem } from 'app/server/lib/ForwardAuthLogin';
import { GristLoginSystem } from 'app/server/lib/GristServer';
import { getMinimalLoginSystem } from 'app/server/lib/MinimalLogin';
import { getOIDCLoginSystem } from 'app/server/lib/OIDCConfig';
import { getSamlLoginSystem } from 'app/server/lib/SamlConfig';

export async function getLoginSystem(): Promise<GristLoginSystem> {
  return await getSamlLoginSystem() ||
    await getOIDCLoginSystem() ||
    await getForwardAuthLoginSystem() ||
    await getMinimalLoginSystem();
}
