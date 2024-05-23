import { reportError } from 'app/client/models/errors';
import { BootProbeIds, BootProbeInfo, BootProbeResult } from 'app/common/BootProbe';
import { InstallAPI } from 'app/common/InstallAPI';
import { getGristConfig } from 'app/common/urlUtils';
import { Disposable, Observable, UseCBOwner } from 'grainjs';

/**
 * Manage a collection of checks about the status of Grist, for
 * presentation on the admin panel or the boot page.
 */
export class AdminChecks {

  // The back end will offer a set of probes (diagnostics) we
  // can use. Probes have unique IDs.
  public probes: Observable<BootProbeInfo[]>;

  // Keep track of probe requests we are making, by probe ID.
  private _requests: Map<string, AdminCheckRunner>;

  // Keep track of probe results we have received, by probe ID.
  private _results: Map<string, Observable<BootProbeResult>>;

  constructor(private _parent: Disposable, private _installAPI: InstallAPI) {
    this.probes = Observable.create(_parent, []);
    this._results = new Map();
    this._requests = new Map();
  }

  /**
   * Fetch a list of available checks from the server.
   */
  public async fetchAvailableChecks() {
    const config = getGristConfig();
    const errMessage = config.errMessage;
    if (!errMessage) {
      const _probes = await this._installAPI.getChecks().catch(reportError);
      if (!this._parent.isDisposed()) {
        // Currently, probes are forbidden if not admin.
        // TODO: May want to relax this to allow some probes that help
        // diagnose some initial auth problems.
        this.probes.set(_probes ? _probes.probes : []);
      }
      return _probes;
    }
    return [];
  }

  /**
   * Request the result of one of the available checks. Returns information
   * about the check and a way to observe the result when it arrives.
   */
  public requestCheck(probe: BootProbeInfo): AdminCheckRequest {
    const {id} = probe;
    let result = this._results.get(id);
    if (!result) {
      result = Observable.create(this._parent, {status: 'none'});
      this._results.set(id, result);
    }
    let request = this._requests.get(id);
    if (!request) {
      request = new AdminCheckRunner(this._installAPI, id, this._results, this._parent);
      this._requests.set(id, request);
    }
    request.start();
    return {
      probe,
      result,
      details: probeDetails[id],
    };
  }

  /**
   * Request the result of a check, by its id.
   */
  public requestCheckById(use: UseCBOwner, id: BootProbeIds): AdminCheckRequest|undefined {
    const probe = use(this.probes).find(p => p.id === id);
    if (!probe) { return; }
    return this.requestCheck(probe);
  }
}

/**
 * Information about a check and a way to observe its result once available.
 */
export interface AdminCheckRequest {
  probe: BootProbeInfo,
  result: Observable<BootProbeResult>,
  details: ProbeDetails,
}

/**
 * Manage a single check.
 */
export class AdminCheckRunner {
  constructor(private _installAPI: InstallAPI,
              public id: string,
              public results: Map<string, Observable<BootProbeResult>>,
              public parent: Disposable) {
    this._installAPI.runCheck(id).then(result => {
      if (parent.isDisposed()) { return; }
      const ob = results.get(id);
      if (ob) {
        ob.set(result);
      }
    }).catch(e => console.error(e));
  }

  public start() {
    let result = this.results.get(this.id);
    if (!result) {
      result = Observable.create(this.parent, {status: 'none'});
      this.results.set(this.id, result);
    }
  }
}

/**
 * Basic information about diagnostics is kept on the server,
 * but it can be useful to show extra details and tips in the
 * client.
 */
export const probeDetails: Record<string, ProbeDetails> = {
  'boot-page': {
    info: `
This boot page should not be too easy to access. Either turn
it off when configuration is ok (by unsetting GRIST_BOOT_KEY)
or make GRIST_BOOT_KEY long and cryptographically secure.
`,
  },

  'health-check': {
    info: `
Grist has a small built-in health check often used when running
it as a container.
`,
  },

  'host-header': {
    info: `
Requests arriving to Grist should have an accurate Host
header. This is essential when GRIST_SERVE_SAME_ORIGIN
is set.
`,
  },

  'sandboxing': {
    info: `
Grist allows for very powerful formulas, using Python.
We recommend setting the environment variable
GRIST_SANDBOX_FLAVOR to gvisor if your hardware
supports it (most will), to run formulas in each document
within a sandbox isolated from other documents and isolated
from the network.
`
  },

  'system-user': {
    info: `
It is good practice not to run Grist as the root user.
`,
  },

  'reachable': {
    info: `
The main page of Grist should be available.
`
  },

  'websockets': {
    // TODO: add a link to https://support.getgrist.com/self-managed/#how-do-i-run-grist-on-a-server
    info: `
Websocket connections need HTTP 1.1 and the ability to pass a few
extra headers in order to work. Sometimes a reverse proxy can
interfere with these requirements.
`
  },
};

/**
 * Information about the probe.
 */
export interface ProbeDetails {
  info: string;
}
