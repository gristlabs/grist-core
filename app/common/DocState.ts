import { ActionSummary, createEmptyActionSummary } from "app/common/ActionSummary";
// Because of -ti files, DocState needs to be in DocumentSettings.
import { DocState } from "app/common/DocumentSettings";

export type { DocState };

/**
 * A list of document states.  Most recent is first.
 */
export interface DocStates {
  states: DocState[];
}

/**
 * A comparison between two documents, called "left" and "right".
 * The comparison is based on the action histories in the documents.
 * If those histories have been truncated, the comparison may report
 * two documents as being unrelated even if they do in fact have some
 * shared history.
 */
export interface DocStateComparison {
  left: DocState;         // left / local document
  right: DocState;        // right / remote document
  parent: DocState | null;  // most recent common ancestor of left and right
  // summary of the relationship between the two documents.
  //        same: documents have the same most recent state
  //        left: the left document has actions not yet in the right
  //       right: the right document has actions not yet in the left
  //        both: both documents have changes (possible divergence)
  //   unrelated: no common history found
  summary: "same" | "left" | "right" | "both" | "unrelated";
  // optionally, details of what changed may be included.
  details?: DocStateComparisonDetails;
}

/**
 * Detailed comparison between document versions.  For now, this
 * is provided as a pair of ActionSummary objects, relative to
 * the most recent common ancestor.
 */
export interface DocStateComparisonDetails {
  leftChanges: ActionSummary;
  rightChanges: ActionSummary;
}

export function removeMetadataChangesFromDetails(details: DocStateComparisonDetails) {
  const { summary: leftChanges, hadMetadata: leftHadMetadata } = removeMetadataChangesFromSummary(details.leftChanges);
  const { summary: rightChanges, hadMetadata: rightHadMetadata } =
    removeMetadataChangesFromSummary(details.rightChanges);
  return {
    details: {
      leftChanges,
      rightChanges,
    },
    leftHadMetadata,
    rightHadMetadata,
  };
}

function removeMetadataChangesFromSummary(summary: ActionSummary) {
  const result = createEmptyActionSummary();
  result.tableRenames = summary.tableRenames;
  const tables = Object.keys(summary.tableDeltas);
  const metaTables = new Set();
  for (const table of tables) {
    if (table.startsWith("_grist_")) {
      metaTables.add(table);
      continue;
    }
    result.tableDeltas[table] = summary.tableDeltas[table];
  }
  return {
    summary: result,
    hadMetadata: metaTables.size > 0,
  };
}
