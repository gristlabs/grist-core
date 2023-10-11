declare module "test/nbrowser/gristUtil-nbrowser" {
  // TODO - tsc can now do nice type inference for most of this, except $,
  // so could change how export is done. Right now it leads to a mess because
  // of $.
  export declare let $: any;
  export declare let gu: any;
  export declare let server: any;
  export declare let test: any;
}


// Adds missing type declaration to chai
declare namespace Chai {
  interface AssertStatic {
    notIncludeMembers<T>(superset: T[], subset: T[], message?: string): void;
  }
}
