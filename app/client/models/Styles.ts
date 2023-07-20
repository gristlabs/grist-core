export interface Style {
  textColor?: string|undefined; // this can be string, undefined or an absent key.
  fillColor?: string|undefined;
  fontBold?: boolean|undefined;
  fontUnderline?: boolean|undefined;
  fontItalic?: boolean|undefined;
  fontStrikethrough?: boolean|undefined;
}

export interface HeaderStyle {
  headerTextColor?: string | undefined; // this can be string, undefined or an absent key.
  headerFillColor?: string | undefined;
  headerFontBold?: boolean | undefined;
  headerFontUnderline?: boolean | undefined;
  headerFontItalic?: boolean | undefined;
  headerFontStrikethrough?: boolean | undefined;
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
