import {StringUnion} from 'app/common/StringUnion';
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

export interface Archive {
  mimeType: string;
  fileExtension: string;
  /**
   * Starts packing files into the archive.
   * This will block indefinitely if dataStream is never read from.
   * This resolves when all files are processed, or an error occurs.
   * This will not close the destination stream. This is to allow the caller to decide how to handle
   * error situations.
   * @returns {Promise<void>}
   */
  packInto: (destination: stream.Writable) => Promise<void>;
}

export const CreatableArchiveFormats = StringUnion('zip', 'tar');
export type CreatableArchiveFormats = typeof CreatableArchiveFormats.type;

/**
 *
 * Creates a streamable zip archive, reading files on-demand from the entries iterator.
 * Entries are provided as an async iterable, to ensure the archive is constructed
 * correctly. A generator can be used for convenience.
 * @param {ZipStreamOptions} options - Settings for the zip archive
 * @param {AsyncIterable<ArchiveEntry>} entries - Entries to add.
 * @returns {Archive}
 */
export async function create_zip_archive(
  options: ZipStreamOptions, entries: AsyncIterable<ArchiveEntry>
): Promise<Archive> {
  const archive = new ZipStream(options);

  return {
    mimeType: "application/zip",
    fileExtension: "zip",
    async packInto(destination: stream.Writable) {
      try {
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
        await stream.promises.finished(archive);
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
export async function create_tar_archive(
  entries: AsyncIterable<ArchiveEntry>
): Promise<Archive> {
  return {
    mimeType: "application/x-tar",
    fileExtension: "tar",
    async packInto(destination: stream.Writable) {
      const archive = tar.pack();
      const passthrough = new stream.PassThrough();
      let pipeline: Promise<void> | undefined = undefined;
      try {
        // 'end' prevents `destination` being closed when completed, or if an error occurs in archive.
        // This is necessary to allow for partial/failed downloads (see DocAPI archive for more details).
        // Passthrough stream is needed as the tar-stream library doesn't implement the 'end' parameter,
        // piping to the passthrough stream fixes this and prevents `destination` being closed.
        pipeline = stream.promises.pipeline(archive, passthrough, destination, { end: false } as any);
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
