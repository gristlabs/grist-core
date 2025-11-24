import { makeT } from 'app/client/lib/localization';
import { DocModel, ViewSectionRec } from 'app/client/models/DocModel';
import { IPageWidget } from 'app/client/ui/PageWidgetPicker';
import {
  buildLinkNodes,
  buildRefColLinkNodes,
  isSummaryGroup,
  isValidLink,
  LinkNode,
  LinkNodeColumn,
  LinkNodeOperations,
  LinkNodeSection,
  LinkNodeTable,
} from 'app/common/LinkNode';
import { IOptionFull } from 'grainjs';
import isEqual = require('lodash/isEqual');

const t = makeT('selectBy');

// some unicode characters
const BLACK_CIRCLE = '\u2022';
const RIGHT_ARROW = '\u2192';

// Describes a link
export interface IPageWidgetLink {

  // The source section id
  srcSectionRef: number;

  // The source column id
  srcColRef: number;

  // The target col id
  targetColRef: number;
}

export const NoLink = linkId({
  srcSectionRef: 0,
  srcColRef: 0,
  targetColRef: 0
});


// Represents the differents way to reference to a section for linking
type MaybeSection = ViewSectionRec|IPageWidget;


// Returns a list of options with all links that link one of the `source` section to the `target`
// section. Each `opt.value` is a unique identifier (see: linkId() and linkFromId() for more
// detail), and `opt.label` is a human readable representation of the form
// `<section_name>[.<source-col-name>][ -> <target-col-name>]` where the <source-col-name> appears
// only when linking from a reference column, as opposed to linking from the table directly. And the
// <target-col-name> shows only when both <section_name>[.<source-col-name>] is ambiguous.
export function selectBy(docModel: DocModel, sources: ViewSectionRec[],
                         target: MaybeSection): Array<IOptionFull<string>> {
  const sourceNodes = createNodesFromViewSections(docModel, sources);
  const targetNodes = isViewSectionRec(target)
    ? createNodesFromViewSections(docModel, [target])
    : createNodesFromPageWidget(docModel, target);


  const NoLinkOption: IOptionFull<string> = {
    label: t("Select widget"),
    value: NoLink
  };
  const options = [NoLinkOption];
  for (const srcNode of sourceNodes) {
    const validTargets = targetNodes.filter((tgt) => isValidLink(srcNode, tgt));
    const hasMany = validTargets.length > 1;
    for (const tgtNode of validTargets) {

      // a unique identifier for this link
      const value = linkId({
        srcSectionRef: srcNode.section.id,
        srcColRef: srcNode.column ? srcNode.column.id : 0,
        targetColRef: tgtNode.column ? tgtNode.column.id : 0,
      });

      // a human readable description
      let label = srcNode.section.title;

      // add the source node col name (except for 'group') or nothing for table node
      if (srcNode.column && !isSummaryGroup(srcNode)) {
        label += ` ${BLACK_CIRCLE} ${srcNode.column.label}`;
      }

      // add the target column name (except for 'group') when clarification is needed, i.e. if either:
      // - target has multiple valid nodes, or
      // - source col is 'group' and is thus hidden.
      //     Need at least one column name to distinguish from simply selecting by summary table.
      //     This is relevant when a table has a column referencing itself.
      if (tgtNode.column && !isSummaryGroup(tgtNode) && (hasMany || isSummaryGroup(srcNode))) {
        label += ` ${RIGHT_ARROW} ${tgtNode.column.label}`;
      }

      // add the new option
      options.push({ label, value });
    }
  }
  return options;
}

function isViewSectionRec(section: MaybeSection): section is ViewSectionRec {
  return Boolean((section as ViewSectionRec).getRowId);
}

function createNodesFromViewSections(
  docModel: DocModel,
  viewSections: ViewSectionRec[]
): LinkNode[] {
  const operations: LinkNodeOperations = {
    getTableById: (id) => getLinkNodeTableById(docModel, id),
    getSectionById: (id) => getLinkNodeSectionById(docModel, id),
  };
  const sections = viewSections
    .filter((s) => !s.isDisposed())
    .map((s) => getLinkNodeSectionById(docModel, s.getRowId()));
  return buildLinkNodes(sections, operations);
}

function getLinkNodeTableById(docModel: DocModel, id: number): LinkNodeTable {
  const table = docModel.tables.getRowModel(id);
  return {
    id: table.getRowId(),
    tableId: table.primaryTableId.peek(),
    isSummaryTable: table.primaryTableId.peek() !== table.tableId.peek(),
    columns: table.columns
      .peek()
      .all()
      .map((c) => ({
        id: c.getRowId(),
        colId: c.colId.peek(),
        label: c.label.peek(),
        type: c.type.peek(),
        summarySourceCol: c.summarySourceCol.peek(),
      })),
  };
}

function getLinkNodeSectionById(
  docModel: DocModel,
  id: number
): LinkNodeSection {
  const section = docModel.viewSections.getRowModel(id);
  return {
    id: section.getRowId(),
    tableRef: section.table.peek().getRowId(),
    parentId: section.parentId.peek(),
    tableId: section.table.peek().primaryTableId.peek(),
    parentKey: section.parentKey.peek(),
    title: section.titleDef.peek(),
    allowSelectBy: section.allowSelectBy.peek(),
    selectedRowsActive: section.selectedRowsActive.peek(),
    linkSrcSectionRef: section.linkSrcSection.peek().getRowId(),
    linkSrcColRef: section.linkSrcCol.peek().getRowId(),
    linkTargetColRef: section.linkTargetCol.peek().getRowId(),
  };
}

// Creates an array of LinkNode from a page widget.
function createNodesFromPageWidget(docModel: DocModel, pageWidget: IPageWidget): LinkNode[] {

  if (typeof pageWidget.table !== 'number') { return []; }

  const nodes: LinkNode[] = [];
  let table = docModel.tables.getRowModel(pageWidget.table);
  const isSummary = pageWidget.summarize;
  const groupbyColumns = isSummary ? new Set(pageWidget.columns) : undefined;
  let tableExists = true;
  if (isSummary) {
    const summaryTable = docModel.tables.rowModels.find(
      tr  => tr?.summarySourceTable.peek() && isEqual(tr.summarySourceColRefs.peek(), groupbyColumns));
    if (summaryTable) {
      // The selected source table and groupby columns correspond to this existing summary table.
      table = summaryTable;
    } else {
      // This summary table doesn't exist yet. `fromColumns` will be using columns from the source table.
      // Make sure it only uses columns that are in the selected groupby columns.
      // The resulting targetColRef will incorrectly be from the source table,
      // but will be corrected in GristDoc.saveLink after the summary table is created.
      tableExists = false;
    }
  }

  const section = docModel.viewSections.getRowModel(pageWidget.section);
  const mainNode: LinkNode = {
    tableId: table.primaryTableId.peek(),
    isSummary,
    isAttachments: false, // hmm, we should need a check here in case attachments col is on the main-node link
    // (e.g.: link from summary table with Attachments in group-by) but it seems to work fine as is
    groupbyColumns,
    widgetType: pageWidget.type,
    ancestors: [],
    isAncestorSameTableCursorLink: [],
    section: {
      id: section.getRowId(),
      tableRef: section.tableRef.peek(),
      parentId: section.parentId.peek(),
      tableId: section.table.peek().primaryTableId.peek(),
      parentKey: section.parentKey.peek(),
      title: section.titleDef.peek(),
      linkSrcSectionRef: section.linkSrcSectionRef.peek(),
      linkSrcColRef: section.linkSrcColRef.peek(),
      linkTargetColRef: section.linkTargetColRef.peek(),
      allowSelectBy: section.allowSelectBy.peek(),
      selectedRowsActive: section.selectedRowsActive.peek(),
    },
  };
  nodes.push(mainNode);

  let columns: LinkNodeColumn[] = table.columns.peek().peek().map(c => ({
    id: c.getRowId(),
    colId: c.colId.peek(),
    label: c.label.peek(),
    type: c.type.peek(),
    summarySourceCol: c.summarySourceCol.peek(),
  }));
  if (!tableExists) {
    columns = columns.filter(c => mainNode.groupbyColumns!.has(c.id));
  }
  nodes.push(...buildRefColLinkNodes(columns, mainNode));
  return nodes;
}

// Returns an identifier to uniquely identify a link. Here we adopt a simple approach where
// {srcSectionRef: 2, srcColRef: 3, targetColRef: 3} is turned into "[2, 3, 3]".
export function linkId(link: IPageWidgetLink) {
  return JSON.stringify([link.srcSectionRef, link.srcColRef, link.targetColRef]);
}

// Returns link's properties from its identifier.
export function linkFromId(linkid: string): IPageWidgetLink {
  const [srcSectionRef, srcColRef, targetColRef] = JSON.parse(linkid);
  return {srcSectionRef, srcColRef, targetColRef};
}
