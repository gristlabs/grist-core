/**
 * Client-side debug logging.
 * At the moment this simply logs to the browser console, but it's still useful to have dedicated
 * methods to allow collecting them in the future, or silencing them in production or in mocha
 * tests.
 */

export type LogMethod = (message: string, ...args: any[]) => void;

// tslint:disable:no-console
export const debug: LogMethod = console.debug.bind(console);
export const info: LogMethod = console.info.bind(console);
export const log: LogMethod = console.log.bind(console);
export const warn: LogMethod = console.warn.bind(console);
export const error: LogMethod = console.error.bind(console);
