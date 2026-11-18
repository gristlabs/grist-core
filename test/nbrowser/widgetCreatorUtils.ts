import * as gu from "test/nbrowser/gristUtils";

import { assert, driver, until, WebElement } from "mocha-webdriver";

export const editor = () => driver.find(".test-widget-creator-editor");
export const saveButton = () => driver.find(".test-widget-creator-save");
export const codePane = () => driver.find(".test-widget-creator-code");
export const isSourceOn = () => driver.find(".test-widget-creator-source input").isSelected();

// Types the code and waits until the auto-refresh replaces the running widget, if there is one.
export async function typeAndRun(code: string) {
  const [running] = await driver.findAll(".active_section .test-widget-creator-widget iframe");
  await setTyped(code);
  if (running) { await driver.wait(until.stalenessOf(running), 3000); }
}

export async function setTyped(code: string) {
  await driver.executeScript((text: string) => {
    const element: any = document.querySelector(".test-widget-creator-code .ace_editor");
    element.env.editor.setValue(text, -1);
  }, code);
}

export async function getTyped(): Promise<string> {
  return await gu.getAceText(await codePane());
}

export async function assertWidgetText(expected: string) {
  const iframe = await driver.findWait(".active_section .test-widget-creator-widget iframe", 2000);
  await gu.doInIframe(iframe, async () => {
    await gu.waitToPass(async () => {
      assert.equal(await driver.findWait("#out", 3000).getText(), expected);
    }, 3000);
  });
}

export async function editFromMenu() {
  await clickMenuItem(".test-widget-creator-menu-edit");
  await driver.findWait(".test-widget-creator-code .ace_editor", 2000);
}

// A menu that has just opened can miss a click, so click again while it is still open.
async function clickMenuItem(selector: string) {
  await gu.openSectionMenu("viewLayout");
  await gu.waitToPass(async () => {
    const menus = await driver.findAll(".grist-floating-menu");
    if (menus.length) { await menus[0].find(selector).click(); }
    assert.lengthOf(await driver.findAll(".grist-floating-menu"), 0);
  }, 2000);
}

export async function isOrange(button: WebElement) {
  return (await button.getAttribute("class")).includes("-changes");
}
