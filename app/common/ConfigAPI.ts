import { BaseAPI, IOptions } from "app/common/BaseAPI";
import { addCurrentOrgToPath } from 'app/common/urlUtils';

/**
 * Interface for authentication providers.
 */
export interface AuthProvider {
  name: string;
  key: string;
  isConfigured?: boolean;     // Whether the provider is configured properly.
  isActive?: boolean;         // Whether the provider is currently active.
  activeError?: string;       // Error reported by the provider (either at startup or runtime).
  configError?: string;       // Error message if provider is misconfigured.
  willBeActive?: boolean;     // Whether the provider will be active on restart.
  willBeDisabled?: boolean;   // Whether the provider will be disabled on restart.
  canBeActivated?: boolean;   // Whether the provider can be activated (configured and not selected via env).
  isSelectedByEnv?: boolean;  // Whether the provider is selected via environment variable.
}

/**
 * An API for accessing the internal Grist configuration, stored in
 * config.json.
 */
export class ConfigAPI extends BaseAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public async getValue(key: string): Promise<any> {
    return (await this.requestJson(`${this._url}/api/config/${key}`, { method: 'GET' })).value;
  }

  public async setValue(value: any, restart = false): Promise<void> {
    await this.request(`${this._url}/api/config`, {
      method: 'PATCH',
      body: JSON.stringify({ config: value, restart }),
    });
  }

  public async restartServer(): Promise<void> {
    await this.request(`${this._url}/api/admin/restart`, { method: 'POST' });
  }

  public async healthcheck(): Promise<void> {
    const resp = await this.request(`${this._homeUrl}/status?ready=1`);
    if (!resp.ok) {
      throw new Error(await resp.text());
    }
  }

  /**
   * Changes the active authentication provider (to be active after restart).
   */
  public async setActiveAuthProvider(providerKey: string): Promise<void> {
    await this.request(`${this._url}/api/config/auth-providers/set-active`, {
      method: 'POST',
      body: JSON.stringify({providerKey}),
    });
  }

  /**
   * Fetches available authentication providers from the server.
   */
  public async getAuthProviders(): Promise<AuthProvider[]> {
    const resp = await this.requestJson(`${this._url}/api/config/auth-providers`, {method: 'GET'});
    return resp as AuthProvider[];
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
