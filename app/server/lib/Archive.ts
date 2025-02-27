import {ZipArchiveEntry} from 'compress-commons';
import stream from 'node:stream';
import ZipStream, {ZipStreamOptions} from 'zip-stream';

export interface ArchiveEntry {
  name: string;
  data: stream.Readable | Buffer;
}

export interface Archive {
  dataStream: stream.Readable;
  completed: Promise<void>;
}

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
    dataStream: archive,
    // TODO - Should we add a default 'catch' here that logs errors?
    completed: (async () => {
      try {
        for await (const entry of entries) {
          // ZipStream will break if multiple entries try to be added at the same time.
          await addEntryToZipArchive(archive, entry);
        }
        archive.finish();
      } catch (error) {
        archive.destroy(error);
      } finally {
        // If the stream was destroyed with an error, this will re-throw the error we caught above.
        // Without this, node will see the stream as having an uncaught error, and complain.
        await stream.promises.finished(archive);
      }
    })()
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
