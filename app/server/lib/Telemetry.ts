import {ApiError} from 'app/common/ApiError';
import {TelemetryConfig} from 'app/common/gristUrls';
import {assertIsDefined} from 'app/common/gutil';
import {
  buildTelemetryEventChecker,
  Level,
  TelemetryContracts,
  TelemetryEvent,
  TelemetryEventChecker,
  TelemetryEvents,
  TelemetryLevel,
  TelemetryLevels,
  TelemetryMetadata,
  TelemetryMetadataByLevel,
  TelemetryRetentionPeriod,
} from 'app/common/Telemetry';
import {TelemetryPrefsWithSources} from 'app/common/InstallAPI';
import {Activation} from 'app/gen-server/entity/Activation';
import {Activations} from 'app/gen-server/lib/Activations';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';
import {RequestWithLogin} from 'app/server/lib/Authorizer';
import {expressWrap} from 'app/server/lib/expressWrap';
import {GristServer} from 'app/server/lib/GristServer';
import {hashId} from 'app/server/lib/hashingUtils';
import {LogMethods} from 'app/server/lib/LogMethods';
import {stringParam} from 'app/server/lib/requestUtils';
import * as express from 'express';
import fetch from 'node-fetch';
import merge = require('lodash/merge');
import pickBy = require('lodash/pickBy');

export interface ITelemetry {
  start(): Promise<void>;
  logEvent(name: TelemetryEvent, metadata?: TelemetryMetadataByLevel): Promise<void>;
  addEndpoints(app: express.Express): void;
  addPages(app: express.Express, middleware: express.RequestHandler[]): void;
  getTelemetryConfig(): TelemetryConfig | undefined;
  fetchTelemetryPrefs(): Promise<void>;
}

const MAX_PENDING_FORWARD_EVENT_REQUESTS = 25;

/**
 * Manages telemetry for Grist.
 */
export class Telemetry implements ITelemetry {
  private _activation: Activation | undefined;
  private _telemetryPrefs: TelemetryPrefsWithSources | undefined;
  private readonly _deploymentType = this._gristServer.getDeploymentType();
  private readonly _shouldForwardTelemetryEvents = this._deploymentType !== 'saas';
  private readonly _forwardTelemetryEventsUrl = process.env.GRIST_TELEMETRY_URL ||
    'https://telemetry.getgrist.com/api/telemetry';
  private _numPendingForwardEventRequests = 0;
  private readonly _logger = new LogMethods('Telemetry ', () => ({}));
  private readonly _telemetryLogger = new LogMethods<string>('Telemetry ', (eventType) => ({
    eventType,
  }));

  private _checkTelemetryEvent: TelemetryEventChecker | undefined;

  constructor(private _dbManager: HomeDBManager, private _gristServer: GristServer) {

  }

  public async start() {
    await this.fetchTelemetryPrefs();
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
    if (!this._checkTelemetryEvent) {
      this._logger.error(undefined, 'logEvent called but telemetry event checker is undefined');
      return;
    }

    const prefs = this._telemetryPrefs;
    if (!prefs) {
      this._logger.error(undefined, 'logEvent called but telemetry preferences are undefined');
      return;
    }

    const {telemetryLevel} = prefs;
    if (TelemetryContracts[event] && TelemetryContracts[event].minimumTelemetryLevel > Level[telemetryLevel.value]) {
      return;
    }

    metadata = filterMetadata(metadata, telemetryLevel.value);
    this._checkTelemetryEvent(event, metadata);

    if (this._shouldForwardTelemetryEvents) {
      await this._forwardEvent(event, metadata);
    } else {
      this._logEvent(event, metadata);
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
    app.post('/api/telemetry', expressWrap(async (req, resp) => {
      const mreq = req as RequestWithLogin;
      const event = stringParam(req.body.event, 'event', TelemetryEvents.values) as TelemetryEvent;
      if ('eventSource' in req.body.metadata) {
        this._telemetryLogger.rawLog('info', getEventType(event), event, {
          ...(removeNullishKeys(req.body.metadata)),
          eventName: event,
        });
      } else {
        try {
          this._assertTelemetryIsReady();
          await this.logEvent(event, merge(
            {
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
    }));
  }

  public addPages(app: express.Application, middleware: express.RequestHandler[]) {
    if (this._deploymentType === 'core') {
      app.get('/support-grist', ...middleware, expressWrap(async (req, resp) => {
        return this._gristServer.sendAppPage(req, resp,
          {path: 'app.html', status: 200, config: {}});
      }));
    }
  }

  public getTelemetryConfig(): TelemetryConfig | undefined {
    const prefs = this._telemetryPrefs;
    if (!prefs) {
      this._logger.error(undefined, 'getTelemetryConfig called but telemetry preferences are undefined');
      return undefined;
    }

    return {
      telemetryLevel: prefs.telemetryLevel.value,
    };
  }

  public async fetchTelemetryPrefs() {
    this._activation = await this._gristServer.getActivations().current();
    await this._fetchTelemetryPrefs();
  }

  private async _fetchTelemetryPrefs() {
    this._telemetryPrefs = await getTelemetryPrefs(this._dbManager, this._activation);
    this._checkTelemetryEvent = buildTelemetryEventChecker(this._telemetryPrefs.telemetryLevel.value);
  }

  private _logEvent(
    event: TelemetryEvent,
    metadata?: TelemetryMetadata
  ) {
    this._telemetryLogger.rawLog('info', getEventType(event), event, {
      ...metadata,
      eventName: event,
      eventSource: `grist-${this._deploymentType}`,
      installationId: this._activation!.id,
    });
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
      await this._doForwardEvent(JSON.stringify({
        event,
        metadata: {
          ...metadata,
          eventName: event,
          eventSource: `grist-${this._deploymentType}`,
          installationId: this._activation!.id,
        }
      }));
    } catch (e) {
      this._logger.error(undefined, `failed to forward telemetry event ${event}`, e);
    } finally {
      this._numPendingForwardEventRequests -= 1;
    }
  }

  private async _doForwardEvent(payload: string) {
    await fetch(this._forwardTelemetryEventsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: payload,
    });
  }

  private _assertTelemetryIsReady() {
    try {
      assertIsDefined('activation', this._activation);
    } catch (e) {
      this._logger.error(null, 'activation is undefined', e);
      throw new ApiError('Telemetry is not ready', 500);
    }
  }
}

export async function getTelemetryPrefs(
  db: HomeDBManager,
  activation?: Activation
): Promise<TelemetryPrefsWithSources> {
  const GRIST_TELEMETRY_LEVEL = process.env.GRIST_TELEMETRY_LEVEL;
  if (GRIST_TELEMETRY_LEVEL !== undefined) {
    const value = TelemetryLevels.check(GRIST_TELEMETRY_LEVEL);
    return {
      telemetryLevel: {
        value,
        source: 'environment-variable',
      },
    };
  }

  const {prefs} = activation ?? await new Activations(db).current();
  return {
    telemetryLevel: {
      value: prefs?.telemetry?.telemetryLevel ?? 'off',
      source: 'preferences',
    }
  };
}

/**
 * Returns a new, filtered metadata object, or undefined if `metadata` is undefined.
 *
 * Filtering currently:
 *  - removes keys in groups that exceed `telemetryLevel`
 *  - removes keys with values of null or undefined
 *  - hashes the values of keys suffixed with "Digest" (e.g. doc ids, fork ids)
 *  - flattens the entire metadata object (i.e. removes the nesting of keys under
 *    "limited" or "full")
 */
export function filterMetadata(
  metadata: TelemetryMetadataByLevel | undefined,
  telemetryLevel: TelemetryLevel
): TelemetryMetadata | undefined {
  if (!metadata) { return; }

  let filteredMetadata: TelemetryMetadata = {};
  for (const level of ['limited', 'full'] as const) {
    if (Level[telemetryLevel] < Level[level]) { break; }

    filteredMetadata = {...filteredMetadata, ...metadata[level]};
  }

  filteredMetadata = removeNullishKeys(filteredMetadata);
  filteredMetadata = hashDigestKeys(filteredMetadata);

  return filteredMetadata;
}

/**
 * Returns a copy of `object` with all null and undefined keys removed.
 */
export function removeNullishKeys(object: Record<string, any>) {
  return pickBy(object, value => value !== null && value !== undefined);
}

/**
 * Returns a copy of `metadata`, replacing the values of all keys suffixed
 * with "Digest" with the result of hashing the value. The hash is prefixed with
 * the first 4 characters of the original value, to assist with troubleshooting.
 */
export function hashDigestKeys(metadata: TelemetryMetadata): TelemetryMetadata {
  const filteredMetadata: TelemetryMetadata = {};
  Object.entries(metadata).forEach(([key, value]) => {
    if (key.endsWith('Digest') && typeof value === 'string') {
      filteredMetadata[key] = hashId(value);
    } else {
      filteredMetadata[key] = value;
    }
  });
  return filteredMetadata;
}

type TelemetryEventType = 'telemetry' | 'telemetry-short-retention';

const EventTypeByRetentionPeriod: Record<TelemetryRetentionPeriod, TelemetryEventType> = {
  indefinitely: 'telemetry',
  short: 'telemetry-short-retention',
};

function getEventType(event: TelemetryEvent) {
  const {retentionPeriod} = TelemetryContracts[event];
  return EventTypeByRetentionPeriod[retentionPeriod];
}
