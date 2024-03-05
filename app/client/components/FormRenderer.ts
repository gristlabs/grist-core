import * as css from 'app/client/components/FormRendererCss';
import {FormField} from 'app/client/ui/FormAPI';
import {sanitizeHTML} from 'app/client/ui/sanitizeHTML';
import {CellValue} from 'app/plugin/GristData';
import {Disposable, dom, DomContents, Observable} from 'grainjs';
import {marked} from 'marked';

export const CHOOSE_TEXT = '— Choose —';

/**
 * A node in a recursive, tree-like hierarchy comprising the layout of a form.
 */
export interface FormLayoutNode {
  type: FormLayoutNodeType;
  children?: Array<FormLayoutNode>;
  // Unique ID of the field. Used only in the Form widget.
  id?: string;
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
  public static new(layoutNode: FormLayoutNode, context: FormRendererContext): FormRenderer {
    const Renderer = FormRenderers[layoutNode.type] ?? ParagraphRenderer;
    return new Renderer(layoutNode, context);
  }

  protected children: FormRenderer[];

  constructor(protected layoutNode: FormLayoutNode, protected context: FormRendererContext) {
    super();
    this.children = (this.layoutNode.children ?? []).map((child) =>
      this.autoDispose(FormRenderer.new(child, this.context)));
  }

  public abstract render(): DomContents;
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
      css.submit(
        dom('input',
          dom.boolAttr('disabled', this.context.disabled),
          {
            type: 'submit',
            value: this.context.rootLayoutNode.submitText || 'Submit'
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
  public build(field: FormField) {
    const Renderer = FieldRenderers[field.type as keyof typeof FieldRenderers] ?? TextRenderer;
    return new Renderer();
  }

  public render() {
    const field = this.layoutNode.leaf ? this.context.fields[this.layoutNode.leaf] : null;
    if (!field) { return null; }

    const renderer = this.build(field);
    return css.field(renderer.render(field, this.context));
  }
}

abstract class BaseFieldRenderer {
  public render(field: FormField, context: FormRendererContext) {
    return css.field(
      this.label(field),
      dom('div', this.input(field, context)),
    );
  }

  public name(field: FormField) {
    return field.colId;
  }

  public label(field: FormField) {
    return dom('label',
      css.label.cls(''),
      css.label.cls('-required', Boolean(field.options.formRequired)),
      {for: this.name(field)},
      field.question,
    );
  }

  public abstract input(field: FormField, context: FormRendererContext): DomContents;
}

class TextRenderer extends BaseFieldRenderer {
  public input(field: FormField) {
    return dom('input', {
      type: 'text',
      name: this.name(field),
      required: field.options.formRequired,
    });
  }
}

class DateRenderer extends BaseFieldRenderer  {
  public input(field: FormField) {
    return dom('input', {
      type: 'date',
      name: this.name(field),
      required: field.options.formRequired,
    });
  }
}

class DateTimeRenderer extends BaseFieldRenderer {
  public input(field: FormField) {
    return dom('input', {
      type: 'datetime-local',
      name: this.name(field),
      required: field.options.formRequired,
    });
  }
}

class ChoiceRenderer extends BaseFieldRenderer  {
  public input(field: FormField) {
    const choices: Array<string|null> = field.options.choices || [];
    // Insert empty option.
    choices.unshift(null);
    return css.select(
      {name: this.name(field), required: field.options.formRequired},
      choices.map((choice) => dom('option', {value: choice ?? ''}, choice ?? CHOOSE_TEXT))
    );
  }
}

class BoolRenderer extends BaseFieldRenderer {
  public render(field: FormField) {
    return css.field(
      dom('div', this.input(field)),
    );
  }

  public input(field: FormField) {
    return css.toggle(
      css.label.cls('-required', Boolean(field.options.formRequired)),
      dom('input', {
        type: 'checkbox',
        name: this.name(field),
        value: '1',
        required: field.options.formRequired,
      }),
      css.gristSwitch(
        css.gristSwitchSlider(),
        css.gristSwitchCircle(),
      ),
      dom('span', field.question || field.colId)
    );
  }
}

class ChoiceListRenderer extends BaseFieldRenderer  {
  public input(field: FormField) {
    const choices: string[] = field.options.choices ?? [];
    const required = field.options.formRequired;
    return css.checkboxList(
      dom.cls('grist-checkbox-list'),
      dom.cls('required', Boolean(required)),
      {name: this.name(field), required},
      choices.map(choice => css.checkbox(
        dom('input', {
          type: 'checkbox',
          name: `${this.name(field)}[]`,
          value: choice,
        }),
        dom('span', choice),
      )),
    );
  }
}

class RefListRenderer extends BaseFieldRenderer {
  public input(field: FormField) {
    const choices: [number, CellValue][] = field.refValues ?? [];
    // Sort by the second value, which is the display value.
    choices.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    // Support for 30 choices. TODO: make limit dynamic.
    choices.splice(30);
    const required = field.options.formRequired;
    return css.checkboxList(
      dom.cls('grist-checkbox-list'),
      dom.cls('required', Boolean(required)),
      {name: this.name(field), required},
      choices.map(choice => css.checkbox(
        dom('input', {
          type: 'checkbox',
          'data-grist-type': field.type,
          name: `${this.name(field)}[]`,
          value: String(choice[0]),
        }),
        dom('span', String(choice[1] ?? '')),
      )),
    );
  }
}

class RefRenderer extends BaseFieldRenderer {
  public input(field: FormField) {
    const choices: [number|string, CellValue][] = field.refValues ?? [];
    // Sort by the second value, which is the display value.
    choices.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    // Support for 1000 choices. TODO: make limit dynamic.
    choices.splice(1000);
    // Insert empty option.
    choices.unshift(['', CHOOSE_TEXT]);
    return css.select(
      {
        name: this.name(field),
        'data-grist-type': field.type,
        required: field.options.formRequired,
      },
      choices.map((choice) => dom('option', {value: String(choice[0])}, String(choice[1] ?? ''))),
    );
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
