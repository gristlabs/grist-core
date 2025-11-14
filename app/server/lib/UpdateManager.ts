import { ApiError } from "app/common/ApiError";
import { MapWithTTL } from "app/common/AsyncCreate";
import { GristDeploymentType } from "app/common/gristUrls";
import { naturalCompare } from "app/common/SortFunc";
import { RequestWithLogin } from "app/server/lib/Authorizer";
import { expressWrap } from 'app/server/lib/expressWrap';
import { GristServer } from "app/server/lib/GristServer";
import { optIntegerParam, optStringParam } from "app/server/lib/requestUtils";
import { rateLimit } from 'express-rate-limit';
import { AbortController, AbortSignal } from 'node-abort-controller';
import type * as express from "express";
import fetch from "node-fetch";
import * as semver from "semver";

// URL to show to the client where the new version for docker based deployments can be found.
const DOCKER_IMAGE_SITE = "https://hub.docker.com/r/gristlabs/grist";

// URL to show to the client where the new version for docker based deployments can be found.
const DOCKER_ENDPOINT = process.env.GRIST_TEST_UPDATE_DOCKER_HUB_URL ||
                          "https://hub.docker.com/v2/namespaces/gristlabs/repositories/grist/tags";
// Timeout for the request to the external resource.
const REQUEST_TIMEOUT = optIntegerParam(process.env.GRIST_TEST_UPDATE_REQUEST_TIMEOUT, '') ?? 10000; // 10s
// Delay between retries in case of rate limiting.
const RETRY_TIMEOUT = optIntegerParam(process.env.GRIST_TEST_UPDATE_RETRY_TIMEOUT, '') ?? 4000; // 4s
// We cache the good result for an hour.
const GOOD_RESULT_TTL = optIntegerParam(process.env.GRIST_TEST_UPDATE_CHECK_TTL, '') ?? 60 * 60 * 1000; // 1h
// We cache the bad result errors from external resources for a minute.
const BAD_RESULT_TTL = optIntegerParam(process.env.GRIST_TEST_UPDATE_ERROR_TTL, '') ?? 60 * 1000; // 1m

const OLDEST_RECOMMENDED_VERSION = process.env.GRIST_OLDEST_RECOMMENDED_VERSION;

// A hook for tests to override the default values.
export const Deps = {
  DOCKER_IMAGE_SITE,
  DOCKER_ENDPOINT,
  REQUEST_TIMEOUT,
  RETRY_TIMEOUT,
  GOOD_RESULT_TTL,
  BAD_RESULT_TTL,
  OLDEST_RECOMMENDED_VERSION,
};

/**
 * JSON returned to the client (exported for tests).
 */
export interface LatestVersion {
  /**
   * Latest version of core component of the client.
   */
  latestVersion: string;
  /**
   * If there were any critical updates after client's version. Undefined if
   * we don't know client version or couldn't figure this out for some other reason.
   */
  isCritical?: boolean;
  /**
   * Url where the client can download the latest version (if applicable)
   */
  updateURL?: string;

  /**
   * When the latest version was updated (in ISO format).
   */
  updatedAt?: string;
}


export class UpdateManager {

  // Cache for the latest version of the client.
  private _latestVersion: MapWithTTL<
    GristDeploymentType,
    // We cache the promise, so that we can wait for the first request.
    // This promise will always resolves, but can be resolved with an error.
    Promise<ApiError|LatestVersion>
  >;

  private _abortController = new AbortController();

  public constructor(
    private _app: express.Application,
    private _server: GristServer
  ) {
    this._latestVersion = new MapWithTTL<GristDeploymentType, Promise<ApiError|LatestVersion>>(Deps.GOOD_RESULT_TTL);
  }

  public addEndpoints() {
    // Make sure that config is ok, so that we are not surprised when client asks as about that.
    if (Deps.DOCKER_ENDPOINT) {
      try {
        new URL(Deps.DOCKER_ENDPOINT);
      } catch (err) {
        throw new Error(
          `Invalid value for GRIST_UPDATE_DOCKER_URL, expected URL: ${Deps.DOCKER_ENDPOINT}`
        );
      }
    }

    // Rate limit the requests to the version API, so that we don't get spammed.
    // 30 requests per second, per IP. The requests are cached so, we should be fine, but make
    // sure it doesn't get out of hand. On dev laptop I could go up to 600 requests per second.
    // (30 was picked by hand, to not hit the limit during tests).
    const limiter = rateLimit({
      windowMs: 1000,
      limit: 30,
      legacyHeaders: true,
    });

    // Support both POST and GET requests.
    this._app.use("/api/version", limiter, expressWrap(async (req, res) => {
      // Get some telemetry from the body request.
      const payload = (name: string) => req.body?.[name] ?? req.query[name];

      // This is the most interesting part for us, to track installation ids and match them
      // with the version of the client.
      const deploymentId = optStringParam(
        payload("installationId"),
        "installationId"
      );

      // Deployment type of the client (we expect this to be 'core' for most of the cases).
      const deploymentType = optStringParam(
        payload("deploymentType"),
        "deploymentType"
      ) as GristDeploymentType|undefined;

      const currentVersion = optStringParam(
        payload("currentVersion"),
        "currentVersion"
      );

      this._server
        .getTelemetry()
        .logEvent(req as RequestWithLogin, "checkedUpdateAPI", {
          full: {
            deploymentId,
            deploymentType,
            currentVersion,
          },
        });

      // For now we will just check the latest tag of docker stable image, assuming
      // that this is what the client wants. In the future we might have different
      // implementation based on the client deployment type.
      const deploymentToCheck = 'core';
      const versionChecker: VersionChecker = getLatestStableDockerVersion;

      // To not spam the docker hub with requests, we will cache the good result for an hour.
      // We are actually caching the promise, so subsequent requests will wait for the first one.
      if (!this._latestVersion.has(deploymentToCheck)) {
        const task = versionChecker(this._abortController.signal).catch(err => err);
        this._latestVersion.set(deploymentToCheck, task);
      }
      const resData = await this._latestVersion.get(deploymentToCheck)!;
      if (resData instanceof ApiError) {
        // If the request has failed for any reason, we will throw the error to the client,
        // but shorten the TTL to 1 minute, so that the next client will try after that time.
        this._latestVersion.setWithCustomTTL(deploymentToCheck, Promise.resolve(resData), Deps.BAD_RESULT_TTL);
        throw resData;
      }
      // Check if the version we're reporting is critical for the caller.
      const oldestVersion = Deps.OLDEST_RECOMMENDED_VERSION;
      if (currentVersion && oldestVersion) {
        try {
          resData.isCritical = semver.gt(oldestVersion, currentVersion);
        } catch (e) {
          throw new ApiError(
            `/api/version got a bad version number ${currentVersion} (incomparable with ${oldestVersion})`,
            400
          );
        }
      }

      res.json(resData);
    }));
  }

  public async clear() {
    this._abortController.abort();
    for (const task of this._latestVersion.values()) {
      await task.catch(() => {});
    }
    this._latestVersion.clear();

    // This function just clears cache and state, we should end with a fine state.
    this._abortController = new AbortController();
  }
}


type VersionChecker = (signal: AbortSignal) => Promise<LatestVersion>;

/**
 * Get the latest stable version of docker image from the hub.
 */
export async function getLatestStableDockerVersion(signal: AbortSignal): Promise<LatestVersion> {
  try {
    // Find stable tag.
    const tags = await listRepositoryTags(signal);
    const stableTag = tags.find((tag) => tag.name === "stable");
    if (!stableTag) {
      throw new ApiError("No stable tag found", 404);
    }

    // Now find all tags with the same image.
    const up = tags
      // Filter by digest.
      .filter((tag) => tag.digest === stableTag.digest)
      // Name should be a version number in a correct format (should start with a number or v and number).
      .filter(tag => /^v?\d+/.test(tag.name))
      // And sort it in natural order (so that 1.1.10 is after 1.1.9).
      .sort(compare("name"));

    const last = up[up.length - 1];
    // Panic if we don't have any tags that looks like version numbers.
    if (!last) {
      throw new ApiError("No stable image found", 404);
    }
    return {
      latestVersion: last.name,
      updatedAt: last.tag_last_pushed,
      // Versions are not critical, upgrades are, so we'll set that
      // later when we know the version the user is currently at.
      isCritical: false,
      updateURL: Deps.DOCKER_IMAGE_SITE
    };
  } catch (err) {
    // Make sure to throw only ApiErrors (cache depends on that).
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError(err.message, 500);
  }
}

// Shape of the data from the Docker Hub API.
interface DockerTag {
  name: string;
  digest: string;
  tag_last_pushed: string;
}

interface DockerResponse {
  results: DockerTag[];
  next: string|null;
}

// https://docs.docker.com/docker-hub/api/latest/#tag/repositories/
// paths/~1v2~1namespaces~1%7Bnamespace%7D~1repositories~1%7Brepository%7D~1tags/get
async function listRepositoryTags(signal: AbortSignal): Promise<DockerTag[]>{
  const tags: DockerTag[] = [];

  // In case of rate limiting, we will retry the request 20 times.
  // This is for all pages, so we might hit the limit multiple times.
  let MAX_RETRIES = 20;

  const url = new URL(Deps.DOCKER_ENDPOINT);
  url.searchParams.set("page_size", "100");
  let next: string|null = url.toString();

  // We assume have a maximum of 100 000 tags, if that is not enough, we will have to change this.
  let MAX_LOOPS = 1000;

  while (next && MAX_LOOPS-- > 0) {
    const response = await fetch(next, {signal, timeout: Deps.REQUEST_TIMEOUT});
    if (response.status === 429) {
      // We hit the rate limit, let's wait a bit and try again.
      await new Promise((resolve) => setTimeout(resolve, Deps.RETRY_TIMEOUT));
      if (signal.aborted) {
        throw new Error("Aborted");
      }
      if (MAX_RETRIES-- <= 0) {
        throw new Error("Too many retries");
      }
      continue;
    }
    if (response.status !== 200) {
      throw new ApiError(await response.text(), response.status);
    }
    const json: DockerResponse = await response.json();
    tags.push(...json.results);
    next = json.next;
  }
  if (MAX_LOOPS <= 0) {
    throw new Error("Too many tags found");
  }
  return tags;
}

/**
 * Helper for sorting in natural order (1.1.10 is after 1.1.9).
 */
function compare<T>(prop: keyof T) {
  return (a: T, b: T) => {
    return naturalCompare(a[prop], b[prop]);
  };
}
