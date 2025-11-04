import * as css from 'app/client/components/FormRendererCss';
import {bindMarkdown} from 'app/client/components/Forms/styles';
import {getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {makeT} from 'app/client/lib/localization';
import {FormField} from 'app/client/ui/FormAPI';
import {dropdownWithSearch} from 'app/client/ui/searchDropdown';
import {isXSmallScreenObs} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {confirmModal} from 'app/client/ui2018/modals';
import {toggleSwitch} from 'app/client/ui2018/toggleSwitch';
import {isAffirmative, isNumber} from 'app/common/gutil';
import {CellValue} from 'app/plugin/GristData';
import {Disposable, dom, DomContents, IAttrObj, makeTestId, MutableObsArray, obsArray, Observable} from 'grainjs';
import {IPopupOptions, PopupControl} from 'popweasel';

const testId = makeTestId('test-form-');

const t = makeT('FormRenderer');

const G = getBrowserGlobals('window');

/**
 * A node in a recursive, tree-like hierarchy comprising the layout of a form.
 */
export interface FormLayoutNode {
  /** Unique ID of the node. Used by FormView. */
  id: string;
  type: FormLayoutNodeType;
  children?: Array<FormLayoutNode>;
  // Used by Layout.
  submitText?: string;
  successURL?: string;
  successText?: string;
  anotherResponse?: boolean;
  // Used by Field.
  formRequired?: boolean;
  leaf?: number;
  // Used by Label and Paragraph.
  text?: string;
  // Used by Paragraph.
  alignment?: string;
}

export type FormLayoutNodeType =
  | 'Paragraph'
  | 'Section'
  | 'Columns'
  | 'Submit'
  | 'Placeholder'
  | 'Layout'
  | 'Field'
  | 'Label'
  | 'Separator'
  | 'Header';

/**
 * Context used by FormRenderer to build each node.
 */
export interface FormRendererContext {
  /** Field metadata, keyed by field id. */
  fields: Record<number, FormField>;
  /** The root of the FormLayoutNode tree. */
  rootLayoutNode: FormLayoutNode;
  /** Disables the Submit node if true. */
  disabled: Observable<boolean>;
  /** Error to show above the Submit node. */
  error: Observable<string|null>;
}

/**
 * Returns a copy of `layoutSpec` with any leaf nodes that don't exist
 * in `fieldIds` removed. Optionally if the fieldIds is a map of old to new
 * field ids, the leaf nodes will be updated to the new field ids.
 */
export function cleanFormLayoutSpec(
  layoutSpec: FormLayoutNode,
  fieldIds: Set<number>|Record<number, number>,
): FormLayoutNode | null {
  if (layoutSpec.leaf) {
    if (fieldIds instanceof Set) {
      return fieldIds.has(layoutSpec.leaf) ? {...layoutSpec} : null;
    }
    return fieldIds[layoutSpec.leaf] ? {...layoutSpec, leaf: fieldIds[layoutSpec.leaf]} : null;
  }

  return {
    ...layoutSpec,
    children: layoutSpec.children
      ?.map(child => cleanFormLayoutSpec(child, fieldIds))
      .filter((child): child is FormLayoutNode => child !== null),
  };
}


/**
 * A renderer for a form layout.
 *
 * Takes the root FormLayoutNode and additional context for each node, and returns
 * the DomContents of the rendered form.
 *
 * A closely related set of classes exist in `app/client/components/Forms/*`; those are
 * specifically used to render a version of a form that is suitable for displaying within
 * a Form widget, where submitting a form isn't possible.
 *
 * TODO: merge the two implementations or factor out what's common.
 */
export abstract class FormRenderer extends Disposable {
  public static new(
    layoutNode: FormLayoutNode,
    context: FormRendererContext,
    parent?: FormRenderer
  ): FormRenderer {
    const Renderer = FormRenderers[layoutNode.type] ?? ParagraphRenderer;
    return new Renderer(layoutNode, context, parent);
  }

  protected children: FormRenderer[];

  constructor(
    protected layoutNode: FormLayoutNode,
    protected context: FormRendererContext,
    protected parent?: FormRenderer
  ) {
    super();
    this.children = (this.layoutNode.children ?? []).map((child) =>
      this.autoDispose(FormRenderer.new(child, this.context, this)));
  }

  public abstract render(): DomContents;

  /**
   * Reset the state of this layout node and all of its children.
   */
  public reset() {
    this.children.forEach((child) => child.reset());
  }
}

class LabelRenderer extends FormRenderer {
  public render() {
    return css.label(this.layoutNode.text ?? '');
  }
}

class ParagraphRenderer extends FormRenderer {
  public render() {
    return css.paragraph(
      css.paragraph.cls(`-alignment-${this.layoutNode.alignment || 'left'}`),
      bindMarkdown(this.layoutNode.text || '')
    );
  }
}

class SectionRenderer extends FormRenderer {
  public render() {
    return css.section(
      this.children.map((child) => child.render()),
    );
  }
}

class ColumnsRenderer extends FormRenderer {
  public render() {
    return css.columns(
      {style: `--grist-columns-count: ${this._getColumnsCount()}`},
      this.children.map((child) => child.render()),
    );
  }

  private _getColumnsCount() {
    return this.children.length || 1;
  }
}

class SubmitRenderer extends FormRenderer {
  public render() {
    return [
      css.error(dom.text(use => use(this.context.error) ?? '')),
      css.submitButtons(
        css.resetButton(
          t('Reset'),
          dom.attr('aria-disabled', (use) => use(this.context.disabled) ? 'true' : 'false'),
          {type: 'button'},
          dom.on('click', (event) => {
            if (this.context.disabled.get()) {
              return event.preventDefault();
            }
            return confirmModal(
              'Are you sure you want to reset your form?',
              'Reset',
              () => this.parent?.reset()
            );
          }),
          testId('reset'),
        ),
        css.submitButton(
          dom('button',
            dom.attr('aria-disabled', (use) => use(this.context.disabled) ? 'true' : 'false'),
            {type: 'submit'},
            dom.domComputed(use => {
              return use(this.context.disabled)
                ? [css.buttonLoadingSpinner(), t('Submitting…')]
                : this.context.rootLayoutNode.submitText || t('Submit');
            }),
            dom.on('click', (event) => {
              if (this.context.disabled.get()) {
                return event.preventDefault();
              }
              return validateRequiredLists();
            }),
          )
        ),
      ),
    ];
  }
}

class PlaceholderRenderer extends FormRenderer {
  public render() {
    return dom('div');
  }
}

class LayoutRenderer extends FormRenderer {
  public render() {
    return this.children.map((child) => child.render());
  }
}

class FieldRenderer extends FormRenderer {
  public renderer: BaseFieldRenderer;

  public constructor(layoutNode: FormLayoutNode, context: FormRendererContext) {
    super(layoutNode, context);
    const field = this.layoutNode.leaf ? this.context.fields[this.layoutNode.leaf] : null;
    if (!field) { throw new Error(); }

    const Renderer = FieldRenderers[field.type as keyof typeof FieldRenderers] ?? TextRenderer;
    this.renderer = this.autoDispose(new Renderer(field, context));
  }

  public render() {
    return this.renderer.render();
  }

  public reset() {
    this.renderer.resetInput();
  }
}

abstract class BaseFieldRenderer extends Disposable {
  public constructor(protected field: FormField, protected context: FormRendererContext) {
    super();
  }

  public render() {
    return css.field(
      dom.hide(this.field.options.formIsHidden || false),
      this.label(),
      dom('div', this.input()),
      this.fieldDomAttributes(),
    );
  }

  public name() {
    return this.field.colId;
  }

  public id() {
    return this.name().replace(/\s+/g, '-');
  }

  public label() {
    return dom('label',
      css.label.cls(''),
      css.label.cls('-required', Boolean(this.field.options.formRequired)),
      {for: this.name(), id: `${this.id()}-label`},
      this.field.question,
    );
  }

  public abstract input(): DomContents;

  public abstract resetInput(): void;

  /**
   * A Field renderer can override this to add additional attributes to the field's DOM element.
   */
  public fieldDomAttributes(): IAttrObj {
    return {};
  }

  protected getInitialValue(): string|null {
    if (this.field.options.formAcceptFromUrl) {
      if (G.window.location.search) {
        return new URLSearchParams(window.location.search).get(this.field.colId);
      }
    }
    return null;
  }

  protected getInitialValueList(): string[] {
    if (this.field.options.formAcceptFromUrl) {
      if (G.window.location.search) {
        return new URLSearchParams(window.location.search).getAll(this.field.colId);
      }
    }
    return [];
  }
}

class TextRenderer extends BaseFieldRenderer {
  protected inputType = 'text';

  private _format = this.field.options.formTextFormat ?? 'singleline';
  private _lineCount = String(this.field.options.formTextLineCount || 3);
  private _value = Observable.create<string>(this, this.getInitialValue() ?? '');

  public input() {
    if (this._format === 'singleline') {
      return this._renderSingleLineInput();
    } else {
      return this._renderMultiLineInput();
    }
  }

  public resetInput(): void {
    this._value.setAndTrigger(this.getInitialValue() ?? '');
  }

  private _renderSingleLineInput() {
    return css.textInput(
      {
        type: this.inputType,
        name: this.name(),
        id: this.id(),
        required: this.field.options.formRequired,
      },
      dom.prop('value', this._value),
      preventSubmitOnEnter(),
    );
  }

  private _renderMultiLineInput() {
    return css.textarea(
      {
        name: this.name(),
        id: this.id(),
        required: this.field.options.formRequired,
        rows: this._lineCount,
      },
      dom.prop('value', this._value),
      dom.on('input', (_e, elem) => this._value.set(elem.value)),
    );
  }
}

class NumericRenderer extends BaseFieldRenderer {
  protected inputType = 'text';

  private _format = this.field.options.formNumberFormat ?? 'text';
  private _value = Observable.create<string>(this, this.getInitialValue() ?? '');
  private _spinnerValue = Observable.create<number|''>(this, this.getInitialNumericValue());

  public input() {
    if (this._format === 'text') {
      return this._renderTextInput();
    } else {
      return this._renderSpinnerInput();
    }
  }

  public resetInput(): void {
    this._value.setAndTrigger(this.getInitialValue() ?? '');
    this._spinnerValue.setAndTrigger(this.getInitialNumericValue());
  }

  protected getInitialNumericValue(): number|'' {
    const val = this.getInitialValue();
    return (val && isNumber(val)) ? parseFloat(val) : '';
  }

  private _renderTextInput() {
    return css.textInput(
      {
        type: this.inputType,
        name: this.name(),
        id: this.id(),
        required: this.field.options.formRequired,
      },
      dom.prop('value', this._value),
      preventSubmitOnEnter(),
    );
  }

  private _renderSpinnerInput() {
    return css.spinner(
      this._spinnerValue,
      {
        setValueOnInput: true,
        inputArgs: [
          {
            name: this.name(),
            id: this.id(),
            required: this.field.options.formRequired,
          },
          preventSubmitOnEnter(),
        ],
      }
    );
  }
}

class DateRenderer extends TextRenderer {
  protected inputType = 'date';
}

class DateTimeRenderer extends TextRenderer {
  protected inputType = 'datetime-local';
}

export const selectPlaceholder = () => t('Select...');

class ChoiceRenderer extends BaseFieldRenderer  {
  protected value: Observable<string>;

  private _choices: string[];
  private _selectElement: HTMLElement;
  private _ctl?: PopupControl<IPopupOptions>;
  private _format = this.field.options.formSelectFormat ?? 'select';
  private _alignment = this.field.options.formOptionsAlignment ?? 'vertical';
  private _radioButtons: MutableObsArray<{
    label: string;
    checked: Observable<boolean>
  }> = this.autoDispose(obsArray());

  public constructor(field: FormField, context: FormRendererContext) {
    super(field, context);

    const choices = this.field.options.choices;
    if (!Array.isArray(choices) || choices.some((choice) => typeof choice !== 'string')) {
      this._choices = [];
    } else {
      const sortOrder = this.field.options.formOptionsSortOrder ?? 'default';
      if (sortOrder !== 'default') {
        choices.sort((a, b) => String(a).localeCompare(String(b)));
        if (sortOrder === 'descending') {
          choices.reverse();
        }
      }
      this._choices = choices;
    }

    const initialValue = this.getInitialValue();
    this.value = Observable.create<string>(this, initialValue ?? '');

    this._radioButtons.set(this._choices.map(choice => ({
      label: String(choice),
      checked: Observable.create(this, String(choice) === initialValue),
    })));
  }

  public fieldDomAttributes() {
    if (this._format === 'radio') {
      return {
        role: 'group',
        'aria-labelledby': `${this.id()}-label`,
      };
    }
    return {};
  }

  public input() {
    if (this._format === 'select') {
      return this._renderSelectInput();
    } else {
      return this._renderRadioInput();
    }
  }

  public resetInput() {
    const initialValue = this.getInitialValue();
    this.value.set(initialValue ?? '');
    this._radioButtons.get().forEach(radioButton => {
      radioButton.checked.set(radioButton.label === initialValue);
    });
  }

  protected override getInitialValue() {
    const val = super.getInitialValue();
    return val && this._choices.includes(val) ? val : null;
  }

  private _renderSelectInput() {
    return css.hybridSelect(
      this._selectElement = css.select(
        {name: this.name(), id: this.id(), required: this.field.options.formRequired},
        dom.on('input', (_e, elem) => this.value.set(elem.value)),
        dom('option', {value: ''}, selectPlaceholder()),
        this._choices.map((choice) => dom('option',
          {value: choice},
          dom.prop('selected', use => use(this.value) === choice),
          choice
        )),
        dom.onKeyDown({
          Enter$: (ev) => this._maybeOpenSearchSelect(ev),
          ' $': (ev) => this._maybeOpenSearchSelect(ev),
          ArrowUp$: (ev) => this._maybeOpenSearchSelect(ev),
          ArrowDown$: (ev) => this._maybeOpenSearchSelect(ev),
          Backspace$: () => this.value.set(''),
        }),
        preventSubmitOnEnter(),
      ),
      dom.maybe(use => !use(isXSmallScreenObs()), () =>
        css.searchSelect(
          css.currentSelectValue(dom.text(use => use(this.value) || selectPlaceholder())),
          dropdownWithSearch<string>({
            action: (value) => this.value.set(value),
            options: () => this._choices.map((choice) => ({
              label: choice,
              value: choice,
            })),
            onClose: () => { setTimeout(() => this._selectElement.focus()); },
            placeholder: t('Search'),
            acOptions: {maxResults: 100, keepOrder: false, showEmptyItems: true},
            popupOptions: {
              trigger: [
                'click',
                (_el, ctl) => { this._ctl = ctl; },
              ],
            },
            matchTriggerElemWidth: true,
          }),
          css.resetSelectButton(
            icon('CrossSmall'),
            dom.attr('aria-label', t('Clear selection for: {{-inputLabel}}', {inputLabel: this.field.question})),
            dom.hide((use) => !use(this.value)),
            dom.on('click', (ev) => {
              this.value.set('');
              this._selectElement.focus();
              ev.stopPropagation();
              ev.preventDefault();
            }),
            testId('search-select-clear-btn')
          ),
          css.searchSelectIcon('Collapse'),
          testId('search-select'),
        ),
      ),
    );
  }

  private _renderRadioInput() {
    const required = this.field.options.formRequired;
    return css.radioList(
      css.radioList.cls('-horizontal', this._alignment === 'horizontal'),
      dom.cls('grist-radio-list'),
      dom.cls('required', Boolean(required)),
      {name: this.name(), required},
      dom.forEach(this._radioButtons, (radioButton) =>
        css.radio(
          dom('input',
            dom.prop('checked', radioButton.checked),
            dom.on('change', (_e, elem) => radioButton.checked.set(elem.checked)),
            {
              type: 'radio',
              name: `${this.name()}`,
              value: radioButton.label,
            },
            preventSubmitOnEnter(),
          ),
          dom('span', radioButton.label),
        )
      ),
    );
  }

  private _maybeOpenSearchSelect(ev: KeyboardEvent) {
    if (isXSmallScreenObs().get()) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    this._ctl?.open();
  }
}

class BoolRenderer extends BaseFieldRenderer {
  protected inputType = 'checkbox';
  protected checked = Observable.create<boolean>(this, isAffirmative(this.getInitialValue()));

  private _format = this.field.options.formToggleFormat ?? 'switch';

  public render() {
    return css.field(
      dom('div', this.input()),
    );
  }

  public input() {
    if (this._format === 'switch') {
      return this._renderSwitchInput();
    } else {
      return this._renderCheckboxInput();
    }
  }

  public resetInput(): void {
    this.checked.set(isAffirmative(this.getInitialValue()));
  }

  private _renderSwitchInput() {
    return toggleSwitch(this. checked, {
      label: this.field.question,
      inputArgs: [
        {name: this.name(), required: this.field.options.formRequired},
        preventSubmitOnEnter(),
      ],
      labelArgs: [
        css.label.cls('-required', Boolean(this.field.options.formRequired)),
      ],
    });
  }

  private _renderCheckboxInput() {
    return css.toggle(
      css.checkboxInput(
        dom.prop('checked', this.checked),
        dom.prop('value', use => use(this.checked) ? '1' : '0'),
        dom.on('change', (_e, elem) => this.checked.set(elem.checked)),
        {
          type: this.inputType,
          name: this.name(),
          required: this.field.options.formRequired,
        },
        preventSubmitOnEnter(),
      ),
      css.toggleLabel(
        css.label.cls('-required', Boolean(this.field.options.formRequired)),
        this.field.question,
      ),
    );
  }
}

class ChoiceListRenderer extends BaseFieldRenderer  {
  protected checkboxes: MutableObsArray<{
    label: string;
    checked: Observable<boolean>
  }> = this.autoDispose(obsArray());

  private _alignment = this.field.options.formOptionsAlignment ?? 'vertical';

  public constructor(field: FormField, context: FormRendererContext) {
    super(field, context);

    let choices = this.field.options.choices;
    if (!Array.isArray(choices) || choices.some((choice) => typeof choice !== 'string')) {
      choices = [];
    } else {
      const sortOrder = this.field.options.formOptionsSortOrder ?? 'default';
      if (sortOrder !== 'default') {
        choices.sort((a, b) => String(a).localeCompare(String(b)));
        if (sortOrder === 'descending') {
          choices.reverse();
        }
      }
      // Support for 30 choices. TODO: make limit dynamic.
      choices = choices.slice(0, 30);
    }

    const initialValues = new Set(this.getInitialValueList());
    this.checkboxes.set(choices.map(choice => ({
      label: choice,
      checked: Observable.create(this, initialValues.has(choice)),
    })));
  }

  public fieldDomAttributes() {
    return {
      role: 'group',
      'aria-labelledby': `${this.id()}-label`,
    };
  }

  public input() {
    const required = this.field.options.formRequired;
    return css.checkboxList(
      css.checkboxList.cls('-horizontal', this._alignment === 'horizontal'),
      dom.cls('grist-checkbox-list'),
      dom.cls('required', Boolean(required)),
      {name: this.name(), required},
      dom.forEach(this.checkboxes, (checkbox) =>
        css.checkbox(
          css.checkboxInput(
            dom.prop('checked', checkbox.checked),
            dom.on('change', (_e, elem) => checkbox.checked.set(elem.checked)),
            {
              type: 'checkbox',
              name: `${this.name()}[]`,
              value: checkbox.label,
            },
            preventSubmitOnEnter(),
          ),
          dom('span', checkbox.label),
        )
      ),
    );
  }

  public resetInput(): void {
    const initialValues = new Set(this.getInitialValueList());
    this.checkboxes.get().forEach(checkbox => {
      checkbox.checked.set(initialValues.has(checkbox.label));
    });
  }
}

class RefListRenderer extends BaseFieldRenderer {
  protected checkboxes: MutableObsArray<{
    label: string;
    value: string;
    checked: Observable<boolean>
  }> = this.autoDispose(obsArray());

  private _alignment = this.field.options.formOptionsAlignment ?? 'vertical';

  public constructor(field: FormField, context: FormRendererContext) {
    super(field, context);

    const references = this.field.refValues ?? [];
    const sortOrder = this.field.options.formOptionsSortOrder;
    if (sortOrder !== 'default') {
      // Sort by the second value, which is the display value.
      references.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      if (sortOrder === 'descending') {
        references.reverse();
      }
    }
    // Support for 30 choices. TODO: make limit dynamic.
    references.splice(30);
    const initialValues = new Set(this.getInitialValueList());
    this.checkboxes.set(references.map(reference => ({
      label: String(reference[1]),
      value: String(reference[0]),
      checked: Observable.create(this, initialValues.has(String(reference[1]))),
    })));
  }

  public fieldDomAttributes() {
    return {
      role: 'group',
      'aria-labelledby': `${this.id()}-label`,
    };
  }

  public input() {
    const required = this.field.options.formRequired;
    return css.checkboxList(
      css.checkboxList.cls('-horizontal', this._alignment === 'horizontal'),
      dom.cls('grist-checkbox-list'),
      dom.cls('required', Boolean(required)),
      {name: this.name(), required},
      dom.forEach(this.checkboxes, (checkbox) =>
        css.checkbox(
          css.checkboxInput(
            dom.prop('checked', checkbox.checked),
            dom.on('change', (_e, elem) => checkbox.checked.set(elem.checked)),
            {
              type: 'checkbox',
              'data-grist-type': this.field.type,
              name: `${this.name()}[]`,
              value: checkbox.value,
            },
            preventSubmitOnEnter(),
          ),
          dom('span', checkbox.label),
        )
      ),
    );
  }

  public resetInput(): void {
    const initialValues = new Set(this.getInitialValueList());
    this.checkboxes.get().forEach(checkbox => {
      checkbox.checked.set(initialValues.has(checkbox.label));
    });
  }
}

class RefRenderer extends BaseFieldRenderer {
  protected value: Observable<string>;

  private _format = this.field.options.formSelectFormat ?? 'select';
  private _alignment = this.field.options.formOptionsAlignment ?? 'vertical';
  private _choices: [number|string, CellValue][];
  private _selectElement: HTMLElement;
  private _ctl?: PopupControl<IPopupOptions>;
  private _radioButtons: MutableObsArray<{
    label: string;
    value: string;
    checked: Observable<boolean>
  }> = this.autoDispose(obsArray());

  public constructor(field: FormField, context: FormRendererContext) {
    super(field, context);

    const choices: [number|string, CellValue][] = this.field.refValues ?? [];
    const sortOrder = this.field.options.formOptionsSortOrder ?? 'default';
    if (sortOrder !== 'default') {
      // Sort by the second value, which is the display value.
      choices.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      if (sortOrder === 'descending') {
        choices.reverse();
      }
    }
    this._choices = choices;

    const initialValue = this.getInitialValue();
    this.value = Observable.create<string>(this, initialValue ?? '');

    this._radioButtons.set(this._choices.map(reference => ({
      label: String(reference[1]),
      value: String(reference[0]),
      checked: Observable.create(this, String(reference[0]) === initialValue),
    })));
  }

  public fieldDomAttributes() {
    if (this._format === 'radio') {
      return {
        role: 'group',
        'aria-labelledby': `${this.id()}-label`,
      };
    }
    return {};
  }

  public input() {
    if (this._format === 'select') {
      return this._renderSelectInput();
    } else {
      return this._renderRadioInput();
    }
  }

  public resetInput(): void {
    const initialValue = this.getInitialValue();
    this.value.set(initialValue ?? '');
    this._radioButtons.get().forEach(radioButton => {
      radioButton.checked.set(radioButton.value === initialValue);
    });
  }

  // This returns the reference rather than its label (e.g. '5' rather than 'Some Name').
  protected override getInitialValue() {
    const initialValue = super.getInitialValue();
    const choice = initialValue && this._choices.find(([id, value]) => (String(value) === initialValue));
    return choice ? String(choice[0]) : null;
  }

  private _renderSelectInput() {
    return css.hybridSelect(
      this._selectElement = css.select(
        {
          name: this.name(),
          id: this.id(),
          'data-grist-type': this.field.type,
          required: this.field.options.formRequired,
        },
        dom.on('input', (_e, elem) => this.value.set(elem.value)),
        dom('option',
          {value: ''},
          selectPlaceholder(),
          dom.prop('selected', use => use(this.value) === ''),
        ),
        this._choices.map((choice) => dom('option',
          {value: String(choice[0])},
          String(choice[1]),
          dom.prop('selected', use => use(this.value) === String(choice[0])),
        )),
        dom.onKeyDown({
          Enter$: (ev) => this._maybeOpenSearchSelect(ev),
          ' $': (ev) => this._maybeOpenSearchSelect(ev),
          ArrowUp$: (ev) => this._maybeOpenSearchSelect(ev),
          ArrowDown$: (ev) => this._maybeOpenSearchSelect(ev),
          Backspace$: () => this.value.set(''),
        }),
        preventSubmitOnEnter(),
      ),
      dom.maybe(use => !use(isXSmallScreenObs()), () =>
        css.searchSelect(
          css.currentSelectValue(dom.text(use => {
            const choice = this._choices.find((c) => String(c[0]) === use(this.value));
            return String(choice?.[1] || selectPlaceholder());
          })),
          dropdownWithSearch<string>({
            action: (value) => this.value.set(value),
            options: () => this._choices.map((choice) => ({
              label: String(choice[1]),
              value: String(choice[0]),
            })),
            onClose: () => { setTimeout(() => this._selectElement.focus()); },
            acOptions: {maxResults: 100, keepOrder: false, showEmptyItems: true},
            placeholder: 'Search',
            popupOptions: {
              trigger: [
                'click',
                (_el, ctl) => { this._ctl = ctl; },
              ],
            },
            matchTriggerElemWidth: true,
          }),
          css.resetSelectButton(
            icon('CrossSmall'),
            dom.attr('aria-label', t('Clear selection for: {{-inputLabel}}', {inputLabel: this.field.question})),
            dom.hide((use) => !use(this.value)),
            dom.on('click', (ev) => {
              this.value.set('');
              this._selectElement.focus();
              ev.stopPropagation();
              ev.preventDefault();
            }),
            testId('search-select-clear-btn')
          ),
          css.searchSelectIcon('Collapse'),
          testId('search-select'),
        ),
      )
    );
  }

  private _renderRadioInput() {
    const required = this.field.options.formRequired;
    return css.radioList(
      css.radioList.cls('-horizontal', this._alignment === 'horizontal'),
      dom.cls('grist-radio-list'),
      dom.cls('required', Boolean(required)),
      {name: this.name(), required, 'data-grist-type': this.field.type},
      dom.forEach(this._radioButtons, (radioButton) =>
        css.radio(
          dom('input',
            dom.prop('checked', radioButton.checked),
            dom.on('change', (_e, elem) => radioButton.checked.set(elem.checked)),
            {
              type: 'radio',
              name: `${this.name()}`,
              value: radioButton.value,
            },
            preventSubmitOnEnter(),
          ),
          dom('span', radioButton.label),
        )
      ),
    );
  }

  private _maybeOpenSearchSelect(ev: KeyboardEvent) {
    if (isXSmallScreenObs().get()) {
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();
    this._ctl?.open();
  }
}

class AttachmentsRenderer extends BaseFieldRenderer {
  protected inputType = 'file';
  // Note that we aren't attempting to support initial values (taken from URL) for attachments.
  // That wouldn't be expected by anyone anyway.
  private _value = Observable.create<File[]>(this, []);

  public input() {
    return css.attachmentInput(
      dom.cls('field_clip'),
      {
        type: this.inputType,
        name: this.name(),
        id: this.id(),
        required: this.field.options.formRequired,
      },
      dom.prop('value', this._value),
      dom.prop('multiple', true),
      testId('attachment-input')
    );
  }

  public resetInput(): void {
    this._value.set([]);
  }
}

const FieldRenderers = {
  'Text': TextRenderer,
  'Numeric': NumericRenderer,
  'Int': NumericRenderer,
  'Choice': ChoiceRenderer,
  'Bool': BoolRenderer,
  'ChoiceList': ChoiceListRenderer,
  'Date': DateRenderer,
  'DateTime': DateTimeRenderer,
  'Ref': RefRenderer,
  'RefList': RefListRenderer,
  'Attachments': AttachmentsRenderer,
};

const FormRenderers = {
  'Paragraph': ParagraphRenderer,
  'Section': SectionRenderer,
  'Columns': ColumnsRenderer,
  'Submit': SubmitRenderer,
  'Placeholder': PlaceholderRenderer,
  'Layout': LayoutRenderer,
  'Field': FieldRenderer,
  'Label': LabelRenderer,
  // Aliases for Paragraph.
  'Separator': ParagraphRenderer,
  'Header': ParagraphRenderer,
};

function preventSubmitOnEnter() {
  return dom.onKeyDown({Enter$: (ev) => ev.preventDefault()});
}

/**
 * Validates the required attribute of checkbox and radio lists, such as those
 * used by Choice, Choice List, Reference, and Reference List fields.
 *
 * Since lists of checkboxes and radios don't natively support a required attribute, we
 * simulate it by marking the first checkbox/radio of each required list as being a
 * required input. Then, we make another pass and unmark all required checkbox/radio
 * inputs if they belong to a list where at least one checkbox/radio is checked. If any
 * inputs in a required are left as required, HTML validations that are triggered when
 * submitting a form will catch them and prevent the submission.
 */
function validateRequiredLists() {
  for (const type of ['checkbox', 'radio']) {
    const requiredLists = document
      .querySelectorAll(`.grist-${type}-list.required:not(:has(input:checked))`);
    Array.from(requiredLists).forEach(function(list) {
      const firstOption = list.querySelector(`input[type="${type}"]`);
      firstOption?.setAttribute('required', 'required');
    });

    const requiredListsWithCheckedOption = document
      .querySelectorAll(`.grist-${type}-list.required:has(input:checked`);
    Array.from(requiredListsWithCheckedOption).forEach(function(list) {
      const firstOption = list.querySelector(`input[type="${type}"]`);
      firstOption?.removeAttribute('required');
    });
  }
}
