/**
 * A version of Function.bind() that preserves types.
 */

// tslint:disable:max-line-length

// Bind just the context for a function of up to 4 args.
export function tbind<T, R, Args extends any[]>(func: (this: T, ...a: Args) => R, context: T): (...a: Args) => R;

// Bind context and first arg for a function of up to 5 args.
export function tbind<T, R, X, Args extends any[]>(
  func: (this: T, x: X, ...a: Args) => R, context: T, x: X
): (...a: Args) => R;

export function tbind(func: any, context: any, ...boundArgs: any[]): any {
  return func.bind(context, ...boundArgs);
}
