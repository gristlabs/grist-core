import {PassThrough} from 'stream';
import {ActiveDocSource} from 'app/server/lib/Export';
import * as ExportXLSX from 'app/server/lib/ExportXLSX';
import * as log from 'app/server/lib/log';
import {Rpc} from 'grain-rpc';
import {Stream} from 'stream';
import {MessagePort, threadId} from 'worker_threads';

export const makeXLSX = handleExport(ExportXLSX.makeXLSX);
export const makeXLSXFromTable = handleExport(ExportXLSX.makeXLSXFromTable);
export const makeXLSXFromViewSection = handleExport(ExportXLSX.makeXLSXFromViewSection);

function handleExport<T extends any[]>(
  make: (a: ActiveDocSource, testDates: boolean, output: Stream, ...args: T) => Promise<void>
) {
  return async function({port, testDates, args}: {port: MessagePort, testDates: boolean, args: T}) {
    try {
      const start = Date.now();
      log.debug("workerExporter %s %s: started", threadId, make.name);
      const rpc = new Rpc({
        sendMessage: async (m) => port.postMessage(m),
        logger: { info: m => {}, warn: m => log.warn(m) },
      });
      const activeDocSource = rpc.getStub<ActiveDocSource>("activeDocSource");
      port.on('message', (m) => rpc.receiveMessage(m));
      const outputStream = new PassThrough();
      bufferedPipe(outputStream, (chunk) => rpc.postMessage(chunk));
      await make(activeDocSource, testDates, outputStream, ...args);
      port.close();
      log.debug("workerExporter %s %s: done in %s ms", threadId, make.name, Date.now() - start);
    } catch (e) {
      log.debug("workerExporter %s %s: error %s", threadId, make.name, String(e));
      // When Error objects move across threads, they keep only the 'message' property. We can
      // keep other properties (like 'status') if we throw a plain object instead. (Didn't find a
      // good reference on this, https://github.com/nodejs/node/issues/35506 is vaguely related.)
      throw {message: e.message, ...e};
    }
  };
}

// ExcelJS's WorkbookWriter produces many tiny writes (even though they pass through zipping). To
// reduce overhead and context switching, buffer them and pass on in chunks. (In practice, this
// helps performance only slightly.)
function bufferedPipe(stream: Stream, callback: (chunk: Buffer) => void, threshold = 64*1024) {
  let buffers: Buffer[] = [];
  let length = 0;
  let flushed = 0;

  function flush() {
    if (length > 0) {
      const data = Buffer.concat(buffers);
      flushed += data.length;
      callback(data);
      buffers = [];
      length = 0;
    }
  }

  stream.on('data', (chunk) => {
    // Whenever data is written to the stream, add it to the buffer.
    buffers.push(chunk);
    length += chunk.length;
    // If the buffer is large enough, post it to the callback. Also post the very first chunk:
    // since this becomes an HTTP response, a quick first chunk lets the browser prompt the user
    // more quickly about what to do with the download.
    if (length >= threshold || flushed === 0) {
      flush();
    }
  });

  stream.on('end', flush);
}
