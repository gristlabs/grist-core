import { ApiError } from "app/common/ApiError";
import { BootProbeIds, BootProbeResult } from "app/common/BootProbe";
import { removeTrailingSlash } from "app/common/gutil";
import { appSettings } from "app/server/lib/AppSettings";
import { expressWrap, jsonErrorHandler } from "app/server/lib/expressWrap";
import { GristServer } from "app/server/lib/GristServer";
import { getBootKey, getInService, getSandboxFlavor, getSandboxFlavorSource } from "app/server/lib/gristSettings";
import { DEFAULT_SESSION_SECRET } from "app/server/lib/ICreate";
import { getAvailableSandboxes, testSandboxFlavor } from "app/server/lib/NSandbox";

import * as express from "express";
import fetch from "node-fetch";
import WS from "ws";

/**
 * Self-diagnostics useful when installing Grist.
 */
export class BootProbes {
  // List of probes.
  public _probes = new Array<Probe>();

  // Probes indexed by id.
  public _probeById = new Map<string, Probe>();

  public constructor(private _app: express.Application,
    private _server: GristServer,
    private _base: string,
    private _middleware: express.Handler[] = []) {
    this._addProbes();
  }

  public addEndpoints() {
    // Return a list of available probes.
    // GET /api/probes
    this._app.use(`${this._base}/probes$`,
      ...this._middleware,
      expressWrap(async (_, res) => {
        res.json({
          probes: this._probes.map((probe) => {
            return { id: probe.id, name: probe.name };
          }),
        });
      }));

    // Return result of running an individual probe.
    // GET /api/probes/:probeId
    this._app.use(`${this._base}/probes/:probeId`,
      ...this._middleware,
      expressWrap(async (req, res) => {
        const probe = this._probeById.get(req.params.probeId);
        if (!probe) {
          throw new ApiError("unknown probe", 400);
        }
        const result = await probe.apply(this._server, req);
        res.json(result);
      }));

    // Fall-back for errors.
    this._app.use(`${this._base}/probes`, jsonErrorHandler);
  }

  private _addProbes() {
    this._probes.push(_homeUrlReachableProbe);
    this._probes.push(_statusCheckProbe);
    this._probes.push(_userProbe);
    this._probes.push(_bootKeyProbe);
    this._probes.push(_hostHeaderProbe);
    this._probes.push(_sandboxingProbe);
    this._probes.push(_authenticationProbe);
    this._probes.push(_webSocketsProbe);
    this._probes.push(_sessionSecretProbe);
    this._probes.push(_admins);
    this._probes.push(_serviceStatusProbe);
    this._probes.push(_backupsProbe);
    this._probes.push(_sandboxProvidersProbe);
    this._probeById = new Map(this._probes.map(p => [p.id, p]));
  }
}

/**
 * An individual probe has an id, a name, an optional description,
 * and a method that returns a probe result.
 */
export interface Probe {
  id: BootProbeIds;
  name: string;
  description?: string;
  apply: (server: GristServer, req: express.Request) => Promise<BootProbeResult>;
}

const _admins: Probe = {
  id: "admins",
  name: "Currently defined install admins",
  apply: async (server, req) => {
    try {
      const users = await server.getInstallAdmin().getAdminUsers(req);
      return {
        status: "success",
        details: { users },
      };
    } catch (e) {
      return {
        status: "fault",
        details: { error: String(e) },
      };
    }
  },
};

const _homeUrlReachableProbe: Probe = {
  id: "reachable",
  name: "Is home page available at expected URL",
  apply: async (server, req) => {
    const url = server.getHomeInternalUrl();
    const details: Record<string, any> = {
      url,
    };
    try {
      const resp = await fetch(url);
      details.status = resp.status;
      if (resp.status !== 200) {
        throw new ApiError(await resp.text(), resp.status);
      }
      return {
        status: "success",
        details,
      };
    } catch (e) {
      return {
        details: {
          ...details,
          error: String(e),
        },
        status: "fault",
      };
    }
  },
};

const _webSocketsProbe: Probe = {
  id: "websockets",
  name: "Can we open a websocket with the server",
  apply: async (server, req) => {
    return new Promise((resolve) => {
      const url = new URL(server.getHomeUrl(req));
      url.protocol = (url.protocol === "https:") ? "wss:" : "ws:";
      const ws = new WS.WebSocket(url.href);
      const details: Record<string, any> = {
        url,
      };
      ws.on("open", () => {
        ws.send('{"msg": "Just nod if you can hear me."}');
        resolve({
          status: "success",
          details,
        });
        ws.close();
      });
      ws.on("error", (ev) => {
        details.error = ev.message;
        resolve({
          status: "fault",
          details,
        });
        ws.close();
      });
    });
  },
};

const _statusCheckProbe: Probe = {
  id: "health-check",
  name: "Is an internal health check passing",
  apply: async (server, req) => {
    const baseUrl = server.getHomeInternalUrl();
    const url = new URL(baseUrl);
    url.pathname = removeTrailingSlash(url.pathname) + "/status";
    const details: Record<string, any> = {
      url: url.href,
    };
    try {
      const resp = await fetch(url);
      details.status = resp.status;
      if (resp.status !== 200) {
        throw new Error(`Failed with status ${resp.status}`);
      }
      const txt = await resp.text();
      if (!txt.includes("is alive")) {
        throw new Error(`Failed, page has unexpected content`);
      }
      return {
        status: "success",
        details,
      };
    } catch (e) {
      return {
        details: {
          ...details,
          error: String(e),
        },
        status: "fault",
      };
    }
  },
};

const _userProbe: Probe = {
  id: "system-user",
  name: "Is the system user following best practice",
  apply: async () => {
    const details = {
      uid: process.getuid ? process.getuid() : "unavailable",
    };
    if (process.getuid && process.getuid() === 0) {
      return {
        details,
        verdict: "User appears to be root (UID 0)",
        status: "warning",
      };
    } else {
      return {
        status: "success",
        details,
      };
    }
  },
};

const _bootKeyProbe: Probe = {
  id: "boot-key",
  name: "Is boot key authentication disabled",
  apply: async () => {
    const { value, source } = getBootKey();
    const disabled = !value;
    return {
      status: disabled ? "success" : "warning",
      verdict: disabled ? undefined : "Boot key should be removed after installation",
      details: { disabled, source },
    };
  },
};

/**
 * Based on:
 * https://github.com/gristlabs/grist-core/issues/228#issuecomment-1803304438
 *
 * When GRIST_SERVE_SAME_ORIGIN is set, requests arriving to Grist need
 * to have an accurate Host header.
 */
const _hostHeaderProbe: Probe = {
  id: "host-header",
  name: "Does the host header look correct",
  apply: async (server, req) => {
    const host = req.header("host");
    const url = new URL(server.getHomeUrl(req));
    const details = {
      homeUrlHost: url.hostname,
      headerHost: host,
    };
    if (url.hostname === "localhost") {
      return {
        status: "none",
        details,
      };
    }
    if (String(url.hostname).toLowerCase() !== String(host).toLowerCase()) {
      return {
        details,
        status: "hmm",
      };
    }
    return {
      status: "none",
      details,
    };
  },
};

const _sandboxingProbe: Probe = {
  id: "sandboxing",
  name: "Is document sandboxing effective",
  apply: async (server, req) => {
    const details = await server.getSandboxInfo();
    return {
      status: (details?.configured && details?.functional) ? "success" : "fault",
      details,
    };
  },
};

const _authenticationProbe: Probe = {
  id: "authentication",
  name: "Authentication system",
  apply: async (server, req) => {
    // Check what provider is active, there is always one, even if there are errors.
    const active = appSettings.section("login").flag("active").get();

    if (!active) {
      return {
        status: "fault",
        verdict: "No active authentication provider",
      };
    }

    // Check if active provider has errors.
    const error = appSettings.section("login").flag("error").get();
    const provider = String(active);
    const status = error ? "fault" : provider === "no-auth" ? "warning" : "success";
    return {
      status,
      verdict: error ? String(error) : undefined,
      details: {
        provider,
      },
    };
  },
};

const _sessionSecretProbe: Probe = {
  id: "session-secret",
  name: "Session secret",
  apply: async (server, req) => {
    const usingDefaultSessionSecret = server.create.sessionSecret() === DEFAULT_SESSION_SECRET;
    return {
      status: usingDefaultSessionSecret ? "warning" : "success",
      details: {
        GRIST_SESSION_SECRET: process.env.GRIST_SESSION_SECRET ? "set" : "not set",
      },
    };
  },
};

const _serviceStatusProbe: Probe = {
  id: "service-status",
  name: "Service status",
  apply: async () => {
    const { value: inService, source } = getInService();
    return {
      status: inService ? "success" : "warning",
      verdict: inService ? undefined : "Server is out of service for maintenance",
      details: { inService, source },
    };
  },
};

const _backupsProbe: Probe = {
  id: "backups",
  name: "Backups",
  apply: async (server) => {
    const externalStorage = appSettings.section("externalStorage");
    const active = externalStorage.flag("active").getAsBool();
    const availableBackends = server.create.getAvailableStorageBackends();
    const backend = Object.values(externalStorage.nested)
      .find(storage => storage.flag("active").getAsBool())
      ?.name;
    return {
      status: active ? "success" : "warning",
      verdict: active ? undefined : "Backups are not enabled",
      details: {
        active,
        availableBackends,
        backend,
      },
    };
  },
};

const _sandboxProvidersProbe: Probe = {
  id: "sandbox-providers",
  name: "Available sandbox providers",
  apply: async (server) => {
    const available = getAvailableSandboxes().map(o => ({ ...o }));

    // Get current sandbox info.
    const sandboxInfo = await server.getSandboxInfo();

    // Test all available and effective sandboxes in parallel.
    const testPromises = available
      .filter(o => o.available && o.effective)
      .map(async (o) => {
        const result = o.flavor === sandboxInfo.flavor ? sandboxInfo :
          await testSandboxFlavor(o.flavor).catch(() => undefined);
        if (result) {
          o.functional = result.functional;
          o.error = result.error;
          o.lastSuccessfulStep = result.lastSuccessfulStep;
        }
      });
    await Promise.all(testPromises);

    // Read what's saved in the database.
    const activation = await server.getActivations().current();
    const dbEnvVars = activation.prefs?.envVars || {};
    const flavorInDB = dbEnvVars.GRIST_SANDBOX_FLAVOR || undefined;

    // Check if set via environment variable (not changeable from UI).
    const flavorInEnv = getSandboxFlavorSource() === "env" ? getSandboxFlavor() : undefined;

    const hasFunctionalSandbox = available.some(o => o.functional && o.effective);
    return {
      status: hasFunctionalSandbox ? "success" : "warning",
      details: {
        options: available,
        current: sandboxInfo.flavor,
        flavorInEnv,
        flavorInDB,
      },
    };
  },
};
