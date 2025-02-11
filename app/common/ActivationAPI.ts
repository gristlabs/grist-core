import {BaseAPI, IOptions} from 'app/common/BaseAPI';
import {ActivationState} from 'app/common/gristUrls';
import {addCurrentOrgToPath} from 'app/common/urlUtils';

export interface ActivationStatus extends ActivationState {
  // Name of the plan.
  planName: string | null;
  // Activation key (only 4 first characters are shown).
  keyPrefix: string | null;
}

export interface ActivationAPI {
  getActivationStatus(): Promise<ActivationStatus>;
  activateEnterprise(key: string): Promise<void>;
}

export class ActivationAPIImpl extends BaseAPI implements ActivationAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public async getActivationStatus(): Promise<ActivationStatus> {
    return this.requestJson(`${this._url}/api/activation/status`, {method: 'GET'});
  }

  public async activateEnterprise(key: string): Promise<void> {
    await this.request(`${this._url}/api/activation/activate`, {method: 'POST', body: JSON.stringify({key})});
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
