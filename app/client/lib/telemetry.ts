import {logError} from 'app/client/models/errors';
import {Level, TelemetryContracts, TelemetryEvent, TelemetryMetadataByLevel} from 'app/common/Telemetry';
import {fetchFromHome, getGristConfig, pageHasHome} from 'app/common/urlUtils';

export function logTelemetryEvent(event: TelemetryEvent, metadata?: TelemetryMetadataByLevel) {
  if (!pageHasHome()) { return; }

  const {telemetry} = getGristConfig();
  if (!telemetry) { return; }

  const {telemetryLevel} = telemetry;
  if (Level[telemetryLevel] < TelemetryContracts[event].minimumTelemetryLevel) { return; }

  fetchFromHome('/api/telemetry', {
    method: 'POST',
    body: JSON.stringify({
      event,
      metadata,
    }),
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  }).catch((e: Error) => {
    console.warn(`Failed to log telemetry event ${event}`, e);
    logError(e);
  });
}
