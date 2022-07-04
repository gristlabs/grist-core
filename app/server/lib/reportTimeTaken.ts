import log from 'app/server/lib/log';

export function reportTimeTaken<T>(locationLabel: string, callback: () => T): T {
  const start = Date.now();
  try {
    return callback();
  } finally {
    const timeTaken = Date.now() - start;
    log.debug("Time taken in %s: %s ms", locationLabel, timeTaken);
  }
}
