export type DocPoolId = string;
type AttachmentId = string;


/**
 * Provides access to external storage, specifically for storing attachments.
 *
 * Attachments are stored in a "Document Pool", which is used to manage the attachments' lifecycle.
 * Typically a document's trunk id should be used for this if available, or the document's id if it isn't.
 *
 * This is a general-purpose interface that should abstract over many different storage providers,
 * so shouldn't have methods which rely on one the features of one specific provider.
 *
 * This is distinct from `ExternalStorage`, in that it's more generic and doesn't support versioning.
 */
export interface IAttachmentStore {
  // Check if attachment exists in the store.
  exists(docPoolId: DocPoolId, attachmentId: AttachmentId): Promise<boolean>;

  // Upload attachment to the store.
  upload(docPoolId: DocPoolId, attachmentId: AttachmentId, fileData: Buffer): Promise<void>;

  // Download attachment to an in-memory buffer
  download(docPoolId: DocPoolId, attachmentId: AttachmentId): Promise<Buffer>;

  // Remove attachments for all documents in the given document pool.
  removePool(docPoolId: DocPoolId): Promise<void>;

  // Close the storage object.
  close(): Promise<void>;
}

