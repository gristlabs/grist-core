import {
  ACIndexImpl,
  ACItem,
  ACResults,
  buildHighlightedDom,
  HighlightFunc,
  normalizeText
} from 'app/client/lib/ACIndex';
import {Autocomplete} from 'app/client/lib/autocomplete';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {menuCssClass} from 'app/client/ui2018/menus';
import {icon} from "app/client/ui2018/icons";
import {FieldOptions} from 'app/client/widgets/NewBaseEditor';
import {NTextEditor} from 'app/client/widgets/NTextEditor';
import {makeT} from 'app/client/lib/localization';
import {IToken} from 'app/client/lib/TokenField';
import {AppModel} from "app/client/models/AppModel";
import {UserAccessData} from "app/common/UserAPI";
import {undef} from 'app/common/gutil';
import {dom, Observable, styled} from 'grainjs';

const t = makeT('UserEditor');

export class UserItem implements ACItem, IToken {
  public cleanText: string = normalizeText(this.label);
  constructor(
    public label: string,
    public id: number
  ) {}
}

/**
 * A UserEditor offers an autocomplete of choices from the users of team.
 */
export class UserEditor extends NTextEditor {
  private _appModel: AppModel;
  private _autocomplete?: Autocomplete<UserItem>;
  private _dropdownConditionError = Observable.create<string | null>(this, null);
  private _userList: UserItem[] = [];

  constructor(options: FieldOptions) {
    super(options);

    this._appModel = options.gristDoc.appModel;

    // Decorate the editor to look like a user column value (with a "user" icon).
    // But not on readonly mode - here we will reuse default decoration
    if (!options.readonly) {
      this.cellEditorDiv.classList.add(cssUserEditor.className);
      this.cellEditorDiv.appendChild(cssUserEditIcon('FieldUser'));
    }

    this.textInput.value = undef(options.state, options.editValue, this._idToText());

    if (this._autocomplete) {
      if (options.editValue === undefined) {
        this._autocomplete.search((items) => items.findIndex((item) => item.label === options.cellValue));
      } else {
        this._autocomplete.search();
      }
    }
  }

  public async attach(cellElem: Element) {
    super.attach(cellElem);
    // don't create autocomplete for readonly mode
    if (this.options.readonly) {
      return;
    }

    try {
      this._userList = (await this._appModel.api.getUsers()).map((user: UserAccessData) => ({
        label: user.name || user.email,
        cleanText: normalizeText(user.name || user.email),
        id: user.id
      }));
    } catch (e) {
      this._dropdownConditionError?.set(e);
    }

    this._autocomplete = this.autoDispose(new Autocomplete<UserItem>(this.textInput, {
      menuCssClass: `${menuCssClass} ${cssUserList.className} test-autocomplete`,
      buildNoItemsMessage: () => {
        return dom.domComputed(use => {
          const error = use(this._dropdownConditionError);
          if (error) {
            return t('Error in dropdown condition');
          }

          return t('No choices matching condition');
        });
      },
      search: this._doSearch.bind(this),
      renderItem: this._renderItem.bind(this),
      getItemText: (item) => item.label,
      onClick: () => this.options.commands.fieldEditSave(),
    }));
  }

  public getCellValue() {
    const selectedItem = this._autocomplete && this._autocomplete.getSelectedItem();

    if (selectedItem) {
      // Selected from the autocomplete dropdown.
      return selectedItem.label;
    } else if (normalizeText(this.textInput.value) === this._idToText()) {
      // Unchanged from what's already in the cell.
      return this.options.cellValue;
    }

    return super.getCellValue();
  }

  private _idToText() {
    const value = this.options.cellValue;

    if (typeof value === 'number') {
      return this._userList.find((user) => value === user.id)?.label || '';
    }

    return String(value || '');
  }

  private async _doSearch(text: string): Promise<ACResults<UserItem>> {
    const items = new ACIndexImpl(this._userList);

    return items.search(text);
  }

  private _renderItem(item: UserItem, highlightFunc: HighlightFunc) {
    return cssUserItem(
      buildHighlightedDom(item.label, highlightFunc, cssMatchText)
    );
  }
}

const cssUserEditor = styled('div', `
  & > .celleditor_text_editor, & > .celleditor_content_measure {
    padding-left: 18px;
  }
`);

const cssUserEditIcon = styled(icon, `
  background-color: ${theme.lightText};
  position: absolute;
  top: 0;
  left: 0;
  margin: 3px 3px 0 3px;
`);

// Set z-index to be higher than the 1000 set for .cell_editor.
const cssUserList = styled('div', `
  z-index: 1001;
  overflow-y: auto;
  padding: 8px 0 0 0;
  --weaseljs-menu-item-padding: 8px 16px;
`);

const cssUserItem = styled('li', `
  display: block;
  font-family: ${vars.fontFamily};
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  cursor: pointer;
  color: ${theme.menuItemFg};

  &.selected {
    background-color: ${theme.menuItemSelectedBg};
    color:            ${theme.menuItemSelectedFg};
  }
`);

const cssMatchText = styled('span', `
  color: ${theme.autocompleteMatchText};
  .selected > & {
    color: ${theme.autocompleteSelectedMatchText};
  }
`);
