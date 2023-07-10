import {AppModel, getHomeUrl} from 'app/client/models/AppModel';
import {TelemetryPrefs} from 'app/common/Install';
import {InstallAPI, InstallAPIImpl, TelemetryPrefsWithSources} from 'app/common/InstallAPI';
import {bundleChanges, Disposable, Observable} from 'grainjs';

export interface TelemetryModel {
  /** Telemetry preferences (e.g. the current telemetry level). */
  readonly prefs: Observable<TelemetryPrefsWithSources | null>;
  fetchTelemetryPrefs(): Promise<void>;
  updateTelemetryPrefs(prefs: Partial<TelemetryPrefs>): Promise<void>;
}

export class TelemetryModelImpl extends Disposable implements TelemetryModel {
  public readonly prefs: Observable<TelemetryPrefsWithSources | null> = Observable.create(this, null);
  private readonly _installAPI: InstallAPI = new InstallAPIImpl(getHomeUrl());

  constructor(_appModel: AppModel) {
    super();
  }

  public async fetchTelemetryPrefs(): Promise<void> {
    const prefs = await this._installAPI.getInstallPrefs();
    bundleChanges(() => {
      this.prefs.set(prefs.telemetry);
    });
  }

  public async updateTelemetryPrefs(prefs: Partial<TelemetryPrefs>): Promise<void> {
    await this._installAPI.updateInstallPrefs({telemetry: prefs});
    await this.fetchTelemetryPrefs();
  }
}
