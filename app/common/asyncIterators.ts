/**
 * Just some basic utilities for async generators that should really be part of the language or lodash or something.
 */

export async function* asyncFilter<T>(it: AsyncIterableIterator<T>, pred: (x: T) => boolean): AsyncIterableIterator<T> {
  for await (const x of it) {
    if (pred(x)) {
      yield x;
    }
  }
}

export async function* asyncMap<T, R>(it: AsyncIterableIterator<T>, mapper: (x: T) => R): AsyncIterableIterator<R> {
  for await (const x of it) {
    yield mapper(x);
  }
}

export async function toArray<T>(it: AsyncIterableIterator<T>): Promise<T[]> {
  const result = [];
  for await (const x of it) {
    result.push(x);
  }
  return result;
}
