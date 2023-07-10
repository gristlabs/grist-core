import {BaseAPI, IOptions} from 'app/common/BaseAPI';
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

export interface InstallAPI {
  getInstallPrefs(): Promise<InstallPrefsWithSources>;
  updateInstallPrefs(prefs: Partial<InstallPrefs>): Promise<void>;
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

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
