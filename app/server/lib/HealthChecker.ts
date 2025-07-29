import {GristServer} from 'app/server/lib/GristServer';
import log from 'app/server/lib/log';
import {createPubSubManager, IPubSubManager} from 'app/server/lib/PubSubManager';
import * as shutdown from 'app/server/lib/shutdown';

import {v4 as uuidv4} from 'uuid';

// Not to be confused with health checks from the frontend, these
// request/response pairs are internal checks between Grist instances
// in multi-server environments
interface ServerHealthcheckRequest {
  id: string;
  instanceId: string;
  checkReady: boolean;
}
interface ServerHealthcheckResponse {
  instanceId: string;
  requestId: string;
  healthy: boolean;
}

// For keeping track of pending health checks for all other servers
// for each request that was broadcast to all of them.
interface PendingServerHealthCheck {
  expectedCount: number;
  responses: Record<string, boolean>;
  resolve: (res: boolean) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
}

/** This class uses pubsub via Redis, if available, to register this
 *  Grist instance and check that all other instances are healthy.
 *
 *  In single-server instances, it also works without Redis, leveraging
 *  the dummy defaults of `PubSubManager`.
 */
export class HealthChecker {
  private _pendingServerHealthChecks: Map<string, PendingServerHealthCheck>;
  private _serverInstanceID: string;
  private _pubSubManager: IPubSubManager;

  constructor(
    private _server: GristServer
  ) {
    this._pubSubManager = createPubSubManager(process.env.REDIS_URL);
    this._pendingServerHealthChecks = new Map<string, PendingServerHealthCheck>();
    this._serverInstanceID = process.env.GRIST_INSTANCE_ID || `testInsanceId_${this._server.getHost()}`;
    this._pubSubManager.getClient()?.sadd('grist-instances', this._serverInstanceID).catch((err) => {
      log.error('Failed to contact redis', err);
    });
    this._subscribeToChannels();

    // Make sure we clean up our Redis mess, if any, even if we exit
    // by signal.
    shutdown.addCleanupHandler(null, () => this.close());
  }


  /** This returns a promise that resolves to `true` when all other
   *  registered instances must respond as healthy within the given
   *  timeout.
   *
   *  @param {number} timeout - number of milliseconds to wait for
   *                            responses from all servers before timeout
   *
   *  @param {boolean} checkReady - whether to insist on `ready` status
   *                                or just a simple health check
   */
  public async allServersOkay(timeout: number, checkReady: boolean): Promise<boolean> {
    const requestId = uuidv4();
    const client = this._pubSubManager.getClient();

    // If there is no Redis, then our current instance is the only instance
    const allInstances = await client?.smembers('grist-instances') || [this._serverInstanceID];

    const allInstancesPromise: Promise<boolean> = new Promise((resolve: (res: boolean) => void, reject) => {
      const allInstancesTimeout = setTimeout(() => {
        log.warn('allServersOkay: timeout waiting for responses');
        reject(new Error('Timeout waiting for health responses'));
        this._pendingServerHealthChecks.delete(requestId);
      }, timeout);

      this._pendingServerHealthChecks.set(requestId, {
        responses: {},
        expectedCount: allInstances.length,
        resolve,
        reject,
        timeout: allInstancesTimeout,
      });
    }).catch(() => false);
    const request: ServerHealthcheckRequest = {
      id: requestId,
      instanceId: this._serverInstanceID,
      checkReady,
    };
    await this._pubSubManager.publish('healthcheck:requests', JSON.stringify(request));
    return allInstancesPromise;
  }

  public async close() {
    await this._pubSubManager.getClient()?.srem('grist-instances', [this._serverInstanceID]);
    await this._pubSubManager.close();
  }

  private _subscribeToChannels() {
    this._pubSubManager.subscribe('healthcheck:requests', async (message) => {
      const request: ServerHealthcheckRequest = JSON.parse(message);
      const response: ServerHealthcheckResponse = {
        instanceId: this._serverInstanceID|| '',
        requestId: request.id,
        healthy: !request.checkReady || this._server.ready,
      };
      log.debug('allServersOkay request', response);
      await this._pubSubManager.publish(`healthcheck:responses-${request.instanceId}`, JSON.stringify(response));
    });

    this._pubSubManager.subscribe(`healthcheck:responses-${this._serverInstanceID}`, (message) => {
      const response: ServerHealthcheckResponse = JSON.parse(message);
      const pending = this._pendingServerHealthChecks.get(response.requestId);
      if (!pending) {
        // This instance didn't broadcast a health check request with
        // this requestId, so nothing to do.
        return;
      }

      pending.responses[response.instanceId] = response.healthy;
      log.debug(
        `allServersOkay cleared pending response on ${this._serverInstanceID} for ${response.instanceId}`
      );

      if (Object.keys(pending.responses).length === pending.expectedCount) {
        // All servers have replied. Make it known and clean up.
        clearTimeout(pending.timeout);
        pending.resolve(Object.values(pending.responses).every(e => e));
        this._pendingServerHealthChecks.delete(response.requestId);
      }
    });
  }
}
