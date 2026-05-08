import { BaseAPI, IOptions } from "app/common/BaseAPI";
import { BootProbeInfo, BootProbeResult } from "app/common/BootProbe";
import { LatestVersionAvailable } from "app/common/gristUrls";
import { InstallPrefs, PendingChanges } from "app/common/Install";
import { TelemetryLevel } from "app/common/Telemetry";
import { addCurrentOrgToPath } from "app/common/urlUtils";

export const installPropertyKeys = ["prefs"];

export interface InstallProperties {
  prefs: InstallPrefs;
}

export interface InstallPrefsWithSources extends PendingChanges {
  telemetry: {
    telemetryLevel: PrefWithSource<TelemetryLevel>;
  },
  checkForLatestVersion: boolean;
  envVars?: Record<string, any>;
}

export type TelemetryPrefsWithSources = InstallPrefsWithSources["telemetry"];

export interface PrefWithSource<T> {
  value: T;
  source: PrefSource;
}

export type PrefSource = "environment-variable" | "preferences";

export interface PermissionSetting {
  value: boolean | undefined;
  source: PrefSource | undefined;
}

export interface PermissionsStatus {
  orgCreationAnyone: PermissionSetting;
  personalOrgs: PermissionSetting;
  forceLogin: PermissionSetting;
  anonPlayground: PermissionSetting;
}

export interface InstallAPI {
  getInstallPrefs(): Promise<InstallPrefsWithSources>;
  updateInstallPrefs(prefs: Partial<InstallPrefs>): Promise<void>;
  /**
   * Returns information about latest version of Grist
   */
  checkUpdates(): Promise<LatestVersionAvailable>;
  getChecks(): Promise<{ probes: BootProbeInfo[] }>;
  /**
   * Run a probe and return its result. Pass `{ background: true }` for prefetches
   * the user isn't waiting on (the underlying request bypasses the pending-request
   * counter so tests' `waitForServer` waits aren't held up).
   */
  runCheck(id: string, opts?: { background?: boolean }): Promise<BootProbeResult>;
  getPermissionsStatus(): Promise<PermissionsStatus>;
}

export class InstallAPIImpl extends BaseAPI implements InstallAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public async getInstallPrefs(): Promise<InstallPrefsWithSources> {
    return this.requestJson(`${this._url}/api/install/prefs`, { method: "GET" });
  }

  public async updateInstallPrefs(prefs: Partial<InstallPrefs>): Promise<void> {
    await this.request(`${this._url}/api/install/prefs`, {
      method: "PATCH",
      body: JSON.stringify({ ...prefs }),
    });
  }

  public checkUpdates(): Promise<LatestVersionAvailable> {
    return this.requestJson(`${this._url}/api/install/updates`, { method: "GET" });
  }

  public getChecks(): Promise<{ probes: BootProbeInfo[] }> {
    return this.requestJson(`${this._url}/api/probes`, { method: "GET" });
  }

  public runCheck(id: string, opts: { background?: boolean } = {}): Promise<BootProbeResult> {
    const url = `${this._url}/api/probes/${id}`;
    return opts.background ?
      this.requestJsonUncounted(url, { method: "GET" }) :
      this.requestJson(url, { method: "GET" });
  }

  public async getPermissionsStatus(): Promise<PermissionsStatus> {
    return this.requestJson(`${this._url}/api/install/permissions`, { method: "GET" });
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
