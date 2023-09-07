/**
 * Overview of Excel exports, which now use worker-threads.
 *
 * 1. The flow starts with the streamXLSX() method called in the main thread.
 * 2. It uses the 'piscina' library to call a makeXLSX* method in a worker thread, registered in
 *    workerExporter.ts, to export full doc, a table, or a section.
 * 3. Each of those methods calls a doMakeXLSX* method defined in that file. I.e. downloadXLSX()
 *    is called in the main thread, but makeXLSX() and doMakeXLSX() are called in the worker thread.
 * 4. doMakeXLSX* methods get data using an ActiveDocSource, which uses Rpc (from grain-rpc
 *    module) to request data over a message port from the ActiveDoc in the main thread.
 * 5. The resulting stream of Excel data is streamed back to the main thread using Rpc too.
 */
import {ActiveDoc} from 'app/server/lib/ActiveDoc';
import {ActiveDocSource, ActiveDocSourceDirect, ExportParameters} from 'app/server/lib/Export';
import log from 'app/server/lib/log';
import {addAbortHandler} from 'app/server/lib/requestUtils';
import * as express from 'express';
import {Rpc} from 'grain-rpc';
import {AbortController} from 'node-abort-controller';
import {Writable} from 'stream';
import {MessageChannel} from 'worker_threads';
import Piscina from 'piscina';

// If this file is imported from within a worker thread, we'll create more thread pools from each
// thread, with a potential for an infinite loop of doom. Better to catch that early.
if (Piscina.isWorkerThread) {
  throw new Error("ExportXLSX must not be imported from within a worker thread");
}

// Configure the thread-pool to use for exporting XLSX files.
const exportPool = new Piscina({
  filename: __dirname + '/workerExporter.js',
  minThreads: 0,
  maxThreads: 4,
  maxQueue: 100,          // Fail if this many tasks are already waiting for a thread.
  idleTimeout: 10_000,    // Drop unused threads after 10s of inactivity.
});

/**
 * Converts `activeDoc` to XLSX and sends to the given outputStream.
 */
export async function streamXLSX(activeDoc: ActiveDoc, req: express.Request,
                                 outputStream: Writable, options: ExportParameters) {
  log.debug(`Generating .xlsx file`);
  const testDates = (req.hostname === 'localhost');

  const { port1, port2 } = new MessageChannel();
  try {
    const rpc = new Rpc({
      sendMessage: async (m) => port1.postMessage(m),
      logger: { info: m => {}, warn: m => log.warn(m) },
    });
    rpc.registerImpl<ActiveDocSource>("activeDocSource", new ActiveDocSourceDirect(activeDoc, req));
    rpc.on('message', (chunk) => { outputStream.write(chunk); });
    port1.on('message', (m) => rpc.receiveMessage(m));

    // For request cancelling to work, remember that such requests are forwarded via DocApiForwarder.
    const abortController = new AbortController();
    const cancelWorker = () => abortController.abort();

    // When the worker thread is done, it closes the port on its side, and we listen to that to
    // end the original request (the incoming HTTP request, in case of a download).
    port1.on('close', () => {
      outputStream.end();
      req.off('close', cancelWorker);
    });

    addAbortHandler(req, outputStream, cancelWorker);

    const run = (method: string, ...args: any[]) => exportPool.run({port: port2, testDates, args}, {
      name: method,
      signal: abortController.signal,
      transferList: [port2],
    });

    // hanlding 3 cases : full XLSX export (full file), view xlsx export, table xlsx export
    try {
      await run('makeXLSXFromOptions', options);
      log.debug('XLSX file generated');
    } catch (e) {
      // We fiddle with errors in workerExporter to preserve extra properties like 'status'. Make
      // the result an instance of Error again here (though we won't know the exact class).
      throw (e instanceof Error) ? e : Object.assign(new Error(e.message), e);
    }
  } finally {
    port1.close();
    port2.close();
  }
}

