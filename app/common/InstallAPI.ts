import {BaseAPI, IOptions} from 'app/common/BaseAPI';
import {BootProbeInfo, BootProbeResult} from 'app/common/BootProbe';
import {InstallPrefs} from 'app/common/Install';
import {TelemetryLevel} from 'app/common/Telemetry';
import {addCurrentOrgToPath} from 'app/common/urlUtils';

export const installPropertyKeys = ['prefs'];

export interface InstallProperties {
  prefs: InstallPrefs;
}

export interface InstallPrefsWithSources {
  telemetry: {
    telemetryLevel: PrefWithSource<TelemetryLevel>;
  },
}

export type TelemetryPrefsWithSources = InstallPrefsWithSources['telemetry'];

export interface PrefWithSource<T> {
  value: T;
  source: PrefSource;
}

export type PrefSource = 'environment-variable' | 'preferences';


/**
 * JSON returned to the client (exported for tests).
 */
export interface LatestVersion {
  /**
   * Latest version of core component of the client.
   */
  latestVersion: string;
  /**
   * If there were any critical updates after client's version. Undefined if
   * we don't know client version or couldn't figure this out for some other reason.
   */
  isCritical?: boolean;
  /**
   * Url where the client can download the latest version (if applicable)
   */
  updateURL?: string;

  /**
   * When the latest version was updated (in ISO format).
   */
  updatedAt?: string;
}

export interface InstallAPI {
  getInstallPrefs(): Promise<InstallPrefsWithSources>;
  updateInstallPrefs(prefs: Partial<InstallPrefs>): Promise<void>;
  /**
   * Returns information about latest version of Grist
   */
  checkUpdates(): Promise<LatestVersion>;
  getChecks(): Promise<{probes: BootProbeInfo[]}>;
  runCheck(id: string): Promise<BootProbeResult>;
}

export class InstallAPIImpl extends BaseAPI implements InstallAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public async getInstallPrefs(): Promise<InstallPrefsWithSources> {
    return this.requestJson(`${this._url}/api/install/prefs`, {method: 'GET'});
  }

  public async updateInstallPrefs(prefs: Partial<InstallPrefs>): Promise<void> {
    await this.request(`${this._url}/api/install/prefs`, {
      method: 'PATCH',
      body: JSON.stringify({...prefs}),
    });
  }

  public checkUpdates(): Promise<LatestVersion> {
    return this.requestJson(`${this._url}/api/install/updates`, {method: 'GET'});
  }

  public getChecks(): Promise<{probes: BootProbeInfo[]}> {
    return this.requestJson(`${this._url}/api/probes`, {method: 'GET'});
  }

  public runCheck(id: string): Promise<BootProbeResult> {
    return this.requestJson(`${this._url}/api/probes/${id}`, {method: 'GET'});
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
