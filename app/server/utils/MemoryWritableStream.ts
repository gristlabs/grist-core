import {Writable} from 'stream';

// Creates a writable stream that can be retrieved as a buffer.
// Sub-optimal implementation, as we end up with *at least* two copies in memory one in `buffers`,
// and one produced by `Buffer.concat` at the end.
export class MemoryWritableStream extends Writable {
  private _buffers: Buffer[] = [];

  public getBuffer(): Buffer {
    return Buffer.concat(this._buffers);
  }

  public _write(chunk: any, encoding: BufferEncoding, callback: (error?: (Error | null)) => void) {
    if (typeof (chunk) == "string") {
      this._buffers.push(Buffer.from(chunk, encoding));
    } else {
      this._buffers.push(chunk);
    }
    callback();
  }
}
