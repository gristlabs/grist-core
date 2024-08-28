import {getHomeUrl} from 'app/client/models/AppModel';
import {Disposable, Observable} from "grainjs";
import {ConfigAPI} from 'app/common/ConfigAPI';
import {delay} from 'app/common/delay';

export class ToggleEnterpriseModel extends Disposable {
  public readonly edition: Observable<string | null> = Observable.create(this, null);
  private readonly _configAPI: ConfigAPI = new ConfigAPI(getHomeUrl());

  public async fetchEnterpriseToggle(): Promise<void> {
    const edition = await this._configAPI.getValue('edition');
    this.edition.set(edition);
  }

  public async updateEnterpriseToggle(edition: string): Promise<void> {
    // We may be restarting the server, so these requests may well
    // fail if done in quick succession.
    await retryOnNetworkError(() => this._configAPI.setValue({edition}));
    this.edition.set(edition);
    await retryOnNetworkError(() => this._configAPI.restartServer());
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
