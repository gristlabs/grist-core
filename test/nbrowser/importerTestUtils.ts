/**
 * Testing utilities used in Importer test suites.
 */

import {driver, Key, stackWrapFunc, WebElementPromise} from 'mocha-webdriver';
import * as gu from 'test/nbrowser/gristUtils';

// Helper to get the input of a matching parse option in the ParseOptions dialog.
export const getParseOptionInput = stackWrapFunc((labelRE: RegExp): WebElementPromise =>
  driver.findContent('.test-parseopts-opt', labelRE).find('input'));

type CellDiff = string|[string|undefined, string|undefined, string|undefined];

/**
 * Returns preview diff cell values when the importer is updating existing records.
 *
 * If a cell has no diff, just the cell value is returned. Otherwise, a 3-tuple
 * containing the parent, remote, and common values (in that order) is returned.
 */
export const getPreviewDiffCellValues = stackWrapFunc(async (cols: number[], rowNums: number[]) => {
  return gu.getPreviewContents<CellDiff>(cols, rowNums, async (cell) => {
    const hasParentDiff = await cell.find('.diff-parent').isPresent();
    const hasRemoteDiff = await cell.find('.diff-remote').isPresent();
    const hasCommonDiff = await cell.find('.diff-common').isPresent();

    const isDiff = hasParentDiff || hasRemoteDiff || hasCommonDiff;
    return !isDiff ? await cell.getText() :
      [
        hasParentDiff ? await cell.find('.diff-parent').getText() : undefined,
        hasRemoteDiff ? await cell.find('.diff-remote').getText() : undefined,
        hasCommonDiff ? await cell.find('.diff-common').getText() : undefined,
      ];
  });
});

// Helper that waits for the diff preview to finish loading.
export const waitForDiffPreviewToLoad = async (): Promise<void> => {
  await gu.waitForServer();
  await driver.wait(() => driver.find('.test-importer-preview').isPresent(), 5000);
  await driver.findWait('.test-importer-preview .gridview_row', 1000);

  // Check if we can see row number 1
  await driver.findContentWait('.test-importer-preview .gridview_data_row_num', "1", 5000);

  // Click any cell that we see to set the focus, to try to make the
  // state after waiting more deterministic.
  // There is something odd occasionally, depending perhaps on scrolling,
  // where the first row isn't clickable. Just working around it, and trying each
  // of the first ten records, since this problem has persisted a very long time.
  // TODO: find a more sensible fix.
  const records = await driver.findAll('.test-importer-preview .record-hlines');
  let success = false;
  await gu.scrollIntoView(await records[0].find('.field_clip'));
  for (const rec of records.slice(0, 10)) {
    try {
      const cell = await rec.find('.field_clip');
      await cell.click();
      // Wait for the focus to be set.
      await driver.findWait('.test-importer-preview .field_clip.has_cursor', 100);
      // Go to the first cell.
      await gu.sendKeys(Key.chord(await gu.modKey(), Key.UP));
      await gu.sendKeys(Key.HOME);
      success = true;
      break;
    } catch (e) {
      continue;
    }
  }
  if (!success) {
    throw Error(`tried cells without success`);
  }
};

// Helper that gets the list of visible column matching rows to the left of the preview.
export const getColumnMatchingRows = stackWrapFunc(async (): Promise<{source: string, destination: string}[]> => {
  return await driver.findAll('.test-importer-column-match-source-destination', async (el) => {
    const source = await el.find('.test-importer-column-match-formula').getAttribute('textContent');
    const destination = await el.find('.test-importer-column-match-destination').getText();
    return {source, destination};
  });
});

export async function waitForColumnMapping() {
  await driver.wait(() => driver.find(".test-importer-column-match-options").isDisplayed(), 300);
}

export async function openColumnMapping() {
  const selected = driver.find('.test-importer-target-selected');
  await selected.find('.test-importer-target-column-mapping').click();
  await driver.sleep(200); // animation
  await waitForColumnMapping();
}

export async function openTableMapping() {
  await driver.find('.test-importer-table-mapping').click();
  await driver.sleep(200); // animation
  await driver.wait(() => driver.find(".test-importer-target").isDisplayed(), 300);
}

/**
 * Opens the menu for the destination column, by clicking the source.
 */
export async function openSource(text: string|RegExp) {
  await driver.findContent('.test-importer-column-match-destination', text)
              .findClosest('.test-importer-column-match-source-destination')
              .find('.test-importer-column-match-source').click();
}
