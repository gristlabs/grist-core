import { getHomeUrl } from "app/client/models/AppModel";
import { BaseAPI, IOptions } from "app/common/BaseAPI";
import { Config, ConfigKey, ConfigValue } from "app/common/Config";
import { addCurrentOrgToPath } from "app/common/urlUtils";

export interface ConfigsAPI {
  getConfig(key: ConfigKey): Promise<Config>;
  updateConfig(key: ConfigKey, value: ConfigValue): Promise<Config>;
  deleteConfig(key: ConfigKey): Promise<void>;
}

export class InstallConfigsAPI extends BaseAPI implements ConfigsAPI {
  constructor(private _homeUrl: string = getHomeUrl(), options: IOptions = {}) {
    super(options);
  }

  public getConfig(key: ConfigKey): Promise<Config> {
    return this.requestJson(`${this._url}/api/install/configs/${key}`, {
      method: "GET",
    });
  }

  public updateConfig(key: ConfigKey, value: ConfigValue): Promise<Config> {
    return this.requestJson(`${this._url}/api/install/configs/${key}`, {
      method: "PUT",
      body: JSON.stringify(value),
    });
  }

  public async deleteConfig(key: ConfigKey): Promise<void> {
    await this.request(`${this._url}/api/install/configs/${key}`, {
      method: "DELETE",
    });
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}

export class OrgConfigsAPI extends BaseAPI implements ConfigsAPI {
  constructor(
    private _org: number | string,
    private _homeUrl: string = getHomeUrl(),
    options: IOptions = {}
  ) {
    super(options);
  }

  public getConfig(key: ConfigKey): Promise<Config> {
    return this.requestJson(
      `${this._url}/api/orgs/${this._org}/configs/${key}`,
      {
        method: "GET",
      }
    );
  }

  public updateConfig(key: ConfigKey, value: ConfigValue): Promise<Config> {
    return this.requestJson(
      `${this._url}/api/orgs/${this._org}/configs/${key}`,
      {
        method: "PUT",
        body: JSON.stringify(value),
      }
    );
  }

  public async deleteConfig(key: ConfigKey): Promise<void> {
    await this.request(`${this._url}/api/orgs/${this._org}/configs/${key}`, {
      method: "DELETE",
    });
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
