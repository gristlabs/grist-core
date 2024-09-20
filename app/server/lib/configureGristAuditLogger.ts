import {appSettings} from 'app/server/lib/AppSettings';
import {GristAuditLogger} from 'app/server/lib/GristAuditLogger';

export function configureGristAuditLogger() {
  const options = checkGristAuditLogger();
  if (!options) { return undefined; }

  return new GristAuditLogger(options);
}

export function checkGristAuditLogger() {
  const settings = appSettings.section('auditLogger').section('http');
  const endpoint = settings.flag('endpoint').readString({
    envVar: 'GRIST_AUDIT_HTTP_ENDPOINT',
  });
  if (!endpoint) { return undefined; }

  const payloadFormat = settings.flag('payloadFormat').readString({
    envVar: 'GRIST_AUDIT_HTTP_PAYLOAD_FORMAT',
    defaultValue: 'grist',
  });
  if (payloadFormat !== 'grist') { return undefined; }

  const authorizationHeader = settings.flag('authorizationHeader').readString({
    envVar: 'GRIST_AUDIT_HTTP_AUTHORIZATION_HEADER',
    censor: true,
  });

  return {endpoint, authorizationHeader};
}
