import {
  buildLinkNodes,
  isValidLink,
  LinkNode,
  LinkNodeOperations,
  LinkNodeSection,
  LinkNodeTable,
} from "app/common/LinkNode";
import { MetaRowRecord } from "app/common/TableData";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import {
  getTableById,
  getTableColumnsByTableId,
  getWidgetById,
  getWidgetsByPageId,
} from "app/server/lib/ActiveDocUtils";
import { pick } from "lodash";

export interface SelectByOption {
  link_from_widget_id: number;
  link_from_column_id: string | null;
  link_to_column_id: string | null;
}

export function getSelectByOptions(
  doc: ActiveDoc,
  widgetId: number,
): SelectByOption[] {
  const targetWidget = getWidgetById(doc, widgetId);
  const sourceWidgets = getWidgetsByPageId(doc, targetWidget.parentId);
  const targetNodes = createNodes(doc, [targetWidget]);
  const sourceNodes = createNodes(doc, sourceWidgets);

  const options: SelectByOption[] = [];
  for (const sourceNode of sourceNodes) {
    const validTargetNodes = targetNodes.filter(targetNode =>
      isValidLink(sourceNode, targetNode),
    );
    for (const targetNode of validTargetNodes) {
      options.push({
        link_from_widget_id: sourceNode.section.id,
        link_from_column_id: sourceNode.column?.colId ?? null,
        link_to_column_id: targetNode.column?.colId ?? null,
      });
    }
  }
  return options;
}

function createNodes(
  doc: ActiveDoc,
  widgets: MetaRowRecord<"_grist_Views_section">[],
): LinkNode[] {
  const operations: LinkNodeOperations = {
    getTableById: id => getLinkNodeTableById(doc, id),
    getSectionById: id => getLinkNodeSection(doc, id),
  };
  const sections = widgets.map(({ id }) => getLinkNodeSection(doc, id));
  return buildLinkNodes(sections, operations);
}

function getLinkNodeTableById(doc: ActiveDoc, id: number): LinkNodeTable {
  const table = getTableById(doc, id);
  const maybeSummaryTable = table.summarySourceTable
    ? getTableById(doc, table.summarySourceTable)
    : undefined;
  return {
    id: table.id,
    tableId: maybeSummaryTable?.tableId ?? table.tableId,
    isSummaryTable: Boolean(
      maybeSummaryTable && maybeSummaryTable.tableId !== table.tableId,
    ),
    columns: getTableColumnsByTableId(doc, id).map(c =>
      pick(c, "id", "colId", "label", "type", "summarySourceCol"),
    ),
  };
}

function getLinkNodeSection(
  doc: ActiveDoc,
  idOrWidget: number | MetaRowRecord<"_grist_Views_section">,
): LinkNodeSection {
  const widget =
    typeof idOrWidget === "number"
      ? getWidgetById(doc, idOrWidget)
      : idOrWidget;
  const table = getTableById(doc, widget.tableRef);
  const maybeSummaryTable = table.summarySourceTable
    ? getTableById(doc, table.summarySourceTable)
    : undefined;
  return {
    ...pick(
      widget,
      "id",
      "tableRef",
      "parentId",
      "parentKey",
      "title",
      "linkSrcSectionRef",
      "linkSrcColRef",
      "linkTargetColRef",
    ),
    tableId: maybeSummaryTable?.tableId ?? table.tableId,
  };
}
