/**
 * Hash a string into an integer. From https://stackoverflow.com/a/7616484/328565.
 */
export function hashCode(str: string): number {
  let hash: number = 0;
  for (let i = 0; i < str.length; i++) {
    // tslint:disable-next-line:no-bitwise
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
