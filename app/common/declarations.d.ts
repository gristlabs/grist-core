declare module "app/common/MemBuffer" {
  const MemBuffer: any;
  type MemBuffer = any;
  export = MemBuffer;
}

declare module "locale-currency/map" {
  const Map: Record<string, string>;
  type Map = Record<string, string>;
  export = Map;
}

declare namespace Intl {
  class DisplayNames {
    public static supportedLocalesOf(locales: string | string[]): string[];
    constructor(locales?: string, options?: object);
    public of(code: string): string;
  }

  class Locale {
    public region: string;
    public language: string;
    constructor(locale: string);
  }
}

declare module '@gristlabs/moment-guess/dist/bundle.js';
