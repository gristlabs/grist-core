import {
  FORWARDAUTH_PROVIDER_KEY,
  OIDC_PROVIDER_KEY,
  SAML_PROVIDER_KEY,
} from "app/common/loginProviders";
import { readForwardAuthConfigFromSettings } from "app/server/lib/ForwardAuthLogin";
import { LoginSystemConfig } from "app/server/lib/LoginSystemConfig";
import { readOIDCConfigFromSettings } from "app/server/lib/OIDCConfig";
import { readSamlConfigFromSettings } from "app/server/lib/SamlConfig";

/**
 * List of supported login systems along with their configuration readers in order of preference.
 */
export const LOGIN_SYSTEMS: LoginSystemConfig[] = [
  { key: OIDC_PROVIDER_KEY, name: "OIDC", reader: readOIDCConfigFromSettings },
  { key: SAML_PROVIDER_KEY, name: "SAML", reader: readSamlConfigFromSettings },
  { key: FORWARDAUTH_PROVIDER_KEY, name: "Forwarded headers", reader: readForwardAuthConfigFromSettings },
];
