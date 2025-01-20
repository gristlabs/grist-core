import {
  AttachmentStoreCreationError,
  ExternalStorageAttachmentStore
} from 'app/server/lib/AttachmentStore';
import {
  checkMinIOBucket,
  checkMinIOExternalStorage,
  configureMinIOExternalStorage
} from 'app/server/lib/configureMinIOExternalStorage';
import {BaseCreate, ICreateAttachmentStoreOptions, ICreateStorageOptions} from 'app/server/lib/ICreate';
import {MinIOExternalStorage} from 'app/server/lib/MinIOExternalStorage';
import {Telemetry} from 'app/server/lib/Telemetry';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {GristServer} from 'app/server/lib/GristServer';

export class CoreCreate extends BaseCreate {
  constructor() {
    const storage: ICreateStorageOptions[] = [
      {
        name: 'minio',
        check: () => checkMinIOExternalStorage() !== undefined,
        checkBackend: () => checkMinIOBucket(),
        create: configureMinIOExternalStorage,
      },
    ];
    super('core', storage);
  }

  public override getAttachmentStoreOptions(): ICreateAttachmentStoreOptions[] {
    return [
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
    ];
  }

  public override Telemetry(dbManager: HomeDBManager, gristServer: GristServer) {
    return new Telemetry(dbManager, gristServer);
  }
}
