import {TelemetryEventName} from 'app/common/Telemetry';
import {HomeDBManager} from 'app/gen-server/lib/HomeDBManager';

export class TelemetryManager {
  constructor(_dbManager: HomeDBManager) {}

  public logEvent(
    _name: TelemetryEventName,
    _metadata?: Record<string, any>
  ) {}
}
