import {ApiError} from 'app/common/ApiError';
import {
  buildTelemetryEventChecker,
  filterMetadata,
  removeNullishKeys,
  TelemetryEvent,
  TelemetryEventChecker,
  TelemetryEvents,
  TelemetryLevel,
  TelemetryLevels,
  TelemetryMetadata,
  TelemetryMetadataByLevel,
} from 'app/common/Telemetry';
import {HomeDBManager, HomeDBTelemetryEvents} from 'app/gen-server/lib/HomeDBManager';
import {RequestWithLogin} from 'app/server/lib/Authorizer';
import {GristServer} from 'app/server/lib/GristServer';
import {LogMethods} from 'app/server/lib/LogMethods';
import {stringParam} from 'app/server/lib/requestUtils';
import * as express from 'express';
import merge = require('lodash/merge');

export interface ITelemetry {
  logEvent(name: TelemetryEvent, metadata?: TelemetryMetadataByLevel): Promise<void>;
  addEndpoints(app: express.Express): void;
  getTelemetryLevel(): TelemetryLevel;
}

const MAX_PENDING_FORWARD_EVENT_REQUESTS = 25;

/**
 * Manages telemetry for Grist.
 */
export class Telemetry implements ITelemetry {
  private _telemetryLevel: TelemetryLevel;
  private _deploymentType = this._gristServer.getDeploymentType();
  private _shouldForwardTelemetryEvents = this._deploymentType !== 'saas';
  private _forwardTelemetryEventsUrl = process.env.GRIST_TELEMETRY_URL ||
  'https://telemetry.getgrist.com/api/telemetry';
  private _numPendingForwardEventRequests = 0;

  private _installationId: string | undefined;

  private _logger = new LogMethods('Telemetry ', () => ({}));
  private _telemetryLogger = new LogMethods('Telemetry ', () => ({
    eventType: 'telemetry',
  }));

  private _checkEvent: TelemetryEventChecker | undefined;

  constructor(private _dbManager: HomeDBManager, private _gristServer: GristServer) {
    this._initialize().catch((e) => {
      this._logger.error(undefined, 'failed to initialize', e);
    });
  }

  /**
   * Logs a telemetry `event` and its `metadata`.
   *
   * Depending on the deployment type, this will either forward the
   * data to an endpoint (set via GRIST_TELEMETRY_URL) or log it
   * directly. In hosted Grist, telemetry is logged directly, and
   * subsequently sent to an OpenSearch instance via CloudWatch. In
   * other deployment types, telemetry is forwarded to an endpoint
   * of hosted Grist, which then handles logging to OpenSearch.
   *
   * Note that `metadata` is grouped by telemetry level, with only the
   * groups meeting the current telemetry level being included in
   * what's logged. If the current telemetry level is `off`, nothing
   * will be logged. Otherwise, `metadata` will be filtered according
   * to the current telemetry level, keeping only the groups that are
   * less than or equal to the current level.
   *
   * Additionally, runtime checks are also performed to verify that the
   * event and metadata being passed in are being logged appropriately
   * for the configured telemetry level. If any checks fail, an error
   * is thrown.
   *
   * Example:
   *
   * The following will only log the `rowCount` if the telemetry level is set
   * to `limited`, and will log both the `method` and `userId` if the telemetry
   * level is set to `full`:
   *
   * ```
   * logEvent('documentUsage', {
   *   limited: {
   *     rowCount: 123,
   *   },
   *   full: {
   *     userId: 1586,
   *   },
   * });
   * ```
   */
  public async logEvent(
    event: TelemetryEvent,
    metadata?: TelemetryMetadataByLevel
  ) {
    if (this._telemetryLevel === 'off') { return; }

    metadata = filterMetadata(metadata, this._telemetryLevel);
    this._checkTelemetryEvent(event, metadata);

    if (this._shouldForwardTelemetryEvents) {
      await this._forwardEvent(event, metadata);
    } else {
      this._telemetryLogger.rawLog('info', null, event, {
        eventName: event,
        eventSource: `grist-${this._deploymentType}`,
        ...metadata,
      });
    }
  }

  public addEndpoints(app: express.Application) {
    /**
     * Logs telemetry events and their metadata.
     *
     * Clients of this endpoint may be external Grist instances, so the behavior
     * varies based on the presence of an `eventSource` key in the event metadata.
     *
     * If an `eventSource` key is present, the telemetry event will be logged
     * directly, as the request originated from an external source; runtime checks
     * of telemetry data are skipped since they should have already occured at the
     * source. Otherwise, the event will only be logged after passing various
     * checks.
     */
    app.post('/api/telemetry', async (req, resp) => {
      const mreq = req as RequestWithLogin;
      const event = stringParam(req.body.event, 'event', TelemetryEvents.values);
      if ('eventSource' in req.body.metadata) {
        this._telemetryLogger.rawLog('info', null, event, {
          eventName: event,
          ...(removeNullishKeys(req.body.metadata)),
        });
      } else {
        try {
          await this.logEvent(event as TelemetryEvent, merge(
            {
              limited: {
                eventSource: `grist-${this._deploymentType}`,
                ...(this._deploymentType !== 'saas' ? {installationId: this._installationId} : {}),
              },
              full: {
                userId: mreq.userId,
                altSessionId: mreq.altSessionId,
              },
            },
            req.body.metadata,
          ));
        } catch (e) {
          this._logger.error(undefined, `failed to log telemetry event ${event}`, e);
          throw new ApiError(`Telemetry failed to log telemetry event ${event}`, 500);
        }
      }
      return resp.status(200).send();
    });
  }

  public getTelemetryLevel() {
    return this._telemetryLevel;
  }

  private async _initialize() {
    if (process.env.GRIST_TELEMETRY_LEVEL !== undefined) {
      this._telemetryLevel = TelemetryLevels.check(process.env.GRIST_TELEMETRY_LEVEL);
      this._checkTelemetryEvent = buildTelemetryEventChecker(this._telemetryLevel);
    } else {
      this._telemetryLevel = 'off';
    }

    const {id} = await this._gristServer.getActivations().current();
    this._installationId = id;

    for (const event of HomeDBTelemetryEvents.values) {
      this._dbManager.on(event, async (metadata) => {
        this.logEvent(event, metadata).catch(e =>
          this._logger.error(undefined, `failed to log telemetry event ${event}`, e));
      });
    }
  }

  private _checkTelemetryEvent(event: TelemetryEvent, metadata?: TelemetryMetadata) {
    if (!this._checkEvent) {
      throw new Error('Telemetry._checkEvent is undefined');
    }

    this._checkEvent(event, metadata);
  }

  private async _forwardEvent(
    event: TelemetryEvent,
    metadata?: TelemetryMetadata
  ) {
    if (this._numPendingForwardEventRequests === MAX_PENDING_FORWARD_EVENT_REQUESTS) {
      this._logger.warn(undefined, 'exceeded the maximum number of pending forwardEvent calls '
        + `(${MAX_PENDING_FORWARD_EVENT_REQUESTS}). Skipping forwarding of event ${event}.`);
      return;
    }

    try {
      this._numPendingForwardEventRequests += 1;
      await this._postJsonPayload(JSON.stringify({event, metadata}));
    } catch (e) {
      this._logger.error(undefined, `failed to forward telemetry event ${event}`, e);
    } finally {
      this._numPendingForwardEventRequests -= 1;
    }
  }

  private async _postJsonPayload(payload: string) {
    await fetch(this._forwardTelemetryEventsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
    });
  }
}
