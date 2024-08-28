import {BaseAPI, IOptions} from "app/common/BaseAPI";
import {addCurrentOrgToPath} from 'app/common/urlUtils';

/**
 * An API for accessing the internal Grist configuration, stored in
 * config.json.
 */
export class ConfigAPI extends BaseAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public async getValue(key: string): Promise<any> {
    return (await this.requestJson(`${this._url}/api/config/${key}`, {method: 'GET'})).value;
  }

  public async setValue(value: any, restart=false): Promise<void> {
    await this.request(`${this._url}/api/config`, {
      method: 'PATCH',
      body: JSON.stringify({config: value, restart}),
    });
  }

  public async restartServer(): Promise<void> {
    await this.request(`${this._url}/api/admin/restart`, {method: 'POST'});
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
