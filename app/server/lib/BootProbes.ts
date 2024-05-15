import { ApiError } from 'app/common/ApiError';
import { BootProbeIds, BootProbeResult } from 'app/common/BootProbe';
import { removeTrailingSlash } from 'app/common/gutil';
import { expressWrap, jsonErrorHandler } from 'app/server/lib/expressWrap';
import { GristServer } from 'app/server/lib/GristServer';
import * as express from 'express';
import fetch from 'node-fetch';

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
        success: true,
        details,
      };
    } catch (e) {
      return {
        success: false,
        details: {
          ...details,
          error: String(e),
        },
        severity: 'fault',
      };
    }
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
        success: true,
        details,
      };
    } catch (e) {
      return {
        success: false,
        details: {
          ...details,
          error: String(e),
        },
        severity: 'fault',
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
        success: false,
        verdict: 'User appears to be root (UID 0)',
        severity: 'warning',
      };
    } else {
      return {
        success: true,
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
      return { success: true, details };
    }
    details.bootKeyLength = bootKey.length;
    if (bootKey.length < 10) {
      return {
        success: false,
        verdict: 'Boot key length is shorter than 10.',
        details,
        severity: 'fault',
      };
    }
    return {
      success: false,
      verdict: 'Boot key ideally should be removed after installation.',
      details,
      severity: 'warning',
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
        done: true,
        details,
      };
    }
    if (String(url.hostname).toLowerCase() !== String(host).toLowerCase()) {
      return {
        success: false,
        details,
        severity: 'hmm',
      };
    }
    return {
      done: true,
      details,
    };
  },
};

const _sandboxingProbe: Probe = {
  id: 'sandboxing',
  name: 'Is document sandboxing effective',
  apply: async (server, req) => {
    const details = server.getSandboxInfo();
    return {
      success: details?.configured && details?.functional,
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
      success: loginSystemId != undefined,
      details: {
        loginSystemId,
      }
    };
  },
};
