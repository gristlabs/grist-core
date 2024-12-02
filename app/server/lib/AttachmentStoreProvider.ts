import { IAttachmentStore } from "app/server/lib/AttachmentStore";
import log from 'app/server/lib/log';

export type AttachmentStoreId = string

/**
 * Creates an {@link IAttachmentStore} from a given store id, if the Grist installation is configured with that store's
 * unique id.
 *
 * Each store represents a specific location to store attachments at, for example a "/attachments" bucket on MinIO,
 * or "/srv/grist/attachments" on the filesystem.
 *
 * Attachments in Grist Documents are accompanied by the id of the store they're in, allowing Grist to store/retrieve
 * them as long as that store exists on the document's installation.
 */
export interface IAttachmentStoreProvider {
  // Returns the store associated with the given id, returning null if no store with that id exists.
  getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null>

  getAllStores(): Promise<IAttachmentStore[]>;

  storeExists(id: AttachmentStoreId): Promise<boolean>;

  listAllStoreIds(): AttachmentStoreId[];
}

export interface IAttachmentStoreSpecification {
  name: string,
  create: (storeId: string) => Promise<IAttachmentStore>,
}

interface IAttachmentStoreDetails {
  id: string;
  spec: IAttachmentStoreSpecification;
}

export class AttachmentStoreProvider implements IAttachmentStoreProvider {
  private _storeDetailsById: { [storeId: string]: IAttachmentStoreDetails } = {};

  constructor(
    _backends: IAttachmentStoreSpecification[],
    _installationUuid: string
  ) {
    // In the current setup, we automatically generate store IDs based on the installation ID.
    // The installation ID is guaranteed to be unique, and we only allow one store of each backend type.
    // This gives us a way to reproducibly generate a unique ID for the stores.
    _backends.forEach((storeSpec) => {
      const storeId = `${_installationUuid}-${storeSpec.name}`;
      this._storeDetailsById[storeId] = {
        id: storeId,
        spec: storeSpec,
      };
    });

    const storeIds = Object.values(this._storeDetailsById).map(storeDetails => storeDetails.id);
    log.info(`AttachmentStoreProvider initialised with stores: ${storeIds}`);
  }

  public async getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null> {
    const storeDetails = this._storeDetailsById[id];
    if (!storeDetails) { return null; }
    return storeDetails.spec.create(id);
  }

  public async getAllStores(): Promise<IAttachmentStore[]> {
    return await Promise.all(
      Object.values(this._storeDetailsById).map(storeDetails => storeDetails.spec.create(storeDetails.id))
    );
  }

  public async storeExists(id: AttachmentStoreId): Promise<boolean> {
    return id in this._storeDetailsById;
  }

  public listAllStoreIds(): string[] {
    return Object.keys(this._storeDetailsById);
  }
}
