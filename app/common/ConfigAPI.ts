import { BaseAPI, IOptions } from "app/common/BaseAPI";
import { addCurrentOrgToPath } from "app/common/urlUtils";

/**
 * Describes a single sandbox option and its availability on the system.
 */
export interface SandboxOption {
  // Unique key for the sandbox runner or unsandboxed.
  key: string;
  isActive?: boolean;           // Whether this is the currently running sandbox
  // User-friendly label for the sandbox option.
  label: string;
  // Whether the sandbox option is available on the current system.
  available: boolean;
  // If not available, an optional reason why it's not available.
  unavailableReason?: string;
  effective: boolean;           // Whether it provides real isolation (not just runs code)
  functional?: boolean;         // Whether sandbox actually works (tested on server)
  testError?: string;           // Error message if functional test failed
}

/**
 * Status of the sandboxing configuration on the server.
 */
export interface SandboxingStatus {
  available: SandboxOption[];
  recommended?: string;
  pendingRestart?: string;      // Flavor that will activate after restart
  isSelectedByEnv: boolean;     // Set via env var — cannot be changed by wizard
  isConfigured: boolean;        // Explicitly configured (env or DB) — false on fresh install
}

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

  /**
   * Fetches available sandbox options and current sandboxing status.
   */
  public async getSandboxingStatus(): Promise<SandboxingStatus> {
    return await this.requestJson(`${this._url}/api/config/sandboxing`, { method: "GET" });
  }

  /**
   * Sets the sandbox flavor (takes effect after restart).
   */
  public async setSandboxFlavor(flavor: string): Promise<void> {
    await this.request(`${this._url}/api/config/sandboxing`, {
      method: "PATCH",
      body: JSON.stringify({ flavor }),
    });
  }



  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
