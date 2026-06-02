// Split from MultiColumn.ts to parallelize across mocha workers.

import * as gu from "test/nbrowser/gristUtils";
import {
  commonTestsForAny,
  removeColumn,
  selectColumns,
  setupMultiColumnDoc,
  slider,
  sliderDisabled,
  types,
  widgetTypeDisabled,
} from "test/nbrowser/multiColumnHelpers";
import { setupTestSuite } from "test/nbrowser/testUtils";

import { assert } from "mocha-webdriver";

describe("MultiColumn3", function() {
  this.timeout(80000);
  const cleanup = setupTestSuite();
  before(async function() {
    await setupMultiColumnDoc(cleanup);
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
