import {getHomeUrl} from 'app/client/models/AppModel';
import {Disposable, Observable} from "grainjs";
import {ConfigAPI} from 'app/common/ConfigAPI';
import {ActivationAPIImpl, ActivationStatus} from 'app/common/ActivationAPI';
import {delay} from 'app/common/delay';
import {getGristConfig} from 'app/common/urlUtils';
import {GristDeploymentType} from 'app/common/gristUrls';
import {Notifier} from 'app/client/models/NotifyModel';

export class ToggleEnterpriseModel extends Disposable {
  public readonly edition: Observable<GristDeploymentType | null> = Observable.create(this, null);
  public readonly status: Observable<ActivationStatus|null> = Observable.create(this, null);
  public readonly installationId: Observable<string | null> = Observable.create(this, null);
  public readonly busy: Observable<boolean> = Observable.create(this, false);
  private readonly _configAPI: ConfigAPI = new ConfigAPI(getHomeUrl());
  private readonly _activationAPI: ActivationAPIImpl = new ActivationAPIImpl(getHomeUrl());

  constructor(private _notifier: Notifier) {
    super();
  }

  public async fetchEnterpriseToggle() {
    const {deploymentType} = getGristConfig();
    this.edition.set(deploymentType || null);
    if (deploymentType === 'enterprise') {
      const status = await this._activationAPI.getActivationStatus();
      if (this.isDisposed()) {
        return;
      }
      this.status.set(status);
      this.installationId.set(status.installationId);
    }
  }

  public async updateEnterpriseToggle(edition: GristDeploymentType): Promise<void> {
    // We may be restarting the server, so these requests may well
    // fail if done in quick succession.
    const task = async () => {
      await retryOnNetworkError(() => this._configAPI.setValue({edition}));
      this.edition.set(edition);
      await retryOnNetworkError(() => this._configAPI.restartServer());
      await this._reloadWhenReady();
    };
    await this._doWork(task);
  }

  public async activateEnterprise(key: string) {
    const task = async () => {
      await this._activationAPI.activateEnterprise(key);
      await retryOnNetworkError(() => this._configAPI.restartServer());
      await this._reloadWhenReady();
    };
    await this._doWork(task);
  }

  private async _doWork(func: () => Promise<void>) {
    if (this.busy.get()) {
      throw new Error("Please wait for the previous operation to complete.");
    }
    try {
      this.busy.set(true);
      await this._notifier.slowNotification(func());
    } finally {
      this.busy.set(false);
    }
  }

  private async _reloadWhenReady() {
    // Now wait for the server to come back up, and refresh the page.
    let maxTries = 10;
    while(maxTries-- > 0) {
      try {
        await this._configAPI.getValue('edition');
        window.location.reload();
        return;
      } catch (err) {
        console.warn("Server not ready yet, will retry", err);
        await delay(1000);
      }
    }
    window.location.reload();
  }
}

// Copied from DocPageModel.ts
const reconnectIntervals = [1000, 1000, 2000, 5000, 10000];
async function retryOnNetworkError<R>(func: () => Promise<R>): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await func();
    } catch (err) {
      // fetch() promises that network errors are reported as TypeError. We'll accept NetworkError too.
      if (err.name !== "TypeError" && err.name !== "NetworkError") {
        throw err;
      }
      // We really can't reach the server. Make it known.
      if (attempt >= reconnectIntervals.length) {
        throw err;
      }
      const reconnectTimeout = reconnectIntervals[attempt];
      console.warn(`Call to ${func.name} failed, will retry in ${reconnectTimeout} ms`, err);
      await delay(reconnectTimeout);
    }
  }
}
