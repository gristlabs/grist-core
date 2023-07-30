import {SandboxRequest} from 'app/common/ActionBundle';
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {makeExceptionalDocSession} from 'app/server/lib/DocSession';
import {httpEncoding} from 'app/server/lib/httpEncoding';
import fetch from 'node-fetch';
import * as path from 'path';
import * as tmp from 'tmp';
import * as fse from 'fs-extra';
import log from 'app/server/lib/log';
import {proxyAgent} from "app/server/lib/ProxyAgent";
import chunk = require('lodash/chunk');
import fromPairs = require('lodash/fromPairs');
import zipObject = require('lodash/zipObject');

export class DocRequests {
  // Request responses are briefly cached in files only to handle multiple requests in a formula
  // and only as long as needed to finish calculating all formulas.
  // When _numPending reaches 0 again, _cacheDir is deleted.
  private _numPending: number = 0;
  private _cacheDir: tmp.SynchrounousResult | null = null;

  constructor(private readonly _activeDoc: ActiveDoc) {}

  public async handleRequestsBatchFromUserActions(requests: Record<string, SandboxRequest>) {
    const numRequests = Object.keys(requests).length;
    this._numPending += numRequests;
    try {
      // Perform batches of requests in parallel for speed, and hope it doesn't cause rate limiting...
      for (const keys of chunk(Object.keys(requests), 10)) {
        const responses: Response[] = await Promise.all(keys.map(async key => {
          const request = requests[key];
          const response = await this.handleSingleRequestWithCache(key, request);
          return {
            ...response,
            // Tells the engine which cell(s) made the request and should be recalculated to use the response
            deps: request.deps,
          };
        }));
        // Tell the sandbox which previous responses we have cached in files.
        // This lets it know it can immediately and synchronously get those responses again.
        const cachedRequestKeys = await fse.readdir(this._cacheDir!.name);
        // Recalculate formulas using this batch of responses.
        const action = ["RespondToRequests", zipObject(keys, responses), cachedRequestKeys];
        await this._activeDoc.applyUserActions(makeExceptionalDocSession("system"), [action]);
      }
    } finally {
      this._numPending -= numRequests;
      if (this._numPending === 0) {
        log.debug(`Removing DocRequests._cacheDir: ${this._cacheDir!.name}`);
        this._cacheDir!.removeCallback();
        this._cacheDir = null;
      }
    }
  }

  public async handleSingleRequestWithCache(key: string, request: SandboxRequest): Promise<Response> {
    if (!this._cacheDir) {
      // Use the sync API because otherwise multiple requests being handled at the same time
      // all reach this point, `await`, and create different dirs.
      // `unsafeCleanup: true` means the directory can be deleted even if it's not empty, which is what we expect.
      this._cacheDir = tmp.dirSync({unsafeCleanup: true});
      log.debug(`Created DocRequests._cacheDir: ${this._cacheDir.name}`);
    }

    const cachePath = path.resolve(this._cacheDir.name, key);
    try {
      const result = await fse.readJSON(cachePath);
      result.content = Buffer.from(result.content, "base64");
      return result;
    } catch {
      const result = await this._handleSingleRequestRaw(request);
      const resultForJson = {...result} as any;
      if ('content' in result) {
        resultForJson.content = result.content.toString("base64");
      }
      fse.writeJSON(cachePath, resultForJson).catch(e => log.warn(`Failed to save response to cache file: ${e}`));
      return result;
    }
  }

  private async _handleSingleRequestRaw(request: SandboxRequest): Promise<Response> {
    try {
      if (process.env.GRIST_ENABLE_REQUEST_FUNCTION != '1') {
        throw new Error("REQUEST is not enabled");
      }
      const {url, method, body, params, headers} = request;
      const urlObj = new URL(url);
      log.rawInfo("Handling sandbox request", {host: urlObj.host, docId: this._activeDoc.docName});
      for (const [param, value] of Object.entries(params || {})) {
        urlObj.searchParams.append(param, value);
      }
      const response = await fetch(urlObj.toString(), {
        headers: headers || {},
        agent: proxyAgent(urlObj),
        method,
        body
      });
      const content = await response.buffer();
      const {status, statusText} = response;
      const encoding = httpEncoding(response.headers.get('content-type'), content);
      return {
        content, status, statusText, encoding,
        headers: fromPairs([...response.headers]),
      };
    } catch (e) {
      return {error: String(e)};
    }
  }
}

interface SuccessfulResponse {
  content: Buffer;
  status: number;
  statusText: string;
  encoding?: string;
  headers: Record<string, string>;
}

interface RequestError {
  error: string;
}

type Response = RequestError | SuccessfulResponse;

