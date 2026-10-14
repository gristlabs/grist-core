import { DataLimitTransitions, getDataLimitFeature } from "app/common/DocLimits";
import { DocumentUsage } from "app/common/DocUsage";
import { Features } from "app/common/Features";

import { assert } from "chai";
import moment from "moment-timezone";

const productFeatures: Features = {
  baseMaxRowsPerDocument: 100,
  baseMaxDataSizePerDocument: 1000,
  baseMaxAttachmentsBytesPerDocument: 10000,
  gracePeriodDays: 14,
};

function usage(u: { rows?: number, dataSize?: number, attachments?: number }): DocumentUsage {
  return {
    rowCount: u.rows === undefined ? undefined : { total: u.rows },
    dataSizeBytes: u.dataSize,
    attachmentsSizeBytes: u.attachments,
  };
}

/**
 * The bookkeeping behind limit telemetry: which data limit a document is closest to, and
 * which changes in its status are worth an event. What reaches telemetry is covered in
 * test/gen-server/lib/limitTelemetry.ts, against a real document.
 */
describe("DocLimits", function() {
  describe("DataLimitTransitions", function() {
    it("reports each transition once", function() {
      const transitions = new DataLimitTransitions();
      const update = (docUsage: DocumentUsage, gracePeriodStart: Date | null = null) =>
        transitions.update({ docUsage, productFeatures, gracePeriodStart });

      // The first update only records a baseline, so start below every threshold. Past 0.9 of
      // a limit is "approaching"; over it is "exceeded" while the 14-day grace period lasts,
      // and "readOnly" once it has run out.
      assert.deepEqual(update(usage({ rows: 10 })), null);
      assert.deepEqual(update(usage({ rows: 95 })), { feature: "rows", status: "approaching" });
      assert.deepEqual(update(usage({ rows: 96 })), null);
      assert.deepEqual(update(usage({ rows: 110 }), new Date()), { feature: "rows", status: "exceeded" });
      assert.deepEqual(update(usage({ rows: 120 }), new Date()), null);
      const oldStart = moment().subtract(20, "days").toDate();
      assert.deepEqual(update(usage({ rows: 120 }), oldStart), { feature: "rows", status: "readOnly" });
    });

    it("keeps the limiting feature when the status is cleared", function() {
      const transitions = new DataLimitTransitions();
      const update = (docUsage: DocumentUsage, gracePeriodStart: Date | null = null) =>
        transitions.update({ docUsage, productFeatures, gracePeriodStart });

      assert.deepEqual(update(usage({ rows: 10 })), null);
      assert.deepEqual(update(usage({ rows: 110, dataSize: 100 }), new Date()),
        { feature: "rows", status: "exceeded" });
      // Data size now has the higher ratio, but rows is the feature that was limiting.
      assert.deepEqual(update(usage({ rows: 10, dataSize: 500 })), { feature: "rows", status: "cleared" });
    });
  });

  describe("getDataLimitFeature", function() {
    it("returns null when nothing is limited", function() {
      assert.isNull(getDataLimitFeature(null, productFeatures));
      assert.isNull(getDataLimitFeature(usage({ rows: 0 }), productFeatures));
      assert.isNull(getDataLimitFeature(usage({ rows: 50 }), undefined));
    });

    it("returns the feature closest to its limit", function() {
      assert.equal(getDataLimitFeature(usage({ rows: 50, dataSize: 100 }), productFeatures), "rows");
      assert.equal(getDataLimitFeature(usage({ rows: 50, dataSize: 900 }), productFeatures), "dataSize");
      assert.equal(getDataLimitFeature(usage({ rows: 50, attachments: 9000 }), productFeatures), "attachments");
    });
  });
});
