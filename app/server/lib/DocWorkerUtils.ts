import {ApiError} from 'app/common/ApiError';
import {parseSubdomainStrictly} from 'app/common/gristUrls';
import {removeTrailingSlash} from 'app/common/gutil';
import {DocStatus, IDocWorkerMap} from 'app/server/lib/DocWorkerMap';
import log from 'app/server/lib/log';
import {adaptServerUrl} from 'app/server/lib/requestUtils';
import * as express from 'express';
import fetch, {Response as FetchResponse, RequestInit} from 'node-fetch';

/**
 * This method transforms a doc worker's public url as needed based on the request.
 *
 * For historic reasons, doc workers are assigned a public url at the time
 * of creation.  In production/staging, this is of the form:
 *   https://doc-worker-NNN-NNN-NNN-NNN.getgrist.com/v/VVVV/
 * and in dev:
 *   http://localhost:NNNN/v/VVVV/
 *
 * Prior to support for different base domains, this was fine.  Now that different
 * base domains are supported, a wrinkle arises.  When a web client communicates
 * with a doc worker, it is important that it accesses the doc worker via a url
 * containing the same base domain as the web page the client is on (for cookie
 * purposes).  Hence this method.
 *
 * If both the request and docWorkerUrl contain identifiable base domains (not localhost),
 * then the base domain of docWorkerUrl is replaced with that of the request.
 *
 * But wait, there's another wrinkle: custom domains. In this case, we have a single
 * domain available to serve a particular org from. This method will use the origin of req
 * and include a /dw/doc-worker-NNN-NNN-NNN-NNN/
 * (or /dw/local-NNNN/) prefix in all doc worker paths.  Once this is in place, it
 * will allow doc worker routing to be changed so it can be overlaid on a custom
 * domain.
 *
 * TODO: doc worker registration could be redesigned to remove the assumption
 * of a fixed base domain.
 */
export function customizeDocWorkerUrl(
  docWorkerUrlSeed: string|undefined,
  req: express.Request
): string|null {
  if (!docWorkerUrlSeed) {
    // When no doc worker seed, we're in single server mode.
    // Return null, to signify that the URL prefix serving the
    // current endpoint is the only one available.
    return null;
  }
  const docWorkerUrl = new URL(docWorkerUrlSeed);
  const workerSubdomain = parseSubdomainStrictly(docWorkerUrl.hostname).org;
  adaptServerUrl(docWorkerUrl, req);

  // We wish to migrate to routing doc workers by path, so insert a doc worker identifier
  // in the path (if not already present).
  if (!docWorkerUrl.pathname.startsWith('/dw/')) {
    // When doc worker is localhost, the port number is necessary and sufficient for routing.
    // Let's add a /dw/... prefix just for consistency.
    const workerIdent = workerSubdomain || `local-${docWorkerUrl.port}`;
    docWorkerUrl.pathname = `/dw/${workerIdent}${docWorkerUrl.pathname}`;
  }
  return docWorkerUrl.href;
}

/**
 *
 * Gets the worker responsible for a given assignment, and fetches a url
 * from the worker.
 *
 * If the fetch fails, we throw an exception, unless we see enough evidence
 * to unassign the worker and try again.
 *
 *  - If GRIST_MANAGED_WORKERS is set, we assume that we've arranged
 *    for unhealthy workers to be removed automatically, and that if a
 *    fetch returns a 404 with specific content, it is proof that the
 *    worker is no longer in existence. So if we see a 404 with that
 *    specific content, we can safely de-list the worker from redis,
 *    and repeat.
 *  - If GRIST_MANAGED_WORKERS is not set, we accept a broader set
 *    of failures as evidence of a missing worker.
 *
 * The specific content of a 404 that will be treated as evidence of
 * a doc worker not being present is:
 *  - A json format body
 *  - With a key called "message"
 *  - With the value of "message" being "document worker not present"
 *  In production, this is provided by a special doc-worker-* load balancer
 *  rule.
 *
 */
export async function getWorker(
  docWorkerMap: IDocWorkerMap,
  assignmentId: string,
  urlPath: string,
  config: RequestInit = {}
) {
  if (!useWorkerPool()) {
    // This should never happen. We are careful to not use getWorker
    // when everything is on a single server, since it is burdensome
    // for self-hosted users to figure out the correct settings for
    // the server to be able to contact itself, and there are cases
    // of the defaults not working.
    throw new Error("AppEndpoint.getWorker was called unnecessarily");
  }
  let docStatus: DocStatus|undefined;
  const workersAreManaged = Boolean(process.env.GRIST_MANAGED_WORKERS);
  for (;;) {
    docStatus = await docWorkerMap.assignDocWorker(assignmentId);
    const configWithTimeout = {timeout: 10000, ...config};
    const fullUrl = removeTrailingSlash(docStatus.docWorker.internalUrl) + urlPath;
    try {
      const resp: FetchResponse = await fetch(fullUrl, configWithTimeout);
      if (resp.ok) {
        return {
          resp,
          docStatus,
        };
      }
      if (resp.status === 403) {
        throw new ApiError("You do not have access to this document.", resp.status);
      }
      if (resp.status !== 404) {
        throw new ApiError(resp.statusText, resp.status);
      }
      let body: any;
      try {
        body = await resp.json();
      } catch (e) {
        throw new ApiError(resp.statusText, resp.status);
      }
      if (!(body && body.message && body.message === 'document worker not present')) {
        throw new ApiError(resp.statusText, resp.status);
      }
      // This is a 404 with the expected content for a missing worker.
    } catch (e) {
      log.rawDebug(`AppEndpoint.getWorker failure`, {
        url: fullUrl,
        docId: assignmentId,
        status: e.status,
        message: String(e),
        workerId: docStatus.docWorker.id,
      });
      // If workers are managed, no errors merit continuing except a 404.
      // Otherwise, we continue if we see a system error (e.g. ECONNREFUSED).
      // We don't accept timeouts since there is too much potential to
      // bring down a single-worker deployment that has a hiccup.
      if (workersAreManaged || !(e.type === 'system')) {
        throw e;
      }
    }
    log.warn(`fetch from ${fullUrl} failed convincingly, removing that worker`);
    await docWorkerMap.removeWorker(docStatus.docWorker.id);
    docStatus = undefined;
  }
}

// Return true if document related endpoints are served by separate workers.
export function useWorkerPool() {
  return process.env.GRIST_SINGLE_PORT !== 'true';
}
