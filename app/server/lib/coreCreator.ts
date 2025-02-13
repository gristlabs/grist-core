import {
  AttachmentStoreCreationError,
  ExternalStorageAttachmentStore, storageSupportsAttachments
} from 'app/server/lib/AttachmentStore';
import {
  checkMinIOBucket,
  checkMinIOExternalStorage,
  configureMinIOExternalStorage
} from 'app/server/lib/configureMinIOExternalStorage';
import {BaseCreate, ICreateStorageOptions} from 'app/server/lib/ICreate';
import {Telemetry} from 'app/server/lib/Telemetry';
import {HomeDBManager} from 'app/gen-server/lib/homedb/HomeDBManager';
import {GristServer} from 'app/server/lib/GristServer';
import {UnsupportedPurposeError} from 'app/server/lib/ExternalStorage';

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

  public override getAttachmentStoreOptions() {
    return {
      // 'snapshots' provider uses the ExternalStorage provider set up for doc snapshots for attachments
      snapshots: {
        name: 'snapshots',
        isAvailable: async () => {
          try {
            const storage = this.ExternalStorage('attachments', '');
            return storage ? storageSupportsAttachments(storage) : false;
          } catch(e) {
            if (e instanceof UnsupportedPurposeError) {
              return false;
            }
            throw e;
          }
        },
        create: async (storeId: string) => {
          const storage = this.ExternalStorage('attachments', '');
          // This *should* always pass due to the `isAvailable` check above being run earlier.
          if (!(storage && storageSupportsAttachments(storage))) {
            throw new AttachmentStoreCreationError('snapshots', storeId,
                                                   'External storage does not support attachments');
          }
          return new ExternalStorageAttachmentStore(
            storeId,
            storage,
          );
        }
      }
    };
  }

  public override Telemetry(dbManager: HomeDBManager, gristServer: GristServer) {
    return new Telemetry(dbManager, gristServer);
  }
}
