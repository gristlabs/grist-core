export interface Style {
  textColor?: string;
  fillColor?: string;
  fontBold?: boolean;
  fontUnderline?: boolean;
  fontItalic?: boolean;
  fontStrikethrough?: boolean;
}

export class CombinedStyle implements Style {
  public readonly textColor?: string;
  public readonly fillColor?: string;
  public readonly fontBold?: boolean;
  public readonly fontUnderline?: boolean;
  public readonly fontItalic?: boolean;
  public readonly fontStrikethrough?: boolean;
  constructor(rules: (Style|undefined|null)[], flags: any[]) {
    for (let i = 0; i < rules.length; i++) {
      if (flags[i]) {
        const textColor = rules[i]?.textColor;
        const fillColor = rules[i]?.fillColor;
        const fontBold = rules[i]?.fontBold;
        const fontUnderline = rules[i]?.fontUnderline;
        const fontItalic = rules[i]?.fontItalic;
        const fontStrikethrough = rules[i]?.fontStrikethrough;
        this.textColor = textColor || this.textColor;
        this.fillColor = fillColor || this.fillColor;
        this.fontBold = fontBold || this.fontBold;
        this.fontUnderline = fontUnderline || this.fontUnderline;
        this.fontItalic = fontItalic || this.fontItalic;
        this.fontStrikethrough = fontStrikethrough || this.fontStrikethrough;
      }
    }
  }
}
