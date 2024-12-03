import { ApiError } from "app/common/ApiError";
import {
  ConfigKey,
  ConfigKeyChecker,
  ConfigValue,
  ConfigValueCheckers,
} from "app/common/Config";
import { commonUrls } from "app/common/gristUrls";
import { InstallProperties } from "app/common/InstallAPI";
import * as version from "app/common/version";
import { getOrgKey } from "app/gen-server/ApiServer";
import { Config } from "app/gen-server/entity/Config";
import {
  PreviousAndCurrent,
  QueryResult,
} from "app/gen-server/lib/homedb/Interfaces";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { BootProbes } from "app/server/lib/BootProbes";
import { expressWrap } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import log from "app/server/lib/log";
import {
  getScope,
  sendOkReply,
  sendReply,
  stringParam,
} from "app/server/lib/requestUtils";
import { getTelemetryPrefs } from "app/server/lib/Telemetry";
import {
  Application,
  json,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from "express";
import pick from "lodash/pick";

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
    "/admin",
    userIdMiddleware,
    expressWrap(async (req, res) => {
      return gristServer.sendAppPage(req, res, {
        path: "app.html",
        status: 200,
        config: {},
      });
    })
  );

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
    expressWrap(async (_, res) => {
      res.on("finish", () => {
        // If we have IPC with parent process (e.g. when running under
        // Docker) tell the parent that we have a new environment so it
        // can restart us.
        if (process.send) {
          process.send({ action: "restart" });
        }
      });

      if (!process.env.GRIST_RUNNING_UNDER_SUPERVISOR) {
        // On the topic of http response codes, thus spake MDN:
        // "409: This response is sent when a request conflicts with the current state of the server."
        return res.status(409).send({
          error:
            "Cannot automatically restart the Grist server to enact changes. Please restart server manually.",
        });
      }
      return res.status(200).send({ msg: "ok" });
    })
  );

  // Restrict this endpoint to install admins.
  app.get(
    "/api/install/prefs",
    expressWrap(async (_req, res) => {
      const activation = await gristServer.getActivations().current();

      return sendOkReply(null, res, {
        telemetry: await getTelemetryPrefs(
          gristServer.getHomeDBManager(),
          activation
        ),
      });
    })
  );

  app.patch(
    "/api/install/prefs",
    json({ limit: "1mb" }),
    expressWrap(async (req, res) => {
      const props = { prefs: req.body };
      const activation = await gristServer.getActivations().current();
      activation.checkProperties(props);
      activation.updateFromProperties(props);
      await activation.save();

      if ((props as Partial<InstallProperties>).prefs?.telemetry) {
        // Make sure the Telemetry singleton picks up the changes to telemetry preferences.
        // TODO: if there are multiple home server instances, notify them all of changes to
        // preferences (via Redis Pub/Sub).
        await gristServer.getTelemetry().fetchTelemetryPrefs();
      }

      return res.status(200).send();
    })
  );

  // Retrieves the latest version of the client from Grist SAAS endpoint.
  app.get(
    "/api/install/updates",
    expressWrap(async (_req, res) => {
      // Prepare data for the telemetry that endpoint might expect.
      const installationId = (await gristServer.getActivations().current()).id;
      const deploymentType = gristServer.getDeploymentType();
      const currentVersion = version.version;
      const response = await fetch(
        process.env.GRIST_TEST_VERSION_CHECK_URL || commonUrls.versionCheck,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            installationId,
            deploymentType,
            currentVersion,
          }),
        }
      );
      if (!response.ok) {
        res.status(response.status);
        if (
          response.headers.get("content-type")?.includes("application/json")
        ) {
          const data = await response.json();
          res.json(data);
        } else {
          res.send(await response.text());
        }
      } else {
        res.json(await response.json());
      }
    })
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
    })
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
    })
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
    })
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
    })
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
    })
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
    })
  );

  function logCreateOrUpdateConfigEvents(
    req: Request,
    config: Config | PreviousAndCurrent<Config>
  ) {
    const mreq = req as RequestWithLogin;
    if ("previous" in config) {
      const { previous, current } = config;
      gristServer.getAuditLogger().logEvent(mreq, {
        action: "config.update",
        context: {
          site: current.org
            ? pick(current.org, "id", "name", "domain")
            : undefined,
        },
        details: {
          previous: {
            config: {
              ...pick(previous, "id", "key", "value"),
              site: previous.org
                ? pick(previous.org, "id", "name", "domain")
                : undefined,
            },
          },
          current: {
            config: {
              ...pick(current, "id", "key", "value"),
              site: current.org
                ? pick(current.org, "id", "name", "domain")
                : undefined,
            },
          },
        },
      });
    } else {
      gristServer.getAuditLogger().logEvent(mreq, {
        action: "config.create",
        context: {
          site: config.org
            ? pick(config.org, "id", "name", "domain")
            : undefined,
        },
        details: {
          config: {
            ...pick(config, "id", "key", "value"),
            site: config.org
              ? pick(config.org, "id", "name", "domain")
              : undefined,
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
          site: config.org
            ? pick(config.org, "id", "name", "domain")
            : undefined,
        },
      },
    });
  }
}

function pruneConfigAPIResult(
  result: QueryResult<Config | PreviousAndCurrent<Config>>
) {
  if (!result.data) {
    return result as unknown as QueryResult<undefined>;
  }

  const config = "previous" in result.data ? result.data.current : result.data;
  return {
    ...result,
    data: {
      ...pick(config, "id", "key", "value", "createdAt", "updatedAt"),
      ...(config.org
        ? { org: pick(config.org, "id", "name", "domain") }
        : undefined),
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
        err
      )})`
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
        err
      )})`
    );
    throw new ApiError("Invalid config key", 400, { userError: String(err) });
  }
}
