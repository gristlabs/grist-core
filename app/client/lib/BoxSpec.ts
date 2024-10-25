import {Layout} from 'app/client/components/Layout';
import {dom} from 'grainjs';
import * as _ from 'underscore';

export interface BoxSpec {
  leaf?: string|number;
  size?: number;
  children?: BoxSpec[];
  collapsed?: BoxSpec[];
}

export function purgeBoxSpec(options: {
  spec: BoxSpec;
  validLeafIds: number[];
  restoreCollapsed?: boolean;
}): BoxSpec {
  const {spec, validLeafIds, restoreCollapsed} = options;
  // We use tmpLayout as a way to manipulate the layout before we get a final spec from it.
  const tmpLayout = Layout.create(spec, () => dom('div'), true);
  const specFieldIds = tmpLayout.getAllLeafIds();

  // For any stale fields (no longer among validLeafIds), remove them from tmpLayout.
  _.difference(specFieldIds, validLeafIds).forEach(function(leafId: string | number) {
    tmpLayout.getLeafBox(leafId)?.dispose();
  });

  // For all fields that should be in the spec but aren't, add them to tmpLayout. We maintain a
  // two-column layout, so add a new row, or a second box to the last row if it's a leaf.
  const missingLeafs = _.difference(validLeafIds, specFieldIds);
  const collapsedLeafs = new Set((spec.collapsed || []).map(c => c.leaf));
  missingLeafs.forEach(function(leafId: any) {
    // Omit collapsed leafs from the spec.
    if (!collapsedLeafs.has(leafId)) {
      addToSpec(tmpLayout, leafId);
    }
  });

  const newSpec = tmpLayout.getLayoutSpec();

  // Restore collapsed state, omitting any leafs that are no longer valid.
  if (spec.collapsed && restoreCollapsed) {
    newSpec.collapsed = spec.collapsed.filter(c => c.leaf && validLeafIds.includes(c.leaf as number));
  }

  tmpLayout.dispose();
  return newSpec;
}

function addToSpec(tmpLayout: Layout, leafId: number) {
  const newBox = tmpLayout.buildLayoutBox({leaf: leafId});
  const root = tmpLayout.rootBox();
  if (!root || root.isDisposed()) {
    tmpLayout.setRoot(newBox);
    return newBox;
  }
  const rows = root.childBoxes.peek();
  const lastRow = rows[rows.length - 1];
  if (rows.length >= 1 && lastRow.isLeaf()) {
    // Add a new child to the last row.
    lastRow.addChild(newBox, true);
  } else {
    // Add a new row.
    tmpLayout.rootBox()!.addChild(newBox, true);
  }
  return newBox;
}
