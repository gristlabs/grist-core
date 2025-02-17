const VAR_PREFIX = 'grist';

export class CssCustomProp {
  private _prefix = VAR_PREFIX;

  constructor(
    public name: string,
    public value?: string | CssCustomProp,
    public fallback?: string | CssCustomProp,
    public type?: 'theme') {
    if (this.type === 'theme') {
      this._prefix = `${VAR_PREFIX}-theme`;
    }
  }

  public decl(): string | undefined {
    if (this.value === undefined) { return undefined; }

    return `${this.var()}: ${this.value};`;
  }

  public toString(): string {
    let value = this.var();
    if (this.fallback) {
      value += `, ${this.fallback}`;
    }
    return `var(${value})`;
  }

  public var(): string {
    return `--${this._prefix}-${this.name}`;
  }

  /**
   * Get the actual string value instead of a potential pointer to another css variable
   */
  public getRawValue(): string {
    if (typeof this.value !== "string" && this.value?.value) {
      return this._getRawValue(this.value);
    }
    return this.value as string;
  }

  private _getRawValue(token?: string | CssCustomProp): string {
    if (typeof token === 'string') {
      return token;
    }
    if (token && token.value) {
      return this._getRawValue(token.value);
    }
    return '';
  }
}
