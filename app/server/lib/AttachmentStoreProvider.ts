import { FilesystemAttachmentStore, IAttachmentStore } from "./AttachmentStore";

export type AttachmentStoreId = string

export interface IAttachmentStoreProvider {
  // Returns the store associated with the given id
  getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null>

  storeExists(id: AttachmentStoreId): Promise<boolean>;
}

export class AttachmentStoreProvider implements IAttachmentStoreProvider {
  constructor() {
  }

  public async getStore(id: string): Promise<IAttachmentStore | null> {
    return new FilesystemAttachmentStore(id, "/home/spoffy/Downloads/Grist/TEST ATTACHMENTS");
  }

  public async storeExists(id: string): Promise<boolean> {
    return true;
  }
}
