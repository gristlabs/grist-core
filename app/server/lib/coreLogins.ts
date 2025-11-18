import {AppSettings} from 'app/server/lib/AppSettings';
import {getForwardAuthLoginSystem} from 'app/server/lib/ForwardAuthLogin';
import {GristLoginSystem} from 'app/server/lib/GristServer';
import {getMinimalLoginSystem, getNoLoginSystem} from 'app/server/lib/MinimalLogin';
import {getOIDCLoginSystem} from 'app/server/lib/OIDCConfig';
import {getSamlLoginSystem} from 'app/server/lib/SamlConfig';

export async function getCoreLoginSystem(settings: AppSettings): Promise<GristLoginSystem> {
  return await getSamlLoginSystem(settings) ||
    await getOIDCLoginSystem(settings) ||
    await getForwardAuthLoginSystem(settings) ||
    await getMinimalLoginSystem(settings) ||
    await getNoLoginSystem();
}
