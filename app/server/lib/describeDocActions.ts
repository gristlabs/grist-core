import { DocAction, getTableId } from 'app/common/DocActions';
import { DocData } from 'app/common/DocData';
import { isMetadataTable } from 'app/common/isHiddenTable';
import { SchemaTypes } from 'app/common/schema';

export interface DocActionsDescription {
  userTableNames: string[];
  categories: DocActionCategory[];
}

// These both define categories, and determine the order we'll report them in.
const allCategories = [
  "metadata",     // catch-all for unknown stuff
  "settings",
  "structure",
  "layouts",
  "forms",
  "webhooks",
  "access rules",
  "user attributes",
] as const;

// This becomes the union of strings, i.e. "metadata"|"settings"|etc.
export type DocActionCategory = typeof allCategories[number];

/**
 * Turns a list of doc actions into an object to describe them, intended for notifications.
 * The description includes a list of user tables, translated to their friendlier names,
 * and a list of categories for metadata tables.
 *
 * Because the intent is notifications, changes to the _grist_Cells table are ignored, since they
 * mean comments, and comments have their own configuration for notifications, so it's clearer to
 * exclude them from docChanges.
 */
export function describeDocActions(docActions: DocAction[], docData: DocData): DocActionsDescription|null {
  if (docActions.length === 0) { return null; }
  const userTableNameSet = new Set<string>();
  const categorySet = new Set<DocActionCategory>();
  for (const action of docActions) {
    const tableId = getTableId(action);
    if (!isMetadataTable(tableId)) {
      userTableNameSet.add(getTableName(tableId, docData) || tableId);
    }
    else {
      const category = categoryMap[tableId as keyof SchemaTypes] || "metadata";
      if (category === IGNORE) { continue; }
      categorySet.add(category);
    }
  }
  if (userTableNameSet.size === 0 && categorySet.size === 0) { return null; }
  return { userTableNames: [...userTableNameSet], categories: [...categorySet] };
}

/**
 * Sort categories in a consistent order, following the order of allCategories.
 */
export function sortDocActionCategories(categories: Set<DocActionCategory>): DocActionCategory[] {
  return allCategories.filter(c => categories.has(c));
}

// A sentinel value for tables that shouldn't get reported.
const IGNORE = Symbol("ignore");

const categoryMap: { [tableId in keyof SchemaTypes]: DocActionCategory|typeof IGNORE|null } = {
  _grist_DocInfo: "settings",
  _grist_Tables: "structure",
  _grist_Tables_column: "structure",
  _grist_Imports: null,                   // deprecated (will fall back to "metadata")
  _grist_External_database: null,         // deprecated
  _grist_External_table: null,            // deprecated
  _grist_TableViews: null,                // deprecated
  _grist_TabItems: null,                  // deprecated
  _grist_TabBar: "layouts",
  _grist_Pages: "layouts",
  _grist_Views: "layouts",
  _grist_Views_section: "layouts",
  _grist_Views_section_field: "layouts",
  _grist_Validations: null,               // deprecated
  _grist_REPL_Hist: null,                 // deprecated
  _grist_Attachments: IGNORE,            // accompanied by a user table change, or only reflects cleanup
  _grist_Triggers: "webhooks",
  _grist_ACLRules: "access rules",
  _grist_ACLResources: "access rules",
  _grist_ACLPrincipals: null,             // deprecated
  _grist_ACLMemberships: null,            // deprecated
  _grist_Filters: "layouts",
  _grist_Cells: IGNORE,                  // ignore comments for the purpose of notifications.
  _grist_Shares: "forms",
};

function getTableName(tableId: string, docData: DocData) {
  const tableRec = docData.getMetaTable("_grist_Tables").findRecord('tableId', tableId);
  const vsRec = tableRec && docData.getMetaTable("_grist_Views_section").getRecord(tableRec.rawViewSectionRef);
  return vsRec?.title;
}
