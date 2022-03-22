export interface Style {
  textColor?: string;
  fillColor?: string;
}

export class CombinedStyle implements Style {
  public readonly textColor?: string;
  public readonly fillColor?: string;
  constructor(rules: Style[], flags: any[]) {
    for (let i = 0; i < rules.length; i++) {
      if (flags[i]) {
        const textColor = rules[i].textColor;
        const fillColor = rules[i].fillColor;
        this.textColor = textColor || this.textColor;
        this.fillColor = fillColor || this.fillColor;
      }
    }
  }
}
