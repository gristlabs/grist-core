import { AttachmentFile } from "./AttachmentStore";

/**
 * Interface for a provider that can scan attachments for viruses.
 */
export interface IAttachmentVirusScanProvider {
    scanAttachment(attachmentFile: AttachmentFile): Promise<boolean>;
}

export class TestAttachmentVirusScanProvider implements IAttachmentVirusScanProvider {
    scanAttachment(attachmentFile: AttachmentFile): Promise<boolean> {
        return Promise.resolve(attachmentFile.metadata.size < 1000);
    }
}