/**
 * This module exposes the various interface that describes the model to generate a tree view. It
 * provides also a way to create a TreeModel from a grist table that implements the tree view
 * interface (ie: a table with both an .indentation and .pagePos fields).
 *
 * To use with tableData;
 *  > fromTableData(tableData, (rec) => dom('div', rec.label))
 *
 * Optionally you can build a model by reusing items from an old model with matching records
 * ids. The is useful to benefit from dom reuse of the TreeViewComponent which allow to persist
 * state when the model updates.
 *
 */

import { BulkColValues, UserAction } from "app/common/DocActions";
import { nativeCompare } from "app/common/gutil";
import { obsArray, ObsArray } from "grainjs";
import forEach = require("lodash/forEach");
import forEachRight = require("lodash/forEachRight");
import reverse = require("lodash/reverse");

/**
 * A generic definition of a tree to use with the `TreeViewComponent`. The tree implements
 * `TreeModel` and any item in it implements `TreeItem`.
 */
export interface TreeNode {
  hidden?: boolean;
  // Returns an observable array of children. Or null if the node does not accept children.
  children(): ObsArray<TreeItem>|null;

  // Inserts newChild as a child, before nextChild, or at the end if nextChild is null. If
  // newChild is already in the tree, it is the implementer's responsibility to remove it from the
  // children() list of its old parent.
  insertBefore(newChild: TreeItem, nextChild: TreeItem|null): void;

  // Removes child from the list of children().
  removeChild(child: TreeItem): void;
}

export interface TreeItem extends TreeNode {
  // Returns the DOM element to render for this tree node.
  buildDom(): HTMLElement;
}

export interface TreeModel extends TreeNode {
  children(): ObsArray<TreeItem>;
}


// A tree record has an id and an indentation field.
export interface TreeRecord {
  id: number;
  indentation: number;
  pagePos: number;
  [key: string]: any;
}

// This is compatible with TableData from app/client/models/TableData.
export interface TreeTableData {
  getRecords(): TreeRecord[];
  sendTableActions(actions: UserAction[]): Promise<unknown>;
}

// describes a function that builds dom for a particular record
type DomBuilder = (id: number, hidden: boolean) => HTMLElement;


// Returns a list of the records from table that is suitable to build the tree model, ie: records
// are sorted by .posKey, and .indentation starts at 0 for the first records and can only increase
// one step at a time (but can decrease as much as you want).
function getRecords(table: TreeTableData) {
  const records = table.getRecords()
    .sort((a, b) => nativeCompare(a.pagePos, b.pagePos));
  return fixIndents(records);
}

// The fixIndents function returns a copy of records with the guarantee the .indentation starts at 0
// and can only increase one step at a time (note that it is however permitted to decrease several
// level at a time). This is useful to build a model for the tree view.
export function fixIndents(records: TreeRecord[]) {
  let maxNextIndent = 0;
  return records.map((rec, index) => {
    const indentation = Math.min(maxNextIndent, rec.indentation);
    maxNextIndent = indentation + 1;
    return {...rec, indentation};
  }) as TreeRecord[];
}


// build a tree model from a grist table storing tree view data
export function fromTableData(table: TreeTableData, buildDom: DomBuilder, oldModel?: TreeModelRecord) {

  const records = getRecords(table);
  const storage = {table, records};

  // an object to collect items at all level of indentations
  const indentations = {} as {[ind: number]: TreeItemRecord[]};

  // a object that map record ids to old items
  const oldItems = {} as {[id: number]: TreeItemRecord};
  if (oldModel) {
    walkTree(oldModel, (item: TreeItemRecord) => oldItems[item.record.id] = item);
  }

  // Let's iterate from bottom to top so that when we visit an item we've already built all of its
  // children. For each record reuses an old item if there is one with same record id.
  forEachRight(records, (rec, index) => {
    const siblings = indentations[rec.indentation] = indentations[rec.indentation] || [];
    const children = indentations[rec.indentation + 1] || [];
    delete indentations[rec.indentation + 1];
    const item = oldItems[rec.id] || new TreeItemRecord();
    item.hidden = rec.hidden;
    item.init(storage, index, reverse(children));
    item.buildDom = () => buildDom(rec.id, rec.hidden);
    siblings.push(item);
  });
  return new TreeModelRecord(storage, reverse(indentations[0] || []));
}

// a table data with all of its records as returned by getRecords(tableData)
interface Storage {
  table: TreeTableData;
  records: TreeRecord[];
}

// TreeNode implementation that uses a grist table.
export class TreeNodeRecord implements TreeNode {
  public hidden: boolean = false;
  public storage: Storage;
  public index: number|"root";
  public children: () => ObsArray<TreeItemRecord>;
  private _children: TreeItemRecord[];

  constructor() {
    // nothing here
  }

  public init(storage: Storage, index: number|"root", children: TreeItemRecord[]) {
    this.storage = storage;
    this.index = index;
    this._children = children;
    const obsChildren = obsArray(this._children);
    this.children = () => obsChildren;
  }

  // Moves 'item' along with all its descendant to just before 'nextChild' by updating the
  // .indentation and .position fields of all of their corresponding records in the table.
  public async insertBefore(item: TreeItemRecord, nextChild: TreeItemRecord|null) {

    // get records for newItem and its descendants
    const records = item.getRecords();

    if (records.length) {
      // adjust indentation for the records
      const indent = this.index === "root" ? 0 : this._records[this.index].indentation + 1;
      const indentations = records.map((rec, i) => rec.indentation + indent - records[0].indentation);

      // adjust positions
      let upperPos: number|null;
      if (nextChild) {
        const index = nextChild.index;
        upperPos = this._records[index].pagePos;
      } else {
        const lastIndex = this.findLastIndex();
        if (lastIndex !== "root") {
          upperPos = (this._records[lastIndex + 1] || {pagePos: null}).pagePos;
        } else {
          upperPos = null;
        }
      }

      // do update
      const update = records.map((rec, i) => ({...rec, indentation: indentations[i], pagePos: upperPos!}));
      await this.sendActions({update});
    }
  }

  // Sends user actions to update [A, B, ...] and remove [C, D, ...] when called with
  // `{update: [A, B ...], remove: [C, D, ...]}`.
  public async sendActions(actions: {update?: TreeRecord[], remove?: TreeRecord[]}) {

    const update = actions.update || [];
    const remove = actions.remove || [];

    const userActions = [];
    if (update.length) {
      const values = {} as BulkColValues;
      // let's transpose [{key1: "val1", ...}, ...] to {key1: ["val1", ...], ...}
      forEach(update[0], (val, key) => values[key] = update.map(rec => rec[key]));
      const rowIds = values.id;
      delete values.id;
      delete values.hidden;
      userActions.push(["BulkUpdateRecord", rowIds, values]);
    }

    if (remove.length) {
      userActions.push(["BulkRemove", remove.map(rec => rec.id)]);
    }

    if (userActions.length) {
      await this.storage.table.sendTableActions(userActions);
    }

  }

  // Removes child.
  public async removeChild(child: TreeItemRecord) {
    await this.sendActions({remove: child.getRecords()});
  }

  // Get all the records included in this item.
  public getRecords(): TreeRecord[] {
    const records = [] as TreeRecord[];
    if (this.index !== "root") { records.push(this._records[this.index]); }
    walkTree(this, (item: TreeItemRecord) => records.push(this._records[item.index]));
    return records;
  }

  public findLastIndex(): number|"root" {
    return this._children.length ? this._children[this._children.length - 1].findLastIndex() : this.index;
  }

  private get _records() {
    return this.storage.records;
  }

}

export class TreeItemRecord extends TreeNodeRecord implements TreeItem {
  public index: number;
  public buildDom: () => HTMLElement;
  constructor() {
    super();
  }
  public get record() { return this.storage.records[this.index]; }
}

export class TreeModelRecord extends TreeNodeRecord implements TreeModel {
  constructor(storage: Storage, children: TreeItemRecord[]) {
    super();
    this.init(storage, "root", children);
  }
}

export function walkTree<T extends TreeItem>(model: TreeNode, func: (item: T) => void): void;
export function walkTree(model: TreeNode, func: (item: TreeItem) => void) {
  const children = model.children();
  if (children) {
    for (const child of children.get()) {
      func(child);
      walkTree(child, func);
    }
  }
}

export function find<T extends TreeItem>(model: TreeNode, func: (item: T) => boolean): T|undefined;
export function find(model: TreeNode, func: (item: TreeItem) => boolean): TreeItem|undefined {
  const children = model.children();
  if (children) {
    for (const child of children.get()) {
      const found = func(child) && child || find(child, func);
      if (found) { return found; }
    }
  }
}
