import { driver, WebElementPromise } from "mocha-webdriver";
import * as gu from "test/nbrowser/gristUtils";

export interface Button {
  click(): Promise<void>;
  element(): WebElementPromise;
  wait(): Promise<void>;
  visible(): Promise<boolean>;
  present(): Promise<boolean>;
}

export const element = (testId: string) => ({
  element() {
    return driver.find(testId);
  },
  async wait() {
    await driver.findWait(testId, 10000);
  },
  async visible() {
    return await this.element().isDisplayed();
  },
  async present() {
    return await this.element().isPresent();
  }
});

export const label = (testId: string) => ({
  ...element(testId),
  async text() {
    return this.element().getText();
  },
});

export const button = (testId: string): Button => ({
  ...element(testId),
  async click() {
    await gu.scrollIntoView(this.element());
    await this.element().click();
  },
});

export const option = (testId: string) => ({
  ...button(testId),
  async checked() {
    return 'true' === await this.element().findClosest("label").find("input[type='checkbox']").getAttribute('checked');
  }
});

