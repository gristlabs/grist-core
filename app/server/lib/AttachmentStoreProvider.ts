import { IAttachmentStore } from "./AttachmentStore";

export type AttachmentStoreId = string

export interface IAttachmentStoreProvider {
  // Returns the store associated with the given id
  getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null>

  storeExists(id: AttachmentStoreId): Promise<boolean>;
}

export interface IAttachmentStoreBackendFactory {
  name: string,
  create: () => IAttachmentStore | undefined,
}

interface IAttachmentStoreDetails {
  id: string;
  factory: IAttachmentStoreBackendFactory;
}

export class AttachmentStoreProvider implements IAttachmentStoreProvider {
  private _storeDetailsById: { [storeId: string]: IAttachmentStoreDetails } = {};

  constructor(
    _backendFactories: IAttachmentStoreBackendFactory[],
    _installationUuid: string
  ) {
    // In the current setup, we automatically generate store IDs based on the installation ID.
    // The installation ID is guaranteed to be unique, and we only allow one store of each backend type.
    // This gives us a way to reproducibly generate a unique ID for the stores.
    _backendFactories.forEach((factory) => {
      const storeId = `${_installationUuid}-${factory.name}`;
      this._storeDetailsById[storeId] = {
        id: storeId,
        factory,
      };
    });
  }

  public async getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null> {
    const storeDetails = this._storeDetailsById[id];
    if (!storeDetails) { return null; }
    return storeDetails.factory.create() || null;
  }

  public async storeExists(id: AttachmentStoreId): Promise<boolean> {
    return id in this._storeDetailsById;
  }

  public listStoreIds(): string[] {
    return Object.keys(this._storeDetailsById);
  }
}
