import log from 'app/server/lib/log';

export type ILogMeta = log.ILogMeta;

/**
 * Helper for logging with metadata. The created object has methods similar to those of the `log`
 * module, but with an extra required first argument. The produced messages get metadata produced
 * by the constructor callback applied to that argument, and the specified prefix.
 *
 * Usage:
 *    _log = new LogMethods(prefix, (info) => ({...logMetadata...}))
 *    _log.info(info, "hello %", name);
 *    _log.warn(info, "hello %", name);
 *    etc.
 */
export class LogMethods<Info> {
  constructor(
    private _prefix: string,
    private _getMeta: (info: Info) => log.ILogMeta,
  ) {}

  public debug(info: Info, msg: string, ...args: any[]) { this.log('debug', info, msg, ...args); }
  public info(info: Info, msg: string, ...args: any[]) { this.log('info', info, msg, ...args); }
  public warn(info: Info, msg: string, ...args: any[]) { this.log('warn', info, msg, ...args); }
  public error(info: Info, msg: string, ...args: any[]) { this.log('error', info, msg, ...args); }

  public log(level: string, info: Info, msg: string, ...args: any[]): void {
    log.origLog(level, this._prefix + msg, ...args, this._getMeta(info));
  }

  // Log with the given level, and include the provided log metadata in addition to that produced
  // by _getMeta(info).
  public rawLog(level: string, info: Info, msg: string, meta: ILogMeta): void {
    log.origLog(level, this._prefix + msg, {...this._getMeta(info), ...meta});
  }
}
