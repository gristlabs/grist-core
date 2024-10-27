import { DocStorage } from "app/server/lib/DocStorage";
import { checksumFileStream } from "app/server/lib/checksumFile";
import { Readable } from "node:stream";

export interface IAttachmentFileManager {
  addFile(fileExtension: string, fileData: Buffer): Promise<AddFileResult>;
}

export interface AddFileResult {
  fileIdent: string;
  alreadyExisted: boolean;
}

export class AttachmentFileManager implements IAttachmentFileManager {
  constructor(private _docStorage: DocStorage) {}

  public async addFile(fileExtension: string, fileData: Buffer): Promise<AddFileResult> {
    const checksum = await checksumFileStream(Readable.from(fileData));
    const fileIdent = `${checksum}${fileExtension}`;
    const existed = await this._docStorage.findOrAttachFile(fileIdent, fileData);

    return {
      fileIdent,
      alreadyExisted: existed,
    };
  }

  public async getFileData(fileIdent: string): Promise<Buffer> {
    return await this._docStorage.getFileData(fileIdent);
  }
}
