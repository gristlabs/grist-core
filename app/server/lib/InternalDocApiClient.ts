import { ApiError } from "app/common/ApiError";
import { DocAPIImpl } from "app/common/UserAPI";
import { forwardDocApiRequest, getDocWorkerInternalUrl } from "app/gen-server/lib/DocApiProxy";
import { RequestWithLogin } from "app/server/lib/Authorizer";

import type { IDocWorkerMap } from "app/server/lib/DocWorkerMap";

/**
 * Unused host passed to the {@link InternalDocApiClient} constructor as a stand-in
 * for the `url` parameter. {@link forwardDocApiRequest} replaces this host in all
 * fetch requests made by InternalDocApiClient.
 *
 * NOTE: `.invalid` is a reserved TLD used to signal that this isn't a real host.
 */
const INTERNAL_API_ORIGIN = "http://doc-worker.invalid";

export interface InternalDocApiClientOptions {
  /** Canonical id of the document to read. */
  docId: string;
  /** Request whose user the document is read as. */
  req: RequestWithLogin;
  docWorkerMap: IDocWorkerMap;
  /** Org to resolve the document in; the request's own org may well not contain it. */
  orgDomain: string;
  /**
   * Prefix of the error thrown when a request fails, to say which document could not be read
   * (e.g. "Failed to read source document").
   */
  errorPrefix?: string;
}

/**
 * A subclass of {@link DocAPIImpl} that differs only in how it routes requests: instead of
 * routing through the public DocAPI endpoints, as DocAPIImpl does, it forwards requests
 * directly to the worker a document is open in, via {@link forwardDocApiRequest}.
 *
 * Used by server-side code to communicate with another document on the same Grist installation,
 * including one served by another worker, without needing a round trip through the public
 * API for each request. This is currently used by the "Import tables from Grist" feature.
 */
export class InternalDocApiClient extends DocAPIImpl {
  public static async create(options: InternalDocApiClientOptions): Promise<InternalDocApiClient> {
    const workerUrl = await getDocWorkerInternalUrl(options.docWorkerMap, options.docId);
    return new InternalDocApiClient(workerUrl, options);
  }

  private readonly _errorPrefix: string;

  private constructor(workerUrl: string, options: InternalDocApiClientOptions) {
    const { docId, req, orgDomain } = options;
    super(`${INTERNAL_API_ORIGIN}/o/${orgDomain}`, docId, {
      fetch: async (input, init) => {
        // Only the path and query of the URL DocAPIImpl built are used; forwardDocApiRequest
        // supplies the host, and composes the path with the worker's own base path.
        const { pathname, search } = new URL(String(input));
        const response = await forwardDocApiRequest(workerUrl, req, {
          method: init?.method ?? "GET",
          subpath: pathname + search,
          body: typeof init?.body === "string" ? init.body : undefined,
        });
        return new Response(response.text, { status: response.status });
      },
    });
    this._errorPrefix = options.errorPrefix ?? "Failed to read document";
  }

  protected override async requestJson(input: string, init: RequestInit = {}): Promise<any> {
    try {
      return await super.requestJson(input, init);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      const serverError = e instanceof ApiError ? e.details?.userError : undefined;
      throw new ApiError(serverError ?
        `${this._errorPrefix}: ${serverError}` :
        `${this._errorPrefix} (status ${status})`, status);
    }
  }
}
