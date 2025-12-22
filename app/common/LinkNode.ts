/**
 * Utilities for creating and validating LinkNodes.
 *
 * A LinkNode is a representation of a node in a widget linking chain.
 *
 * Used by both the client and server to build a list of valid linking options.
 * See `app/client/ui/selectBy.ts` and `app/server/lib/selectBy.ts`, respectively.
 */

import { getReferencedTableId } from "app/common/gristTypes";
import * as gutil from "app/common/gutil";
import pick from "lodash/pick";

export interface LinkNodeSection {
  id: number;
  tableRef: number;
  parentId: number;
  tableId: string;
  parentKey: string;
  title: string;
  linkSrcSectionRef: number;
  linkSrcColRef: number;
  linkTargetColRef: number;
  allowSelectBy?: boolean;
  selectedRowsActive?: boolean;
}

export interface LinkNodeColumn {
  id: number;
  colId: string;
  label: string;
  type: string;
  summarySourceCol: number;
}

export interface LinkNodeTable {
  id: number;
  tableId: string;
  isSummaryTable: boolean;
  columns: LinkNodeColumn[];
}

export interface LinkNode {
  // the tableId
  tableId: string;

  // is the table a summary table
  isSummary: boolean;

  // does this node involve an "Attachments" column. Can be tricky if Attachments is one of groupby cols
  isAttachments: boolean;

  // For a summary table, the set of col refs of the groupby columns of the underlying table
  groupbyColumns?: Set<number>;

  // list of ids of the sections that are ancestors to this section according to the linked section
  // relationship. ancestors[0] is this.section, ancestors[length-1] is oldest ancestor
  ancestors: number[];

  // For bidirectional linking, cycles are only allowed if all links on that cycle are same-table cursor-link
  // this.ancestors only records what the ancestors are, but we need to record info about the edges between them.
  // isAncCursLink[i]==true  means the link from ancestors[i] to ancestors[i+1] is a same-table cursor-link
  // NOTE: (Since ancestors is a list of nodes, and this is a list of the edges between those nodes, this list will
  //        be 1 shorter than ancestors (if there's no cycle), or will be the same length (if there is a cycle))
  isAncestorSameTableCursorLink: boolean[];

  // the section. Must be the empty sections that are to be created.
  section: LinkNodeSection;

  // the column or undefined for the main section node (ie: the node that does not connect to
  // any particular column)
  column?: LinkNodeColumn;

  // the widget type
  widgetType: string;
}

export interface LinkNodeOperations {
  getTableById(id: number): LinkNodeTable;
  getSectionById(id: number): LinkNodeSection;
}

export function buildLinkNodes(
  sections: LinkNodeSection[],
  operations: LinkNodeOperations
): LinkNode[] {
  const { getTableById, getSectionById } = operations;
  const nodes: LinkNode[] = [];
  for (const section of sections) {
    const ancestors: number[] = [];
    const isAncestorSameTableCursorLink: boolean[] = [];

    let currentSection: LinkNodeSection | undefined = section;
    while (currentSection) {
      if (ancestors.includes(currentSection.id)) {
        break;
      }

      ancestors.push(currentSection.id);

      const linkedSectionId: number | undefined =
        currentSection.linkSrcSectionRef;
      let linkedSection: LinkNodeSection | undefined;
      if (linkedSectionId) {
        linkedSection = getSectionById(linkedSectionId);
        const sourceColumn = linkedSection.linkSrcColRef;
        const targetColumn = linkedSection.linkTargetColRef;
        const sourceTable = getTableById(linkedSection.parentId);
        isAncestorSameTableCursorLink.push(
          sourceColumn === 0 &&
            targetColumn === 0 &&
            !sourceTable.isSummaryTable
        );
      }

      currentSection = linkedSection;
    }

    const table = getTableById(section.tableRef);
    const { columns, isSummaryTable } = table;
    const groupByCols = columns.filter(c => c.summarySourceCol);
    const groupByColIds = new Set(groupByCols.map(c => c.summarySourceCol));
    const mainNode: LinkNode = {
      tableId: table.tableId,
      isSummary: isSummaryTable,
      isAttachments:
        isSummaryTable && groupByCols.some(col => col.type === "Attachments"),
      groupbyColumns: isSummaryTable ? groupByColIds : undefined,
      widgetType: section.parentKey,
      ancestors,
      isAncestorSameTableCursorLink,
      section: {
        ...pick(
          section,
          "id",
          "parentId",
          "parentKey",
          "title",
          "linkSrcSectionRef",
          "linkSrcColRef",
          "linkTargetColRef",
          "allowSelectBy",
          "selectedRowsActive"
        ),
        tableRef: table.id,
        tableId: table.tableId,
      },
    };

    nodes.push(mainNode, ...buildRefColLinkNodes(columns, mainNode));
  }
  return nodes;
}

export function buildRefColLinkNodes(
  columns: LinkNodeColumn[],
  parent: LinkNode
): LinkNode[] {
  const nodes: LinkNode[] = [];
  for (const column of columns) {
    const tableId = getReferencedTableId(column.type);
    if (tableId) {
      nodes.push({
        ...parent,
        tableId,
        column: pick(
          column,
          "id",
          "colId",
          "label",
          "type",
          "summarySourceCol"
        ),
        isAttachments: column.type == "Attachments",
      });
    }
  }
  return nodes;
}

// Returns true if this node corresponds to the special 'group' reflist column of a summary table
export function isSummaryGroup(node: LinkNode): boolean {
  return node.isSummary && node.column?.colId === "group";
}

// Returns true is the link from `source` to `target` is valid, false otherwise.
export function isValidLink(source: LinkNode, target: LinkNode) {
  // section must not be the same
  if (source.section.id === target.section.id) {
    return false;
  }

  // table must match
  if (source.tableId !== target.tableId) {
    return false;
  }

  // Can only link to the somewhat special 'group' reflist column of summary tables
  // with another ref/reflist column that isn't also a group column
  // because otherwise it's equivalent to the usual summary table linking but potentially slower
  if (
    (isSummaryGroup(source) && (!target.column || isSummaryGroup(target))) ||
    isSummaryGroup(target)
  ) {
    return false;
  }

  // Cannot directly link a summary table to a column referencing the source table.
  // Instead the ref column must link against the group column of the summary table, which is allowed above.
  // The 'group' column name will be hidden from the options so it feels like linking using summaryness.
  if (
    (source.isSummary && !source.column && target.column) ||
    (target.isSummary && !target.column && source.column)
  ) {
    return false;
  }

  // If the target is a summary table and we're linking based on 'summaryness' (i.e. there are no ref columns)
  // then the source must be a less detailed summary table, i.e. having a subset of the groupby columns.
  // (or they should be the same summary table for same-record linking, which this check allows through)
  if (
    !source.column &&
    !target.column &&
    target.isSummary &&
    !(
      source.isSummary &&
      gutil.isSubset(source.groupbyColumns!, target.groupbyColumns!)
    )
  ) {
    return false;
  }

  //cannot select from attachments, even though they're implemented as reflists
  if (source.isAttachments || target.isAttachments) {
    return false;
  }

  // cannot select from chart
  if (source.widgetType === "chart") {
    return false;
  }

  if (source.widgetType === "custom") {
    // custom widget do not support linking by columns
    if (source.tableId !== source.section.tableId) {
      return false;
    }

    // custom widget must allow select by
    if (!source.section.allowSelectBy) {
      return false;
    }
  }

  // The link must not create a cycle, unless it's only same-table cursor-links all the way to target
  if (source.ancestors.includes(target.section.id)) {
    // cycles only allowed for cursor links
    if (source.column || target.column || source.isSummary) {
      return false;
    }

    // If one of the section has custom row filter, we can't make cycles.
    if (target.section.selectedRowsActive) {
      return false;
    }

    // We know our ancestors cycle back around to ourselves
    // - lets walk back along the cyclic portion of the ancestor chain and verify that each link in that chain is
    //   a cursor-link

    // e.g. if the current link graph is:
    //                     A->B->TGT->C->D->SRC
    //    (SRC.ancestors):[5][4] [3] [2][1] [0]
    // We're verifying the new potential link SRC->TGT, which would turn the graph into:
    //             [from SRC] -> TGT -> C -> D -> SRC -> [to TGT]
    // (Note that A and B will be cut away, since we change TGT's link source)
    //
    // We need to make sure that each link going backwards from `TGT -> C -> D -> SRC` is a same-table-cursor-link,
    // since we disallow cycles with other kinds of links.
    // isAncestorCursorLink[i] will tell us if the link going into ancestors[i] is a same-table-cursor-link
    // So before we step from i=0 (SRC) to i=1 (D), we check isAncestorCursorLink[0], which tells us about D->SRC
    let i;
    for (i = 0; i < source.ancestors.length; i++) {
      // Walk backwards through the ancestors

      // Once we hit the target section, we've seen all links that will be part of the cycle, and they've all been valid
      if (source.ancestors[i] == target.section.id) {
        break; // Success!
      }

      // Check that the link to the preceding section is valid
      // NOTE! isAncestorSameTableCursorLink could be 1 shorter than ancestors!
      // (e.g. if the graph looks like A->B->C, there's 3 ancestors but only two links)
      // (however, if there's already a cycle, they'll be the same length ( [from C]->A->B->C, 3 ancestors & 3 links)
      // If the link doesn't exist (shouldn't happen?) OR the link is not same-table-cursor, the cycle is invalid
      if (
        i >= source.isAncestorSameTableCursorLink.length ||
        !source.isAncestorSameTableCursorLink[i]
      ) {
        return false;
      }
    }

    // If we've hit the last ancestor and haven't found target, error out (shouldn't happen!, we checked for it)
    if (i == source.ancestors.length) {
      throw Error("Array doesn't include targetSection");
    }

    // Yay, this is a valid cycle of same-table cursor-links
  }

  return true;
}
