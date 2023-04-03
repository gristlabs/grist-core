/**
 * Configures grist logging. This is merely a customization of the 'winston' logging module,
 * and all winston methods are available. Additionally provides log.timestamp() function.
 * Usage:
 *    var log = require('./lib/log');
 *    log.info(...);
 */

import {timeFormat} from 'app/common/timeFormat';
import * as winston from 'winston';

interface LogWithTimestamp extends winston.LoggerInstance {
  timestamp(): string;
  // We'd like to log raw json, for convenience of parsing downstream.
  // We have a customization that interferes with meta arguments, and
  // existing log messages that depend on that customization.  For
  // clarity then, we just add "raw" flavors of the primary level
  // methods that pass their object argument through to winston.
  rawError(msg: string, meta: ILogMeta): void;
  rawInfo(msg: string, meta: ILogMeta): void;
  rawWarn(msg: string, meta: ILogMeta): void;
  rawDebug(msg: string, meta: ILogMeta): void;
  origLog(level: string, msg: string, ...args: any[]): void;
}

/**
 * Hack winston to provide a saner behavior with regard to its optional arguments. Winston allows
 * two optional arguments at the end: "meta" (if object) and "callback" (if function). We don't
 * use them, but we do use variable number of arguments as in log.info("foo %s", foo). If foo is
 * an object, winston dumps it in an ugly way, not at all as intended. We fix by always appending
 * {} to the end of the arguments, so that winston sees an empty meta object.
 * We can add support for callback if ever needed.
 */
const origLog = winston.Logger.prototype.log;
winston.Logger.prototype.log = function(level: string, msg: string, ...args: any[]) {
  return origLog.call(this, level, msg, ...args, {});
};

const rawLog = new (winston.Logger)();
const log: LogWithTimestamp = Object.assign(rawLog, {
  timestamp,
  /**
   * Versions of log.info etc that take a meta parameter.  For
   * winston, logs are streams of info objects.  Info objects
   * have two mandatory fields, level and message.  They can
   * have other fields, called "meta" fields.  When logging
   * in json, those fields are added directly to the json,
   * rather than stringified into the message field, which
   * is what we want and why we are adding these variants.
   */
  rawError: (msg: string, meta: ILogMeta) => origLog.call(log, 'error', msg, meta),
  rawInfo: (msg: string, meta: ILogMeta) => origLog.call(log, 'info', msg, meta),
  rawWarn: (msg: string, meta: ILogMeta) => origLog.call(log, 'warn', msg, meta),
  rawDebug: (msg: string, meta: ILogMeta) => origLog.call(log, 'debug', msg, meta),
  origLog,
  add: rawLog.add.bind(rawLog),  // Explicitly pass add method along - otherwise
                                 // there's an odd glitch under Electron.
});

/**
 * Returns the current timestamp as a string in the same format as used in logging.
 */
function timestamp() {
  return timeFormat("A", new Date());
}

const fileTransportOptions = {
  stream: process.stderr,
  level: process.env.GRIST_LOG_LEVEL || 'debug',
  timestamp: log.timestamp,
  colorize: true,
  json: process.env.GRIST_HOSTED_VERSION ? true : false
};

// Configure logging to use console and simple timestamps.
log.add(winston.transports.File, fileTransportOptions);

// Also update the default logger to use the same format.
winston.remove(winston.transports.Console);
winston.add(winston.transports.File, fileTransportOptions);

// It's a little tricky to export a type when the top-level export is an object.
// tslint:disable-next-line:no-namespace
declare namespace log { // eslint-disable-line @typescript-eslint/no-namespace
  interface ILogMeta {
    [key: string]: any;
  }
}
type ILogMeta = log.ILogMeta;

export = log;
