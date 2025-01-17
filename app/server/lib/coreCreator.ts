import {
  AttachmentStoreCreationError,
  ExternalStorageAttachmentStore
} from 'app/server/lib/AttachmentStore';
import {
  checkMinIOBucket,
  checkMinIOExternalStorage,
  configureMinIOExternalStorage
} from 'app/server/lib/configureMinIOExternalStorage';
import {makeSimpleCreator} from 'app/server/lib/ICreate';
import {MinIOExternalStorage} from 'app/server/lib/MinIOExternalStorage';
import {Telemetry} from 'app/server/lib/Telemetry';

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
  attachmentStoreOptions: [
    {
      name: 'minio',
      isAvailable: async () => checkMinIOExternalStorage() !== undefined,
      create: async (storeId: string) => {
        const options = checkMinIOExternalStorage();
        if (!options) {
          throw new AttachmentStoreCreationError('minio', storeId, 'MinIO storage not configured');
        }
        return new ExternalStorageAttachmentStore(
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
