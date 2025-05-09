import {drainWhenSettled} from 'app/server/utils/streams';
import {ZipArchiveEntry} from 'compress-commons';
import stream from 'node:stream';
import * as tar from 'tar-stream';
import ZipStream, {ZipStreamOptions} from 'zip-stream';

export interface ArchiveEntry {
  name: string;
  size: number;
  data: stream.Readable | Buffer;
}

export interface ArchivePackingOptions {
  // Whether the destination stream should be closed once the archive has been written.
  endDestStream: boolean;
}

const defaultPackingOptions: ArchivePackingOptions = {
  endDestStream: true,
};

export interface Archive {
  mimeType: string;
  fileExtension: string;
  /**
   * Starts packing files into the archive.
   * This will block indefinitely if the data stream is never read from.
   * This resolves when all files are processed, or an error occurs.
   * @returns {Promise<void>}
   */
  packInto: (destination: stream.Writable, options?: ArchivePackingOptions) => Promise<void>;
}

/**
 *
 * Creates a streamable zip archive, reading files on-demand from the entries iterator.
 * Entries are provided as an async iterable, to ensure the archive is constructed
 * correctly. A generator can be used for convenience.
 * @param {ZipStreamOptions} zipOptions - Settings for the zip archive
 * @param {AsyncIterable<ArchiveEntry>} entries - Entries to add.
 * @returns {Archive}
 */
export function create_zip_archive(
  zipOptions: ZipStreamOptions, entries: AsyncIterable<ArchiveEntry>
): Archive {
  return {
    mimeType: "application/zip",
    fileExtension: "zip",
    async packInto(destination: stream.Writable, options: ArchivePackingOptions = defaultPackingOptions) {
      const archive = new ZipStream(zipOptions);
      let pipeline: Promise<void> | undefined;
      try {
        // `as any` cast required with @types/node 18.X due to the `end` parameter missing from the type declaration.
        pipeline = stream.promises.pipeline(archive, destination, { end: options.endDestStream } as any);
        for await (const entry of entries) {
          // ZipStream will break if multiple entries try to be added at the same time.
          await addEntryToZipArchive(archive, entry);
        }
        archive.finish();
      } catch (error) {
        archive.destroy(error);
      } finally {
        // This ensures any errors in the stream (e.g. from destroying it above) are handled.
        // Without this, node will see the stream as having an uncaught error, and complain or crash.
        await pipeline;
      }
    }
  };
}

function addEntryToZipArchive(archive: ZipStream, file: ArchiveEntry): Promise<ZipArchiveEntry | undefined> {
  return new Promise((resolve, reject) => {
    archive.entry(file.data, { name: file.name }, function(err, entry) {
      if (err) {
        return reject(err);
      }
      return resolve(entry);
    });
  });
}

/**
 *
 * Creates a streamable tar archive, reading files on-demand from the entries iterator.
 * Entries are provided as an async iterable, to ensure the archive is constructed
 * correctly. A generator can be used for convenience.
 * @param {AsyncIterable<ArchiveEntry>} entries - Entries to add.
 * @returns {Archive}
 */
export function create_tar_archive(
  entries: AsyncIterable<ArchiveEntry>
): Archive {
  return {
    mimeType: "application/x-tar",
    fileExtension: "tar",
    async packInto(destination: stream.Writable, options: ArchivePackingOptions = defaultPackingOptions) {
      const archive = tar.pack();
      const passthrough = new stream.PassThrough();
      let pipeline: Promise<void> | undefined;
      try {
        // 'end' prevents `destination` being closed when completed, or if an error occurs in archive.
        // Passthrough stream is needed as the tar-stream library doesn't implement the 'end' parameter,
        // piping to the passthrough stream fixes this and prevents `destination` being closed.
        // Cast is required due to a bug with @types/node 18.X missing the parameter
        pipeline = stream.promises.pipeline(archive, passthrough, destination, { end: options.endDestStream } as any);
        for await (const entry of entries) {
          const entryStream = archive.entry({ name: entry.name, size: entry.size });
          await stream.promises.pipeline(entry.data, entryStream);
        }
        archive.finalize();
      } catch (error) {
        archive.destroy(error);
      } finally {
        // This ensures any errors in the stream (e.g. from destroying it above) are handled.
        // Without this, node will see the stream as having an uncaught error, and complain or crash.
        await pipeline;
      }
    }
  };
}

export interface UnpackedFile {
  path: string;
  data: stream.Readable;
}

export async function unpackTarArchive(
  tarStream: stream.Readable,
  onFile: (file: UnpackedFile) => Promise<void>
): Promise<void> {
  let resolveFinished = () => {};
  let rejectFinished = (err: any) => {};
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const extractor = tar.extract();

  extractor.on('entry', function (header, contentStream, next) {
    // Ensures contentStream is drained when onFile is finished.
    // Failure to drain contentStream will block the whole extraction.
    drainWhenSettled(contentStream,
      onFile({
        path: header.name,
        data: contentStream,
      })
      // No sensible behaviour when an error is thrown by onFile - it's onFile's responsibility
      // to handle it.
    ).catch(() => {})
     .finally(() => { next(); });
  });

  extractor.on('error', (err: any) => { rejectFinished(err); });
  extractor.on('finish', () => { resolveFinished(); });

  tarStream.pipe(extractor);

  return finished;
}
