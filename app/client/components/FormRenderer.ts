import * as css from 'app/client/components/FormRendererCss';
import {FormField} from 'app/client/ui/FormAPI';
import {sanitizeHTML} from 'app/client/ui/sanitizeHTML';
import {dropdownWithSearch} from 'app/client/ui/searchDropdown';
import {isXSmallScreenObs} from 'app/client/ui2018/cssVars';
import {confirmModal} from 'app/client/ui2018/modals';
import {CellValue} from 'app/plugin/GristData';
import {Disposable, dom, DomContents, makeTestId, MutableObsArray, obsArray, Observable} from 'grainjs';
import {marked} from 'marked';
import {IPopupOptions, PopupControl} from 'popweasel';

const testId = makeTestId('test-form-');

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
 * in `fieldIds` removed.
 */
export function patchLayoutSpec(
  layoutSpec: FormLayoutNode,
  fieldIds: Set<number>
): FormLayoutNode | null {
  if (layoutSpec.leaf && !fieldIds.has(layoutSpec.leaf)) { return null; }

  return {
    ...layoutSpec,
    children: layoutSpec.children
      ?.map(child => patchLayoutSpec(child, fieldIds))
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
      el => {
        el.innerHTML = sanitizeHTML(marked(this.layoutNode.text || '**Lorem** _ipsum_ dolor'));
      },
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
      {style: `--grist-columns-count: ${this.children.length || 1}`},
      this.children.map((child) => child.render()),
    );
  }
}

class SubmitRenderer extends FormRenderer {
  public render() {
    return [
      css.error(dom.text(use => use(this.context.error) ?? '')),
      css.submitButtons(
        css.resetButton(
          'Reset',
          dom.boolAttr('disabled', this.context.disabled),
          {type: 'button'},
          dom.on('click', () => {
            return confirmModal(
              'Are you sure you want to reset your form?',
              'Reset',
              () => this.parent?.reset()
            );
          }),
          testId('reset'),
        ),
        css.submitButton(
          dom('input',
            dom.boolAttr('disabled', this.context.disabled),
            {
              type: 'submit',
              value: this.context.rootLayoutNode.submitText || 'Submit',
            },
            dom.on('click', () => {
              // Make sure that all choice or reference lists that are required have at least one option selected.
              const lists = document.querySelectorAll('.grist-checkbox-list.required:not(:has(input:checked))');
              Array.from(lists).forEach(function(list) {
                // If the form has at least one checkbox, make it required.
                const firstCheckbox = list.querySelector('input[type="checkbox"]');
                firstCheckbox?.setAttribute('required', 'required');
              });

              // All other required choice or reference lists with at least one option selected are no longer required.
              const checkedLists = document.querySelectorAll('.grist-checkbox-list.required:has(input:checked)');
              Array.from(checkedLists).forEach(function(list) {
                const firstCheckbox = list.querySelector('input[type="checkbox"]');
                firstCheckbox?.removeAttribute('required');
              });
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
    return css.field(this.renderer.render());
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
      this.label(),
      dom('div', this.input()),
    );
  }

  public name() {
    return this.field.colId;
  }

  public label() {
    return dom('label',
      css.label.cls(''),
      css.label.cls('-required', Boolean(this.field.options.formRequired)),
      {for: this.name()},
      this.field.question,
    );
  }

  public abstract input(): DomContents;

  public abstract resetInput(): void;
}

class TextRenderer extends BaseFieldRenderer {
  protected type = 'text';
  private _value = Observable.create(this, '');

  public input() {
    return dom('input',
      {
        type: this.type,
        name: this.name(),
        required: this.field.options.formRequired,
      },
      dom.prop('value', this._value),
      dom.on('input', (_e, elem) => this._value.set(elem.value)),
    );
  }

  public resetInput(): void {
    this._value.set('');
  }
}

class DateRenderer extends TextRenderer {
  protected type = 'date';
}

class DateTimeRenderer extends TextRenderer {
  protected type = 'datetime-local';
}

export const SELECT_PLACEHOLDER = 'Select...';

class ChoiceRenderer extends BaseFieldRenderer  {
  protected value = Observable.create<string>(this, '');
  private _choices: string[];
  private _selectElement: HTMLElement;
  private _ctl?: PopupControl<IPopupOptions>;

  public constructor(field: FormField, context: FormRendererContext) {
    super(field, context);

    const choices = this.field.options.choices;
    if (!Array.isArray(choices) || choices.some((choice) => typeof choice !== 'string')) {
      this._choices = [];
    } else {
      // Support for 1000 choices. TODO: make limit dynamic.
      this._choices = choices.slice(0, 1000);
    }
  }

  public input() {
    return css.hybridSelect(
      this._selectElement = css.select(
        {name: this.name(), required: this.field.options.formRequired},
        dom.prop('value', this.value),
        dom.on('input', (_e, elem) => this.value.set(elem.value)),
        dom('option', {value: ''}, SELECT_PLACEHOLDER),
        this._choices.map((choice) => dom('option', {value: choice}, choice)),
        dom.onKeyDown({
          ' $': (ev) => this._maybeOpenSearchSelect(ev),
          ArrowUp$: (ev) => this._maybeOpenSearchSelect(ev),
          ArrowDown$: (ev) => this._maybeOpenSearchSelect(ev),
        }),
      ),
      dom.maybe(use => !use(isXSmallScreenObs()), () =>
        css.searchSelect(
          dom('div', dom.text(use => use(this.value) || SELECT_PLACEHOLDER)),
          dropdownWithSearch<string>({
            action: (value) => this.value.set(value),
            options: () => [
              {label: SELECT_PLACEHOLDER, value: '', placeholder: true},
              ...this._choices.map((choice) => ({
                label: choice,
                value: choice,
              }),
            )],
            onClose: () => { setTimeout(() => this._selectElement.focus()); },
            placeholder: 'Search',
            acOptions: {maxResults: 1000, keepOrder: true, showEmptyItems: true},
            popupOptions: {
              trigger: [
                'click',
                (_el, ctl) => { this._ctl = ctl; },
              ],
            },
            matchTriggerElemWidth: true,
          }),
          css.searchSelectIcon('Collapse'),
          testId('search-select'),
        ),
      ),
    );
  }

  public resetInput(): void {
    this.value.set('');
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
  protected checked = Observable.create<boolean>(this, false);

  public render() {
    return css.field(
      dom('div', this.input()),
    );
  }

  public input() {
    return css.toggle(
      dom('input',
        dom.prop('checked', this.checked),
        dom.on('change', (_e, elem) => this.checked.set(elem.checked)),
        {
          type: 'checkbox',
          name: this.name(),
          value: '1',
          required: this.field.options.formRequired,
        },
      ),
      css.gristSwitch(
        css.gristSwitchSlider(),
        css.gristSwitchCircle(),
      ),
      css.toggleLabel(
        css.label.cls('-required', Boolean(this.field.options.formRequired)),
        this.field.question,
      ),
    );
  }

  public resetInput(): void {
    this.checked.set(false);
  }
}

class ChoiceListRenderer extends BaseFieldRenderer  {
  protected checkboxes: MutableObsArray<{
    label: string;
    checked: Observable<string|null>
  }> = this.autoDispose(obsArray());

  public constructor(field: FormField, context: FormRendererContext) {
    super(field, context);

    let choices = this.field.options.choices;
    if (!Array.isArray(choices) || choices.some((choice) => typeof choice !== 'string')) {
      choices = [];
    } else {
      // Support for 30 choices. TODO: make limit dynamic.
      choices = choices.slice(0, 30);
    }

    this.checkboxes.set(choices.map(choice => ({
      label: choice,
      checked: Observable.create(this, null),
    })));
  }

  public input() {
    const required = this.field.options.formRequired;
    return css.checkboxList(
      dom.cls('grist-checkbox-list'),
      dom.cls('required', Boolean(required)),
      {name: this.name(), required},
      dom.forEach(this.checkboxes, (checkbox) =>
        css.checkbox(
          dom('input',
            dom.prop('checked', checkbox.checked),
            dom.on('change', (_e, elem) => checkbox.checked.set(elem.value)),
            {
              type: 'checkbox',
              name: `${this.name()}[]`,
              value: checkbox.label,
            }
          ),
          dom('span', checkbox.label),
        )
      ),
    );
  }

  public resetInput(): void {
    this.checkboxes.get().forEach(checkbox => {
      checkbox.checked.set(null);
    });
  }
}

class RefListRenderer extends BaseFieldRenderer {
  protected checkboxes: MutableObsArray<{
    label: string;
    value: string;
    checked: Observable<string|null>
  }> = this.autoDispose(obsArray());

  public constructor(field: FormField, context: FormRendererContext) {
    super(field, context);

    const references = this.field.refValues ?? [];
    // Sort by the second value, which is the display value.
    references.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    // Support for 30 choices. TODO: make limit dynamic.
    references.splice(30);
    this.checkboxes.set(references.map(reference => ({
      label: String(reference[1]),
      value: String(reference[0]),
      checked: Observable.create(this, null),
    })));
  }
  public input() {
    const required = this.field.options.formRequired;
    return css.checkboxList(
      dom.cls('grist-checkbox-list'),
      dom.cls('required', Boolean(required)),
      {name: this.name(), required},
      dom.forEach(this.checkboxes, (checkbox) =>
        css.checkbox(
          dom('input',
            dom.prop('checked', checkbox.checked),
            dom.on('change', (_e, elem) => checkbox.checked.set(elem.value)),
            {
              type: 'checkbox',
              'data-grist-type': this.field.type,
              name: `${this.name()}[]`,
              value: checkbox.value,
            }
          ),
          dom('span', checkbox.label),
        )
      ),
    );
  }

  public resetInput(): void {
    this.checkboxes.get().forEach(checkbox => {
      checkbox.checked.set(null);
    });
  }
}

class RefRenderer extends BaseFieldRenderer {
  protected value = Observable.create(this, '');
  private _selectElement: HTMLElement;
  private _ctl?: PopupControl<IPopupOptions>;

  public input() {
    const choices: [number|string, CellValue][] = this.field.refValues ?? [];
    // Sort by the second value, which is the display value.
    choices.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    // Support for 1000 choices. TODO: make limit dynamic.
    choices.splice(1000);
    return css.hybridSelect(
      this._selectElement = css.select(
        {
          name: this.name(),
          'data-grist-type': this.field.type,
          required: this.field.options.formRequired,
        },
        dom.prop('value', this.value),
        dom.on('input', (_e, elem) => this.value.set(elem.value)),
        dom('option', {value: ''}, SELECT_PLACEHOLDER),
        choices.map((choice) => dom('option', {value: String(choice[0])}, String(choice[1]))),
        dom.onKeyDown({
          ' $': (ev) => this._maybeOpenSearchSelect(ev),
          ArrowUp$: (ev) => this._maybeOpenSearchSelect(ev),
          ArrowDown$: (ev) => this._maybeOpenSearchSelect(ev),
        }),
      ),
      dom.maybe(use => !use(isXSmallScreenObs()), () =>
        css.searchSelect(
          dom('div', dom.text(use => {
            const choice = choices.find((c) => String(c[0]) === use(this.value));
            return String(choice?.[1] || SELECT_PLACEHOLDER);
          })),
          dropdownWithSearch<string>({
            action: (value) => this.value.set(value),
            options: () => [
              {label: SELECT_PLACEHOLDER, value: '', placeholder: true},
              ...choices.map((choice) => ({
                label: String(choice[1]),
                value: String(choice[0]),
              }),
            )],
            onClose: () => { setTimeout(() => this._selectElement.focus()); },
            acOptions: {maxResults: 1000, keepOrder: true, showEmptyItems: true},
            placeholder: 'Search',
            popupOptions: {
              trigger: [
                'click',
                (_el, ctl) => { this._ctl = ctl; },
              ],
            },
            matchTriggerElemWidth: true,
          }),
          css.searchSelectIcon('Collapse'),
          testId('search-select'),
        ),
      )
    );
  }

  public resetInput(): void {
    this.value.set('');
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

const FieldRenderers = {
  'Text': TextRenderer,
  'Choice': ChoiceRenderer,
  'Bool': BoolRenderer,
  'ChoiceList': ChoiceListRenderer,
  'Date': DateRenderer,
  'DateTime': DateTimeRenderer,
  'Ref': RefRenderer,
  'RefList': RefListRenderer,
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
