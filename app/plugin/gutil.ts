import constant = require('lodash/constant');
import times = require('lodash/times');

/**
 * Returns a new array of length count, filled with the given value.
 */
export function arrayRepeat<T>(count: number, value: T): T[] {
  return times(count, constant(value));
}

export type MaybePromise<T> = T | Promise<T>;
