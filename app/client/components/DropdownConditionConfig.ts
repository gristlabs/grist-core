import {buildDropdownConditionEditor} from 'app/client/components/DropdownConditionEditor';
import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec} from 'app/client/models/DocModel';
import {cssLabel, cssRow} from 'app/client/ui/RightPanelStyles';
import {withInfoTooltip} from 'app/client/ui/tooltips';
import {textButton } from 'app/client/ui2018/buttons';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {ISuggestionWithValue} from 'app/common/ActiveDocAPI';
import {getPredicateFormulaProperties} from 'app/common/PredicateFormula';
import {UserInfo} from 'app/common/User';
import {Computed, Disposable, dom, Observable, styled} from 'grainjs';
import isPlainObject from 'lodash/isPlainObject';

const t = makeT('DropdownConditionConfig');

/**
 * Right panel configuration for dropdown conditions.
 *
 * Contains an instance of `DropdownConditionEditor`, the class responsible
 * for setting dropdown conditions.
 */
export class DropdownConditionConfig extends Disposable {
  private _text = Computed.create(this, use => {
    const dropdownCondition = use(this._field.dropdownCondition);
    if (!dropdownCondition) { return ''; }

    return dropdownCondition.text;
  });

  private _saveError = Observable.create<string | null>(this, null);

  private _properties = Computed.create(this, use => {
    const dropdownCondition = use(this._field.dropdownCondition);
    if (!dropdownCondition?.parsed) { return null; }

    return getPredicateFormulaProperties(JSON.parse(dropdownCondition.parsed));
  });

  private _column = Computed.create(this, use => use(this._field.column));

  private _columns = Computed.create(this, use => use(use(use(this._column).table).visibleColumns));

  private _refColumns = Computed.create(this, use => {
    const refTable = use(use(this._column).refTable);
    if (!refTable) { return null; }

    return use(refTable.visibleColumns);
  });

  private _propertiesError = Computed.create<string | null>(this, use => {
    const properties = use(this._properties);
    if (!properties) { return null; }

    const {recColIds = [], choiceColIds = []} = properties;
    const columns = use(this._columns);
    const validRecColIds = new Set(['id', ...columns.map((({colId}) => use(colId)))]);
    const invalidRecColIds = recColIds.filter(colId => !validRecColIds.has(colId));
    if (invalidRecColIds.length > 0) {
      return t('Invalid columns: {{colIds}}', {colIds: invalidRecColIds.join(', ')});
    }

    const refColumns = use(this._refColumns);
    if (refColumns) {
      const validChoiceColIds = new Set(['id', ...refColumns.map((({colId}) => use(colId)))]);
      const invalidChoiceColIds = choiceColIds.filter(colId => !validChoiceColIds.has(colId));
      if (invalidChoiceColIds.length > 0) {
        return t('Invalid columns: {{colIds}}', {colIds: invalidChoiceColIds.join(', ')});
      }
    }

    return null;
  });

  private _error = Computed.create<string | null>(this, (use) => {
    const maybeSaveError = use(this._saveError);
    if (maybeSaveError) { return maybeSaveError; }

    const maybeCompiled = use(this._field.dropdownConditionCompiled);
    if (maybeCompiled?.kind === 'failure') { return maybeCompiled.error; }

    const maybePropertiesError = use(this._propertiesError);
    if (maybePropertiesError) { return maybePropertiesError; }

    return null;
  });

  private _disabled = Computed.create(this, use =>
    use(this._field.disableModify) ||
    use(use(this._column).disableEditData) ||
    use(this._field.config.multiselect)
  );

  private _isEditingCondition = Observable.create(this, false);

  private _isRefField = Computed.create(this, (use) =>
    ['Ref', 'RefList'].includes(use(use(this._column).pureType)));

  private _tooltip = Computed.create(this, use => use(this._isRefField)
    ? 'setRefDropdownCondition'
    : 'setChoiceDropdownCondition');

  private _editorElement: HTMLElement;

  constructor(private _field: ViewFieldRec, private _gristDoc: GristDoc) {
    super();

    this.autoDispose(this._text.addListener(() => {
      this._saveError.set('');
    }));
  }

  public buildDom() {
    return [
      dom.maybe((use) => !(use(this._isEditingCondition) || Boolean(use(this._text))), () => [
        cssSetDropdownConditionRow(
          dom.domComputed(use => withInfoTooltip(
            textButton(
              t('Set dropdown condition'),
              dom.on('click', () => {
                this._isEditingCondition.set(true);
                setTimeout(() => this._editorElement.focus(), 0);
              }),
              dom.prop('disabled', this._disabled),
              testId('field-set-dropdown-condition'),
            ),
            use(this._tooltip),
          )),
        ),
      ]),
      dom.maybe((use) => use(this._isEditingCondition) || Boolean(use(this._text)), () => [
        cssLabel(t('Dropdown Condition')),
        cssRow(
          dom.create(buildDropdownConditionEditor,
            {
              value: this._text,
              disabled: this._disabled,
              getAutocompleteSuggestions: () => this._getAutocompleteSuggestions(),
              onSave: async (value) => {
                try {
                  const widgetOptions = this._field.widgetOptionsJson.peek();
                  if (value.trim() === '') {
                    delete widgetOptions.dropdownCondition;
                  } else {
                    widgetOptions.dropdownCondition = {text: value};
                  }
                  await this._field.widgetOptionsJson.setAndSave(widgetOptions);
                } catch (e) {
                  if (e?.code === 'ACL_DENY') {
                    reportError(e);
                  } else {
                    this._saveError.set(e.message.replace(/^\[Sandbox\]/, '').trim());
                  }
                }
              },
              onDispose: () => {
                this._isEditingCondition.set(false);
              },
            },
            (el) => { this._editorElement = el; },
            testId('field-dropdown-condition'),
          ),
        ),
        dom.maybe(this._error, (error) => cssRow(
          cssDropdownConditionError(error), testId('field-dropdown-condition-error')),
        ),
      ]),
    ];
  }

  private _getAutocompleteSuggestions(): ISuggestionWithValue[] {
    const variables = ['choice'];
    const user = this._gristDoc.docPageModel.user.get();
    if (user) {
      variables.push(...getUserCompletions(user));
    }
    const refColumns = this._refColumns.get();
    if (refColumns) {
      variables.push('choice.id', ...refColumns.map(({colId}) => `choice.${colId.peek()}`));
    }
    const columns = this._columns.get();
    variables.push(
      ...columns.map(({colId}) => `$${colId.peek()}`),
      ...columns.map(({colId}) => `rec.${colId.peek()}`),
    );
    const suggestions = [
      'and', 'or', 'not', 'in', 'is', 'True', 'False', 'None',
      'OWNER', 'EDITOR', 'VIEWER',
      ...variables,
    ];
    return suggestions.map(suggestion => [suggestion, null]);
  }
}

function getUserCompletions(user: UserInfo) {
  return Object.entries(user).flatMap(([key, value]) => {
    if (key === 'LinkKey') {
      return 'user.LinkKey.';
    } else if (isPlainObject(value)) {
      return Object.keys(value as {[key: string]: any})
        .filter(valueKey => valueKey !== 'manualSort')
        .map(valueKey => `user.${key}.${valueKey}`);
    } else {
      return `user.${key}`;
    }
  });
}

const cssSetDropdownConditionRow = styled(cssRow, `
  margin-top: 16px;
`);

const cssDropdownConditionError = styled('div', `
  color: ${theme.errorText};
  margin-top: 4px;
  width: 100%;
`);
