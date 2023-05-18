import {logError} from 'app/client/models/errors';
import {TelemetryEventName} from 'app/common/Telemetry';
import {fetchFromHome, pageHasHome} from 'app/common/urlUtils';

export function logTelemetryEvent(name: TelemetryEventName, metadata?: Record<string, any>) {
  if (!pageHasHome()) { return; }

  fetchFromHome('/api/telemetry', {
    method: 'POST',
    body: JSON.stringify({
      name,
      metadata,
    }),
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
    },
  }).catch((e: Error) => {
    console.warn(`Failed to log telemetry event ${name}`, e);
    logError(e);
  });
}
