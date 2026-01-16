import { ApiError } from "app/common/ApiError";
import { AuthProvider } from "app/common/ConfigAPI";
import { GETGRIST_COM_PROVIDER_KEY } from "app/common/loginProviders";
import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { appSettings, AppSettings } from "app/server/lib/AppSettings";
import { expressWrap } from "app/server/lib/expressWrap";
import { getGetGristComHost, readGetGristComConfigFromSettings } from "app/server/lib/GetGristComConfig";
import { getGlobalConfig } from "app/server/lib/globalConfig";
import log from "app/server/lib/log";
import {
  getActiveLoginSystemType,
  getActiveLoginSystemTypeSource,
  NotConfiguredError,
} from "app/server/lib/loginSystemHelpers";
import { LOGIN_SYSTEMS } from "app/server/lib/loginSystems";
import { sendOkReply, stringParam } from "app/server/lib/requestUtils";

import * as express from "express";

export class ConfigBackendAPI {
  constructor(private _activations: ActivationsManager) {
  }

  public addEndpoints(app: express.Express, requireInstallAdmin: express.RequestHandler) {
    // GET /api/config/auth-providers
    // Returns available authentication providers.
    app.get("/api/config/auth-providers", requireInstallAdmin, expressWrap(async (req, res) => {
      const providers = await this._buildProviderList();
      return sendOkReply(req, res, providers);
    }));

    // POST /api/config/auth-providers/set-active
    // Set active login system (will be active after restart)
    app.post("/api/config/auth-providers/set-active", requireInstallAdmin, expressWrap(async (req, resp) => {
      const { providerKey } = req.body;
      if (!providerKey) {
        resp.status(400).send({ error: "providerKey is required" });
        return;
      }

      // Get current providers to validate
      const providers = await this._buildProviderList();
      const provider = providers.find((p: AuthProvider) => p.key === providerKey);
      if (!provider) {
        resp.status(404).send({ error: "Provider not found" });
        return;
      }

      await this._activations.updateAppEnvFile({ GRIST_LOGIN_SYSTEM_TYPE: providerKey });

      return sendOkReply(req, resp, { msg: "ok" });
    }));

    // PATCH /api/config/auth-providers?provider=...
    app.patch("/api/config/auth-providers", requireInstallAdmin, expressWrap(async (req, resp) => {
      stringParam(req.query.provider, "provider", { allowed: [GETGRIST_COM_PROVIDER_KEY] });

      const gristComSecret = "GRIST_GETGRISTCOM_SECRET";

      // And expect just a secret key in the body.
      const key = req.body[gristComSecret]?.split(/\s+/).join("");
      if (!key) {
        throw new ApiError("Request doesn't contain valid getgrist.com configuration parameter", 400);
      }
      const newSettings = new AppSettings("grist");
      const currentEnvVars = (await this._activations.current()).prefs?.envVars || {};
      const newEnvVars = { ...currentEnvVars, [gristComSecret]: key };
      newSettings.setEnvVars(newEnvVars);
      // Check configuration, we now expect that this is enough to configure the provider.
      try {
        readGetGristComConfigFromSettings(newSettings);
      } catch (e) {
        // If still not configured, something is wrong with the provided key, but we don't know what exactly,
        // as the check function thinks nothing is configured, if the key was invalid it would have thrown earlier.
        throw new ApiError("Error configuring provider with the provided key.", 400);
      }
      await this._activations.updateAppEnvFile({ [gristComSecret]: key });
      return sendOkReply(req, resp, { msg: "ok" });
    }));

    // Returns the getgrist.com host for the current configuration, needed for initial handshake.
    // Notice: while the code is using current settings to determine the host, the secret key doesn't contain
    // the GRIST_GETGRISTCOM_SP_HOST variable. It can be only set via env var. We still read from the current
    // settings for consistency and future use.
    // GET /api/config/auth-providers/config?provider=getgrist.com
    app.get("/api/config/auth-providers/config", requireInstallAdmin, expressWrap(async (req, resp) => {
      stringParam(req.query.provider, "provider", { allowed: [GETGRIST_COM_PROVIDER_KEY] });
      return sendOkReply(req, resp, {
        GRIST_GETGRISTCOM_SP_HOST: getGetGristComHost(appSettings),
      });
    }));

    app.get("/api/config/:key", requireInstallAdmin, expressWrap((req, resp) => {
      log.debug("config: requesting configuration", req.params);

      // Only one key is valid for now
      if (req.params.key === "edition") {
        resp.send({ value: getGlobalConfig().edition.get() });
      } else {
        resp.status(404).send({ error: "Configuration key not found." });
      }
    }));

    app.patch("/api/config", requireInstallAdmin, expressWrap(async (req, resp) => {
      const config = req.body.config;
      log.debug("config: received new configuration item", config);

      // Only one key is valid for now
      if (config.edition !== undefined) {
        await getGlobalConfig().edition.set(config.edition);

        resp.send({ msg: "ok" });
      } else {
        resp.status(400).send({ error: "Invalid configuration key" });
      }
    }));
  }

  /**
   * Build the list of available authentication providers based on AppSettings.
   */
  private async _buildProviderList(): Promise<AuthProvider[]> {
    // Read new settings to see what will be picked after restart.
    const newSettings = new AppSettings("grist");
    newSettings.setEnvVars((await this._activations.current()).prefs?.envVars || {});

    // Now build the list of providers and check their configuration status.
    const providers: AuthProvider[] = [];
    for (const { key, name, reader: configuredCheck } of LOGIN_SYSTEMS) {
      const record: AuthProvider = {
        name,
        key,
      };
      try {
        configuredCheck(newSettings);
        record.isConfigured = true;
      } catch (e) {
        if (e instanceof NotConfiguredError) {
          record.isConfigured = false;
        } else {
          record.configError = (e as Error).message;
        }
      }
      providers.push(record);
    }

    // Now figure out which one will be active after restart.
    return _fillProviderInfo({ newSettings, currentSettings: appSettings, providers });
  }
}

/**
 * Fill out the provider info fields based on current and selected providers.
 * Method is private, exported for tests.
 */
export function _fillProviderInfo({
  currentSettings,
  newSettings,
  providers,
}: {
  currentSettings: AppSettings; // The current settings to get runtime state
  newSettings: AppSettings; // The new settings to determine active provider
  providers: AuthProvider[]; // List of available providers and their new configuration status
}) {
  // Read the error and current provider from current settings.
  const loginSection = currentSettings.section("login");
  const active = String(loginSection.flag("active").get() ?? "") || undefined;
  const error = loginSection.flag("error").get() as string | undefined;

  // Which system is selected explicitly via env var (if any)
  const newFromConfig = getActiveLoginSystemType(newSettings);
  const isNewFixedByEnv = getActiveLoginSystemTypeSource(newSettings) === "env";

  // If we don't have picked system, Grist will pick the first configured one
  const next = newFromConfig || providers.find(p => p.isConfigured || p.configError)?.key || active;

  // Now we know enough to properly fill out the rest of the fields for the ui.
  for (const provider of providers) {
    // We will mark provider as active if it is currently active and will be active after restart.
    provider.isActive = provider.key === active && provider.key === next;

    // We will mark provider as configured if it is configured without an error.
    provider.isConfigured = provider.isConfigured && !provider.configError;

    // If this is current provider pass the error that was reported.
    provider.activeError = provider.key === active ? error : undefined;

    // If those two errors are the same, clear configError to avoid duplication.
    provider.configError = provider.activeError === provider.configError ? undefined : provider.configError;

    // We will mark provider as selected by env if it matches the selected value from env.
    provider.isSelectedByEnv = isNewFixedByEnv && provider.key === newFromConfig;

    // Provider will be active after restart if it is the next one but not current one.
    provider.willBeActive = provider.key === next && provider.key !== active;

    // Provider will be disabled after restart if it is current one but not next one.
    provider.willBeDisabled = provider.key === active && provider.key !== next;

    // Provider can be activated if it is configured and not selected by env.
    provider.canBeActivated = provider.isConfigured && provider.key !== next && !isNewFixedByEnv;
  }

  // For easy testing remove undefined and false values.
  for (const provider of providers) {
    for (const key of Object.keys(provider)) {
      if (provider[key as keyof AuthProvider] === undefined ||
        provider[key as keyof AuthProvider] === false) {
        delete provider[key as keyof AuthProvider];
      }
    }
  }

  return providers;
}
