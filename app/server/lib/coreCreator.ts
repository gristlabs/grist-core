import { checkGristAuditLogger, configureGristAuditLogger } from 'app/server/lib/configureGristAuditLogger';
import {
  checkMinIOBucket,
  checkMinIOExternalStorage,
  configureMinIOExternalStorage
} from 'app/server/lib/configureMinIOExternalStorage';
import { makeSimpleCreator } from 'app/server/lib/ICreate';
import { Telemetry } from 'app/server/lib/Telemetry';
import { AttachmentStoreCreationError, MinIOAttachmentStore } from "./AttachmentStore";
import { MinIOExternalStorage } from "./MinIOExternalStorage";

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
  attachmentStoreBackends: [
    {
      name: 'minio',
      check: () => checkMinIOExternalStorage() !== undefined,
      checkBackend: () => checkMinIOBucket(),
      create: (storeId: string) => {
        const options = checkMinIOExternalStorage();
        if (!options) {
          throw new AttachmentStoreCreationError('minio', storeId, 'MinIO storage not configured');
        }
        return new MinIOAttachmentStore(
          storeId,
          new MinIOExternalStorage(options.bucket, options),
          [options?.prefix || "", "attachments"]
        );
      }
    }
  ],
  telemetry: {
    create: (dbManager, gristServer) => new Telemetry(dbManager, gristServer),
  }
});
