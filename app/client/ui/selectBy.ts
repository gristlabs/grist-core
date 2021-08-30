import { ColumnRec, DocModel, TableRec, ViewSectionRec } from 'app/client/models/DocModel';
import { IPageWidget } from 'app/client/ui/PageWidgetPicker';
import { getReferencedTableId } from 'app/common/gristTypes';
import { IOptionFull } from 'grainjs';
import * as assert from 'assert';

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

const NoLinkOption: IOptionFull<string> = {
  label: "Select Widget",
  value: NoLink
};


interface LinkNode {
  // the tableId
  tableId: string;

  // is the table a summary table
  isSummary: boolean;

  // list of ids of the sections that are ancestors to this section according to the linked section
  // relationship
  ancestors: Set<number>;

  // the section record. Must be the empty record sections that are to be created.
  section: ViewSectionRec;

  // the column record or undefined for the main section node (ie: the node that does not connect to
  // any particular column)
  column?: ColumnRec;

  // the widget type
  widgetType: string;
}


// Returns true is the link from `source` to `target` is valid, false otherwise.
function isValidLink(source: LinkNode, target: LinkNode) {

  // section must not be the same
  if (source.section.getRowId() === target.section.getRowId()) {
    return false;
  }

  // table must match
  if (source.tableId !== target.tableId) {
    return false;
  }

  // summary table can only link to and from the main node (node with no column)
  if ((source.isSummary || target.isSummary) && (source.column || target.column)) {
    return false;
  }

  // cannot select from chart or custom
  if (['chart', 'custom'].includes(source.widgetType)) {
    return false;
  }

  // The link must not create a cycle
  if (source.ancestors.has(target.section.getRowId())) {
    return false;
  }

  return true;
}

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
  const sourceNodes = createNodes(docModel, sources);
  const targetNodes = createNodes(docModel, [target]);

  const options = [NoLinkOption];
  for (const srcNode of sourceNodes) {
    const validTargets = targetNodes.filter((tgt) => isValidLink(srcNode, tgt));
    const hasMany = validTargets.length > 1;
    for (const tgtNode of validTargets) {

      // a unique identifier for this link
      const value = linkId({
        srcSectionRef: srcNode.section.getRowId(),
        srcColRef: srcNode.column ? srcNode.column.getRowId() : 0,
        targetColRef: tgtNode.column ? tgtNode.column.getRowId() : 0,
      });

      // a human readable description
      let label = srcNode.section.titleDef();

      // add the source node col name or nothing for table node
      label += srcNode.column ? ` ${BLACK_CIRCLE} ${srcNode.column.label.peek()}` : '';

      // add the target column name only if target has multiple valid nodes
      label += hasMany && tgtNode.column ? ` ${RIGHT_ARROW} ${tgtNode.column.label.peek()}` : '';

      // add the new option
      options.push({ label, value });
    }
  }
  return options;
}

function isViewSectionRec(section: MaybeSection): section is ViewSectionRec {
  return Boolean((section as ViewSectionRec).getRowId);
}

// Create all nodes for sections.
function createNodes(docModel: DocModel, sections: MaybeSection[]) {
  const nodes = [];
  for (const section of sections) {
    if (isViewSectionRec(section)) {
      nodes.push(...fromViewSectionRec(section));
    } else {
      nodes.push(...fromPageWidget(docModel, section));
    }
  }
  return nodes;
}

// Creates an array of LinkNode from a view section record.
function fromViewSectionRec(section: ViewSectionRec): LinkNode[] {
  const table = section.table.peek();
  const ancestors = new Set<number>();

  for (let sec = section; sec.getRowId(); sec = sec.linkSrcSection.peek()) {
    if (ancestors.has(sec.getRowId())) {
      // tslint:disable-next-line:no-console
      console.warn(`Links should not create a cycle - section ids: ${Array.from(ancestors)}`);
      break;
    }
    ancestors.add(sec.getRowId());
  }

  const mainNode = {
    tableId: table.primaryTableId.peek(),
    isSummary: table.primaryTableId.peek() !== table.tableId.peek(),
    widgetType: section.parentKey.peek(),
    ancestors,
    section,
  };

  return fromColumns(table, mainNode);
}

// Creates an array of LinkNode from a page widget.
function fromPageWidget(docModel: DocModel, pageWidget: IPageWidget): LinkNode[] {

  if (typeof pageWidget.table !== 'number') { return []; }

  const table = docModel.tables.getRowModel(pageWidget.table);

  const mainNode: LinkNode = {
    tableId: table.primaryTableId.peek(),
    isSummary: pageWidget.summarize,
    widgetType: pageWidget.type,
    ancestors: new Set(),
    section: docModel.viewSections.getRowModel(pageWidget.section),
  };

  return fromColumns(table, mainNode);
}

function fromColumns(table: TableRec, mainNode: LinkNode): LinkNode[] {
  const nodes = [mainNode];
  const columns = table.columns.peek().peek();
  for (const column of columns) {
    const tableId = getReferencedTableId(column.type.peek());
    if (tableId) {
      nodes.push({...mainNode, tableId, column});
    }
  }
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

export class LinkConfig {
  public readonly srcSection: ViewSectionRec;
  public readonly tgtSection: ViewSectionRec;
  // Note that srcCol and tgtCol may be the empty column records if that column is not used.
  public readonly srcCol: ColumnRec;
  public readonly tgtCol: ColumnRec;
  public readonly srcColId: string|undefined;
  public readonly tgtColId: string|undefined;

  // The constructor throws an exception if settings are invalid. When used from inside a knockout
  // computed, the constructor subscribes to all parts relevant for linking.
  constructor(tgtSection: ViewSectionRec) {
    this.tgtCol = tgtSection.linkTargetCol();
    this.srcCol = tgtSection.linkSrcCol();
    this.srcSection = tgtSection.linkSrcSection();
    this.tgtSection = tgtSection;
    this.srcColId = this.srcCol.colId();
    this.tgtColId = this.tgtCol.colId();
    this._assertValid();
  }

  // Check if section-linking configuration is valid, and throw exception if not.
  private _assertValid(): void {
    // Use null for unset cols (rather than an empty ColumnRec) for easier comparisons below.
    const srcCol = this.srcCol?.getRowId() ? this.srcCol : null;
    const tgtCol = this.tgtCol?.getRowId() ? this.tgtCol : null;
    const srcTableId = (srcCol ? getReferencedTableId(srcCol.type.peek()) :
      this.srcSection.table.peek().primaryTableId.peek());
    const tgtTableId = (tgtCol ? getReferencedTableId(tgtCol.type.peek()) :
      this.tgtSection.table.peek().primaryTableId.peek());
    try {
      assert(!tgtCol || tgtCol.parentId.peek() === this.tgtSection.tableRef.peek(), "tgtCol belongs to wrong table");
      assert(!srcCol || srcCol.parentId.peek() === this.srcSection.tableRef.peek(), "srcCol belongs to wrong table");
      assert(this.srcSection.getRowId() !== this.tgtSection.getRowId(), "srcSection links to itself");
      assert(tgtTableId, "tgtCol not a valid reference");
      assert(srcTableId, "srcCol not a valid reference");
      assert(srcTableId === tgtTableId, "mismatched tableIds");
    } catch (e) {
      throw new Error(`LinkConfig invalid: ` +
        `${this.srcSection.getRowId()}:${this.srcCol?.getRowId()}[${srcTableId}] -> ` +
        `${this.tgtSection.getRowId()}:${this.tgtCol?.getRowId()}[${tgtTableId}]: ${e}`);
    }
  }
}
