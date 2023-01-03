import {makeT} from 'app/client/lib/localization';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {attachColumnFilterMenu} from 'app/client/ui/ColumnFilterMenu';
import {addFilterMenu} from 'app/client/ui/FilterBar';
import {cssIcon, cssPinButton, cssRow, cssSortFilterColumn} from 'app/client/ui/RightPanelStyles';
import {theme} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {Computed, Disposable, dom, makeTestId, styled} from 'grainjs';
import {IMenuOptions} from 'popweasel';

const testId = makeTestId('test-filter-config-');

const t = makeT('SortConfig');

export interface FilterConfigOptions {
  /** Options to pass to the menu and popup components. */
  menuOptions?: IMenuOptions;
}

/**
 * Component that renders controls for managing filters for a view section.
 *
 * Active filters (i.e. columns that have non-blank filters set) are displayed in
 * a vertical list of pill-shaped buttons. These buttons can be clicked to open their
 * respective filter menu. Additionally, there are buttons to the right of each filter
 * for removing and pinning them.
 */
export class FilterConfig extends Disposable {
  private _popupControls = new WeakMap();

  private _canAddFilter = Computed.create(this, (use) => {
    return use(this._section.filters).some(f => !use(f.isFiltered));
  });

  constructor(private _section: ViewSectionRec, private _options: FilterConfigOptions = {}) {
    super();
  }

  public buildDom() {
    const {menuOptions} = this._options;
    return dom('div',
      dom.forEach(this._section.activeFilters, (filterInfo) => {
        const {fieldOrColumn, filter, pinned, isPinned} = filterInfo;
        return cssRow(
          cssSortFilterColumn(
            cssIconWrapper(
              cssFilterIcon('FilterSimple',
                cssFilterIcon.cls('-accent', use => !use(filter.isSaved) || !use(pinned.isSaved)),
                testId('filter-icon'),
              ),
            ),
            cssLabel(dom.text(fieldOrColumn.label)),
            attachColumnFilterMenu(filterInfo, {
              popupOptions: {
                placement: 'bottom-end',
                ...menuOptions,
                trigger: [
                  'click',
                  (_el, popupControl) => this._popupControls.set(fieldOrColumn.origCol(), popupControl)
                ],
              },
            }),
            testId('column'),
          ),
          cssPinFilterButton(
            icon('PinTilted'),
            dom.on('click', () => this._section.setFilter(fieldOrColumn.origCol().origColRef(), {
              pinned: !isPinned.peek()
            })),
            cssPinButton.cls('-pinned', isPinned),
            testId('pin-filter'),
          ),
          cssIconWrapper(
            cssRemoveFilterButton('Remove',
              dom.on('click',
                () => this._section.setFilter(fieldOrColumn.origCol().origColRef(), {
                  filter: '',
                  pinned: false,
                })),
              testId('remove-filter'),
            ),
          ),
          testId('filter'),
        );
      }),
      cssRow(
        dom.domComputed((use) => {
          const filters = use(this._section.filters);
          return cssTextBtn(
            t("Add Column"),
            addFilterMenu(filters, this._popupControls, {
              menuOptions: {
                placement: 'bottom-end',
                ...this._options.menuOptions,
              },
            }),
            dom.on('click', (ev) => ev.stopPropagation()),
            dom.hide(u => !u(this._canAddFilter)),
            testId('add-filter-btn'),
          );
        }),
      ),
      testId('container'),
    );
  }
}

const cssIconWrapper = styled('div', ``);

const cssLabel = styled('div', `
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
  flex-grow: 1;
`);

const cssTextBtn = styled('div', `
  color: ${theme.controlFg};
  cursor: pointer;

  &:hover {
    color: ${theme.controlHoverFg};
  }
`);

const cssFilterIcon = styled(cssIcon, `
  flex: none;
  margin: 0px 6px 0px 0px;
  background-color: ${theme.controlSecondaryFg};

  &-accent {
    background-color: ${theme.accentIcon};
  }
`);

const cssRemoveFilterButton = styled(cssIcon, `
  flex: none;
  margin: 0 6px;
  background-color: ${theme.controlSecondaryFg};
  cursor: pointer;

  &:hover {
    background-color: ${theme.controlSecondaryHoverFg};
  }
`);

const cssPinFilterButton = styled(cssPinButton, `
  margin-left: 6px;
`);
