import { BaseAPI, IOptions } from "app/common/BaseAPI";
import { delay } from "app/common/delay";
import { addCurrentOrgToPath } from "app/common/urlUtils";

/**
 * Interface for authentication providers.
 */
export interface AuthProvider {
  name: string;
  key: string;
  isConfigured?: boolean;         // Whether the provider is configured properly.
  isActive?: boolean;             // Whether the provider is currently active.
  activeError?: string;           // Error reported by the provider (either at startup or runtime).
  configError?: string;           // Error message if provider is misconfigured.
  willBeActive?: boolean;         // Whether the provider will be active on restart.
  willBeDisabled?: boolean;       // Whether the provider will be disabled on restart.
  canBeActivated?: boolean;       // Whether the provider can be activated (configured and not selected via env).
  isSelectedByEnv?: boolean;      // Whether the provider is selected via environment variable.
  metadata?: Record<string, any>; // Additional provide metadata.
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
    return (await this.requestJson(`${this._url}/api/config/${key}`, { method: "GET" })).value;
  }

  public async setValue(value: any, restart = false): Promise<void> {
    await this.request(`${this._url}/api/config`, {
      method: "PATCH",
      body: JSON.stringify({ config: value, restart }),
    });
  }

  public async restartServer(): Promise<void> {
    await this.request(`${this._url}/api/admin/restart`, { method: "POST" });
  }

  public async healthcheck(): Promise<void> {
    const resp = await this.request(`${this._homeUrl}/status?ready=1`);
    if (!resp.ok) {
      throw new Error(await resp.text());
    }
  }

  /**
   * Snapshot of the server's restart identity. `id` changes on every
   * (in-process or whole-process) restart; `restarting` is true while
   * RestartShell is mid-restart and the new child isn't yet serving.
   */
  public async getRestartIdentity(): Promise<{ count: number; id: string; restarting: boolean }> {
    return await this.requestJson(`${this._homeUrl}/status/restart`);
  }

  /**
   * Polls until the restart id has changed (and we're no longer in the
   * shell's mid-restart window) and healthcheck passes. Returns true on
   * success, false on timeout; callers decide how to surface the
   * timeout. Snapshot the id BEFORE issuing the restart.
   */
  public async waitUntilReady({
    priorRestartId,
    attempts = 30,
    intervalMs = 1000,
  }: {
    priorRestartId: string;
    attempts?: number;
    intervalMs?: number;
  }): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      try {
        const ident = await this.getRestartIdentity();
        if (!ident.restarting && ident.id !== priorRestartId) {
          await this.healthcheck();
          return true;
        }
      } catch { /* not ready */ }
      await delay(intervalMs);
    }
    return false;
  }

  /**
   * Changes the active authentication provider (to be active after restart).
   */
  public async setActiveAuthProvider(providerKey: string): Promise<void> {
    await this.request(`${this._url}/api/config/auth-providers/set-active`, {
      method: "POST",
      body: JSON.stringify({ providerKey }),
    });
  }

  /**
   * Fetches available authentication providers from the server.
   */
  public async getAuthProviders(): Promise<AuthProvider[]> {
    const resp = await this.requestJson(`${this._url}/api/config/auth-providers`, { method: "GET" });
    return resp as AuthProvider[];
  }

  /**
   * Configures an authentication provider.
   */
  public async configureProvider(provider: string, config: Record<string, string>): Promise<void> {
    const url = new URL(`${this._url}/api/config/auth-providers`);
    url.searchParams.append("provider", provider);
    await this.request(url.toString(), {
      method: "PATCH",
      body: JSON.stringify(config),
    });
  }

  /**
   * Gets the configuration of an authentication provider.
   */
  public async getAuthProviderConfig(provider: string): Promise<Record<string, any>> {
    const url = new URL(`${this._url}/api/config/auth-providers/config`);
    url.searchParams.append("provider", provider);
    return await this.requestJson(url.toString(), { method: "GET" });
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
