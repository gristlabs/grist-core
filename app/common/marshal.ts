/**
 * Module for serializing data in the format of Python 'marshal' module. It's used for
 * communicating with the Python-based formula engine running in a Pypy sandbox. It supports
 * version 0 of python marshalling format, which is what the Pypy sandbox supports.
 *
 * Usage:
 *    Marshalling:
 *      const marshaller = new Marshaller({version: 2});
 *      marshaller.marshal(value);
 *      marshaller.marshal(value);
 *      const buf = marshaller.dump();    // Leaves the marshaller empty.
 *
 *    Unmarshalling:
 *      const unmarshaller = new Unmarshaller();
 *      unmarshaller.on('value', function(value) { ... });
 *      unmarshaller.push(buffer);
 *      unmarshaller.push(buffer);
 *
 * In Python, and in the marshalled format, there is a distinction between strings and unicode
 * objects. In JS, there is a good correspondence to Uint8Array objects and strings, respectively.
 * Python unicode objects always become JS strings. JS Uint8Arrays always become Python strings.
 *
 * JS strings become Python unicode objects, but can be marshalled to Python strings with
 * 'stringToBuffer' option. Similarly, Python strings become JS Uint8Arrays, but can be
 * unmarshalled to JS strings if 'bufferToString' option is set.
 */
import {BigInt} from 'app/common/BigInt';
import MemBuffer from 'app/common/MemBuffer';
import {EventEmitter} from 'events';
import * as util from 'util';


export interface MarshalOptions {
  stringToBuffer?: boolean;
  version?: number;

  // True if we want keys in dicts to be buffers.
  // It is convenient to have some freedom here to simplify implementation
  // of marshaling for some SQLite wrappers. This flag was initially
  // introduced for a fork of Grist using better-sqlite3, and I don't
  // remember exactly what the issues were.
  keysAreBuffers?: boolean;
}

export interface UnmarshalOptions {
  bufferToString?: boolean;
}

function ord(str: string): number {
  return str.charCodeAt(0);
}

/**
 * Type codes used for python marshalling of values.
 * See pypy: rpython/translator/sandbox/_marshal.py.
 */
const marshalCodes = {
  NULL     : ord('0'),
  NONE     : ord('N'),
  FALSE    : ord('F'),
  TRUE     : ord('T'),
  STOPITER : ord('S'),
  ELLIPSIS : ord('.'),
  INT      : ord('i'),
  INT64    : ord('I'),
  /*
    BFLOAT, for 'binary float', is an encoding of float that just encodes the bytes of the
    double in standard IEEE 754 float64 format. It is used by Version 2+ of Python's marshal
    module. Previously (in versions 0 and 1), the FLOAT encoding is used, which stores floats
    through their string representations.

    Version 0 (FLOAT) is mandatory for system calls within the sandbox, while Version 2 (BFLOAT)
    is recommended for Grist's communication because it is more efficient and faster to
    encode/decode
   */
  BFLOAT   : ord('g'),
  FLOAT    : ord('f'),
  COMPLEX  : ord('x'),
  LONG     : ord('l'),
  STRING   : ord('s'),
  INTERNED : ord('t'),
  STRINGREF: ord('R'),
  TUPLE    : ord('('),
  LIST     : ord('['),
  DICT     : ord('{'),
  CODE     : ord('c'),
  UNICODE  : ord('u'),
  UNKNOWN  : ord('?'),
  SET      : ord('<'),
  FROZENSET: ord('>'),
};

type MarshalCode = keyof typeof marshalCodes;

// A little hack to test if the value is a 32-bit integer. Actually, for Python, int might be up
// to 64 bits (if that's the native size), but this is simpler.
// See http://stackoverflow.com/questions/3885817/how-to-check-if-a-number-is-float-or-integer.
function isInteger(n: number): boolean {
  // Float have +0.0 and -0.0. To represent -0.0 precisely, we have to use a float, not an int
  // (see also https://stackoverflow.com/questions/7223359/are-0-and-0-the-same).
  // tslint:disable-next-line:no-bitwise
  return n === +n && n === (n | 0) && !Object.is(n, -0.0);
}

// ----------------------------------------------------------------------

/**
 * To force a value to be serialized using a particular representation (e.g. a number as INT64),
 * wrap it into marshal.wrap('INT64', value) and serialize that.
 */
export function wrap(codeStr: MarshalCode, value: unknown) {
  return new WrappedObj(marshalCodes[codeStr], value);
}

export class WrappedObj {
  constructor(public code: number, public value: unknown) {}

  public inspect() {
    return util.inspect(this.value);
  }
}

// ----------------------------------------------------------------------

/**
 * @param {Boolean} options.stringToBuffer - If set, JS strings will become Python strings rather
 *      than unicode objects (as if each JS string is wrapped into MemBuffer.stringToArray(str)).
 *      This flag becomes a same-named property of Marshaller, which can be set at any time.
 * @param {Number} options.version - If version >= 2, uses binary representation for floats. The
 *      default version 0 formats floats as strings.
 *
 * TODO: The default should be version 2. (0 was used historically because it was needed for
 * communication with PyPy-based sandbox.)
 */
export class Marshaller {
  private _memBuf: MemBuffer;
  private readonly _floatCode: number;
  private readonly _stringCode: number;
  private readonly _keysAreBuffers: boolean;

  constructor(options?: MarshalOptions) {
    this._memBuf = new MemBuffer(undefined);
    this._floatCode = options && options.version && options.version >= 2 ? marshalCodes.BFLOAT : marshalCodes.FLOAT;
    this._stringCode = options && options.stringToBuffer ? marshalCodes.STRING : marshalCodes.UNICODE;
    this._keysAreBuffers = Boolean(options?.keysAreBuffers);
  }

  public dump(): Uint8Array {
    // asByteArray returns a view on the underlying data, and the constructor creates a new copy.
    // For some usages, we may want to avoid making the copy.
    const bytes = new Uint8Array(this._memBuf.asByteArray());
    this._memBuf.clear();
    return bytes;
  }

  public dumpAsBuffer(): Buffer {
    const bytes = Buffer.from(this._memBuf.asByteArray());
    this._memBuf.clear();
    return bytes;
  }

  public getCode(value: any) {
    switch (typeof value) {
      case 'number': return isInteger(value) ? marshalCodes.INT : this._floatCode;
      case 'string': return this._stringCode;
      case 'boolean': return value ? marshalCodes.TRUE : marshalCodes.FALSE;
      case 'undefined': return marshalCodes.NONE;
      case 'object': {
        if (value instanceof WrappedObj) {
          return value.code;
        } else if (value === null) {
          return marshalCodes.NONE;
        } else if (value instanceof Uint8Array) {
          return marshalCodes.STRING;
        } else if (Buffer.isBuffer(value)) {
          return marshalCodes.STRING;
        } else if (Array.isArray(value)) {
          return marshalCodes.LIST;
        }
        return marshalCodes.DICT;
      }
      default: {
        throw new Error("Marshaller: Unsupported value of type " + (typeof value));
      }
    }
  }

  public marshal(value: any): void {
    const code = this.getCode(value);
    if (value instanceof WrappedObj) {
      value = value.value;
    }
    this._memBuf.writeUint8(code);
    switch (code) {
      case marshalCodes.NULL:       return;
      case marshalCodes.NONE:       return;
      case marshalCodes.FALSE:      return;
      case marshalCodes.TRUE:       return;
      case marshalCodes.INT:        return this._memBuf.writeInt32LE(value);
      case marshalCodes.INT64:      return this._writeInt64(value);
      case marshalCodes.FLOAT:      return this._writeStringFloat(value);
      case marshalCodes.BFLOAT:     return this._memBuf.writeFloat64LE(value);
      case marshalCodes.STRING:
        return (value instanceof Uint8Array || Buffer.isBuffer(value) ?
          this._writeByteArray(value) :
          this._writeUtf8String(value));
      case marshalCodes.TUPLE:      return this._writeList(value);
      case marshalCodes.LIST:       return this._writeList(value);
      case marshalCodes.DICT:       return this._writeDict(value);
      case marshalCodes.UNICODE:    return this._writeUtf8String(value);
      // None of the following are supported.
      case marshalCodes.STOPITER:
      case marshalCodes.ELLIPSIS:
      case marshalCodes.COMPLEX:
      case marshalCodes.LONG:
      case marshalCodes.INTERNED:
      case marshalCodes.STRINGREF:
      case marshalCodes.CODE:
      case marshalCodes.UNKNOWN:
      case marshalCodes.SET:
      case marshalCodes.FROZENSET:  throw new Error("Marshaller: Can't serialize code " + code);
      default:                      throw new Error("Marshaller: Can't serialize code " + code);
    }
  }

  private _writeInt64(value: number) {
    if (!isInteger(value)) {
      // TODO We could actually support 53 bits or so.
      throw new Error("Marshaller: int64 still only supports 32-bit ints for now: " + value);
    }
    this._memBuf.writeInt32LE(value);
    this._memBuf.writeInt32LE(value >= 0 ? 0 : -1);
  }

  private _writeStringFloat(value: number) {
    // This could be optimized a bit, but it's only used in V0 marshalling, which is only used in
    // sandbox system calls, which don't really ever use floats anyway.
    const bytes = MemBuffer.stringToArray(value.toString());
    if (bytes.byteLength >= 127) {
      throw new Error("Marshaller: Trying to write a float that takes " + bytes.byteLength + " bytes");
    }
    this._memBuf.writeUint8(bytes.byteLength);
    this._memBuf.writeByteArray(bytes);
  }

  private _writeByteArray(value: Uint8Array|Buffer) {
    // This works for both Uint8Arrays and Node Buffers.
    this._memBuf.writeInt32LE(value.length);
    this._memBuf.writeByteArray(value);
  }

  private _writeUtf8String(value: string) {
    const offset = this._memBuf.size();
    // We don't know the length until we write the value.
    this._memBuf.writeInt32LE(0);
    this._memBuf.writeString(value);
    const byteLength = this._memBuf.size() - offset - 4;
    // Overwrite the 0 length we wrote earlier with the correct byte length.
    this._memBuf.asDataView.setInt32(this._memBuf.startPos + offset, byteLength, true);
  }

  private _writeList(array: unknown[]) {
    this._memBuf.writeInt32LE(array.length);
    for (const item of array) {
      this.marshal(item);
    }
  }

  private _writeDict(obj: {[key: string]: any}) {
    const keys = Object.keys(obj);
    keys.sort();
    for (const key of keys) {
      this.marshal(this._keysAreBuffers ? Buffer.from(key) : key);
      this.marshal(obj[key]);
    }
    this._memBuf.writeUint8(marshalCodes.NULL);
  }
}

// ----------------------------------------------------------------------

const TwoTo32 = 0x100000000;    // 2**32
const TwoTo15 = 0x8000;         // 2**15

/**
 * @param {Boolean} options.bufferToString - If set, Python strings will become JS strings rather
 *      than Buffers (as if each decoded buffer is wrapped into `buf.toString()`).
 *      This flag becomes a same-named property of Unmarshaller, which can be set at any time.
 * Note that options.version isn't needed, since this will decode both formats.
 * TODO: Integers (such as int64 and longs) that are too large for JS are currently represented as
 * decimal strings. They may need a better representation, or a configurable option.
 */
export class Unmarshaller extends EventEmitter {
  public memBuf: MemBuffer;
  private _consumer: any = null;
  private _lastCode: number|null = null;
  private readonly _bufferToString: boolean;
  private _emitter: (v: any) => boolean;
  private _stringTable: Array<string|Uint8Array> = [];

  constructor(options?: UnmarshalOptions) {
    super();
    this.memBuf = new MemBuffer(undefined);
    this._bufferToString = Boolean(options && options.bufferToString);
    this._emitter = this.emit.bind(this, 'value');
  }

  /**
   * Adds more data for parsing. Parsed values will be emitted as 'value' events.
   * @param {Uint8Array|Buffer} byteArray: Uint8Array or Node Buffer with bytes to parse.
   */
  public push(byteArray: Uint8Array|Buffer) {
    this.parse(byteArray, this._emitter);
  }

  /**
   * Adds data to parse, and calls valueCB(value) for each value parsed. If valueCB returns the
   * Boolean false, stops parsing and returns.
   */
  public parse(byteArray: Uint8Array|Buffer, valueCB: (val: any) => boolean|void) {
    this.memBuf.writeByteArray(byteArray);
    try {
      while (this.memBuf.size() > 0) {
        this._consumer = this.memBuf.makeConsumer();

        // Have to reset stringTable for interned strings before each top-level parse call.
        this._stringTable.length = 0;

        const value = this._parse();
        this.memBuf.consume(this._consumer);
        if (valueCB(value) === false) {
          return;
        }
      }
    } catch (err) {
      // If the error is `needMoreData`, we silently return. We'll retry by reparsing the message
      // from scratch after the next push(). If buffers contain complete serialized messages, the
      // cost should be minor. But this design might get very inefficient if we have big messages
      // of arrays or dictionaries.
      if (err.needMoreData) {
        if (!err.consumedData || err.consumedData > 1024) {
          // tslint:disable-next-line:no-console
          console.log("Unmarshaller: Need more data; wasted parsing of %d bytes", err.consumedData);
        }
      } else {
        err.message = "Unmarshaller: " + err.message;
        throw err;
      }
    }
  }

  private _parse(): unknown {
    const code = this.memBuf.readUint8(this._consumer);
    this._lastCode = code;
    switch (code) {
      case marshalCodes.NULL:       return null;
      case marshalCodes.NONE:       return null;
      case marshalCodes.FALSE:      return false;
      case marshalCodes.TRUE:       return true;
      case marshalCodes.INT:        return this._parseInt();
      case marshalCodes.INT64:      return this._parseInt64();
      case marshalCodes.FLOAT:      return this._parseStringFloat();
      case marshalCodes.BFLOAT:     return this._parseBinaryFloat();
      case marshalCodes.STRING:     return this._parseByteString();
      case marshalCodes.TUPLE:      return this._parseList();
      case marshalCodes.LIST:       return this._parseList();
      case marshalCodes.DICT:       return this._parseDict();
      case marshalCodes.UNICODE:    return this._parseUnicode();
      case marshalCodes.INTERNED:   return this._parseInterned();
      case marshalCodes.STRINGREF:  return this._parseStringRef();
      case marshalCodes.LONG:       return this._parseLong();
        // None of the following are supported.
        // case marshalCodes.STOPITER:
        // case marshalCodes.ELLIPSIS:
        // case marshalCodes.COMPLEX:
        // case marshalCodes.CODE:
        // case marshalCodes.UNKNOWN:
        // case marshalCodes.SET:
        // case marshalCodes.FROZENSET:
      default:
        throw new Error(`Unmarshaller: unsupported code "${String.fromCharCode(code)}" (${code})`);
    }
  }

  private _parseInt() {
    return this.memBuf.readInt32LE(this._consumer);
  }

  private _parseInt64() {
    const low = this.memBuf.readInt32LE(this._consumer);
    const hi = this.memBuf.readInt32LE(this._consumer);
    if ((hi === 0 && low >= 0) || (hi === -1 && low < 0)) {
      return low;
    }
    const unsignedLow = low < 0 ? TwoTo32 + low : low;
    if (hi >= 0) {
      return new BigInt(TwoTo32, [unsignedLow, hi], 1).toNative();
    } else {
      // This part is tricky. See unittests for check of correctness.
      return new BigInt(TwoTo32, [TwoTo32 - unsignedLow, -hi - 1], -1).toNative();
    }
  }

  private _parseLong() {
    // The format is a 32-bit size whose sign is the sign of the result, followed by 16-bit digits
    // in base 2**15.
    const size = this.memBuf.readInt32LE(this._consumer);
    const sign = size < 0 ? -1 : 1;
    const numDigits = size < 0 ? -size : size;
    const digits = [];
    for (let i = 0; i < numDigits; i++) {
      digits.push(this.memBuf.readInt16LE(this._consumer));
    }
    return new BigInt(TwoTo15, digits, sign).toNative();
  }

  private _parseStringFloat() {
    const len = this.memBuf.readUint8(this._consumer);
    const buf = this.memBuf.readString(this._consumer, len);
    return parseFloat(buf);
  }

  private _parseBinaryFloat() {
    return this.memBuf.readFloat64LE(this._consumer);
  }

  private _parseByteString(): string|Uint8Array {
    const len = this.memBuf.readInt32LE(this._consumer);
    return (this._bufferToString ?
      this.memBuf.readString(this._consumer, len) :
      this.memBuf.readByteArray(this._consumer, len));
  }

  private _parseInterned() {
    const s = this._parseByteString();
    this._stringTable.push(s);
    return s;
  }

  private _parseStringRef() {
    const index = this._parseInt();
    return this._stringTable[index];
  }

  private _parseList() {
    const len = this.memBuf.readInt32LE(this._consumer);
    const value = [];
    for (let i = 0; i < len; i++) {
      value[i] = this._parse();
    }
    return value;
  }

  private _parseDict() {
    const dict: {[key: string]: any} = {};
    while (true) {    // eslint-disable-line no-constant-condition
      let key = this._parse() as string|Uint8Array;
      if (key === null && this._lastCode === marshalCodes.NULL) {
        break;
      }
      const value = this._parse();
      if (key !== null) {
        if (key instanceof Uint8Array) {
          key = MemBuffer.arrayToString(key);
        }
        dict[key as string] = value;
      }
    }
    return dict;
  }

  private _parseUnicode() {
    const len = this.memBuf.readInt32LE(this._consumer);
    return this.memBuf.readString(this._consumer, len);
  }
}

/**
 * Similar to python's marshal.loads(). Parses the given bytes and returns the parsed value. There
 * must not be any trailing data beyond the single marshalled value.
 */
export function loads(byteArray: Uint8Array|Buffer, options?: UnmarshalOptions): any {
  const unmarshaller = new Unmarshaller(options);
  let parsedValue;
  unmarshaller.parse(byteArray, function(value) {
    parsedValue = value;
    return false;
  });
  if (typeof parsedValue === 'undefined') {
    throw new Error("loads: input data truncated");
  } else if (unmarshaller.memBuf.size() > 0) {
    throw new Error("loads: extra bytes past end of input");
  }
  return parsedValue;
}

/**
 * Serializes arbitrary data by first marshalling then converting to a base64 string.
 */
export function dumpBase64(data: any, options?: MarshalOptions) {
  const marshaller = new Marshaller(options || {version: 2});
  marshaller.marshal(data);
  return marshaller.dumpAsBuffer().toString('base64');
}

/**
 * Loads data from a base64 string, as serialized by dumpBase64().
 */
export function loadBase64(data: string, options?: UnmarshalOptions) {
  return loads(Buffer.from(data, 'base64'), options);
}
