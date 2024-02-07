import {isHiddenCol} from 'app/common/gristTypes';
import {CellValue, GristType} from 'app/plugin/GristData';
import {MaybePromise} from 'app/plugin/gutil';
import _ from 'lodash';
import {marked} from 'marked';

/**
 * This file is a part of the Forms project. It contains a logic to render an HTML form from a JSON definition.
 * TODO: Client version has its own implementation, we should merge them but it is hard to tell currently
 * what are the similarities and differences as a Client code should also support browsing.
 */

/**
 * All allowed boxes.
 */
export type BoxType =   'Paragraph' | 'Section' | 'Columns' | 'Submit'
                      | 'Placeholder' | 'Layout' | 'Field' | 'Label'
                      | 'Separator' | 'Header'
                      ;

/**
 * Number of fields to show in the form by default.
 */
export const INITIAL_FIELDS_COUNT = 9;

export const CHOOSE_TEXT = '— Choose —';

/**
 * Box model is a JSON that represents a form element. Every element can be converted to this element and every
 * ViewModel should be able to read it and built itself from it.
 */
export interface Box {
  type: BoxType,
  children?: Array<Box>,

  // Some properties used by some boxes (like form itself)
  submitText?: string,
  successURL?: string,
  successText?: string,
  anotherResponse?: boolean,

  // Unique ID of the field, used only in UI.
  id?: string,

  // Some properties used by fields and stored in the column/field.
  formRequired?: boolean,
  // Used by Label and Paragraph.
  text?: string,
  // Used by Paragraph.
  alignment?: string,
  // Used by Field.
  leaf?: number,
}

/**
 * When a form is rendered, it is given a context that can be used to access Grist data and sanitize HTML.
 */
export interface RenderContext {
  root: Box;
  field(id: number): FieldModel;
}

export interface FieldOptions {
  formRequired?: boolean;
  choices?: string[];
}

export interface FieldModel {
  /**
   * The question to ask. Fallbacks to column's label than column's id.
   */
  question: string;
  description: string;
  colId: string;
  type: string;
  isFormula: boolean;
  options: FieldOptions;
  values(): MaybePromise<[number, CellValue][]>;
}

/**
 * The RenderBox is the main building block for the form. Each main block has its own, and is responsible for
 * rendering itself and its children.
 */
export class RenderBox {
  public static new(box: Box, ctx: RenderContext): RenderBox {
    const ctr = elements[box.type] ?? Paragraph;
    return new ctr(box, ctx);
  }

  constructor(protected box: Box, protected ctx: RenderContext) {

  }

  public async toHTML(): Promise<string> {
    const proms = (this.box.children || []).map((child) => RenderBox.new(child, this.ctx).toHTML());
    const parts = await Promise.all(proms);
    return parts.join('');
  }
}

class Label extends RenderBox {
  public override async toHTML() {
    const text = this.box.text || '';
    return `
      <div class="grist-label">${text || ''}</div>
    `;
  }
}

class Paragraph extends RenderBox {
  public override async toHTML() {
    const text = this.box['text'] || '**Lorem** _ipsum_ dolor';
    const alignment = this.box['alignment'] || 'left';
    const html = marked(text);
    return `
      <div class="grist-paragraph grist-text-${alignment}">${html}</div>
    `;
  }
}

class Section extends RenderBox {
  public override async toHTML() {
    return `
      <div class="grist-section">
        ${await super.toHTML()}
      </div>
    `;
  }
}

class Columns extends RenderBox {
  public override async toHTML() {
    const size = this.box.children?.length || 1;
    const content = await super.toHTML();
    return `
      <div class="grist-columns" style='--grist-columns-count: ${size}'>
        ${content}
      </div>
    `;
  }
}

class Submit extends RenderBox {
  public override async toHTML() {
    const text = _.escape(this.ctx.root['submitText'] || 'Submit');
    return `
      <div class='grist-submit'>
        <input type='submit' value='${text}' />
      </div>
    `;
  }
}

class Placeholder extends RenderBox {
  public override async toHTML() {
    return `
      <div>
      </div>
    `;
  }
}

class Layout extends RenderBox {
  /** Nothing, default is enough */
}

/**
 * Field is a special kind of box, as it renders a Grist field (a Question). It provides a default frame, like label and
 * description, and then renders the field itself in same way as the main Boxes where rendered.
 */
class Field extends RenderBox {

  public build(field: FieldModel, context: RenderContext) {
    const ctr = (questions as any)[field.type as any] as { new(): Question } || Text;
    return new ctr();
  }

  public async toHTML() {
    const field = this.box.leaf ? this.ctx.field(this.box.leaf) : null;
    if (!field) {
      return `<div class="grist-field">Field not found</div>`;
    }
    const renderer = this.build(field, this.ctx);
    return `
      <div class="grist-field">
        ${await renderer.toHTML(field, this.ctx)}
      </div>
    `;
  }
}

interface Question {
  toHTML(field: FieldModel, context: RenderContext): Promise<string>|string;
}

abstract class BaseQuestion implements Question {
  public async toHTML(field: FieldModel, context: RenderContext): Promise<string> {
    return `
      <div class='grist-question'>
        ${this.label(field)}
        <div class='grist-field-content'>
          ${await this.input(field, context)}
        </div>
      </div>
    `;
  }

  public name(field: FieldModel): string {
    const excludeFromFormData = (
      field.isFormula ||
      field.type === 'Attachments' ||
      isHiddenCol(field.colId)
    );
    return `${excludeFromFormData ? '_' : ''}${field.colId}`;
  }

  public label(field: FieldModel): string {
    // This might be HTML.
    const label = field.question;
    const name = this.name(field);
    const required = field.options.formRequired ? 'grist-label-required' : '';
    return `
      <label class='grist-label ${required}' for='${name}'>${label}</label>
    `;
  }

  public abstract input(field: FieldModel, context: RenderContext): string|Promise<string>;
}

class Text extends BaseQuestion {
  public input(field: FieldModel, context: RenderContext): string {
    const required = field.options.formRequired ? 'required' : '';
    return `
      <input type='text' name='${this.name(field)}' ${required}/>
    `;
  }
}

class Date extends BaseQuestion  {
  public input(field: FieldModel, context: RenderContext): string {
    const required = field.options.formRequired ? 'required' : '';
    return `
      <input type='date' name='${this.name(field)}' ${required}/>
    `;
  }
}

class DateTime extends BaseQuestion {
  public input(field: FieldModel, context: RenderContext): string {
    const required = field.options.formRequired ? 'required' : '';
    return `
      <input type='datetime-local' name='${this.name(field)}' ${required}/>
    `;
  }
}

class Choice extends BaseQuestion  {
  public input(field: FieldModel, context: RenderContext): string {
    const required = field.options.formRequired ? 'required' : '';
    const choices: Array<string|null> = field.options.choices || [];
    // Insert empty option.
    choices.unshift(null);
    return `
      <select name='${this.name(field)}' ${required} >
        ${choices.map((choice) => `<option value='${choice ?? ''}'>${choice ?? CHOOSE_TEXT}</option>`).join('')}
      </select>
    `;
  }
}

class Bool extends BaseQuestion {
  public async toHTML(field: FieldModel, context: RenderContext) {
    return `
      <div class='grist-question'>
        <div class='grist-field-content'>
        ${this.input(field, context)}
        </div>
      </div>
    `;
  }

  public input(field: FieldModel, context: RenderContext): string {
    const requiredLabel = field.options.formRequired ? 'grist-label-required' : '';
    const required = field.options.formRequired ? 'required' : '';
    const label = field.question ? field.question : field.colId;
    return `
      <label class='grist-switch ${requiredLabel}'>
        <input type='checkbox' name='${this.name(field)}' value="1" ${required}  />
        <div class="grist-widget_switch grist-switch_transition">
          <div class="grist-switch_slider"></div>
          <div class="grist-switch_circle"></div>
        </div>
        <span>${label}</span>
      </label>
    `;
  }
}

class ChoiceList extends BaseQuestion  {
  public input(field: FieldModel, context: RenderContext): string {
    const required = field.options.formRequired ? 'required' : '';
    const choices: string[] = field.options.choices || [];
    return `
      <div name='${this.name(field)}' class='grist-checkbox-list ${required}'>
        ${choices.map((choice) => `
          <label class='grist-checkbox'>
            <input type='checkbox' name='${this.name(field)}[]' value='${choice}' />
            <span>
              ${choice}
            </span>
          </label>
        `).join('')}
      </div>
    `;
  }
}

class RefList extends BaseQuestion {
  public async input(field: FieldModel, context: RenderContext) {
    const required = field.options.formRequired ? 'required' : '';
    const choices: [number, CellValue][] = (await field.values()) ?? [];
    // Sort by the second value, which is the display value.
    choices.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    // Support for 30 choices, TODO: make it dynamic.
    choices.splice(30);
    return `
      <div name='${this.name(field)}' class='grist-checkbox-list ${required}'>
        ${choices.map((choice) => `
          <label class='grist-checkbox'>
            <input type='checkbox'
                   data-grist-type='${field.type}'
                   name='${this.name(field)}[]'
                   value='${String(choice[0])}' />
            <span>
              ${String(choice[1] ?? '')}
            </span>
          </label>
        `).join('')}
      </div>
    `;
  }
}

class Ref extends BaseQuestion {
  public async input(field: FieldModel) {
    const choices: [number|string, CellValue][] = (await field.values()) ?? [];
    // Sort by the second value, which is the display value.
    choices.sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    // Support for 1000 choices, TODO: make it dynamic.
    choices.splice(1000);
    // Insert empty option.
    choices.unshift(['', CHOOSE_TEXT]);
    // <option type='number' is not standard, we parse it ourselves.
    const required = field.options.formRequired ? 'required' : '';
    return `
      <select name='${this.name(field)}' class='grist-ref' data-grist-type='${field.type}' ${required}>
        ${choices.map((choice) => `<option value='${String(choice[0])}'>${String(choice[1] ?? '')}</option>`).join('')}
      </select>
    `;
  }
}

/**
 * List of all available questions we will render of the form.
 * TODO: add other renderers.
 */
const questions: Partial<Record<GristType, new () => Question>> = {
  'Text': Text,
  'Choice': Choice,
  'Bool': Bool,
  'ChoiceList': ChoiceList,
  'Date': Date,
  'DateTime': DateTime,
  'Ref': Ref,
  'RefList': RefList,
};

/**
 * List of all available boxes we will render of the form.
 */
const elements = {
  'Paragraph': Paragraph,
  'Section': Section,
  'Columns': Columns,
  'Submit': Submit,
  'Placeholder': Placeholder,
  'Layout': Layout,
  'Field': Field,
  'Label': Label,

  // Those are just aliases for Paragraph.
  'Separator': Paragraph,
  'Header': Paragraph,
};
