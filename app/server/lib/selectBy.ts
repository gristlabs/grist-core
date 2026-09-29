import { DocData } from "app/common/DocData";
import {
  buildLinkNodes,
  isValidLink,
  LinkNode,
  LinkNodeOperations,
  LinkNodeSection,
  LinkNodeTable,
} from "app/common/LinkNode";
import { MetaRowRecord } from "app/common/TableData";
import {
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
  docData: DocData,
  widgetId: number,
): SelectByOption[] {
  const targetWidget = getWidgetById(docData, widgetId);
  // Widgets this session cannot see can neither link nor be linked to.
  const sourceWidgets = getWidgetsByPageId(docData, targetWidget.parentId);
  const targetNodes = createNodes(docData, [targetWidget]);
  const sourceNodes = createNodes(docData, sourceWidgets);

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
  docData: DocData,
  widgets: MetaRowRecord<"_grist_Views_section">[],
): LinkNode[] {
  const operations: LinkNodeOperations = {
    getTableById: id => getLinkNodeTableById(docData, id),
    getSectionById: id => getLinkNodeSection(docData, id),
  };
  const sections = widgets.map(({ id }) => getLinkNodeSection(docData, id));
  return buildLinkNodes(sections, operations);
}

// A link chain can pass through a widget this session cannot see, whose table
// is censored. Like the client's row models, a missing table reads as blank.
function getLinkNodeTableById(docData: DocData, id: number): LinkNodeTable {
  const tables = docData.getMetaTable("_grist_Tables");
  const table = tables.getRecord(id);
  if (!table?.tableId) { return { id, tableId: "", isSummaryTable: false, columns: [] }; }
  // The source of a readable summary may itself be censored.
  const maybeSummaryTable = table.summarySourceTable ?
    tables.getRecord(table.summarySourceTable) :
    undefined;
  return {
    id: table.id,
    tableId: maybeSummaryTable?.tableId ?? table.tableId,
    isSummaryTable: Boolean(
      maybeSummaryTable && maybeSummaryTable.tableId !== table.tableId,
    ),
    columns: getTableColumnsByTableId(docData, id).map(c =>
      pick(c, "id", "colId", "label", "type", "summarySourceCol"),
    ),
  };
}

function getLinkNodeSection(
  docData: DocData,
  idOrWidget: number | MetaRowRecord<"_grist_Views_section">,
): LinkNodeSection {
  // Not getWidgetById(), which rejects the censored widgets a chain may include.
  const widget =
    typeof idOrWidget === "number" ?
      docData.getMetaTable("_grist_Views_section").getRecord(idOrWidget) :
      idOrWidget;
  if (!widget) { throw new Error(`Widget ${idOrWidget} not found`); }
  const table = getLinkNodeTableById(docData, widget.tableRef);
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
    tableId: table.tableId,
  };
}
