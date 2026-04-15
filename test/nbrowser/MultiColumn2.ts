// Split from MultiColumn.ts to parallelize across mocha workers.

import * as gu from "test/nbrowser/gristUtils";
import {
  alignment,
  alignmentDisabled,
  choiceEditorDisabled,
  commonTestsForAny,
  customDateFormatVisible,
  dateFormat,
  dateFormatDisabled,
  refControlsDisabled,
  removeColumn,
  selectColumns,
  setupMultiColumnDoc,
  slider,
  sliderDisabled,
  testAlignment,
  testChoices,
  testSingleWrapping,
  testWrapping,
  types,
  widgetTypeDisabled,
  wrap,
  wrapDisabled,
} from "test/nbrowser/multiColumnHelpers";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert } from "mocha-webdriver";

describe("MultiColumn2", function() {
  this.timeout(80000);
  const cleanup = setupTestSuite();
  before(async function() {
    await setupMultiColumnDoc(cleanup);
  });

  for (const left of ["Choice", "Choice List"]) {
    describe(`test for ${left} column`, function() {
      beforeEach(async () => {
        await gu.addColumn("Left", left);
      });
      afterEach(async function() {
        if (this.currentTest?.state === "passed") {
          await removeColumn("Left");
          await removeColumn("Right");
        }
      });
      for (const right of types) {
        it(`should work with ${right} column`, async function() {
          await gu.addColumn("Right", right);
          await selectColumns("Left", "Right");
          if (["Choice", "Choice List"].includes(right)) {
            await testChoices();
          } else {
            assert.isTrue(await choiceEditorDisabled());
          }

          if (left === "Choice List") {
            if (["Toggle", "Date", "DateTime", "Attachment"].includes(right)) {
              assert.equal(await wrapDisabled(), true);
            } else {
              assert.equal(await wrapDisabled(), false);
              assert.equal(await wrap(), false);
            }
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

          // Choice doesn't support wrapping.
          if (left === "Choice List") {
            if (["Toggle", "Date", "DateTime", "Attachment"].includes(right)) {
              // omit tests for wrap
            } else if (["Choice"].includes(right)) {
              // Choice column doesn't support wrapping.
              await testSingleWrapping();
            } else {
              await testWrapping();
            }
          }
        });
      }
    });
  }

  for (const left of ["Reference", "Reference List"]) {
    describe(`test for ${left} column`, function() {
      beforeEach(async () => {
        await gu.addColumn("Left", left);
      });
      afterEach(async function() {
        if (this.currentTest?.state === "passed") {
          await removeColumn("Left");
          await removeColumn("Right");
        }
      });
      // Test for types that matter (have different set of defaults).
      for (const right of ["Any", "Reference", "Reference List", "Toggle", "Integer"]) {
        it(`should work with ${right} column`, async function() {
          await gu.addColumn("Right", right);
          await selectColumns("Left", "Right");
          assert.isTrue(await refControlsDisabled(), "Reference controls should be disabled");
          await commonTestsForAny(right);
        });
      }
    });
  }

  describe(`test for Date column`, function() {
    beforeEach(async () => {
      await gu.addColumn("Left", "Date");
    });
    afterEach(async function() {
      if (this.currentTest?.state === "passed") {
        await removeColumn("Left");
        await removeColumn("Right");
      }
    });
    for (const right of types) {
      it(`should work with ${right} column`, async function() {
        await gu.addColumn("Right", right);
        await selectColumns("Left", "Right");
        if (["Date", "DateTime"].includes(right)) {
          assert.isFalse(await dateFormatDisabled());
        } else {
          assert.isTrue(await dateFormatDisabled());
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
      });
      if (["Date", "DateTime"].includes(right)) {
        it(`should change format with ${right} column`, async function() {
          await gu.addColumn("Right", right);
          await selectColumns("Left", "Right");
          assert.isFalse(await dateFormatDisabled());
          // Test for mixed format.
          await selectColumns("Left");
          await dateFormat("MM/DD/YY");
          await selectColumns("Left", "Right");
          assert.equal(await dateFormat(), "Mixed format");
          // Test that both change when format is changed.
          for (const mode of ["MM/DD/YY", "DD-MM-YYYY"]) {
            await dateFormat(mode);
            await selectColumns("Left");
            assert.equal(await dateFormat(), mode);
            await selectColumns("Right");
            assert.equal(await dateFormat(), mode);
            await selectColumns("Left", "Right");
            assert.equal(await dateFormat(), mode);
          }
          // Test that custom format works
          await gu.setCustomDateFormat("MM");
          await selectColumns("Left");
          assert.equal(await gu.getDateFormat(), "MM");
          await selectColumns("Right");
          assert.equal(await gu.getDateFormat(), "MM");
          await selectColumns("Left", "Right");
          assert.equal(await gu.getDateFormat(), "MM");
          // Test that we can go back to normal format.
          await gu.setDateFormat("MM/DD/YY");
          assert.isFalse(await customDateFormatVisible());
          await selectColumns("Left");
          assert.isFalse(await customDateFormatVisible());
          assert.equal(await gu.getDateFormat(), "MM/DD/YY");
          await selectColumns("Right");
          assert.isFalse(await customDateFormatVisible());
          assert.equal(await gu.getDateFormat(), "MM/DD/YY");
        });
      }
    }
  });

  describe(`test for Toggle column`, function() {
    beforeEach(async () => {
      await gu.addColumn("Left", "Toggle");
    });
    afterEach(async function() {
      if (this.currentTest?.state === "passed") {
        await removeColumn("Left");
        await removeColumn("Right");
      }
    });
    for (const right of types) {
      it(`should work with ${right} column`, async function() {
        await gu.addColumn("Right", right);
        // There is not match to test
        if (right === "Toggle") {
          await selectColumns("Left", "Right");
          assert.isFalse(await widgetTypeDisabled());
          // Test for mixed format.
          await selectColumns("Left");
          await gu.setFieldWidgetType("TextBox");
          await selectColumns("Right");
          await gu.setFieldWidgetType("CheckBox");
          await selectColumns("Left", "Right");
          assert.equal(await gu.getFieldWidgetType(), "Mixed format");
          // Test that both change when format is changed.
          for (const mode of ["TextBox", "CheckBox", "Switch"]) {
            await gu.setFieldWidgetType(mode);
            await selectColumns("Left");
            assert.equal(await gu.getFieldWidgetType(), mode);
            await selectColumns("Right");
            assert.equal(await gu.getFieldWidgetType(), mode);
            await selectColumns("Left", "Right");
            assert.equal(await gu.getFieldWidgetType(), mode);
          }
        } else {
          await selectColumns("Left", "Right");
          assert.isTrue(await widgetTypeDisabled());
        }
      });
    }
  });

  // Any and Text column are identical in terms of formatting.
  for (const left of ["Text", "Any"]) {
    describe(`test for ${left} column`, function() {
      beforeEach(async () => {
        await gu.addColumn("Left", left);
      });
      afterEach(async function() {
        if (this.currentTest?.state === "passed") {
          await removeColumn("Left");
          await removeColumn("Right");
        }
      });
      for (const right of types) {
        it(`should work with ${right} column`, async function() {
          await gu.addColumn("Right", right);
          await selectColumns("Left", "Right");
          if (left === "Text") {
            if (right === "Text") {
              assert.isFalse(await widgetTypeDisabled());
            } else {
              assert.isTrue(await widgetTypeDisabled());
            }
          }
          await commonTestsForAny(right);
        });
      }
    });
  }

  describe(`test for Attachment column`, function() {
    beforeEach(async () => {
      await gu.addColumn("Left", "Attachment");
    });
    afterEach(async function() {
      if (this.currentTest?.state === "passed") {
        await removeColumn("Left");
        await removeColumn("Right");
      }
    });
    // Test for types that matter (have different set of defaults).
    for (const right of ["Any", "Attachment"]) {
      it(`should work with ${right} column`, async function() {
        await gu.addColumn("Right", right);
        await selectColumns("Left", "Right");
        if (right !== "Attachment") {
          assert.isTrue(await sliderDisabled());
        } else {
          assert.isFalse(await sliderDisabled());
          // Test it works as expected
          await slider(16); // min value
          assert.equal(await slider(), 16);
          await selectColumns("Left");
          assert.equal(await slider(), 16);
          await selectColumns("Right");
          assert.equal(await slider(), 16);
          // Set max for Right column, left still has minium
          await slider(96); // max value
          await selectColumns("Left", "Right");
          // When mixed, slider is in between.
          assert.equal(await slider(), (96 - 16) / 2 + 16);
        }
      });
    }
  });
});
