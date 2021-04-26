// tslint:disable:max-line-length
// credits: https://stackoverflow.com/questions/49998665/promisified-function-type

// Generic Function definition
type AnyFunction = (...args: any[]) => any;

// Extracts the type if wrapped by a Promise
type Unpacked<T> = T extends Promise<infer U> ? U : T;

type PromisifiedFunction<T extends AnyFunction> =
  T extends () => infer U ? () => Promise<Unpacked<U>> :
  T extends (a1: infer A1) => infer U ? (a1: A1) => Promise<Unpacked<U>> :
  T extends (a1: infer A1, a2: infer A2) => infer U ? (a1: A1, a2: A2) => Promise<Unpacked<U>> :
  T extends (a1: infer A1, a2: infer A2, a3: infer A3) => infer U ? (a1: A1, a2: A2, a3: A3) => Promise<Unpacked<U>> :
  T extends (a1: infer A1, a2: infer A2, a3: infer A3, a4: infer A4) =>
    infer U ? (a1: A1, a2: A2, a3: A3, a4: A4) => Promise<Unpacked<U>> :
  // ...
  T extends (...args: any[]) => infer U ? (...args: any[]) => Promise<Unpacked<U>> : T;

/**
 * `Promisified<T>` has the same methods as `T` but they all return promises. This is useful when
 * creating a stub with `grain-rpc` for an api which is synchronous.
 */
export type Promisified<T> = {
  [K in keyof T]: T[K] extends AnyFunction ? PromisifiedFunction<T[K]> : never
};
