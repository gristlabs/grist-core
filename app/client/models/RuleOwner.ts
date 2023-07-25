import {ColumnRec, DocModel} from 'app/client/models/DocModel';
import {Style} from 'app/client/models/Styles';
import * as modelUtil from 'app/client/models/modelUtil';
import {GristObjCode} from 'app/plugin/GristData';

export interface RuleOwner {
  // Field or Section can have a list of conditional styling rules. Each style is a combination of a formula and options
  // that must by applied. Style is persisted as a new hidden formula column and the list of such
  // columns is stored as Reference List property ('rules') in a field or column.
  tableId: ko.Computed<string>;
  // If this field (or column) has a list of conditional styling rules.
  hasRules: ko.Computed<boolean>;
  // List of rules.
  rulesList: ko.Computed<[GristObjCode.List, ...number[]] | null>;
  // List of columns that are used as rules for conditional styles.
  rulesCols: ko.Computed<ColumnRec[]>;
  // List of columns ids that are used as rules for conditional styles.
  rulesColsIds: ko.Computed<string[]>;
  // List of styles used by conditional rules.
  rulesStyles: modelUtil.KoSaveableObservable<Style[]>;
  // Adds empty conditional style rule. Sets before sending to the server.
  addEmptyRule(): Promise<void>;
  // Removes one rule from the collection. Removes before sending update to the server.
  removeRule(index: number): Promise<void>;
}

export async function removeRule(docModel: DocModel, owner: RuleOwner, index: number) {
  const col = owner.rulesCols.peek()[index];
  if (!col) {
    throw new Error(`There is no rule at index ${index}`);
  }
  const newStyles = owner.rulesStyles.peek()?.slice() ?? [];
  if (newStyles.length >= index) {
    newStyles.splice(index, 1);
  } else {
    console.debug(`There are not style options at index ${index}`);
  }
  await docModel.docData.bundleActions("Remove conditional rule", () =>
    Promise.all([
      owner.rulesStyles.setAndSave(newStyles),
      docModel.docData.sendAction(['RemoveColumn', owner.tableId.peek(), col.colId.peek()])
    ])
  );
}
