/**
 * Returns a promise that resolves in the given number of milliseconds.
 * (A replica of bluebird.delay using native promises.)
 */
export function delay(msec: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, msec));
}
