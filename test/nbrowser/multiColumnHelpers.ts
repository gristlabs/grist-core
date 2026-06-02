// Helpers shared by MultiColumn.ts and MultiColumn2.ts. Extracted verbatim
// from the original MultiColumn.ts with no logic changes, only `export` added.

import { arrayRepeat } from "app/plugin/gutil";
import * as gu from "test/nbrowser/gristUtils";
import { ColumnType } from "test/nbrowser/gristUtils";
import { Cleanup } from "test/server/testCleanup";

import { assert, driver, Key } from "mocha-webdriver";

export async function setupMultiColumnDoc(cleanup: Cleanup) {
  const session = await gu.session().login();
  const doc = await session.tempNewDoc(cleanup, "MultiColumn", { load: false });
  const api = session.createHomeApi();
  await api.applyUserActions(doc, [
    ["BulkAddRecord", "Table1", arrayRepeat(2, null), {}],
  ]);
  // Leave only A column which will have AnyType. We don't need it, but
  // table must have at least one column and we will be removing all columns
  // that we test.
  await api.applyUserActions(doc, [
    ["RemoveColumn", "Table1", "B"],
    ["RemoveColumn", "Table1", "C"],
  ]);
  await session.loadDoc("/doc/" + doc);
  await gu.toggleSidePanel("right", "open");
  await driver.find(".test-right-tab-field").click();
}

export const transparent = "rgba(0, 0, 0, 0)";
export const blue = "#0000FF";
export const red = "#FF0000";
export const types: ColumnType[] = [
  "Any", "Text", "Integer", "Numeric", "Toggle", "Date", "DateTime", "Choice", "Choice List",
  "Reference", "Reference List", "Attachment",
];

export async function numModeDisabled() {
  return await hasDisabledSuffix(".test-numeric-mode");
}

export async function numSignDisabled() {
  return await hasDisabledSuffix(".test-numeric-sign");
}

export async function decimalsDisabled() {
  const min = await hasDisabledSuffix(".test-numeric-min-decimals");
  const max = await hasDisabledSuffix(".test-numeric-max-decimals");
  return min && max;
}

export async function numberFormattingDisabled() {
  return (await numModeDisabled()) && (await numSignDisabled()) && (await decimalsDisabled());
}

export async function testWrapping(colA: string = "Left", colB: string = "Right") {
  await selectColumns(colA, colB);
  await wrap(true);
  assert.isTrue(await wrap());
  assert.isTrue(await colWrap(colA), `${colA} should be wrapped`);
  assert.isTrue(await colWrap(colB), `${colB} should be wrapped`);
  await wrap(false);
  assert.isFalse(await wrap());
  assert.isFalse(await colWrap(colA), `${colA} should not be wrapped`);
  assert.isFalse(await colWrap(colB), `${colB} should not be wrapped`);

  // Test common wrapping.
  await selectColumns(colA);
  await wrap(true);
  await selectColumns(colB);
  await wrap(false);
  await selectColumns(colA, colB);
  assert.isFalse(await wrap());
  await selectColumns(colB);
  await wrap(true);
  assert.isTrue(await wrap());
}

export async function testSingleWrapping(colA: string = "Left", colB: string = "Right") {
  await selectColumns(colA, colB);
  await wrap(true);
  assert.isTrue(await wrap());
  assert.isTrue(await colWrap(colA), `${colA} should be wrapped`);
  await wrap(false);
  assert.isFalse(await wrap());
  assert.isFalse(await colWrap(colA), `${colA} should not be wrapped`);
}

export async function testChoices(colA: string = "Left", colB: string = "Right") {
  await selectColumns(colA, colB);
  assert.equal(await choiceEditor.label(), "No choices configured");

  // Add two choices elements.
  await choiceEditor.edit();
  await choiceEditor.add("one");
  await choiceEditor.add("two");
  await choiceEditor.save();

  // Check that both column have them.
  await selectColumns(colA);
  assert.deepEqual(await choiceEditor.read(), ["one", "two"]);
  await selectColumns(colB);
  assert.deepEqual(await choiceEditor.read(), ["one", "two"]);
  // Check that they are shown normally and not as mixed.
  await selectColumns(colA, colB);
  assert.deepEqual(await choiceEditor.read(), ["one", "two"]);

  // Modify only one.
  await selectColumns(colA);
  await choiceEditor.edit();
  await choiceEditor.add("three");
  await choiceEditor.save();

  // Test that we now have a mix.
  await selectColumns(colA, colB);
  assert.equal(await choiceEditor.label(), "Mixed configuration");
  // Edit them, but press cancel.
  await choiceEditor.reset();
  await choiceEditor.cancel();
  // Test that we still have a mix.
  assert.equal(await choiceEditor.label(), "Mixed configuration");
  await selectColumns(colA);
  assert.deepEqual(await choiceEditor.read(), ["one", "two", "three"]);
  await selectColumns(colB);
  assert.deepEqual(await choiceEditor.read(), ["one", "two"]);

  // Reset them back and add records to the table.
  await selectColumns(colA, colB);
  await choiceEditor.reset();
  await choiceEditor.add("one");
  await choiceEditor.add("two");
  await choiceEditor.save();
  await gu.getCell(colA, 1).click();
  await gu.waitAppFocus();
  await gu.sendKeys("one", Key.ENTER);
  // If this is choice list we need one more enter.
  if (await getColumnType() === "Choice List") {
    await gu.sendKeys(Key.ENTER);
  }
  await gu.waitForServer();
  await gu.getCell(colB, 1).click();
  await gu.waitAppFocus();
  await gu.sendKeys("one", Key.ENTER);
  if (await getColumnType() === "Choice List") {
    await gu.sendKeys(Key.ENTER);
  }
  await gu.waitForServer();
  // Rename one of the choices.
  await selectColumns(colA, colB);
  const undo = await gu.begin();
  await choiceEditor.edit();
  await choiceEditor.rename("one", "one renamed");
  await choiceEditor.save();
  await gu.waitForServer();
  // Test if grid is ok.
  await gu.waitToPass(async () => {
    assert.equal(await gu.getCell(colA, 1).getText(), "one renamed");
    assert.equal(await gu.getCell(colB, 1).getText(), "one renamed");
  });
  await undo();
  await gu.waitToPass(async () => {
    assert.equal(await gu.getCell(colA, 1).getText(), "one");
    assert.equal(await gu.getCell(colB, 1).getText(), "one");
  });

  // Test that colors are also treated as different.
  await selectColumns(colA, colB);
  assert.deepEqual(await choiceEditor.read(), ["one", "two"]);
  await selectColumns(colA);
  await choiceEditor.edit();
  await choiceEditor.color("one", red);
  await choiceEditor.save();
  await selectColumns(colA, colB);
  assert.equal(await choiceEditor.label(), "Mixed configuration");
}

export const choiceEditor = {
  async hasReset() {
    return (await driver.find(".test-choice-list-entry-edit").getText()) === "Reset";
  },
  async reset() {
    await driver.find(".test-choice-list-entry-edit").click();
  },
  async label() {
    return await driver.find(".test-choice-list-entry-row").getText();
  },
  async add(label: string) {
    await driver.find(".test-tokenfield-input").click();
    await driver.find(".test-tokenfield-input").clear();
    await gu.sendKeys(label, Key.ENTER);
  },
  async rename(label: string, label2: string) {
    const entry = await driver.findWait(`.test-choice-list-entry .test-token-label[value='${label}']`, 100);
    await entry.click();
    await driver.wait(() => entry.hasFocus());
    await gu.sendKeys(label2, Key.ENTER);
  },
  async color(token: string, color: string) {
    const label = await driver.findWait(`.test-choice-list-entry .test-token-label[value='${token}']`, 100);
    await label.findClosest(".test-tokenfield-token").find(".test-color-button").click();
    await gu.setFillColor(color);
    await gu.sendKeys(Key.ENTER);
  },
  async read() {
    return await driver.findAll(".test-choice-list-entry-label", e => e.getText());
  },
  async edit() {
    await this.reset();
  },
  async save() {
    await driver.find(".test-choice-list-entry-save").click();
    await gu.waitForServer();
  },
  async cancel() {
    await driver.find(".test-choice-list-entry-cancel").click();
  },
};

export async function testAlignment(colA: string = "Left", colB: string = "Right") {
  await selectColumns(colA, colB);
  await alignment("left");
  assert.equal(await colAlignment(colA), "left", `${colA} alignment should be left`);
  assert.equal(await colAlignment(colB), "left", `${colB} alignment should be left`);
  assert.equal(await alignment(), "left", "Alignment should be left");
  await alignment("center");
  assert.equal(await colAlignment(colA), "center", `${colA} alignment should be center`);
  assert.equal(await colAlignment(colB), "center", `${colB} alignment should be center`);
  assert.equal(await alignment(), "center", "Alignment should be center");
  await alignment("right");
  assert.equal(await colAlignment(colA), "right", `${colA} alignment should be right`);
  assert.equal(await colAlignment(colB), "right", `${colB} alignment should be right`);
  assert.equal(await alignment(), "right", "Alignment should be right");

  // Now align first column to left, and second to right.
  await selectColumns(colA);
  await alignment("left");
  await selectColumns(colB);
  await alignment("right");
  // And test we don't have alignment set.
  await selectColumns(colA, colB);
  assert.isNull(await alignment());

  // Now change alignment of first column to right, so that we have common alignment.
  await selectColumns(colA);
  await alignment("right");
  await selectColumns(colA, colB);
  assert.equal(await alignment(), "right");
}

export async function colWrap(col: string) {
  const cell = await gu.getCell(col, 1).find(".field_clip");
  let hasTextWrap = await cell.matches("[class*=text_wrapping]");
  if (!hasTextWrap) {
    // We can be in a choice column, where wrapping is done differently.
    hasTextWrap = await cell.matches("[class*=-wrap]");
  }
  return hasTextWrap;
}

export async function colAlignment(col: string) {
  // TODO: unify how widgets are aligned.
  let cell = await gu.getCell(col, 1).find(".field_clip");
  let style = await cell.getAttribute("style");
  if (!style) {
    // We might have a choice column, use flex attribute of first child;
    cell = await gu.getCell(col, 1).find(".field_clip > div");
    style = await cell.getAttribute("style");
    // Get justify-content style
    const match = style.match(/justify-content: ([\w-]+)/);
    if (!match) { return null; }
    switch (match[1]) {
      case "left": return "left";
      case "center": return "center";
      case "flex-end": return "right";
    }
  }
  let match = style.match(/text-align: (\w+)/);
  if (!match) {
    // We might be in a choice list column, so check if we have a flex attribute.
    match = style.match(/justify-content: ([\w-]+)/);
  }
  if (!match) { return null; }
  return match[1] === "flex-end" ? "right" : match[1];
}

export async function wrap(state?: boolean) {
  const buttons = await driver.findAll(".test-tb-wrap-text .test-select-button");
  if (buttons.length !== 1) {
    assert.isUndefined(state, "Can't set wrap");
    return undefined;
  }
  if (await buttons[0].matches("[class*=-selected]")) {
    if (state === false) {
      await buttons[0].click();
      await gu.waitForServer();
      return false;
    }
    return true;
  }
  if (state === true) {
    await buttons[0].click();
    await gu.waitForServer();
    return true;
  }
  return false;
}

// Many controls works the same as any column for wrapping and alignment.
export async function commonTestsForAny(right: string) {
  await selectColumns("Left", "Right");
  if (["Toggle", "Date", "DateTime", "Attachment"].includes(right)) {
    assert.equal(await wrapDisabled(), true);
  } else {
    assert.equal(await wrapDisabled(), false);
    assert.equal(await wrap(), false);
  }
  if (["Toggle", "Attachment"].includes(right)) {
    assert.equal(await alignmentDisabled(), true);
  } else {
    assert.equal(await alignmentDisabled(), false);
  }
  if (["Integer", "Numeric"].includes(right)) {
    assert.equal(await alignment(), null);
  } else if (["Toggle", "Attachment"].includes(right)) {
    // With toggle, alignment is unset.
  } else {
    assert.equal(await alignment(), "left");
  }
  if (["Toggle", "Attachment"].includes(right)) {
    // omit tests for alignment
  } else {
    await testAlignment();
  }
  if (["Toggle", "Date", "DateTime", "Attachment"].includes(right)) {
    // omit tests for wrap
  } else if (["Choice"].includes(right)) {
    // Choice column doesn't support wrapping.
    await testSingleWrapping();
  } else {
    await testWrapping();
  }
}

export async function selectColumns(col1: string, col2?: string) {
  // Clear selection in grid.
  await driver.executeScript("gristDocPageModel.gristDoc.get().currentView.get().clearSelection();");
  if (col2 === undefined) {
    await gu.selectColumn(col1);
  } else {
    // First make sure we start with col1 selected.
    await gu.selectColumnRange(col1, col2);
  }
}

export async function alignmentDisabled() {
  return await hasDisabledSuffix(".test-alignment-select");
}

export async function choiceEditorDisabled() {
  return await hasDisabledSuffix(".test-choice-list-entry");
}

export async function alignment(value?: "left" | "right" | "center") {
  const buttons = await driver.findAll(".test-alignment-select .test-select-button");
  if (buttons.length !== 3) {
    assert.isUndefined(value, "Can't set alignment");
    return undefined;
  }
  if (value) {
    if (value === "left") {
      await buttons[0].click();
    }
    if (value === "center") {
      await buttons[1].click();
    }
    if (value === "right") {
      await buttons[2].click();
    }
    await gu.waitForServer();
    return;
  }
  if (await buttons[0].matches("[class*=-selected]")) {
    return "left";
  }
  if (await buttons[1].matches("[class*=-selected]")) {
    return "center";
  }
  if (await buttons[2].matches("[class*=-selected]")) {
    return "right";
  }
  return null;
}

export async function dateFormatDisabled() {
  const format = await driver.find("[data-test-id=Widget_dateFormat]");
  return await format.matches(".disabled");
}

export async function customDateFormatVisible() {
  const control = driver.find("[data-test-id=Widget_dateCustomFormat]");
  return await control.isPresent();
}

export async function dateFormat(format?: string) {
  if (!format) {
    return await gu.getDateFormat();
  }
  await driver.find("[data-test-id=Widget_dateFormat]").click();
  await gu.findOpenMenuItem("li", gu.exactMatch(format)).click();
  await gu.waitForServer();
}

export async function widgetTypeDisabled() {
  // Maybe we have selectbox
  const selectbox = await driver.findAll(".test-fbuilder-widget-select .test-select-open");
  if (selectbox.length === 1) {
    return await selectbox[0].matches(".disabled");
  }
  const buttons = await driver.findAll(".test-fbuilder-widget-select > div");
  const allDisabled = await Promise.all(buttons.map(button => button.matches("[class*=-disabled]")));
  return allDisabled.every(disabled => disabled) && allDisabled.length > 0;
}

export async function labelDisabled() {
  return (await driver.find(".test-field-label").getAttribute("readonly")) === "true";
}

export async function colIdDisabled() {
  return (await driver.find(".test-field-col-id").getAttribute("readonly")) === "true";
}

export async function hasDisabledSuffix(selector: string) {
  return (await driver.find(selector).matches("[class*=-disabled]"));
}

export async function hasDisabledClass(selector: string) {
  return (await driver.find(selector).matches(".disabled"));
}

export async function deriveDisabled() {
  return await hasDisabledSuffix(".test-field-derive-id");
}

export async function toggleDerived() {
  await driver.find(".test-field-derive-id").click();
  await gu.waitForServer();
}

export async function wrapDisabled() {
  return (await driver.find(".test-tb-wrap-text > div").matches("[class*=disabled]"));
}

export async function columnTypeDisabled() {
  return await hasDisabledClass(".test-fbuilder-type-select .test-select-open");
}

export async function getColumnType() {
  return await driver.find(".test-fbuilder-type-select").getText();
}

export async function setFormulaDisabled() {
  return (await driver.find(".test-field-set-formula").getAttribute("disabled")) === "true";
}

export async function formulaEditorDisabled() {
  return await hasDisabledSuffix(".formula_field_sidepane");
}

export async function setTriggerDisabled() {
  return (await driver.find(".test-field-set-trigger").getAttribute("disabled")) === "true";
}

export async function refControlsDisabled() {
  return (await hasDisabledClass(".test-fbuilder-ref-table-select .test-select-open")) &&
    (await hasDisabledClass(".test-fbuilder-ref-col-select .test-select-open"));
}

export async function setDataDisabled() {
  return (await driver.find(".test-field-set-data").getAttribute("disabled")) === "true";
}

export async function transformSectionDisabled() {
  return (await driver.find(".test-fbuilder-edit-transform").getAttribute("disabled")) === "true";
}

export async function addConditionDisabled() {
  return (await driver.find(".test-widget-style-add-conditional-style").getAttribute("disabled")) === "true";
}

export async function addAnyColumn(name: string) {
  await gu.sendActions([
    ["AddVisibleColumn", "Table1", name, {}],
  ]);
  await gu.waitForServer();
}

export async function removeColumn(...names: string[]) {
  await gu.sendActions([
    ...names.map(name => (["RemoveColumn", "Table1", name])),
  ]);
  await gu.waitForServer();
}

export function maxDecimals(value?: number | null) {
  return modDecimals(".test-numeric-max-decimals input", value);
}

export function minDecimals(value?: number | null) {
  return modDecimals(".test-numeric-min-decimals input", value);
}

export async function modDecimals(selector: string, value?: number | null) {
  const element = await driver.find(selector);
  if (value === undefined) {
    return parseInt(await element.value());
  } else {
    await element.click();
    if (value !== null) {
      await element.sendKeys(value.toString());
    } else {
      await element.doClear();
    }
    await driver.sendKeys(Key.ENTER);
    await gu.waitForServer();
  }
}

export async function numMode(value?: "currency" | "percent" | "exp" | "decimal") {
  const mode = await driver.findAll(".test-numeric-mode");
  if (value !== undefined) {
    if (mode.length === 0) {
      assert.fail("No number format");
    }
    if (value === "currency") {
      if (await numMode() !== "currency") {
        await driver.findContent(".test-numeric-mode .test-select-button", /\$/).click();
      }
    } else if (value === "percent") {
      if (await numMode() !== "percent") {
        await driver.findContent(".test-numeric-mode .test-select-button", /%/).click();
      }
    } else if (value === "decimal") {
      if (await numMode() !== "decimal") {
        await driver.findContent(".test-numeric-mode .test-select-button", /,/).click();
      }
    } else if (value === "exp") {
      if (await numMode() !== "exp") {
        await driver.findContent(".test-numeric-mode .test-select-button", /Exp/).click();
      }
    }
    await gu.waitForServer();
  }
  if (mode.length === 0) {
    return undefined;
  }
  const curr = await driver.findContent(".test-numeric-mode .test-select-button", /\$/).matches("[class*=-selected]");
  if (curr) {
    return "currency";
  }
  const decimal = await driver.findContent(".test-numeric-mode .test-select-button", /,/).matches("[class*=-selected]");
  if (decimal) {
    return "decimal";
  }
  const percent = await driver.findContent(".test-numeric-mode .test-select-button", /%/).matches("[class*=-selected]");
  if (percent) {
    return "percent";
  }
  const exp = await driver.findContent(".test-numeric-mode .test-select-button", /Exp/).matches("[class*=-selected]");
  if (exp) {
    return "exp";
  }
  return null;
}

export async function sliderDisabled() {
  return (await driver.find(".test-pw-thumbnail-size").getAttribute("disabled")) === "true";
}

export async function slider(value?: number) {
  if (value !== undefined) {
    await driver.executeScript(`
    document.querySelector('.test-pw-thumbnail-size').value = '${value}';
    document.querySelector('.test-pw-thumbnail-size').dispatchEvent(new Event('change'));
    `);
    await gu.waitForServer();
  }
  return parseInt(await driver.find(".test-pw-thumbnail-size").getAttribute("value"));
}

export async function cellColorLabel() {
  // Text actually contains T symbol before.
  const label = await driver.find(".test-cell-color-select .test-color-select").getText();
  return label.replace(/^T/, "").trim();
}

export async function headerColorLabel() {
  // Text actually contains T symbol before.
  const label = await driver.find(".test-header-color-select .test-color-select").getText();
  return label.replace(/^T/, "").trim();
}
