import {appSettings} from 'app/server/lib/AppSettings';
import {getForwardAuthLoginSystem} from 'app/server/lib/ForwardAuthLogin';
import {GristLoginSystem} from 'app/server/lib/GristServer';
import {getMinimalLoginSystem} from 'app/server/lib/MinimalLogin';
import {getOIDCLoginSystem} from 'app/server/lib/OIDCConfig';
import {getSamlLoginSystem} from 'app/server/lib/SamlConfig';

export async function getCoreLoginSystem(): Promise<GristLoginSystem> {
  return await getSamlLoginSystem(appSettings) ||
    await getOIDCLoginSystem(appSettings) ||
    await getForwardAuthLoginSystem(appSettings) ||
    await getMinimalLoginSystem(appSettings);
}
