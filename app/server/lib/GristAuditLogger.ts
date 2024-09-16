import {AuditEvent, AuditEventName} from 'app/common/AuditEvent';
import {IAuditLogger} from 'app/server/lib/AuditLogger';
import {HTTPAuditLogger} from 'app/server/lib/HTTPAuditLogger';

export class GristAuditLogger extends HTTPAuditLogger implements IAuditLogger {
  protected toJSON<Name extends AuditEventName>(event: AuditEvent<Name>): string {
    return JSON.stringify(event);
  }
}
