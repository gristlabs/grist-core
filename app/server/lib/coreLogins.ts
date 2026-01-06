import { isAffirmative } from "app/common/gutil";
import {
  FORWARD_AUTH_PROVIDER_KEY,
  GETGRIST_COM_PROVIDER_KEY,
  OIDC_PROVIDER_KEY,
  SAML_PROVIDER_KEY,
} from "app/common/loginProviders";
import { appSettings } from "app/server/lib/AppSettings";
import { getForwardAuthLoginSystem, readForwardAuthConfigFromSettings } from "app/server/lib/ForwardAuthLogin";
import { getGetGristComLoginSystem, readGetGristComConfigFromSettings } from "app/server/lib/GetGristComConfig";
import { GristLoginSystem } from "app/server/lib/GristServer";
import { LoginSystemConfig } from "app/server/lib/LoginSystemConfig";
import { getMinimalLoginSystem } from "app/server/lib/MinimalLogin";
import { getOIDCLoginSystem, readOIDCConfigFromSettings } from "app/server/lib/OIDCConfig";
import { readSamlConfigFromSettings } from "app/server/lib/SamlConfig";
import { getSamlLoginSystem } from "app/server/lib/SamlConfig";

export async function getCoreLoginSystem(): Promise<GristLoginSystem> {
  const builders = LOGIN_SYSTEMS.map(ls => ls.builder);
  for (const builder of builders) {
    const loginSystem = await builder(appSettings);
    if (loginSystem) {
      return loginSystem;
    }
  }
  // Fallback to minimal login system if none configured.
  return await getMinimalLoginSystem(appSettings);
}

/**
 * List of supported login systems along with their configuration readers in order of preference.
 */
export const LOGIN_SYSTEMS: LoginSystemConfig[] = [
  ...(!isAffirmative(process.env.GRIST_FEATURE_GETGRIST_COM) ? [] : [
    { key: GETGRIST_COM_PROVIDER_KEY,
      name: "Sign in with getgrist.com",
      reader: readGetGristComConfigFromSettings,
      builder: getGetGristComLoginSystem,
    },
  ]),
  { key: OIDC_PROVIDER_KEY,
    name: "OIDC",
    reader: readOIDCConfigFromSettings,
    builder: getOIDCLoginSystem,
  },
  { key: SAML_PROVIDER_KEY,
    name: "SAML",
    reader: readSamlConfigFromSettings,
    builder: getSamlLoginSystem,
  },
  { key: FORWARD_AUTH_PROVIDER_KEY,
    name: "Forwarded headers",
    reader: readForwardAuthConfigFromSettings,
    builder: getForwardAuthLoginSystem,
  },
];
