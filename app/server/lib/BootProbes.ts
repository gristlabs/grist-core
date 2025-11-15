import { ApiError } from 'app/common/ApiError';
import { BootProbeIds, BootProbeResult } from 'app/common/BootProbe';
import { removeTrailingSlash } from 'app/common/gutil';
import { expressWrap, jsonErrorHandler } from 'app/server/lib/expressWrap';
import { GristServer } from 'app/server/lib/GristServer';
import * as express from 'express';
import WS from 'ws';
import fetch from 'node-fetch';
import { DEFAULT_SESSION_SECRET } from 'app/server/lib/ICreate';

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
    this._app.use(`${this._base}/probes$`,
                  ...this._middleware,
                  expressWrap(async (_, res) => {
      res.json({
        'probes': this._probes.map(probe => {
          return { id: probe.id, name: probe.name };
        }),
      });
    }));

    // Return result of running an individual probe.
    this._app.use(`${this._base}/probes/:probeId`,
                  ...this._middleware,
                  expressWrap(async (req, res) => {
      const probe = this._probeById.get(req.params.probeId);
      if (!probe) {
        throw new ApiError('unknown probe', 400);
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
    this._probes.push(_bootProbe);
    this._probes.push(_hostHeaderProbe);
    this._probes.push(_sandboxingProbe);
    this._probes.push(_authenticationProbe);
    this._probes.push(_webSocketsProbe);
    this._probes.push(_sessionSecretProbe);
    this._probes.push(_admins);
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
  id: 'admins',
  name: 'Currently defined install admins',
  apply: async (server, req) => {
    try {
      const users = await server.getInstallAdmin().getAdminUsers(req);
      return {
        status: 'success',
        details: {users}
      };
    } catch (e) {
      return {
        status: 'fault',
        details: {error: String(e)},
      };
    }
  }
};

const _homeUrlReachableProbe: Probe = {
  id: 'reachable',
  name: 'Is home page available at expected URL',
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
        status: 'success',
        details,
      };
    } catch (e) {
      return {
        details: {
          ...details,
          error: String(e),
        },
        status: 'fault',
      };
    }
  }
};

const _webSocketsProbe: Probe = {
  id: 'websockets',
  name: 'Can we open a websocket with the server',
  apply: async (server, req) => {
    return new Promise((resolve) => {
      const url = new URL(server.getHomeUrl(req));
      url.protocol = (url.protocol === 'https:') ? 'wss:' : 'ws:';
      const ws = new WS.WebSocket(url.href);
      const details: Record<string, any> = {
        url,
      };
      ws.on('open', () => {
        ws.send('{"msg": "Just nod if you can hear me."}');
        resolve({
          status: 'success',
          details,
        });
        ws.close();
      });
      ws.on('error', (ev) => {
        details.error = ev.message;
        resolve({
          status: 'fault',
          details,
        });
        ws.close();
      });
    });
  }
};

const _statusCheckProbe: Probe = {
  id: 'health-check',
  name: 'Is an internal health check passing',
  apply: async (server, req) => {
    const baseUrl = server.getHomeInternalUrl();
    const url = new URL(baseUrl);
    url.pathname = removeTrailingSlash(url.pathname) + '/status';
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
      if (!txt.includes('is alive')) {
        throw new Error(`Failed, page has unexpected content`);
      }
      return {
        status: 'success',
        details,
      };
    } catch (e) {
      return {
        details: {
          ...details,
          error: String(e),
        },
        status: 'fault',
      };
    }
  },
};

const _userProbe: Probe = {
  id: 'system-user',
  name: 'Is the system user following best practice',
  apply: async () => {
    const details = {
      uid: process.getuid ? process.getuid() : 'unavailable',
    };
    if (process.getuid && process.getuid() === 0) {
      return {
        details,
        verdict: 'User appears to be root (UID 0)',
        status: 'warning',
      };
    } else {
      return {
        status: 'success',
        details,
      };
    }
  },
};

const _bootProbe: Probe = {
  id: 'boot-page',
  name: 'Is the boot page adequately protected',
  apply: async (server) => {
    const bootKey = server.getBootKey() || '';
    const hasBoot = Boolean(bootKey);
    const details: Record<string, any> = {
      bootKeySet: hasBoot,
    };
    if (!hasBoot) {
      return { status: 'success', details };
    }
    details.bootKeyLength = bootKey.length;
    if (bootKey.length < 10) {
      return {
        verdict: 'Boot key length is shorter than 10.',
        details,
        status: 'fault',
      };
    }
    return {
      verdict: 'Boot key ideally should be removed after installation.',
      details,
      status: 'warning',
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
  id: 'host-header',
  name: 'Does the host header look correct',
  apply: async (server, req) => {
    const host = req.header('host');
    const url = new URL(server.getHomeUrl(req));
    const details = {
      homeUrlHost: url.hostname,
      headerHost: host,
    };
    if (url.hostname === 'localhost') {
      return {
        status: 'none',
        details,
      };
    }
    if (String(url.hostname).toLowerCase() !== String(host).toLowerCase()) {
      return {
        details,
        status: 'hmm',
      };
    }
    return {
      status: 'none',
      details,
    };
  },
};

const _sandboxingProbe: Probe = {
  id: 'sandboxing',
  name: 'Is document sandboxing effective',
  apply: async (server, req) => {
    const details = await server.getSandboxInfo();
    return {
      status: (details?.configured && details?.functional) ? 'success' : 'fault',
      details,
    };
  },
};

const _authenticationProbe: Probe = {
  id: 'authentication',
  name: 'Authentication system',
  apply: async(server, req) => {
    const loginSystemId = server.getInfo('loginMiddlewareComment');
    return {
      status: (loginSystemId != undefined) ? 'success' : 'fault',
      details: {
        loginSystemId,
      }
    };
  },
};

const _sessionSecretProbe: Probe = {
  id: 'session-secret',
  name: 'Session secret',
  apply: async(server, req) => {
    const usingDefaultSessionSecret = server.create.sessionSecret() === DEFAULT_SESSION_SECRET;
    return {
      status: usingDefaultSessionSecret ? 'warning' : 'success',
      details: {
        "GRIST_SESSION_SECRET": process.env.GRIST_SESSION_SECRET ? "set" : "not set",
      }
    };
  },
};
