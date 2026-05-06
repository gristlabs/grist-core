import { ApiError } from "app/common/ApiError";
import {
  ConfigKey,
  ConfigKeyChecker,
  ConfigValue,
  ConfigValueCheckers,
} from "app/common/Config";
import { AdminPageConfig } from "app/common/gristUrls";
import { isAffirmative } from "app/common/gutil";
import { InstallPrefs } from "app/common/Install";
import { PermissionsStatus, PrefSource } from "app/common/InstallAPI";
import { getOrgKey } from "app/gen-server/ApiServer";
import { Config } from "app/gen-server/entity/Config";
import {
  PreviousAndCurrent,
  QueryResult,
} from "app/gen-server/lib/homedb/Interfaces";
import { appSettings } from "app/server/lib/AppSettings";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { BootProbes } from "app/server/lib/BootProbes";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import {
  getAnonPlaygroundEnabled, getAnonPlaygroundEnabledSource,
  getCanAnyoneCreateOrgs, getCanAnyoneCreateOrgsSource,
  getForceLogin, getForceLoginSource,
  getPersonalOrgsEnabled, getPersonalOrgsEnabledSource,
  invalidateReloadableSettings,
} from "app/server/lib/gristSettings";
import log from "app/server/lib/log";
import {
  getScope,
  sendOkReply,
  sendReply,
  stringParam,
} from "app/server/lib/requestUtils";
import { updateGristServerLatestVersion } from "app/server/lib/updateChecker";

import {
  Application,
  json,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import isEmpty from "lodash/isEmpty";
import pick from "lodash/pick";

function canRestart() {
  return isAffirmative(process.env.GRIST_RUNNING_UNDER_SUPERVISOR) ||
    isAffirmative(process.env.GRIST_UNDER_RESTART_SHELL);
}

export interface AttachOptions {
  app: Application;
  gristServer: GristServer;
  userIdMiddleware: RequestHandler;
}

/**
 * Attaches endpoints that should be available as early as possible
 * in the Grist startup process.
 *
 * These endpoints comprise a baseline for troubleshooting a faulty
 * installation of Grist. Currently, this includes the landing page
 * for the Admin Panel, and API endpoints for restarting the install,
 * checking the status of various install probes, reading/writing install
 * prefs, and reading/writing install and org configuration.
 *
 * Only the bare minimum middleware needed for these endpoints to function
 * should be added beforehand (e.g. `userIdMiddleware`).
 */
export function attachEarlyEndpoints(options: AttachOptions) {
  const { app, gristServer, userIdMiddleware } = options;

  // Admin endpoint needs to have very little middleware since each
  // piece of middleware creates a new way to fail and leave the admin
  // panel inaccessible. Generally the admin panel should report problems
  // rather than failing entirely.
  app.get(
    "/admin/:subpath(*)?",
    userIdMiddleware,
    expressWrap(async (req, res) => {
      const config: Partial<AdminPageConfig> = {
        runningUnderSupervisor: canRestart(),
        adminControls: gristServer.create.areAdminControlsAvailable(),
      };
      return gristServer.sendAppPage(req, res, {
        path: "app.html",
        status: 200,
        config,
      });
    }),
  );

  // MOCKUP ONLY — control buttons used by the front-page setup mockup so
  // marketing reviewers can demo the wizard without a real install. These
  // endpoints are only active before Go Live (when service is not in-service);
  // afterwards they 404. No auth, no security — throwaway POC code.
  const refuseIfInService = (_req: Request, res: Response, next: NextFunction) => {
    if (gristServer.isInService()) {
      return res.status(404).json({ error: "Not found" });
    }
    next();
  };

  app.post("/api/setup/mockup-set-admin-email", json(), refuseIfInService,
    expressWrap(async (req, res) => {
      const email = req.body?.email;
      if (!email || typeof email !== "string") {
        throw new ApiError("Missing email", 400);
      }
      process.env.GRIST_ADMIN_EMAIL = email;
      gristServer.getInstallAdmin().clearCaches();
      return sendOkReply(req, res, { email });
    }));

  app.post("/api/setup/mockup-reset-admin-email", refuseIfInService,
    expressWrap(async (req, res) => {
      delete process.env.GRIST_ADMIN_EMAIL;
      gristServer.getInstallAdmin().clearCaches();
      return sendOkReply(req, res, {});
    }));

  // Resolves the boot key the same way the rest of the server does: env var
  // takes precedence, falling back to the activation prefs DB.
  const resolveBootKey = async (): Promise<string | undefined> => {
    if (process.env.GRIST_BOOT_KEY !== undefined) {
      return process.env.GRIST_BOOT_KEY || undefined;
    }
    const activation = await gristServer.getActivations().current();
    return activation.prefs?.envVars?.GRIST_BOOT_KEY;
  };

  app.get("/api/setup/mockup-boot-key", refuseIfInService,
    expressWrap(async (req, res) => {
      const bootKey = await resolveBootKey();
      return sendOkReply(req, res, { bootKey });
    }));

  // Variant that's available even after Go Live, so the boot-key login page
  // mockup can still demo the flow.
  app.get("/api/setup/mockup-boot-key-login", expressWrap(async (req, res) => {
    const bootKey = await resolveBootKey();
    return sendOkReply(req, res, { bootKey });
  }));

  // Toggles GRIST_IN_SERVICE without restart. Available pre- and post-Go-Live
  // so marketing demos can show both transitions.
  app.post("/api/setup/mockup-set-in-service", json(),
    expressWrap(async (req, res) => {
      const inService = Boolean(req.body?.inService);
      process.env.GRIST_IN_SERVICE = inService ? "true" : "false";
      return sendOkReply(req, res, { inService });
    }));

  const requireInstallAdmin = gristServer
    .getInstallAdmin()
    .getMiddlewareRequireAdmin();

  const adminMiddleware = [requireInstallAdmin];
  app.use("/api/admin", adminMiddleware);
  app.use("/api/install", adminMiddleware);

  const probes = new BootProbes(app, gristServer, "/api", adminMiddleware);
  probes.addEndpoints();

  app.post(
    "/api/admin/restart",
    expressWrap(async (req, res) => {
      const mreq = req as RequestWithLogin;
      const meta = {
        host: mreq.get("host"),
        path: mreq.path,
        email: mreq.user?.loginEmail,
      };
      log.rawDebug(`Restart[${mreq.method}] starting:`, meta);
      res.on("finish", () => {
        // If we have IPC with parent process (e.g. when running under
        // Docker) tell the parent that we have a new environment so it
        // can restart us.
        log.rawDebug(`Restart[${mreq.method}] finishing:`, meta);
        if (process.send && canRestart()) {
          log.rawDebug(`Restart[${mreq.method}] requesting restart:`, meta);
          process.send({ action: "restart" });
        }
      });
      if (!canRestart()) {
        // On the topic of http response codes, thus spake MDN:
        // "409: This response is sent when a request conflicts with the current state of the server."
        return res.status(409).send({
          error:
            "Cannot automatically restart the Grist server to enact changes. Please restart server manually.",
        });
      }
      // We're going down, so we're no longer ready to serve requests.
      gristServer.setReady(false);
      return res.status(200).send({ msg: "ok" });
    }),
  );

  // Query current maintenance / service state.
  app.get(
    "/api/admin/maintenance",
    expressWrap(async (_req, res) => {
      const inService = gristServer.isInService();
      return res.status(200).send({ maintenance: !inService, inService });
    }),
  );

  // Toggle maintenance mode (take Grist out of / back into service).
  app.post(
    "/api/admin/maintenance",
    json({ limit: "1kb" }),
    expressWrap(async (req, res) => {
      const enable = req.body?.maintenance;
      if (typeof enable !== "boolean") {
        return res.status(400).send({ error: "Missing boolean 'maintenance' field" });
      }
      const activations = gristServer.getActivations();
      if (enable) {
        await activations.updateEnvVars({ GRIST_IN_SERVICE: "false" });
        process.env.GRIST_IN_SERVICE = "false";
      } else {
        await activations.updateEnvVars({ GRIST_IN_SERVICE: "true" });
        process.env.GRIST_IN_SERVICE = "true";
      }
      return res.status(200).send({ msg: "ok", maintenance: enable });
    }),
  );

  // Configure sandbox flavor.  Persists to activation prefs so the
  // value survives restarts.
  app.post(
    "/api/admin/configure-sandbox",
    json({ limit: "1kb" }),
    expressWrap(async (req, res) => {
      const flavor = req.body?.GRIST_SANDBOX_FLAVOR;
      if (!flavor || typeof flavor !== "string") {
        return res.status(400).send({ error: "Missing GRIST_SANDBOX_FLAVOR" });
      }
      const known = ["gvisor", "pyodide", "macSandboxExec", "unsandboxed"];
      if (!known.includes(flavor)) {
        return res.status(400).send({ error: `Unknown sandbox flavor: ${flavor}` });
      }
      const activations = gristServer.getActivations();
      await activations.updateEnvVars({ GRIST_SANDBOX_FLAVOR: flavor });
      return res.status(200).send({ msg: "ok", flavor });
    }),
  );

  // Bring Grist into service (open the setup gate).  Persists
  // GRIST_IN_SERVICE=true and optionally sets GRIST_ADMIN_EMAIL
  // and permission defaults from the pre-launch checklist.
  app.post(
    "/api/admin/go-live",
    json({ limit: "1kb" }),
    expressWrap(async (req, res) => {
      const activations = gristServer.getActivations();
      const reqAdminEmail = req.body?.adminEmail;
      if (reqAdminEmail && typeof reqAdminEmail === "string") {
        await activations.updateEnvVars({ GRIST_ADMIN_EMAIL: reqAdminEmail });
        process.env.GRIST_ADMIN_EMAIL = reqAdminEmail;
        gristServer.getInstallAdmin().clearCaches();
      }
      // Persist APP_HOME_URL from the server step.
      const homeUrl = req.body?.APP_HOME_URL;
      if (homeUrl && typeof homeUrl === "string") {
        try {
          new URL(homeUrl);
          await activations.updateEnvVars({ APP_HOME_URL: homeUrl });
          process.env.APP_HOME_URL = homeUrl;
        } catch {
          // Invalid URL — skip silently during go-live.
        }
      }
      // Persist permission defaults from the pre-launch checklist.
      const perms = req.body?.permissions;
      if (perms && typeof perms === "object") {
        const permEnvVars: Record<string, string> = {};
        const permKeys = [
          "GRIST_ORG_CREATION_ANYONE",
          "GRIST_PERSONAL_ORGS",
          "GRIST_FORCE_LOGIN",
          "GRIST_ANON_PLAYGROUND",
        ];
        for (const key of permKeys) {
          if (key in perms) {
            const val = String(perms[key]);
            permEnvVars[key] = val;
            process.env[key] = val;
          }
        }
        if (Object.keys(permEnvVars).length > 0) {
          await activations.updateEnvVars(permEnvVars);
        }
      }
      await activations.updateEnvVars({ GRIST_IN_SERVICE: "true" });
      process.env.GRIST_IN_SERVICE = "true";
      // Trigger a restart if we have IPC with a parent process.
      const restarting = typeof process.send === "function";
      if (restarting) {
        gristServer.setReady(false);
        res.on("finish", () => {
          process.send!({ action: "restart" });
        });
      }
      return res.status(200).send({ msg: "ok", restarting });
    }),
  );

  // Save permission defaults without restarting.  Used by the admin
  // panel's permissions section.
  app.post(
    "/api/admin/save-permissions",
    json({ limit: "1kb" }),
    expressWrap(async (req, res) => {
      const activations = gristServer.getActivations();
      const perms = req.body?.permissions;
      if (!perms || typeof perms !== "object") {
        return res.status(400).send({ error: "Missing permissions object" });
      }
      const permEnvVars: Record<string, string> = {};
      const permKeys = [
        "GRIST_ORG_CREATION_ANYONE",
        "GRIST_PERSONAL_ORGS",
        "GRIST_FORCE_LOGIN",
        "GRIST_ANON_PLAYGROUND",
      ];
      for (const key of permKeys) {
        if (key in perms) {
          const val = String(perms[key]);
          permEnvVars[key] = val;
          process.env[key] = val;
        }
      }
      if (Object.keys(permEnvVars).length === 0) {
        return res.status(400).send({ error: "No recognized permission keys" });
      }
      await activations.updateEnvVars(permEnvVars);
      return res.status(200).send({ msg: "ok" });
    }),
  );

  // Read current APP_HOME_URL (from env or DB-persisted env vars).
  app.get(
    "/api/admin/server-config",
    expressWrap(async (_req, res) => {
      return res.status(200).send({
        APP_HOME_URL: process.env.APP_HOME_URL || "",
      });
    }),
  );

  // Save APP_HOME_URL without restart.
  app.post(
    "/api/admin/save-server-config",
    json({ limit: "1kb" }),
    expressWrap(async (req, res) => {
      const activations = gristServer.getActivations();
      const url = req.body?.APP_HOME_URL;
      if (typeof url !== "string" || !url) {
        return res.status(400).send({ error: "Missing APP_HOME_URL" });
      }
      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return res.status(400).send({ error: "Invalid URL" });
      }
      await activations.updateEnvVars({ APP_HOME_URL: url });
      process.env.APP_HOME_URL = url;
      return res.status(200).send({ msg: "ok" });
    }),
  );

  // Generate a new boot key and store it in activation prefs.
  app.post(
    "/api/admin/boot-key/generate",
    json({ limit: "1kb" }),
    expressWrap(async (_req, res) => {
      const crypto = await import("crypto");
      const newKey = crypto.randomBytes(12).toString("hex");
      const activations = gristServer.getActivations();
      const activation = await activations.current();
      if (!activation.prefs) { activation.prefs = {}; }
      activation.prefs.bootKey = newKey;
      await activation.save();
      (gristServer as any)._bootKey = newKey;
      return res.status(200).send({ msg: "ok", bootKey: newKey });
    }),
  );

  // Clear the boot key from activation prefs.
  app.post(
    "/api/admin/boot-key/clear",
    json({ limit: "1kb" }),
    expressWrap(async (_req, res) => {
      const activations = gristServer.getActivations();
      const activation = await activations.current();
      if (activation.prefs?.bootKey) {
        delete activation.prefs.bootKey;
        await activation.save();
      }
      // Also clear the cached value so getBootKey() returns the env var (or undefined).
      (gristServer as any)._bootKey = process.env.GRIST_BOOT_KEY || undefined;
      return res.status(200).send({ msg: "ok" });
    }),
  );

  // Restrict this endpoint to install admins.
  app.get(
    "/api/install/prefs",
    expressWrap(async (_req, res) => {
      const prefs = await gristServer.getActivations().getPrefsWithSources();
      return sendOkReply(null, res, prefs);
    }),
  );

  // Returns current default permission settings with their sources.
  app.get(
    "/api/install/permissions",
    expressWrap(async (_req, res) => {
      const toPrefSource = (s: "env" | "db" | undefined): PrefSource | undefined =>
        s === "env" ? "environment-variable" : s === "db" ? "preferences" : undefined;
      const status: PermissionsStatus = {
        orgCreationAnyone: { value: getCanAnyoneCreateOrgs(), source: toPrefSource(getCanAnyoneCreateOrgsSource()) },
        personalOrgs: { value: getPersonalOrgsEnabled(), source: toPrefSource(getPersonalOrgsEnabledSource()) },
        forceLogin: { value: getForceLogin(), source: toPrefSource(getForceLoginSource()) },
        anonPlayground: { value: getAnonPlaygroundEnabled(), source: toPrefSource(getAnonPlaygroundEnabledSource()) },
      };
      return sendOkReply(null, res, status);
    }),
  );

  app.patch(
    "/api/install/prefs",
    json({ limit: "1mb" }),
    expressWrap(async (req, res) => {
      const prefs = req.body;
      await gristServer.getActivations().updatePrefs(prefs);

      const { telemetry, envVars } = prefs as InstallPrefs;

      if (telemetry) {
        // Make sure the Telemetry singleton picks up the changes to telemetry preferences.
        // TODO: if there are multiple home server instances, notify them all of changes to
        // preferences (via Redis Pub/Sub).
        await gristServer.getTelemetry().fetchTelemetryPrefs();
      }

      if (!isEmpty(envVars)) {
        // TODO: Similar to above, we need to notify other servers of updates to env vars.
        appSettings.setEnvVars((await gristServer.getActivations().current()).prefs?.envVars || {});
        invalidateReloadableSettings(...Object.keys(envVars!));
      }

      return res.status(200).send();
    }),
  );

  // Retrieves the latest version of the client from Grist SAAS endpoint.
  app.get(
    "/api/install/updates",
    expressWrap(async (_req, res) => {
      try {
        const updateData = await updateGristServerLatestVersion(gristServer, true);
        res.json(updateData);
      } catch (error) {
        res.status(error.status);
        if (typeof error.details === "object") {
          res.json(error.details);
        } else {
          res.send(error.details);
        }
      }
    }),
  );

  app.get(
    "/api/install/configs/:key",
    hasValidConfigKey,
    expressWrap(async (req, res) => {
      const key = stringParam(req.params.key, "key") as ConfigKey;
      const configResult = await gristServer
        .getHomeDBManager()
        .getInstallConfig(key);
      const result = pruneConfigAPIResult(configResult);
      return sendReply(req, res, result);
    }),
  );

  app.put(
    "/api/install/configs/:key",
    json({ limit: "1mb", strict: false }),
    hasValidConfig,
    expressWrap(async (req, res) => {
      const key = stringParam(req.params.key, "key") as ConfigKey;
      const value = req.body as ConfigValue;
      const configResult = await gristServer
        .getHomeDBManager()
        .updateInstallConfig(key, value);
      if (configResult.data) {
        logCreateOrUpdateConfigEvents(req, configResult.data);
      }
      const result = pruneConfigAPIResult(configResult);
      return sendReply(req, res, result);
    }),
  );

  app.delete(
    "/api/install/configs/:key",
    hasValidConfigKey,
    expressWrap(async (req, res) => {
      const key = stringParam(req.params.key, "key") as ConfigKey;
      const { data, ...result } = await gristServer
        .getHomeDBManager()
        .deleteInstallConfig(key);
      if (data) {
        logDeleteConfigEvents(req, data);
      }
      return sendReply(req, res, result);
    }),
  );

  app.get(
    "/api/orgs/:oid/configs/:key",
    hasValidConfigKey,
    expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const key = stringParam(req.params.key, "key") as ConfigKey;
      const configResult = await gristServer
        .getHomeDBManager()
        .getOrgConfig(getScope(req), org, key);
      const result = pruneConfigAPIResult(configResult);
      return sendReply(req, res, result);
    }),
  );

  app.put(
    "/api/orgs/:oid/configs/:key",
    json({ limit: "1mb", strict: false }),
    hasValidConfig,
    expressWrap(async (req, res) => {
      const key = stringParam(req.params.key, "key") as ConfigKey;
      const org = getOrgKey(req);
      const value = req.body as ConfigValue;
      const configResult = await gristServer
        .getHomeDBManager()
        .updateOrgConfig(getScope(req), org, key, value);
      if (configResult.data) {
        logCreateOrUpdateConfigEvents(req, configResult.data);
      }
      const result = pruneConfigAPIResult(configResult);
      return sendReply(req, res, result);
    }),
  );

  app.delete(
    "/api/orgs/:oid/configs/:key",
    hasValidConfigKey,
    expressWrap(async (req, res) => {
      const org = getOrgKey(req);
      const key = stringParam(req.params.key, "key") as ConfigKey;
      const { data, status } = await gristServer
        .getHomeDBManager()
        .deleteOrgConfig(getScope(req), org, key);
      if (data) {
        logDeleteConfigEvents(req, data);
      }
      return sendReply(req, res, { status });
    }),
  );

  function logCreateOrUpdateConfigEvents(
    req: Request,
    config: Config | PreviousAndCurrent<Config>,
  ) {
    const mreq = req as RequestWithLogin;
    if ("previous" in config) {
      const { previous, current } = config;
      gristServer.getAuditLogger().logEvent(mreq, {
        action: "config.update",
        context: {
          site: current.org ?
            pick(current.org, "id", "name", "domain") :
            undefined,
        },
        details: {
          previous: {
            config: {
              ...pick(previous, "id", "key", "value"),
              site: previous.org ?
                pick(previous.org, "id", "name", "domain") :
                undefined,
            },
          },
          current: {
            config: {
              ...pick(current, "id", "key", "value"),
              site: current.org ?
                pick(current.org, "id", "name", "domain") :
                undefined,
            },
          },
        },
      });
    } else {
      gristServer.getAuditLogger().logEvent(mreq, {
        action: "config.create",
        context: {
          site: config.org ?
            pick(config.org, "id", "name", "domain") :
            undefined,
        },
        details: {
          config: {
            ...pick(config, "id", "key", "value"),
            site: config.org ?
              pick(config.org, "id", "name", "domain") :
              undefined,
          },
        },
      });
    }
  }

  function logDeleteConfigEvents(req: Request, config: Config) {
    gristServer.getAuditLogger().logEvent(req as RequestWithLogin, {
      action: "config.delete",
      context: {
        site: config.org ? pick(config.org, "id", "name", "domain") : undefined,
      },
      details: {
        config: {
          ...pick(config, "id", "key", "value"),
          site: config.org ?
            pick(config.org, "id", "name", "domain") :
            undefined,
        },
      },
    });
  }
}

function pruneConfigAPIResult(
  result: QueryResult<Config | PreviousAndCurrent<Config>>,
) {
  if (!result.data) {
    return result as unknown as QueryResult<undefined>;
  }

  const config = "previous" in result.data ? result.data.current : result.data;
  return {
    ...result,
    data: {
      ...pick(config, "id", "key", "value", "createdAt", "updatedAt"),
      ...(config.org ?
        { org: pick(config.org, "id", "name", "domain") } :
        undefined),
    },
  };
}

function hasValidConfig(req: Request, _res: Response, next: NextFunction) {
  try {
    assertValidConfig(req);
    next();
  } catch (e) {
    next(e);
  }
}

function hasValidConfigKey(req: Request, _res: Response, next: NextFunction) {
  try {
    assertValidConfigKey(req);
    next();
  } catch (e) {
    next(e);
  }
}

function assertValidConfig(req: Request) {
  assertValidConfigKey(req);
  const key = stringParam(req.params.key, "key") as ConfigKey;
  try {
    ConfigValueCheckers[key].check(req.body);
  } catch (err) {
    log.warn(
      `Error during API call to ${req.path}: invalid config value (${String(
        err,
      )})`,
    );
    throw new ApiError("Invalid config value", 400, { userError: String(err) });
  }
}

function assertValidConfigKey(req: Request) {
  try {
    ConfigKeyChecker.check(req.params.key);
  } catch (err) {
    log.warn(
      `Error during API call to ${req.path}: invalid config key (${String(
        err,
      )})`,
    );
    throw new ApiError("Invalid config key", 400, { userError: String(err) });
  }
}
