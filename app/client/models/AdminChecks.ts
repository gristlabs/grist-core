import { BootProbeIds, BootProbeInfo, BootProbeResult } from 'app/common/BootProbe';
import { removeTrailingSlash } from 'app/common/gutil';
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

  constructor(private _parent: Disposable) {
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
      // Probe tool URLs are relative to the current URL. Don't trust configuration,
      // because it may be buggy if the user is here looking at the boot page
      // to figure out some problem.
      //
      // We have been careful to make URLs available with appropriate
      // middleware relative to both of the admin panel and the boot page.
      const url = new URL(removeTrailingSlash(document.location.href));
      url.pathname += '/probe';
      const resp = await fetch(url.href);
      const _probes = await resp.json();
      this.probes.set(_probes.probes);
    }
  }

  /**
   * Request the result of one of the available checks. Returns information
   * about the check and a way to observe the result when it arrives.
   */
  public requestCheck(probe: BootProbeInfo): AdminCheckRequest {
    const {id} = probe;
    let result = this._results.get(id);
    if (!result) {
      result = Observable.create(this._parent, {});
      this._results.set(id, result);
    }
    let request = this._requests.get(id);
    if (!request) {
      request = new AdminCheckRunner(id, this._results, this._parent);
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
  constructor(public id: string, public results: Map<string, Observable<BootProbeResult>>,
              public parent: Disposable) {
    const url = new URL(removeTrailingSlash(document.location.href));
    url.pathname = url.pathname + '/probe/' + id;
    fetch(url.href).then(async resp => {
      const _probes: BootProbeResult = await resp.json();
      const ob = results.get(id);
      if (ob) {
        ob.set(_probes);
      }
    }).catch(e => console.error(e));
  }

  public start() {
    let result = this.results.get(this.id);
    if (!result) {
      result = Observable.create(this.parent, {});
      this.results.set(this.id, result);
    }
  }
}

/**
 * Basic information about diagnostics is kept on the server,
 * but it can be useful to show extra details and tips in the
 * client.
 */
const probeDetails: Record<string, ProbeDetails> = {
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
};

/**
 * Information about the probe.
 */
export interface ProbeDetails {
  info: string;
}
