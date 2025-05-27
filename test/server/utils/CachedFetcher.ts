import crypto from "crypto";
import * as fs from "fs";
import fetch, { RequestInfo, RequestInit, Response } from "node-fetch";
import { join } from "path";

/**
 * A wrapper around `node-fetch` that caches responses on the local filesystem.
 *
 * This class avoids redundant HTTP requests by storing and retrieving responses
 * from disk. If a cached response exists and is still valid, it will be returned
 * instead of making a new network call.
 */
export class CachedFetcher {
  public callCount = 0;

  private _queue = new Map<string, any>();

  constructor(private _basePath: string) {
    if (!fs.existsSync(_basePath)) {
      fs.mkdirSync(join(_basePath), { recursive: true });
    }
  }

  public async fetch(info: RequestInfo, init?: RequestInit): Promise<Response> {
    const url =
      typeof info === "string" ? info : "href" in info ? info.href : info.url;
    const hash = JSON.stringify({ url, body: init?.body });
    if (this._has(hash)) {
      return new Response(this._get(hash), { status: 200 });
    }
    if (this._queue.has(hash)) {
      return new Response(await this._queue.get(hash), { status: 200 });
    }

    this._queue.set(hash, fetch(url, init));
    const response = await this._queue.get(hash);
    this.callCount++;
    if (response.status === 200) {
      this._set(hash, await response.clone().text());
    }
    return response;
  }

  private _get(key: string): string | undefined {
    if (!this._has(key)) {
      return undefined;
    }

    const content = JSON.parse(fs.readFileSync(this._path(key), "utf8"));
    return JSON.stringify(content.responseBody);
  }

  private _has(key: string): boolean {
    return fs.existsSync(this._path(key));
  }

  private _set(key: string, value: any): void {
    const content = {
      requestBody: key,
      responseBody: JSON.parse(value),
    };
    fs.writeFileSync(this._path(key), JSON.stringify(content));
  }

  private _path(key: string) {
    return join(this._basePath, this._hash(key) + ".json");
  }

  private _hash(key: string) {
    return crypto.createHash("md5").update(key).digest("hex");
  }
}
