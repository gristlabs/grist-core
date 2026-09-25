/**
 * Configures grist logging. This is merely a customization of the 'winston' logging module,
 * and all winston methods are available. Additionally provides log.timestamp() function.
 * Usage:
 *    import log from 'app/server/lib/log';
 *    log.info(...);
 */

import { isAffirmative } from "app/common/gutil";
import { timeFormat } from "app/common/timeFormat";
import { appSettings } from "app/server/lib/AppSettings";

import * as winston from "winston";

const logAsJson = appSettings.section("log").flag("json").readBool({
  envVar: ["GRIST_LOG_AS_JSON", "GRIST_HOSTED_VERSION"],
  preferredEnvVar: "GRIST_LOG_AS_JSON",
  defaultValue: false,
});

// GRIST_LOG_LEVEL sets the level. Without it, default to info, or to debug when running with
// DEBUG or VERBOSE set (a developer convenience).
const debugging = isAffirmative(process.env.DEBUG) || isAffirmative(process.env.VERBOSE);
const logLevel = appSettings.section("log").flag("level").requireString({
  envVar: "GRIST_LOG_LEVEL",
  defaultValue: debugging ? "debug" : "info",
  acceptedValues: ["debug", "info", "warn", "error"],
});

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
  rawError: (msg: string, meta: ILogMeta) => origLog.call(log, "error", msg, meta),
  rawInfo: (msg: string, meta: ILogMeta) => origLog.call(log, "info", msg, meta),
  rawWarn: (msg: string, meta: ILogMeta) => origLog.call(log, "warn", msg, meta),
  rawDebug: (msg: string, meta: ILogMeta) => origLog.call(log, "debug", msg, meta),
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
  level: logLevel,
  timestamp: log.timestamp,
  colorize: true,
  json: logAsJson,
};

// Configure logging to use console and simple timestamps.
log.add(winston.transports.File, fileTransportOptions);

// Also update the default logger to use the same format.
winston.remove(winston.transports.Console);
winston.add(winston.transports.File, fileTransportOptions);

// It's a little tricky to export a type when the top-level export is an object.
declare namespace log {
  interface ILogMeta {
    [key: string]: any;
  }
}
export type ILogMeta = log.ILogMeta;

/**
 * Coercions for untrusted values (request bodies, client messages) that go into log meta.
 * Each JSON log field must keep a single type for log indexing to work; these keep it that way.
 * A value of the wrong type is dropped (undefined), except that anything can be described as a string.
 */
export const metaField = {
  string: (value: unknown): string | undefined => (value === undefined ? undefined : String(value)),
  number: (value: unknown): number | undefined => (typeof value === "number" ? value : undefined),
  object: (value: unknown): object | undefined => (value && typeof value === "object" ? value : undefined),
};

export { logAsJson, logLevel };
export default log;
