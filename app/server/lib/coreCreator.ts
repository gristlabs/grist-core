import { checkMinIOBucket, checkMinIOExternalStorage,
         configureMinIOExternalStorage } from 'app/server/lib/configureMinIOExternalStorage';
import { configureCoreAuditLogger } from 'app/server/lib/configureCoreAuditLogger';
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
  auditLogger: {
    create: configureCoreAuditLogger,
  },
  telemetry: {
    create: (dbManager, gristServer) => new Telemetry(dbManager, gristServer),
  }
});
