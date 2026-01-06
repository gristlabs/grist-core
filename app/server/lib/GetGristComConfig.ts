/**
 * Configuration for GetGrist.com login system.
 * This is essentially a preconfigured OIDC provider that connects to getgrist.com's authentication service.
 *
 * Expected environment variables:
 *    env GRIST_GETGRISTCOM_KEY
 *        The API key/client secret for authenticating with getgrist.com.
 *        This variable enables the GetGrist.com login system.
 */

import { GETGRIST_COM_PROVIDER_KEY } from "app/common/loginProviders";
import { appSettings, AppSettings } from "app/server/lib/AppSettings";
import { GristLoginSystem, GristServer } from "app/server/lib/GristServer";
import { createLoginProviderFactory, NotConfiguredError } from "app/server/lib/loginSystemHelpers";
import { OIDCBuilder, OIDCConfig } from "app/server/lib/OIDCConfig";
import { stringParam } from "app/server/lib/requestUtils";

import * as express from "express";

/**
 * Read GetGrist.com configuration from application settings.
 */
export function readGetGristComConfigFromSettings(settings: AppSettings): OIDCConfig {
  const section = settings.section("login").section("system").section(GETGRIST_COM_PROVIDER_KEY);

  const secret = section.flag("secret").readString({
    envVar: "GRIST_GETGRISTCOM_SECRET",
    censor: true,
  });

  if (!secret) {
    throw new NotConfiguredError("getgrist.com login system is not configured: missing secret");
  }

  const spHost = getGetGristComHost(settings);

  const decodedSecret = Buffer.from(secret, "base64").toString("utf-8");
  const secretJson = JSON.parse(decodedSecret);

  const config: OIDCConfig = {
    clientId: stringParam(secretJson.oidcClientId, "oidcClientId"),
    clientSecret: stringParam(secretJson.oidcClientSecret, "oidcClientSecret"),
    issuerUrl: stringParam(secretJson.oidcIssuer, "oidcIssuer"),
    spHost: spHost,
    scopes: "openid email profile",
    emailPropertyKey: "email",
    endSessionEndpoint: secretJson.oidcEndSessionEndpoint || "",
    skipEndSessionEndpoint: !!secretJson.oidcSkipEndSessionEndpoint,
    ignoreEmailVerified: false,
    extraMetadata: {},
    enabledProtections: new Set(["PKCE", "STATE"]),
  };

  return config;
}

/**
 * Return the host URL for GetGrist.com login system. By default and in 99% of cases, this is just APP_HOME_URL, but
 * there is an option to override it via GRIST_GETGRISTCOM_SP_HOST env var.
 * Notice that this doesn't come from the GRIST_GETGRISTCOM_SECRET, that secret contains only upstream OIDC provider
 * information.
 */
export function getGetGristComHost(settings = appSettings): string {
  return settings.section("login")
    .section("system")
    .section(GETGRIST_COM_PROVIDER_KEY)
    .flag("spHost")
    .requireString({
      envVar: "GRIST_GETGRISTCOM_SP_HOST",
      defaultValue: process.env.APP_HOME_URL,
    });
}

/**
 * Get the GetGrist.com login system.
 * This reuses the OIDC builder with preconfigured settings for getgrist.com.
 */
async function getLoginSystem(settings: AppSettings): Promise<GristLoginSystem> {
  const oidcConfig = readGetGristComConfigFromSettings(settings);

  return {
    async getMiddleware(gristServer: GristServer) {
      const oidcBuilder = await OIDCBuilder.build(gristServer.sendAppPage.bind(gristServer), oidcConfig);
      return {
        getLoginRedirectUrl: oidcBuilder.getLoginRedirectUrl.bind(oidcBuilder),
        getSignUpRedirectUrl: oidcBuilder.getLoginRedirectUrl.bind(oidcBuilder),
        getLogoutRedirectUrl: oidcBuilder.getLogoutRedirectUrl.bind(oidcBuilder),
        async addEndpoints(app: express.Express) {
          oidcBuilder.addEndpoints(app, gristServer.getSessions());
          return GETGRIST_COM_PROVIDER_KEY;
        },
      };
    },
    async deleteUser() { },
  };
}

export const getGetGristComLoginSystem = createLoginProviderFactory(
  GETGRIST_COM_PROVIDER_KEY,
  getLoginSystem,
);
