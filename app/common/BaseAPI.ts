import {ApiError, ApiErrorDetails} from 'app/common/ApiError';
import axios, {AxiosRequestConfig, AxiosResponse} from 'axios';
import {tbind} from './tbind';

export interface IOptions {
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  newFormData?: () => FormData;  // constructor for FormData depends on platform.
  extraParameters?: Map<string, string>;  // if set, add query parameters to requests.
}

/**
 * Base setup class for creating a REST API client interface.
 */
export class BaseAPI {
  // Count of pending requests. It is relied on by tests.
  public static numPendingRequests(): number { return this._numPendingRequests; }

  // Wrap a promise to add to the count of pending requests until the promise is resolved.
  public static async countPendingRequest<T>(promise: Promise<T>): Promise<T> {
    try {
      BaseAPI._numPendingRequests++;
      return await promise;
    } finally {
      BaseAPI._numPendingRequests--;
    }
  }

  // Define a decorator for methods in BaseAPI or derived classes.
  public static countRequest(target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = async function(...args: any[]) {
      return BaseAPI.countPendingRequest(originalMethod.apply(this, args));
    };
  }

  // Make a JSON request to the given URL, and read the response as JSON. Handles errors, and
  // counts pending requests in the same way as BaseAPI methods do.
  public static requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
    return new BaseAPI().requestJson(url, init);
  }

  // Make a request to the given URL, and read the response. Handles errors, and
  // counts pending requests in the same way as BaseAPI methods do.
  public static request(url: string, init: RequestInit = {}): Promise<Response> {
    return new BaseAPI().request(url, init);
  }

  private static _numPendingRequests: number = 0;

  protected fetch: typeof fetch;
  protected newFormData: () => FormData;
  private _headers: Record<string, string>;
  private _extraParameters?: Map<string, string>;

  constructor(options: IOptions = {}) {
    this.fetch = options.fetch || tbind(window.fetch, window);
    this.newFormData = options.newFormData || (() => new FormData());
    this._headers = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...options.headers
    };
    this._extraParameters = options.extraParameters;
  }

  // Make a modified request, exposed for test convenience.
  public async testRequest(url: string, init: RequestInit = {}): Promise<Response> {
    return this.request(url, init);
  }

  public defaultHeaders() {
    return this._headers;
  }

  public defaultHeadersWithoutContentType() {
    const headers = {...this.defaultHeaders()};
    delete headers['Content-Type'];
    return headers;
  }

  // Similar to request, but uses the axios library, and supports progress indicator.
  @BaseAPI.countRequest
  protected async requestAxios(url: string, config: AxiosRequestConfig): Promise<AxiosResponse> {
    // If using with FormData in node, axios needs the headers prepared by FormData.
    let headers = config.headers;
    if (config.data && typeof config.data.getHeaders === 'function') {
      headers = {...config.data.getHeaders(), ...headers};
    }
    const resp = await axios.request({
      url,
      withCredentials: true,
      validateStatus: (status) => true,     // This is more like fetch
      ...config,
      headers,
    });
    if (resp.status !== 200) {
      throwApiError(url, resp, resp.data);
    }
    return resp;
  }

  @BaseAPI.countRequest
  protected async request(input: string, init: RequestInit = {}): Promise<Response> {
    init = Object.assign({ headers: this._headers, credentials: 'include' }, init);
    if (this._extraParameters) {
      const url = new URL(input);
      for (const [key, val] of this._extraParameters.entries()) {
        url.searchParams.set(key, val);
        input = url.href;
      }
    }
    const resp = await this.fetch(input, init);
    if (resp.status !== 200) {
      const body = await resp.json().catch(() => ({}));
      throwApiError(input, resp, body);
    }
    return resp;
  }

  /**
   * Make a request, and read the response as JSON. This allows counting the request as pending
   * until it has been read, which is relied on by tests.
   */
  @BaseAPI.countRequest
  protected async requestJson(input: string, init: RequestInit = {}): Promise<any> {
    return (await this.request(input, init)).json();
  }
}

function throwApiError(url: string, resp: Response | AxiosResponse, body: any) {
  // If the response includes details, include them into the ApiError we construct. Include
  // also the error message from the server as details.userError. It's used by the Notifier.
  if (!body) { body = {}; }
  const details: ApiErrorDetails = body.details && typeof body.details === 'object' ? body.details :
    {errorDetails: body.details};
  // If a userError is already specified, do not overwrite it.
  // (The error handling here is quite confusing, would it not be better
  // to just unserialize an ApiError into the form it would have had on
  // the server?)
  if (body.error && !details.userError) {
    details.userError = body.error;
  }
  if (body.memos) {
    details.memos = body.memos;
  }
  throw new ApiError(`Request to ${url} failed with status ${resp.status}: ` +
    `${resp.statusText} (${body.error || 'unknown cause'})`, resp.status, details);
}
