/**
 * A minimal library to represent arbitrarily large integers. Unlike the many third party
 * libraries, which are big, this only implements a representation and conversion to string (such
 * as base 10 or base 16), so it's tiny in comparison.
 *
 * Big integers
 *    base: number - the base for the digits
 *    digits: number[] - digits, from least significant to most significant, in [0, base) range.
 *    sign: number - 1 or -1
 */
export class BigInt {
  constructor(
    private _base: number,      // Base for the digits
    private _digits: number[],  // Digits from least to most significant, in [0, base) range.
    private _sign: number,      // +1 or -1
  ) {}

  public copy() { return new BigInt(this._base, this._digits, this._sign); }

  /** Convert to Number if there is no loss of precision, or string (base 10) otherwise. */
  public toNative(): number|string {
    const num = this.toNumber();
    return Number.isSafeInteger(num) ? num : this.toString(10);
  }

  /** Convert to Number as best we can. This will lose precision beying 53 bits. */
  public toNumber(): number {
    let res = 0;
    let baseFactor = 1;
    for (const digit of this._digits) {
      res += digit * baseFactor;
      baseFactor *= this._base;
    }
    return res * (this._sign < 0 ? -1 : 1);
  }

  /** Like Number.toString(). Radix (or base) is an integer between 2 and 36, defaulting to 10. */
  public toString(radix: number = 10): string {
    const copy = this.copy();
    const decimals = [];
    while (copy._digits.length > 0) {
      decimals.push(copy._mod(radix).toString(radix));
      copy._divide(radix);
    }
    if (decimals.length === 0) { return "0"; }
    return (this._sign < 0 ? "-" : "") + decimals.reverse().join("");
  }

  /** Returns the remainder when this number is divided by divisor. */
  private _mod(divisor: number): number {
    let res = 0;
    let baseFactor = 1;
    for (const digit of this._digits) {
      res = (res + (digit % divisor) * baseFactor) % divisor;
      baseFactor = (baseFactor * this._base) % divisor;
    }
    return res;
  }

  /** Divides this number in-place. */
  private _divide(divisor: number): void {
    if (this._digits.length === 0) { return; }
    for (let i = this._digits.length - 1; i > 0; i--) {
      this._digits[i - 1] += (this._digits[i] % divisor) * this._base;
      this._digits[i] = Math.floor(this._digits[i] / divisor);
    }
    this._digits[0] = Math.floor(this._digits[0] / divisor);
    while (this._digits.length > 0 && this._digits[this._digits.length - 1] === 0) {
      this._digits.pop();
    }
  }
}
