import {GristDoc} from 'app/client/components/GristDoc';
import koArray from 'app/client/lib/koArray';
import * as kf from 'app/client/lib/koForm';
import {makeT} from 'app/client/lib/localization';
import {addToSort, updatePositions} from 'app/client/lib/sortUtil';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {ObjObservable} from 'app/client/models/modelUtil';
import {dropdownWithSearch} from 'app/client/ui/searchDropdown';
import {cssIcon, cssRow, cssSortFilterColumn} from 'app/client/ui/RightPanelStyles';
import {labeledLeftSquareCheckbox} from 'app/client/ui2018/checkbox';
import {theme} from 'app/client/ui2018/cssVars';
import {cssDragger} from 'app/client/ui2018/draggableList';
import {menu} from 'app/client/ui2018/menus';
import {Sort} from 'app/common/SortSpec';
import {Computed, Disposable, dom, makeTestId, MultiHolder, styled} from 'grainjs';
import difference = require('lodash/difference');
import isEqual = require('lodash/isEqual');
import {cssMenuItem, IMenuOptions} from 'popweasel';

interface SortableColumn {
  label: string;
  value: number;
  icon: 'FieldColumn';
  type: string;
}

export interface SortConfigOptions {
  /** Options to pass to all menus created by `SortConfig`. */
  menuOptions?: IMenuOptions;
}

const testId = makeTestId('test-sort-config-');

const t = makeT('SortConfig');

/**
 * Component that renders controls for managing sorting for a view section.
 *
 * Sorted columns are displayed in a vertical list of pill-shaped buttons. These
 * buttons can be clicked to toggle their sort direction, and can be clicked and
 * dragged to re-arrange their order. Additionally, there are buttons to the right
 * of each sorted column for removing them, and opening a menu with advanced sort
 * options.
 */
export class SortConfig extends Disposable {
  // Computed array of sortable columns.
  private _columns: Computed<SortableColumn[]> = Computed.create(this, (use) => {
    // Columns is an observable holding an observable array - must call 'use' on it 2x.
    const cols = use(use(use(this._section.table).columns).getObservable());
    return cols.filter(col => !use(col.isHiddenCol)).map(col => ({
      label: use(col.label),
      value: col.getRowId(),
      icon: 'FieldColumn',
      type: col.type(),
    }));
  });

  // We only want to recreate rows, when the actual columns change.
  private _colRefs = Computed.create(this, (use) => {
    return use(this._section.activeSortSpec).map(col => Sort.getColRef(col));
  });
  private _sortRows = this.autoDispose(koArray(this._colRefs.get()));

  private _changedColRefs = Computed.create(this, (use) => {
    const changedSpecs = difference(
      use(this._section.activeSortSpec),
      Sort.parseSortColRefs(use(this._section.sortColRefs))
    );
    return new Set(changedSpecs.map(spec => Sort.getColRef(spec)));
  });

  constructor(private _section: ViewSectionRec, private _gristDoc: GristDoc, private _options: SortConfigOptions = {}) {
    super();

    this.autoDispose(this._colRefs.addListener((curr, prev) => {
      if (!isEqual(curr, prev)){
        this._sortRows.assign(curr);
      }
    }));
  }

  public buildDom() {
    return dom('div',
      // Sort rows.
      kf.draggableList(this._sortRows, (colRef: number) => this._createRow(colRef), {
        reorder: (colRef: number, nextColRef: number | null) => this._reorder(colRef, nextColRef),
        removeButton: false,
        drag_indicator: cssDragger,
        itemClass: cssDragRow.className,
      }),
      // Add to sort btn & menu.
      this._buildAddToSortButton(this._columns),
      this._buildUpdateDataButton(),
      testId('container'),
    );
  }

  private _createRow(colRef: number) {
    return this._buildSortRow(colRef, this._section.activeSortSpec, this._columns);
  }

  /**
   * Builds a single row of the sort dom.
   * Takes the colRef, current sortSpec and array of column select options to show
   * in the column select dropdown.
   */
  private _buildSortRow(
    colRef: number,
    sortSpec: ObjObservable<Sort.SortSpec>,
    columns: Computed<SortableColumn[]>
  ) {
    const holder = new MultiHolder();
    const {menuOptions} = this._options;

    const col           = Computed.create(holder, () => colRef);
    const details       = Computed.create(holder, (use) => Sort.specToDetails(Sort.findCol(use(sortSpec), colRef)!));
    const hasSpecs      = Computed.create(holder, details, (_, specDetails) => Sort.hasOptions(specDetails));
    const isAscending   = Computed.create(holder, details, (_, specDetails) => specDetails.direction === Sort.ASC);

    col.onWrite((newRef) => {
      let specs = sortSpec.peek();
      const colSpec = Sort.findCol(specs, colRef);
      const newSpec = Sort.findCol(specs, newRef);
      if (newSpec) {
        // this column is already there so only swap order
        specs = Sort.swap(specs, colRef, newRef);
        // but keep the directions
        specs = Sort.setSortDirection(specs, colRef, Sort.direction(newSpec));
        specs = Sort.setSortDirection(specs, newRef, Sort.direction(colSpec!));
      } else {
        specs = Sort.replace(specs, colRef, Sort.createColSpec(newRef, Sort.direction(colSpec!)));
      }
      this._saveSort(specs);
    });

    const computedFlag = (
      flag: keyof Sort.ColSpecDetails,
      allowedTypes: string[] | null,
      label: string
    ) => {
      const computed = Computed.create(holder, details, (_, d) => d[flag] || false);
      computed.onWrite(value => {
        const specs = sortSpec.peek();
        // Get existing details
        const specDetails = Sort.specToDetails(Sort.findCol(specs, colRef)!) as any;
        // Update flags
        specDetails[flag] = value;
        // Replace the colSpec at the index
        this._saveSort(Sort.replace(specs, Sort.getColRef(colRef), specDetails));
      });
      return {computed, allowedTypes, flag, label};
    };
    const orderByChoice = computedFlag('orderByChoice', ['Choice'], t("Use choice position"));
    const naturalSort   = computedFlag('naturalSort', ['Text'], t("Natural sort"));
    const emptyLast     = computedFlag('emptyLast', null, t("Empty values last"));
    const flags = [orderByChoice, emptyLast, naturalSort];

    const column = columns.get().find(c => c.value === Sort.getColRef(colRef));

    return cssSortRow(
      dom.autoDispose(holder),
      cssSortFilterColumn(
        dom.domComputed(isAscending, ascending =>
          cssSortIcon(
            "Sort",
            cssSortIcon.cls('-accent', use => use(this._changedColRefs).has(column!.value)),
            dom.style("transform", ascending ? "scaleY(-1)" : "none"),
            testId('order'),
            testId(ascending ? "sort-order-asc" : "sort-order-desc"),
          )
        ),
        cssLabel(column!.label),
        dom.on("click", () => {
          this._saveSort(Sort.flipSort(sortSpec.peek(), colRef));
        }),
        testId('column'),
      ),
      cssMenu(
        cssBigIconWrapper(
          cssIcon('Dots', dom.cls(cssBgAccent.className, hasSpecs)),
          testId('options-icon'),
        ),
        menu(_ctl => flags.map(({computed, allowedTypes, flag, label}) => {
          // when allowedTypes is null, flag can be used for every column
          const enabled = !allowedTypes || allowedTypes.includes(column!.type);
          return cssMenuItem(
              labeledLeftSquareCheckbox(
                computed as any,
                label,
                dom.prop('disabled', !enabled),
              ),
              dom.cls(cssOptionMenuItem.className),
              dom.cls('disabled', !enabled),
              testId('option'),
              testId(`option-${flag}`),
            );
          },
        ), menuOptions),
      ),
      cssSortIconBtn('Remove',
        dom.on('click', () => {
          const specs = sortSpec.peek();
          if (Sort.findCol(specs, colRef)) {
            this._saveSort(Sort.removeCol(specs, colRef));
          }
        }),
        testId('remove')
      ),
      testId('row'),
    );
  }

  private _buildAddToSortButton(columns: Computed<SortableColumn[]>) {
    const available = Computed.create(null, (use) => {
      const currentSection = this._section;
      const currentSortSpec = use(currentSection.activeSortSpec);
      const specRowIds = new Set(currentSortSpec.map(_sortRef => Sort.getColRef(_sortRef)));
      return use(columns).filter(_col => !specRowIds.has(_col.value));
    });
    const {menuOptions} = this._options;
    return cssButtonRow(
      dom.autoDispose(available),
      dom.domComputed(use => {
        const cols = use(available);
        return cssTextBtn(
          t("Add Column"),
          dropdownWithSearch({
            popupOptions: menuOptions,
            options: () => cols.map((col) => ({label: col.label, value: col})),
            action: (col) => addToSort(this._section.activeSortSpec, col.value, 1),
            placeholder: t('Search Columns'),
          }),
          dom.on('click', (ev) => { ev.stopPropagation(); }),
          testId('add'),
        );
      }),
      dom.hide(use => !use(available).length),
    );
  }

  private _buildUpdateDataButton() {
    return dom.maybe(this._section.isSorted, () =>
      cssButtonRow(
        cssTextBtn(t("Update Data"),
          dom.on('click', () => updatePositions(this._gristDoc, this._section)),
          testId('update'),
          dom.show((use) => (
            use(use(this._section.table).supportsManualSort)
            && !use(this._gristDoc.isReadonly)
          )),
        ),
      ),
    );
  }

  private _reorder(colRef: number, nextColRef: number | null) {
    const activeSortSpec = this._section.activeSortSpec.peek();
    const colSpec = Sort.findCol(activeSortSpec, colRef);
    if (colSpec === undefined) {
      throw new Error(`Col ${colRef} not found in active sort spec`);
    }

    const newSpec = Sort.reorderSortRefs(this._section.activeSortSpec.peek(), colSpec, nextColRef);
    this._saveSort(newSpec);
  }

  private _saveSort(sortSpec: Sort.SortSpec) {
    this._section.activeSortSpec(sortSpec);
  }
}

const cssDragRow = styled('div', `
  display: flex !important;
  align-items: center;
  margin: 0 16px 0px 0px;
  & > .kf_draggable_content {
    margin: 4px 0;
    flex: 1 1 0px;
    min-width: 0px;
  }
`);

const cssLabel = styled('div', `
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  flex-grow: 1;
`);

const cssSortRow = styled('div', `
  display: flex;
  align-items: center;
  width: 100%;
`);

const cssTextBtn = styled('div', `
  color: ${theme.controlFg};
  cursor: pointer;

  &:hover {
    color: ${theme.controlHoverFg};
  }
`);

const cssSortIconBtn = styled(cssIcon, `
  flex: none;
  margin: 0 6px;
  cursor: pointer;
  background-color: ${theme.controlSecondaryFg};

  &:hover {
    background-color: ${theme.controlSecondaryHoverFg};
  }
`);

const cssSortIcon = styled(cssIcon, `
  flex: none;
  margin: 0px 6px 0px 0px;
  background-color: ${theme.controlSecondaryFg};

  &-accent {
    background-color: ${theme.accentIcon};
  }
`);

const cssBigIconWrapper = styled('div', `
  padding: 3px;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
`);

const cssBgAccent = styled(`div`, `
  background: ${theme.accentIcon}
`);

const cssMenu = styled('div', `
  display: inline-flex;
  cursor: pointer;
  border-radius: 3px;
  border: 1px solid transparent;
  margin-left: 6px;
  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
`);

const cssOptionMenuItem = styled('div', `
  &:hover {
    background-color: ${theme.hover};
  }
  & label {
    flex: 1;
    cursor: pointer;
  }
  &.disabled * {
    color: ${theme.menuItemDisabledFg} important;
    cursor: not-allowed;
  }
`);

const cssButtonRow = styled(cssRow, `
  margin-top: 4px;
`);
