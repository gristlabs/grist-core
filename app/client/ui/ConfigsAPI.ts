import { getHomeUrl } from "app/client/models/AppModel";
import { BaseAPI, IOptions } from "app/common/BaseAPI";
import { Config, ConfigKey, ConfigValueByKey } from "app/common/Config";
import { addCurrentOrgToPath } from "app/common/urlUtils";

// A Config whose `value` is narrowed to the type for key `K`, so callers passing a literal key
// get its specific value type back instead of the whole union (no cast needed).
export type ConfigFor<K extends ConfigKey> = Omit<Config, "value"> & { value: ConfigValueByKey[K] };

export interface ConfigsAPI {
  getConfig<K extends ConfigKey>(key: K): Promise<ConfigFor<K>>;
  updateConfig<K extends ConfigKey>(key: K, value: ConfigValueByKey[K]): Promise<ConfigFor<K>>;
  deleteConfig(key: ConfigKey): Promise<void>;
}

export class InstallConfigsAPI extends BaseAPI implements ConfigsAPI {
  constructor(private _homeUrl: string = getHomeUrl(), options: IOptions = {}) {
    super(options);
  }

  public getConfig<K extends ConfigKey>(key: K): Promise<ConfigFor<K>> {
    return this.requestJson(`${this._url}/api/install/configs/${key}`, {
      method: "GET",
    });
  }

  public updateConfig<K extends ConfigKey>(key: K, value: ConfigValueByKey[K]): Promise<ConfigFor<K>> {
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
    options: IOptions = {},
  ) {
    super(options);
  }

  public getConfig<K extends ConfigKey>(key: K): Promise<ConfigFor<K>> {
    return this.requestJson(
      `${this._url}/api/orgs/${this._org}/configs/${key}`,
      {
        method: "GET",
      },
    );
  }

  public updateConfig<K extends ConfigKey>(key: K, value: ConfigValueByKey[K]): Promise<ConfigFor<K>> {
    return this.requestJson(
      `${this._url}/api/orgs/${this._org}/configs/${key}`,
      {
        method: "PUT",
        body: JSON.stringify(value),
      },
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
