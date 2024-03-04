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
                     private _base: string) {
    this._addProbes();
  }

  public addEndpoints() {
    // Return a list of available probes.
    this._app.use(`${this._base}/probe$`, expressWrap(async (_, res) => {
      res.json({
        'probes': this._probes.map(probe => {
          return { id: probe.id, name: probe.name };
        }),
      });
    }));

    // Return result of running an individual probe.
    this._app.use(`${this._base}/probe/:probeId`, expressWrap(async (req, res) => {
      const probe = this._probeById.get(req.params.probeId);
      if (!probe) {
        throw new ApiError('unknown probe', 400);
      }
      const result = await probe.apply(this._server, req);
      res.json(result);
    }));

    // Fall-back for errors.
    this._app.use(`${this._base}/probe`, jsonErrorHandler);
  }

  private _addProbes() {
    this._probes.push(_homeUrlReachableProbe);
    this._probes.push(_statusCheckProbe);
    this._probes.push(_userProbe);
    this._probes.push(_bootProbe);
    this._probes.push(_hostHeaderProbe);
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
  name: 'Grist is reachable',
  apply: async (server, req) => {
    const url = server.getHomeUrl(req);
    try {
      const resp = await fetch(url);
      if (resp.status !== 200) {
        throw new ApiError(await resp.text(), resp.status);
      }
      return {
        success: true,
      };
    } catch (e) {
      return {
        success: false,
        details: {
          error: String(e),
        },
        severity: 'fault',
      };
    }
  }
};

const _statusCheckProbe: Probe = {
  id: 'health-check',
  name: 'Built-in Health check',
  apply: async (server, req) => {
    const baseUrl = server.getHomeUrl(req);
    const url = new URL(baseUrl);
    url.pathname = removeTrailingSlash(url.pathname) + '/status';
    try {
      const resp = await fetch(url);
      if (resp.status !== 200) {
        throw new Error(`Failed with status ${resp.status}`);
      }
      const txt = await resp.text();
      if (!txt.includes('is alive')) {
        throw new Error(`Failed, page has unexpected content`);
      }
      return {
        success: true,
      };
    } catch (e) {
      return {
        success: false,
        error: String(e),
        severity: 'fault',
      };
    }
  },
};

const _userProbe: Probe = {
  id: 'system-user',
  name: 'System user is sane',
  apply: async () => {
    if (process.getuid && process.getuid() === 0) {
      return {
        success: false,
        verdict: 'User appears to be root (UID 0)',
        severity: 'warning',
      };
    } else {
      return {
        success: true,
      };
    }
  },
};

const _bootProbe: Probe = {
  id: 'boot-page',
  name: 'Boot page exposure',
  apply: async (server) => {
    if (!server.hasBoot) {
      return { success: true };
    }
    const maybeSecureEnough = String(process.env.GRIST_BOOT_KEY).length > 10;
    return {
      success: maybeSecureEnough,
      severity: 'hmm',
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
  name: 'Host header is sane',
  apply: async (server, req) => {
    const host = req.header('host');
    const url = new URL(server.getHomeUrl(req));
    if (url.hostname === 'localhost') {
      return {
        done: true,
      };
    }
    if (String(url.hostname).toLowerCase() !== String(host).toLowerCase()) {
      return {
        success: false,
        severity: 'hmm',
      };
    }
    return {
      done: true,
    };
  },
};
