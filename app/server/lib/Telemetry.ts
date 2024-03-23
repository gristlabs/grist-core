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
import {getDocSessionUser, OptDocSession} from 'app/server/lib/DocSession';
import {expressWrap} from 'app/server/lib/expressWrap';
import {GristServer} from 'app/server/lib/GristServer';
import {hashId} from 'app/server/lib/hashingUtils';
import {LogMethods} from 'app/server/lib/LogMethods';
import {stringParam} from 'app/server/lib/requestUtils';
import {getLogMetaFromDocSession} from 'app/server/lib/serverUtils';
import * as cookie from 'cookie';
import * as express from 'express';
import fetch from 'node-fetch';
import merge = require('lodash/merge');
import pickBy = require('lodash/pickBy');

type RequestOrSession = RequestWithLogin | OptDocSession | null;

interface RequestWithMatomoVisitorId extends RequestWithLogin {
  /**
   * Extracted from a cookie set by Matomo.
   *
   * Used by an AWS Lambda (LogsToMatomo_grist) to associate Grist telemetry
   * events with Matomo visits.
   */
  matomoVisitorId?: string | null;
}

export interface ITelemetry {
  start(): Promise<void>;
  logEvent(
    requestOrSession: RequestOrSession,
    name: TelemetryEvent,
    metadata?: TelemetryMetadataByLevel
  ): void;
  logEventAsync(
    requestOrSession: RequestOrSession,
    name: TelemetryEvent,
    metadata?: TelemetryMetadataByLevel
  ): Promise<void>;
  shouldLogEvent(name: TelemetryEvent): boolean;
  addEndpoints(app: express.Express): void;
  getTelemetryConfig(requestOrSession?: RequestOrSession): TelemetryConfig | undefined;
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
  private readonly _logger = new LogMethods('Telemetry ', (requestOrSession: RequestOrSession | undefined) =>
    this._getLogMeta(requestOrSession));
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
  public async logEventAsync(
    requestOrSession: RequestOrSession,
    event: TelemetryEvent,
    metadata?: TelemetryMetadataByLevel
  ) {
    await this._checkAndLogEvent(requestOrSession, event, metadata);
  }

  /**
   * Non-async variant of `logEventAsync`.
   *
   * Convenient for fire-and-forget usage.
   */
  public logEvent(
    requestOrSession: RequestOrSession,
    event: TelemetryEvent,
    metadata?: TelemetryMetadataByLevel
  ) {
    this.logEventAsync(requestOrSession, event, metadata).catch((e) => {
      this._logger.error(requestOrSession, `failed to log telemetry event ${event}`, e);
    });
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
      const event = stringParam(req.body.event, 'event', {allowed: TelemetryEvents.values}) as TelemetryEvent;
      if ('eventSource' in (req.body.metadata ?? {})) {
        this._telemetryLogger.rawLog('info', getEventType(event), event, {
          ...(removeNullishKeys(req.body.metadata)),
          eventName: event,
        });
      } else {
        try {
          this._assertTelemetryIsReady();
          await this._checkAndLogEvent(mreq, event, merge(
            {
              full: {
                userId: mreq.userId,
                altSessionId: mreq.altSessionId,
              },
            },
            req.body.metadata,
          ));
        } catch (e) {
          this._logger.error(mreq, `failed to log telemetry event ${event}`, e);
          throw new ApiError(`Telemetry failed to log telemetry event ${event}`, 500);
        }
      }
      return resp.status(200).send();
    }));
  }

  public getTelemetryConfig(requestOrSession?: RequestOrSession): TelemetryConfig | undefined {
    const prefs = this._telemetryPrefs;
    if (!prefs) {
      this._logger.error(requestOrSession, 'getTelemetryConfig called but telemetry preferences are undefined');
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

  // Checks if the event should be logged.
  public shouldLogEvent(event: TelemetryEvent): boolean {
    return Boolean(this._prepareToLogEvent(event));
  }

  private async _fetchTelemetryPrefs() {
    this._telemetryPrefs = await getTelemetryPrefs(this._dbManager, this._activation);
    this._checkTelemetryEvent = buildTelemetryEventChecker(this._telemetryPrefs.telemetryLevel.value);
  }

  private _prepareToLogEvent(
    event: TelemetryEvent
  ): {checkTelemetryEvent: TelemetryEventChecker, telemetryLevel: TelemetryLevel}|undefined {
    if (!this._checkTelemetryEvent) {
      this._logger.error(null, 'telemetry event checker is undefined');
      return;
    }

    const prefs = this._telemetryPrefs;
    if (!prefs) {
      this._logger.error(null, 'telemetry preferences are undefined');
      return;
    }

    const telemetryLevel = prefs.telemetryLevel.value;
    if (TelemetryContracts[event] && TelemetryContracts[event].minimumTelemetryLevel > Level[telemetryLevel]) {
      return;
    }
    return {checkTelemetryEvent: this._checkTelemetryEvent, telemetryLevel};
  }

  private async _checkAndLogEvent(
    requestOrSession: RequestOrSession,
    event: TelemetryEvent,
    metadata?: TelemetryMetadataByLevel
  ) {
    const result = this._prepareToLogEvent(event);
    if (!result) {
      return;
    }

    metadata = filterMetadata(metadata, result.telemetryLevel);
    result.checkTelemetryEvent(event, metadata);

    if (this._shouldForwardTelemetryEvents) {
      await this._forwardEvent(requestOrSession, event, metadata);
    } else {
      this._logEvent(requestOrSession, event, metadata);
    }
  }

  private _logEvent(
    requestOrSession: RequestOrSession,
    event: TelemetryEvent,
    metadata: TelemetryMetadata = {}
  ) {
    const isAnonymousUser = metadata.userId === this._dbManager.getAnonymousUserId();
    let isInternalUser: boolean | undefined;
    let isTeamSite: boolean | undefined;
    let visitorId: string | null | undefined;
    if (requestOrSession) {
      let email: string | undefined;
      let org: string | undefined;
      if ('get' in requestOrSession) {
        email = requestOrSession.user?.loginEmail;
        org = requestOrSession.org;
        if (isAnonymousUser) {
          visitorId = this._getAndSetMatomoVisitorId(requestOrSession);
        }
      } else {
        email = getDocSessionUser(requestOrSession)?.email;
        org = requestOrSession.client?.getOrg() ?? requestOrSession.req?.org;
      }
      if (email) {
        isInternalUser = email !== 'anon@getgrist.com' && email.endsWith('@getgrist.com');
      }
      if (org && !process.env.GRIST_SINGLE_ORG) {
        isTeamSite = !this._dbManager.isMergedOrg(org);
      }
    }
    const {category: eventCategory} = TelemetryContracts[event];
    this._telemetryLogger.rawLog('info', getEventType(event), event, {
      ...metadata,
      eventName: event,
      ...(eventCategory !== undefined ? {eventCategory} : undefined),
      eventSource: `grist-${this._deploymentType}`,
      installationId: this._activation!.id,
      ...(isInternalUser !== undefined ? {isInternalUser} : undefined),
      ...(isTeamSite !== undefined ? {isTeamSite} : undefined),
      ...(visitorId ? {visitorId} : undefined),
      ...(isAnonymousUser ? {userId: undefined} : undefined),
    });
  }

  private _getAndSetMatomoVisitorId(req: RequestWithMatomoVisitorId) {
    if (req.matomoVisitorId === undefined) {
      const cookies = cookie.parse(req.headers.cookie || '');
      const matomoVisitorCookie = Object.entries(cookies)
        .find(([key]) => key.startsWith('_pk_id'));
      if (matomoVisitorCookie) {
        req.matomoVisitorId = (matomoVisitorCookie[1] as string).split('.')[0];
      } else {
        req.matomoVisitorId = null;
      }
    }
    return req.matomoVisitorId;
  }

  private async _forwardEvent(
    requestOrSession: RequestOrSession,
    event: TelemetryEvent,
    metadata?: TelemetryMetadata
  ) {
    if (this._numPendingForwardEventRequests === MAX_PENDING_FORWARD_EVENT_REQUESTS) {
      this._logger.warn(requestOrSession, 'exceeded the maximum number of pending forwardEvent calls '
        + `(${MAX_PENDING_FORWARD_EVENT_REQUESTS}). Skipping forwarding of event ${event}.`);
      return;
    }

    try {
      this._numPendingForwardEventRequests += 1;
      const {category: eventCategory} = TelemetryContracts[event];
      await this._doForwardEvent(JSON.stringify({
        event,
        metadata: {
          ...metadata,
          eventName: event,
          ...(eventCategory !== undefined ? {eventCategory} : undefined),
          eventSource: `grist-${this._deploymentType}`,
          installationId: this._activation!.id,
        },
      }));
    } catch (e) {
      this._logger.error(requestOrSession, `failed to forward telemetry event ${event}`, e);
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

  private _getLogMeta(requestOrSession?: RequestOrSession) {
    if (!requestOrSession) { return {}; }

    if ('get' in requestOrSession) {
      return {
        org: requestOrSession.org,
        email: requestOrSession.user?.loginEmail,
        userId: requestOrSession.userId,
        altSessionId: requestOrSession.altSessionId,
      };
    } else {
      return getLogMetaFromDocSession(requestOrSession);
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
