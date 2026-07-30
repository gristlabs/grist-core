/**
 * API client for setup requests. The summary half is for any signed-in user (the nudge); the
 * admin half is for the admin panel and requires an install admin.
 */
import { BaseAPI, IOptions } from "app/common/BaseAPI";
import { SetupRequests, SetupStepId } from "app/common/Config";
import { SetupRequestSpec, SetupRequestsSummary } from "app/common/SetupRequests";
import { addCurrentOrgToPath } from "app/common/urlUtils";

export interface SetupRequestsAPI {
  /** Per-step counts plus whether the current user has asked; censored, any user. */
  getSummary(): Promise<SetupRequestsSummary>;
  /** Record (or refresh) a request from the current user; returns the new summary. */
  sendRequest(spec: SetupRequestSpec): Promise<SetupRequestsSummary>;
}

export interface SetupRequestsAdminAPI extends SetupRequestsAPI {
  /** Full request detail; install admins only. */
  getAll(): Promise<SetupRequests>;
  /** Clear all requests for one step, returning the updated detail; admins only. */
  clearStep(step: SetupStepId): Promise<SetupRequests>;
}

export class SetupRequestsAPIImpl extends BaseAPI implements SetupRequestsAdminAPI {
  constructor(private _homeUrl: string, options: IOptions = {}) {
    super(options);
  }

  public getSummary(): Promise<SetupRequestsSummary> {
    return this.requestJson(`${this._url}/api/setup-requests`, { method: "GET" });
  }

  public sendRequest(spec: SetupRequestSpec): Promise<SetupRequestsSummary> {
    return this.requestJson(`${this._url}/api/setup-requests`, {
      method: "POST",
      body: JSON.stringify(spec),
    });
  }

  public getAll(): Promise<SetupRequests> {
    return this.requestJson(`${this._url}/api/admin/setup-requests`, { method: "GET" });
  }

  public clearStep(step: SetupStepId): Promise<SetupRequests> {
    return this.requestJson(`${this._url}/api/admin/setup-requests/${step}`, {
      method: "DELETE",
    });
  }

  private get _url(): string {
    return addCurrentOrgToPath(this._homeUrl);
  }
}
