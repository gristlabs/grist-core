import { ApiError } from "app/common/ApiError";
import { AuthProvider, SandboxingStatus } from "app/common/ConfigAPI";
import { GETGRIST_COM_PROVIDER_KEY } from "app/common/loginProviders";
import { ActivationsManager } from "app/gen-server/lib/ActivationsManager";
import { appSettings, AppSettings } from "app/server/lib/AppSettings";
import { expressWrap } from "app/server/lib/expressWrap";
import { getGetGristComHost, readGetGristComConfigFromSettings } from "app/server/lib/GetGristComConfig";
import { getGlobalConfig } from "app/server/lib/globalConfig";
import { GristServer } from "app/server/lib/GristServer";
import log from "app/server/lib/log";
import {
  getActiveLoginSystemType,
  getActiveLoginSystemTypeSource,
  NotConfiguredError,
} from "app/server/lib/loginSystemHelpers";
import { LOGIN_SYSTEMS } from "app/server/lib/loginSystems";
import { getAvailableSandboxes, getSandboxFlavor, getSandboxFlavorSource, testSandboxFlavor } from "app/server/lib/NSandbox";
import { sendOkReply, stringParam } from "app/server/lib/requestUtils";

import * as express from "express";

export class ConfigBackendAPI {
  private get _activations(): ActivationsManager {
    return this._server.getActivations();
  }

  constructor(private _server: GristServer) {}

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

      await this._activations.updateEnvVars({ GRIST_LOGIN_SYSTEM_TYPE: providerKey });

      await this._activations.updatePrefs({ onRestartClearSessions: true });

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
      await this._activations.updateEnvVars({ [gristComSecret]: key });
      // TODO: Restart may not always be required. When this endpoint evolves to support other
      // providers, be more nuanced about setting this.
      await this._activations.updatePrefs({ onRestartClearSessions: true });
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

    // GET /api/config/sandboxing
    // Returns available sandbox options, current status, and recommendation.
    app.get("/api/config/sandboxing", requireInstallAdmin, expressWrap(async (req, res) => {
      const status = await this._buildSandboxingStatus();
      return sendOkReply(req, res, status);
    }));

    // PATCH /api/config/sandboxing
    // Set sandbox flavor (takes effect after restart).
    app.patch("/api/config/sandboxing", requireInstallAdmin, expressWrap(async (req, res) => {
      const flavor = stringParam(req.body.flavor, "flavor");

      // Block changes when flavor is fixed by a real environment variable.
      if (getSandboxFlavorSource() === "env") {
        throw new ApiError(
          "Sandbox flavor is set via GRIST_SANDBOX_FLAVOR environment variable and cannot be changed here",
          409,
        );
      }

      // Don't do anything if the flavor is the same as current, to avoid unnecessary restart.
      if (getSandboxFlavor() === flavor) {
        return sendOkReply(req, res, { msg: "Sandbox flavor is already set to the requested value." });
      }

      // Validate the flavor name, while the flag itself allows expressions (like fallbacks), we don't allow
      // it here in this endpoint.
      const option = getAvailableSandboxes().find(o => o.key === flavor);
      if (!option) {
        throw new ApiError(`Unknown sandbox flavor: ${flavor}`, 400);
      }

      // And make sure it is reachable (don't trust the UI).
      if (!option.available) {
        throw new ApiError(
          `Sandbox '${flavor}' is not available: ${option.unavailableReason || "unknown reason"}`,
          400,
        );
      }

      // Now update Grist settings to switch to the new flavor on next restart.
      await this._activations.updateEnvVars({ GRIST_SANDBOX_FLAVOR: flavor });

      // And return to the UI that we need restart
      return sendOkReply(req, res, { needsRestart: true });
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
   * Build sandboxing status, testing if available sandboxes are functional, and determining the recommended option.
   */
  private async _buildSandboxingStatus(): Promise<SandboxingStatus> {
    const available = getAvailableSandboxes();

    // Test all available and effective sandboxes in parallel.
    const testPromises = available
      .filter(o => o.available && o.effective)
      .map(async (o) => {
        const result = await testSandboxFlavor(o.key).catch((e) => { /** should not happen */});
        o.functional = result!.functional;
        o.testError = result!.error;
      });

    // Wait for all tests to complete, non should fail.
    await Promise.all(testPromises);

    // Mark unsandboxed as always functional (no test needed).
    available.filter(o => !o.effective && o.available).forEach(o => o.functional = true);

    // Use server's sandbox info, it is cached and tested, what the server is actually using know.
    const sandboxInfo = await this._server.getSandboxInfo();
    const active = sandboxInfo.flavor === "unknown" ? "unsandboxed" : sandboxInfo.flavor;
    const activeOption = available.find(o => o.key === active);

    // Mark the currently active sandbox.
    if (activeOption) {
      activeOption.isActive = true;
    }


    // Sort: best option first. Priority: functional+effective > functional > rest.
    // Note: functional means available (we checked that before).
    const sorted = [
      ...available.filter(o => o.functional && o.effective),
      ...available.filter(o => o.functional && !o.effective),
      ...available.filter(o => !o.functional),
    ];

    // The recommended sandbox is the first available, functional, and effective option. Might be none.
    const recommended = sorted.find(o => o.functional && o.effective)?.key;

    // Check if there's a pending change in the database.
    const activation = await this._activations.current();
    const dbEnvVars = activation.prefs?.envVars ?? {};
    const flavorInDb = dbEnvVars.GRIST_SANDBOX_FLAVOR;

    // Read the settings as sandbox creator see it (so what is configurd currently)
    const flavorCurrentlyConfigured = getSandboxFlavor();
    const currentConfigSource = getSandboxFlavorSource();
    const pendingRestart = flavorInDb && flavorInDb !== flavorCurrentlyConfigured ? flavorInDb : undefined;

    // process.env is never populated from DB envVars, so its presence
    // means the value was set outside our control and is immutable.
    const isSelectedByEnv = currentConfigSource === "env"

    // Explicitly configured = set via env var OR previously saved to DB.
    const isConfigured = !!currentConfigSource;

    return {
      available: sorted,
      recommended,
      pendingRestart,
      isSelectedByEnv,
      isConfigured,
    };
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
    for (const { key, name, reader: configuredCheck, metadataReader } of LOGIN_SYSTEMS) {
      const record: AuthProvider = {
        name,
        key,
      };
      try {
        configuredCheck(newSettings);
        record.metadata = metadataReader?.(newSettings) ?? {};
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
