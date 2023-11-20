import {KoArray} from 'app/client/lib/koArray';
import * as koArray from 'app/client/lib/koArray';
import * as tableUtil from 'app/client/lib/tableUtil';
import {ColumnRec, DocModel, ViewFieldRec} from 'app/client/models/DocModel';
import {KoSaveableObservable} from 'app/client/models/modelUtil';
import {cssFieldEntry, cssFieldLabel} from 'app/client/ui/VisibleFieldsConfig';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {menu, menuItem, menuText} from 'app/client/ui2018/menus';
import {FieldBuilder} from 'app/client/widgets/FieldBuilder';
import * as gutil from 'app/common/gutil';
import {Disposable, dom, fromKo, styled} from 'grainjs';
import ko from 'knockout';
import {makeT} from 'app/client/lib/localization';

const t = makeT('RefSelect');

interface Item {
  label: string;
  value: string;
}

/**
 * Builder for the reference display multiselect.
 */
export class RefSelect extends Disposable {
  public isForeignRefCol: ko.Computed<boolean>;
  private _docModel: DocModel;
  private _origColumn: ColumnRec;
  private _colId: KoSaveableObservable<string>;
  private _fieldObs: ko.Computed<ViewFieldRec | null>;
  private _validCols: ko.Computed<ColumnRec[]>;
  private _added: KoArray<Item>;
  private _addedSet: ko.Computed<Set<string>>;

  constructor(options: {
    docModel: DocModel,
    origColumn: ColumnRec,
    fieldBuilder: ko.Computed<FieldBuilder | null>,
  }) {
    super();
    this._docModel = options.docModel;
    this._origColumn = options.origColumn;
    this._colId = this._origColumn.colId;

    // Indicates whether this is a ref col that references a different table.
    // (That's the only time when RefSelect is offered.)
    this.isForeignRefCol = this.autoDispose(ko.computed(() => {
      const table = this._origColumn.refTable();
      return Boolean(table && table.getRowId() !== this._origColumn.parentId());
    }));

    // Computed for the current fieldBuilder's field, if it exists.
    this._fieldObs = this.autoDispose(ko.computed(() => {
      const builder = options.fieldBuilder();
      return builder ? builder.field : null;
    }));

    // List of valid cols in the currently referenced table.
    this._validCols = this.autoDispose(ko.computed(() => {
      const refTable = this._origColumn.refTable();
      if (refTable) {
        return refTable.columns().all().filter(col => !col.isHiddenCol() &&
          !gutil.startsWith(col.type(), 'Ref:'));
      }
      return [];
    }));

    // Returns the array of columns added to the multiselect. Used as a helper to create a synced KoArray.
    const _addedObs = this.autoDispose(ko.computed(() => {
      return this.isForeignRefCol() && this._fieldObs() ?
        this._getReferencedCols(this._fieldObs()!).map(c => ({ label: c.label(), value: c.colId() })) : [];
    }));

    // KoArray of columns displaying data from the referenced table in the current section.
    this._added = this.autoDispose(koArray.syncedKoArray(_addedObs));

    // Set of added colIds.
    this._addedSet = this.autoDispose(ko.computed(() => new Set(this._added.all().map(item => item.value))));
  }

  /**
   * Builds the multiselect dom to select columns to added to the table to show data from the
   * referenced table.
   */
  public buildDom() {
    return cssFieldList(
      testId('ref-select'),
      dom.forEach(fromKo(this._added.getObservable()), (col) =>
        cssFieldEntry(
          cssColumnLabel(dom.text(col.label)),
          cssRemoveIcon('Remove',
            dom.on('click', () => this._removeFormulaField(col)),
            testId('ref-select-remove'),
          ),
          testId('ref-select-item'),
        )
      ),
      cssAddLink(cssAddIcon('Plus'), t("Add Column"),
        menu(() => [
          ...this._validCols.peek()
            .filter((col) => !this._addedSet.peek().has(col.colId.peek()))
            .map((col) =>
              menuItem(() => this._addFormulaField({ label: col.label(), value: col.colId() }),
                col.label.peek())
            ),
          cssEmptyMenuText(t("No columns to add")),
          testId('ref-select-menu'),
        ]),
        testId('ref-select-add'),
      ),
    );
  }

  /**
   * Adds the column item to the multiselect. If the visibleCol is 'id', sets the visibleCol.
   * Otherwise, adds a field which refers to the column to the table. If a column with the
   * necessary formula exists, only adds a field to this section, otherwise adds the necessary
   * column and field.
   */
  private async _addFormulaField(item: Item) {
    const field = this._fieldObs();
    if (!field) {
      return;
    }
    const tableData = this._docModel.dataTables[this._origColumn.table().tableId()].tableData;
    // Check if column already exists in the table
    const cols = this._origColumn.table().columns().all();
    const colMatch = cols.find(c => c.formula() === `$${this._colId()}.${item.value}` && !c.isHiddenCol());
    // Get field position, so that the new field is inserted just after the current field.
    const fields = field.viewSection().viewFields();
    const index = fields.all()
      .sort((a, b) => a.parentPos() > b.parentPos() ? 1 : -1)
      .findIndex(f => f.getRowId() === field.getRowId());
    const pos = tableUtil.fieldInsertPositions(fields, index + 1)[0];
    let colAction: Promise<any>|undefined;
    if (colMatch) {
      // If column exists, use it.
      colAction = Promise.resolve({ colRef: colMatch.getRowId(), colId: colMatch.colId() });
    } else {
      // If column doesn't exist, add it (without fields).
      colAction = tableData.sendTableAction(['AddColumn', `${this._colId()}_${item.value}`, {
        type: 'Any',
        isFormula: true,
        formula: `$${this._colId()}.${item.value}`,
        _position: pos
      }])!;
    }
    const colInfo = await colAction;
    // Add field to the current section (if it isn't a raw data section - as this one will have
    // this field already)
    if (field.viewSection().isRaw()) { return; }
    const fieldInfo = {
      colRef: colInfo.colRef,
      parentId: field.viewSection().getRowId(),
      parentPos: pos
    };
    return this._docModel.viewFields.sendTableAction(['AddRecord', null, fieldInfo]);
  }

  /**
   * Removes the column item from the multiselect. If the item is the visibleCol, clears to show
   * row id. Otherwise, removes all fields which refer to the column from the table.
   */
  private _removeFormulaField(item: Item) {
    const tableData = this._docModel.dataTables[this._origColumn.table().tableId()].tableData;
    // Iterate through all display fields in the current section.
    this._getReferrerFields(item.value).forEach(refField => {
      const sectionId = this._fieldObs()!.viewSection().getRowId();
      if (refField.column().viewFields().all()
          .filter(field => !field.viewSection().isRaw() && !field.viewSection().isRecordCard())
          .some(field => field.parentId() !== sectionId)) {
        // The col has fields in other sections, remove only the fields in this section.
        return this._docModel.viewFields.sendTableAction(['RemoveRecord', refField.getRowId()]);
      } else {
        // The col is only displayed in this section, remove the column.
        return tableData.sendTableAction(['RemoveColumn', refField.column().colId()]);
      }
    });
  }

  /**
   * Returns a list of fields in the current section whose formulas refer to 'colId' in the table this
   * reference column refers to.
   */
  private _getReferrerFields(colId: string) {
    const re = new RegExp("^\\$" + this._colId() + "\\." + colId + "$");
    return this._fieldObs()!.viewSection().viewFields().all()
      .filter(field => re.exec(field.column().formula()));
  }

  /**
   * Returns a non-repeating list of columns in the referenced table referred to by fields in
   * the current section.
   */
  private _getReferencedCols(field: ViewFieldRec) {
    const matchesSet = this._getFormulaMatchSet(field);
    return this._validCols().filter(c => matchesSet.has(c.colId()));
  }

  /**
   * Helper function for getReferencedCols. Iterates through fields in
   * the current section, returning a set of colIds which those fields' formulas refer to.
   */
  private _getFormulaMatchSet(field: ViewFieldRec) {
    const fields = field.viewSection().viewFields().all();
    const re = new RegExp("^\\$" + this._colId() + "\\.(\\w+)$");
    return new Set(fields.map(f => {
      const found = re.exec(f.column().formula());
      return found ? found[1] : null;
    }));
  }
}

const cssFieldList = styled('div', `
  display: flex;
  flex-direction: column;
  width: 100%;

  & > .${cssFieldEntry.className} {
    margin: 2px 0;
  }
`);

const cssEmptyMenuText = styled(menuText, `
  font-size: inherit;
  &:not(:first-child) {
    display: none;
  }
`);

const cssAddLink = styled('div', `
  display: flex;
  cursor: pointer;
  color: ${theme.controlFg};
  --icon-color: ${theme.controlFg};

  &:not(:first-child) {
    margin-top: 8px;
  }
  &:hover, &:focus, &:active {
    color: ${theme.controlHoverFg};
    --icon-color: ${theme.controlHoverFg};
  }
`);

const cssAddIcon = styled(icon, `
  margin-right: 4px;
`);

const cssRemoveIcon = styled(icon, `
  display: none;
  cursor: pointer;
  flex: none;
  margin-left: 8px;
  .${cssFieldEntry.className}:hover & {
    display: block;
  }
`);

const cssColumnLabel = styled(cssFieldLabel, `
  line-height: 16px;
`);
