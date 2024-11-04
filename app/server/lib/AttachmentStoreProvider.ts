import { IAttachmentStore } from "./AttachmentStore";

export type AttachmentStoreId = string

export interface IAttachmentStoreProvider {
  // Returns the store associated with the given id
  getStore(id: AttachmentStoreId): Promise<IAttachmentStore | null>

  storeExists(id: AttachmentStoreId): Promise<boolean>;
}

/*
export class AttachmentStoreProvider implements IAttachmentStoreProvider {
  constructor() {
  }

  public getStore(id: string): Promise<IAttachmentStore | null> {

  }

  public storeExists(id: string): Promise<boolean> {

  }
}
*/
