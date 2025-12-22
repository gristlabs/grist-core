import { drainWhenSettled } from 'app/server/utils/streams';
import { ZipArchiveEntry } from 'compress-commons';
import stream from 'node:stream';
import * as tar from 'tar-stream';
import ZipStream, { ZipStreamOptions } from 'zip-stream';

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
  zipOptions: ZipStreamOptions, entries: AsyncIterable<ArchiveEntry>,
): Archive {
  return {
    mimeType: "application/zip",
    fileExtension: "zip",
    async packInto(destination: stream.Writable, options: ArchivePackingOptions = defaultPackingOptions) {
      const archive = new ZipStream(zipOptions);
      const pipeline = stream.promises.pipeline(archive, destination, { end: options.endDestStream });

      // This can hang indefinitely in various error cases (e.g. `destination` stream closes unexpectedly).
      // `pipeline` should still resolve correctly, but none of the code in this block is guaranteed to execute.
      addEntriesToZipArchive(archive, entries)
        .then(() => archive.finish())
        .catch(err => archive.destroy(err));

      // This ensures any errors in the stream (e.g. from destroying it above) are propagated.
      await pipeline;
    },
  };
}

// Asynchronously iterating entries - and trying to add them to the archive.
// Warning: This function may hang indefinitely if the archive stream errors. DO NOT AWAIT IT.
// This is due to the underlying ZipStream "pumping" the entry queue to keep adding entries.
// In some circumstances the callback doesn't fire (e.g. there's a downstream error).
async function addEntriesToZipArchive(archive: ZipStream, entries: AsyncIterable<ArchiveEntry>): Promise<void> {
  // ZipStream will break if multiple entries try to be added at the same time.
  for await (const entry of entries) {
    await addEntryToZipArchive(archive, entry);
  }
}

function addEntryToZipArchive(archive: ZipStream, file: ArchiveEntry): Promise<ZipArchiveEntry | undefined> {
  return new Promise((resolve, reject) => {
    archive.on("error", function(err) {
      reject(new Error(`Archive error: ${err}`, { cause: err }));
    });
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
  entries: AsyncIterable<ArchiveEntry>,
): Archive {
  return {
    mimeType: "application/x-tar",
    fileExtension: "tar",
    async packInto(destination: stream.Writable, options: ArchivePackingOptions = defaultPackingOptions) {
      const archive = tar.pack();
      const passthrough = new stream.PassThrough();
      // 'end' prevents `destination` being closed when completed, or if an error occurs in archive.
      // Passthrough stream is needed as the tar-stream library doesn't implement the 'end' parameter,
      // piping to the passthrough stream fixes this and prevents `destination` being closed.
      const pipeline = stream.promises.pipeline(archive, passthrough, destination,
        { end: options.endDestStream });

      // Zip packing had issues where adding archive entries could hang indefinitely in error states.
      // While that hasn't been observed with .tar archives, this block isn't awaited as a precaution.
      addEntriesToTarArchive(archive, entries)
        .then(() => archive.finalize())
        .catch(err => archive.destroy(err));

      // This ensures any errors in the stream (e.g. from destroying it above) are handled.
      // Without this, node will see the stream as having an uncaught error, and complain or crash.
      await pipeline;
    },
  };
}

async function addEntriesToTarArchive(archive: tar.Pack, entries: AsyncIterable<ArchiveEntry>): Promise<void> {
  // ZipStream will break if multiple entries try to be added at the same time.
  for await (const entry of entries) {
    const entryStream = archive.entry({ name: entry.name, size: entry.size });
    await stream.promises.pipeline(entry.data, entryStream);
  }
}

export interface UnpackedFile {
  path: string;
  data: stream.Readable;
  size: number;
}

export async function unpackTarArchive(
  tarStream: stream.Readable,
  onFile: (file: UnpackedFile) => Promise<void>,
): Promise<void> {
  let resolveFinished = () => {};
  let rejectFinished = (err: any) => {};
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });

  const extractor = tar.extract();

  extractor.on('entry', function(header, contentStream, next) {
    // Ensures contentStream is drained when onFile is finished.
    // Failure to drain contentStream will block the whole extraction.
    drainWhenSettled(contentStream,
      onFile({
        path: header.name,
        data: contentStream,
        // Realistically this should never be undefined - it's mandatory for files in a .tar archive
        size: header.size ?? 0,
      }),
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
