import { getSelectByOptions } from "app/server/lib/selectBy";
import { createDocTools } from "test/server/docTools";

import { assert } from "chai";

describe("selectBy", function() {
  const docTools = createDocTools();

  it("lists options on a page where one widget already selects another", async function() {
    const session = docTools.createFakeSession();
    const doc = await docTools.createDoc("selectBy.grist");
    await doc.applyUserActions(session, [["AddTable", "Deals", [{ id: "Name" }]]]);
    // A second page, so its id matches no table's.
    const a = await doc.applyUserActions(session, [["CreateViewSection", 1, 0, "record", null, null]]);
    const { viewRef, sectionRef: widgetA } = a.retValues[0];
    const b = await doc.applyUserActions(session, [["CreateViewSection", 1, viewRef, "record", null, null]]);
    const widgetB = b.retValues[0].sectionRef;
    await doc.applyUserActions(session, [
      ["UpdateRecord", "_grist_Views_section", widgetB, { linkSrcSectionRef: widgetA }],
    ]);
    assert.deepEqual(getSelectByOptions(doc.docData!, widgetA), [
      { link_from_widget_id: widgetB, link_from_column_id: null, link_to_column_id: null },
    ]);
  });
});
