import { buildLinkNodes, LinkNodeSection, LinkNodeTable } from "app/common/LinkNode";

import { assert } from "chai";

describe("LinkNode", function() {
  it("judges each link in a chain by the widget it selects", function() {
    const table: LinkNodeTable = { id: 1, tableId: "Deals", isSummaryTable: false, columns: [] };
    const widget = (id: number, link: Partial<LinkNodeSection> = {}): LinkNodeSection => ({
      id, tableRef: 1, parentId: 1, tableId: "Deals", parentKey: "record", title: "",
      linkSrcSectionRef: 0, linkSrcColRef: 0, linkTargetColRef: 0, ...link,
    });
    // Widget 1 selects widget 2 by cursor, and widget 2 selects widget 3 by a column.
    const widgets: Record<number, LinkNodeSection> = {
      1: widget(1),
      2: widget(2, { linkSrcSectionRef: 1 }),
      3: widget(3, { linkSrcSectionRef: 2, linkSrcColRef: 5 }),
    };
    const [node] = buildLinkNodes([widgets[3]], {
      getTableById: () => table,
      getSectionById: id => widgets[id],
    });
    assert.deepEqual(node.ancestors, [3, 2, 1]);
    // The link into 3 is by a column, and the link into 2 is a cursor link.
    assert.deepEqual(node.isAncestorSameTableCursorLink, [false, true]);
  });
});
