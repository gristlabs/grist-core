/**
 * Functions to convert between an array of bytes and a string. The implementations are
 * different for Node and for the browser.
 */

declare const TextDecoder: any, TextEncoder: any;

export let arrayToString: (data: Uint8Array) => string;
export let stringToArray: (data: string) => Uint8Array;

if (typeof TextDecoder !== 'undefined') {
  // Note that constructing a TextEncoder/Decoder takes time, so it's faster to reuse.
  const dec = new TextDecoder('utf8');
  const enc = new TextEncoder('utf8');
  arrayToString = function(uint8Array: Uint8Array): string {
    return dec.decode(uint8Array);
  };
  stringToArray = function(str: string): Uint8Array {
    return enc.encode(str);
  };
} else {
  arrayToString = function(uint8Array: Uint8Array): string {
    return Buffer.from(uint8Array).toString('utf8');
  };
  stringToArray = function(str: string): Uint8Array {
    return new Uint8Array(Buffer.from(str, 'utf8'));
  };
}
