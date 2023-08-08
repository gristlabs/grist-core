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

declare module "selenium-webdriver" {
  interface WebDriver {
    withActions(cb: (actions: WebActions) => void): Promise<void>;
  }

  // This is not a complete definition of available methods, but only those that we use for now.
  // TODO: find documentation for this interface or update selenium-webdriver.
  interface WebActions {
    contextClick(el?: WebElement): WebActions;
    click(el?: WebElement): WebActions;
    press(): WebActions;
    move(params: {origin?: WebElement|string, x?: number, y?: number}): WebActions;
    keyDown(key: string): WebActions;
    keyUp(key: string): WebActions;
    dragAndDrop(element: WebElement, target: WebElement): WebActions;
    release(): WebActions;
    doubleClick(element: WebElement): WebActions;
    pause(ms: number): WebActions;
  }
}

import "mocha-webdriver";
declare module "mocha-webdriver" {
  // It looks like this hack makes tsc see our definition as primary, adding
  // the typed version override (of the withActions method) as the default one.
  export declare let driver: import("selenium-webdriver").WebDriver;
}
