import { mayAffectSyncedData } from "app/server/lib/Sharing";
import { S, td } from "test/server/lib/ActionSummaryTestHelpers";
import { assert } from "test/server/testUtils";

describe("Sharing", function() {
  describe("mayAffectSyncedData", function() {
    it("counts user tables and schema metadata", function() {
      assert.isTrue(mayAffectSyncedData(S([], { Table1: td() })));
      assert.isTrue(mayAffectSyncedData(S([["Table1", "Table2"]])));
      // A removed table arrives as [name, null] and its id is reported "-"-prefixed.
      assert.isTrue(mayAffectSyncedData(S([["Table1", null]])));
      assert.isTrue(mayAffectSyncedData(S([[null, "Table1"]])));
      // Schema changes to a user table can surface only as metadata deltas, so these count.
      assert.isTrue(mayAffectSyncedData(S([], { _grist_Tables: td() })));
      assert.isTrue(mayAffectSyncedData(S([], { _grist_Tables_column: td() })));
      assert.isTrue(mayAffectSyncedData(S([], { _grist_Views: td(), Table1: td() })));
    });

    it("ignores other metadata and empty summaries", function() {
      assert.isFalse(mayAffectSyncedData(S([])));
      assert.isFalse(mayAffectSyncedData(S([], { _grist_Views: td() })));
      assert.isFalse(mayAffectSyncedData(S([], { _grist_ACLRules: td() })));
      assert.isFalse(mayAffectSyncedData(S([], { _grist_Syncs: td() })));
      assert.isFalse(mayAffectSyncedData(S([], {
        _grist_Views: td(), _grist_Views_section: td(), _grist_ACLResources: td(),
      })));
      assert.isFalse(mayAffectSyncedData(S([["_grist_Syncs", null]])));
    });
  });
});
