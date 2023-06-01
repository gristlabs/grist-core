/**
 * A sanitizer interface that provides methods to sanitize log entries.
 */
interface ISanitizer {
  /**
   * Sanitizes the provided log entry. Should be called only if canSanitize returns true.
   * @param {any} entry - The log entry to sanitize.
   * @returns {any} The sanitized log entry.
   */
  sanitize(entry: any): any;

  /**
   * Checks if the sanitizer can handle the given log entry.
   * @param {any} entry - The log entry to check.
   * @returns {boolean} True if the sanitizer can handle the log entry, false otherwise.
   */
  canSanitize(entry: any): boolean;
}

/**
 * A log sanitizer class that sanitizes logs to avoid leaking sensitive/private data.
 * only the first applicable sanitizer (as determined by canSanitize) will be applied
 * Currently, it is hardcoded to sanitize only logs from Redis rpush command.
 */
export class LogSanitizer {
  private _sanitizers: ISanitizer[] = [
    new RedisSanitizer(),
  ];

  /**
   * Sanitizes the provided log entry using a predefined set of sanitizers.
   * @param {any} log - The log entry to sanitize.
   * @returns {any} The sanitized log entry.
   */
  public sanitize(log: any): any {
    for (const sanitizer of this._sanitizers) {
      if (sanitizer.canSanitize(log)) {
        return sanitizer.sanitize(log);
      }
    }
    return log;
  }
}

/**
 * A sanitizer implementation for Redis logs.
 */
class RedisSanitizer implements ISanitizer {
  /**
   * Sanitizes the Redis log entry by replacing sensitive data in the payload with "[sanitized]".
   * @param {any} entry - The Redis log entry to sanitize.
   * @returns {any} The sanitized Redis log entry.
   */
  public sanitize(entry: any): any {
    // REDIS log structure looks like this: the first arg is the name of the queue,
    // and the rest are the data that was pushed to the queue. Therefore, we are omitting the first arg.
    for (let i = 1; i < entry.args.length; i++) {
      let arg = entry.args[i];
      let parsedArg: any = null;
      parsedArg = JSON.parse(arg);
      if (parsedArg?.payload) {
        parsedArg.payload = "[sanitized]";
      }
      arg = JSON.stringify(parsedArg);
      entry.args[i] = arg;
    }
    return entry;
  }

  /**
   * Checks if the given log entry corresponds to a Redis rpush command.
   * @param {any} entry - The log entry to check.
   * @returns {boolean} True if the log entry is a Redis rpush command, false otherwise.
   */
  public canSanitize(entry: any): boolean {
    // We are only interested in rpush commands
    return (
      typeof entry === "object" &&
      entry.command?.toLowerCase() === "rpush".toLowerCase() &&
      entry.args &&
      Array.isArray(entry.args)
    );
  }
}
