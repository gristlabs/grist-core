import { getForwardAuthLoginSystem } from 'app/server/lib/ForwardAuthLogin';
import { GristLoginSystem } from 'app/server/lib/GristServer';
import { getMinimalLoginSystem } from 'app/server/lib/MinimalLogin';
import { getSamlLoginSystem } from 'app/server/lib/SamlConfig';

export async function getLoginSystem(): Promise<GristLoginSystem> {
  return await getSamlLoginSystem() ||
    await getForwardAuthLoginSystem() ||
    await getMinimalLoginSystem();
}
