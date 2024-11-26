import { IAttachmentStore } from "app/server/lib/AttachmentStore";
import log from 'app/server/lib/log';

export type AttachmentStoreId = string

export interface IAttachmentStoreProvider {
  // Returns the store associated with the given id, returning null if no store with that id exists.
  getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null>

  getAllStores(): Promise<IAttachmentStore[]>;

  storeExists(id: AttachmentStoreId): Promise<boolean>;
}

export interface IAttachmentStoreSpecification {
  name: string,
  create: (storeId: string) => IAttachmentStore,
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
    return Object.values(this._storeDetailsById).map(storeDetails => storeDetails.spec.create(storeDetails.id));
  }

  public async storeExists(id: AttachmentStoreId): Promise<boolean> {
    return id in this._storeDetailsById;
  }

  public listStoreIds(): string[] {
    return Object.keys(this._storeDetailsById);
  }
}
