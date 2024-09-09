import { checkGristAuditLogger, configureGristAuditLogger } from 'app/server/lib/configureGristAuditLogger';
import { checkMinIOBucket, checkMinIOExternalStorage,
         configureMinIOExternalStorage } from 'app/server/lib/configureMinIOExternalStorage';
import { makeSimpleCreator } from 'app/server/lib/ICreate';
import { Telemetry } from 'app/server/lib/Telemetry';

export const makeCoreCreator = () => makeSimpleCreator({
  deploymentType: 'core',
  storage: [
    {
      name: 'minio',
      check: () => checkMinIOExternalStorage() !== undefined,
      checkBackend: () => checkMinIOBucket(),
      create: configureMinIOExternalStorage,
    },
  ],
  auditLogger: [
    {
      name: 'grist',
      check: () => checkGristAuditLogger() !== undefined,
      create: configureGristAuditLogger,
    },
  ],
  telemetry: {
    create: (dbManager, gristServer) => new Telemetry(dbManager, gristServer),
  }
});
