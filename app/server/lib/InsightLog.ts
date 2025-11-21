/**
 * Helper to get insight into what's happening in complex calls, e.g. applyUserActions. It helps
 * to collect metadata for a log message, and timestamps of stages, and logs them all at once.
 *
 * To use, decorate a method, then use insightLogEntry() within it.
 *    @insightLogDecorate("ClassName")
 *    public async myMethod(...) {
 *      const insightLog = insightLogEntry();
 *      insightLog?.mark("foo");
 *      insightLog?.addMeta({docId, email, custom});
 *      insightLog?.mark("bar");
 *    }
 *
 * All the collected data will be logged with "ClassName myMethod done" message  when the async
 * method resolves (or rejects). In addition, if the method is running for longer than 5000 ms
 * (configurable via the second argument to insightLogDecorate), it will be logged with "ClassName
 * myMethod running" message.
 *
 * In case of nested decorated calls, only the entry for the outermost one is filled in and logged.
 */

import log from 'app/server/lib/log';
import {AsyncLocalStorage} from 'node:async_hooks';

const asyncLocalStorage = new AsyncLocalStorage<InsightLogEntry>();

export function insightLogDecorate(prefix: string, logIfLongerThanMs: number = 5000) {
  return function decorate(target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
    const origFunc = descriptor.value;
    descriptor.value = async function(this: unknown) {
      const callback = () => origFunc.apply(this, arguments);
      // If already within a decorated call, pass through seamlessly to the decorated function.
      if (asyncLocalStorage.getStore()) {
        return callback();
      }
      return insightLogWrap(`${prefix} ${propertyKey}`, callback, logIfLongerThanMs);
    };
  };
}

export async function insightLogWrap<T>(
  prefix: string, callback: () => Promise<T>, logIfLongerThanMs: number = 5000
): Promise<T> {
  const entry = new InsightLogEntry();
  const timer = setTimeout(() => log.rawInfo(`${prefix} running`, entry.getMeta()), logIfLongerThanMs);
  try {
    return await asyncLocalStorage.run(entry, callback);
  } finally {
    clearTimeout(timer);
    entry.mark("end");
    log.rawInfo(`${prefix} done`, entry.getMeta());
  }
}

export function insightLogEntry(): InsightLogEntry|undefined {
  return asyncLocalStorage.getStore();
}

class InsightLogEntry {
  private _start = Date.now();
  private _meta: log.ILogMeta = {
    startTs: this._start,
    start: new Date(this._start).toISOString(),
  };

  // Add a property "mark_{label}" with the ms elapsed since start.
  public mark(label: string) {
    this._meta['mark_' + label] = Date.now() - this._start;
  }

  // Add some more metadata properties to the message to be logged.
  public addMeta(values: log.ILogMeta) {
    Object.assign(this._meta, values);
  }

  public getMeta(): log.ILogMeta {
    return this._meta;
  }
}
