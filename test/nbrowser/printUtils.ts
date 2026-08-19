/**
 * Testing printing using selenium webdriver is tricky.
 *
 * 1. The `--kiosk-printing` option may be set on chromedriver to cause printing to go to a pdf
 *    without a confirmation. But it doesn't work in headless mode.
 *
 * 2. As long as we use `setTimeout(() => window.print(), 0)` instead of plain `window.print()`,
 *    it is possible to interact with the print dialog in chrome (although next steps are
 *    unclear), e.g.:
 *    ```
 *    const windowHandles = await driver.getAllWindowHandles();
 *    await driver.switchTo().window(windowHandles[1]);
 *    driver.sendKeys(Key.ENTER);
 *    ```
 *    This, however, doesn't work in headless either.
 *
 * 3. There is a command `Emulation.setEmulatedMedia`, can do the equivalent of dev console's
 *    simulation of `@media print`. That's what we use here. We don't get to see anything about
 *    pagination, but we can at least check whether various elements are visible for printing.
 *
 * 4. `window.print()` is replaced below with one that only fires `beforeprint`. The real call
 *    blocks the main thread, and in headless chrome it sometimes never returns, which hangs
 *    every later executeScript. The DOM under test is built by the `beforeprint` handler, so
 *    firing the event keeps the assertions meaningful. `afterprint` was already simulated
 *    here (see `afterPrintCallback` below), so both ends of the cycle are now driven by the
 *    test rather than by the browser's print pipeline.
 */
import * as gu from "test/nbrowser/gristUtils";

import { assert, driver } from "mocha-webdriver";

function emulateMediaPrint(print: boolean) {
  return (driver as any).sendDevToolsCommand("Emulation.setEmulatedMedia", { media: print ? "print" : "screen" });
}

/**
 * Prints the named section, runs checkFunc while `@media print` is in effect, and tidies up.
 */
export async function checkPrintSection(sectionName: string, checkFunc: () => Promise<void>) {
  const numTabs = (await driver.getAllWindowHandles()).length;
  await driver.executeScript(`
    window.debugPrinting = 1;
    window.print = () => window.dispatchEvent(new Event("beforeprint"));
  `);
  await gu.openSectionMenu("viewLayout", sectionName);
  await driver.findWait(".test-print-section", 500).click();
  await driver.sleep(100);    // Just to be sure we don't continue before setTimeout(0), used in printing.
  try {
    await emulateMediaPrint(true);
    await checkFunc();
  } finally {
    // Ensure the dialog's window (if it ever opened, only non-headless) is gone.
    await gu.waitToPass(async () => assert.lengthOf(await driver.getAllWindowHandles(), numTabs), 5000);

    // Ensure that `afterprint` callback gets triggered, needed for mac.
    await gu.waitToPass(() => driver.executeScript("window.afterPrintCallback?.()"));

    await emulateMediaPrint(false);
    await gu.waitToPass(() => driver.executeScript("window.finishPrinting()"));
    await driver.executeScript("window.debugPrinting = 0");
  }
}
