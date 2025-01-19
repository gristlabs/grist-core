const VAR_PREFIX = 'grist';

export class CssCustomProp {
  constructor(public name: string, public value?: string | CssCustomProp, public fallback?: string | CssCustomProp) {

  }

  public decl(): string | undefined {
    if (this.value === undefined) { return undefined; }

    return `--${VAR_PREFIX}-${this.name}: ${this.value};`;
  }

  public toString(): string {
    let value = `--${VAR_PREFIX}-${this.name}`;
    if (this.fallback) {
      value += `, ${this.fallback}`;
    }
    return `var(${value})`;
  }
}
