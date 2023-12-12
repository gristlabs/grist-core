import {GristType} from 'app/plugin/GristData';
import {marked} from 'marked';

/**
 * All allowed boxes.
 */
export type BoxType = 'Paragraph' | 'Section' | 'Columns' | 'Submit' | 'Placeholder' | 'Layout' | 'Field';

/**
 * Box model is a JSON that represents a form element. Every element can be converted to this element and every
 * ViewModel should be able to read it and built itself from it.
 */
export interface Box extends Record<string, any> {
  type: BoxType,
  children?: Array<Box>,
}

/**
 * When a form is rendered, it is given a context that can be used to access Grist data and sanitize HTML.
 */
export interface RenderContext {
  field(id: number): FieldModel;
}

export interface FieldModel {
  question: string;
  description: string;
  colId: string;
  type: string;
  options: Record<string, any>;
}

/**
 * The RenderBox is the main building block for the form. Each main block has its own, and is responsible for
 * rendering itself and its children.
 */
export class RenderBox {
  public static new(box: Box, ctx: RenderContext): RenderBox {
    console.assert(box, `Box is not defined`);
    const ctr = elements[box.type];
    console.assert(ctr, `Box ${box.type} is not defined`);
    return new ctr(box, ctx);
  }

  constructor(protected box: Box, protected ctx: RenderContext) {

  }

  public toHTML(): string {
    return (this.box.children || []).map((child) => RenderBox.new(child, this.ctx).toHTML()).join('');
  }
}

class Paragraph extends RenderBox {
  public override toHTML(): string {
    const text = this.box['text'] || '**Lorem** _ipsum_ dolor';
    const html = marked(text);
    return `
      <div class="grist-paragraph">${html}</div>
    `;
  }
}

class Section extends RenderBox {
  /** Nothing, default is enough */
}

class Columns extends RenderBox {
  public override toHTML(): string {
    const kids = this.box.children || [];
    return `
      <div class="grist-columns" style='--grist-columns-count: ${kids.length}'>
        ${kids.map((child) => child.toHTML()).join('\n')}
      </div>
    `;
  }
}

class Submit extends RenderBox {
  public override toHTML() {
    return `
      <div>
        <input type='submit' value='Submit' />
      </div>
    `;
  }
}

class Placeholder extends RenderBox {
  public override toHTML() {
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

  public static render(field: FieldModel, context: RenderContext): string {
    const ctr = (questions as any)[field.type as any] as { new(): Question } || Text;
    return new ctr().toHTML(field, context);
  }

  public toHTML(): string {
    const field = this.ctx.field(this.box['leaf']);
    if (!field) {
      return `<div class="grist-field">Field not found</div>`;
    }
    const label = field.question ? field.question : field.colId;
    const name = field.colId;
    let description = field.description || '';
    if (description) {
      description = `<div class='grist-field-description'>${description}</div>`;
    }
    const html = `<div class='grist-field-content'>${Field.render(field, this.ctx)}</div>`;
    return `
      <div class="grist-field">
        <label for='${name}'>${label}</label>
        ${html}
        ${description}
      </div>
    `;
  }
}

interface Question {
  toHTML(field: FieldModel, context: RenderContext): string;
}


class Text implements Question {
  public toHTML(field: FieldModel, context: RenderContext): string {
    return `
      <input type='text' name='${field.colId}' />
    `;
  }
}

class Date implements Question {
  public toHTML(field: FieldModel, context: RenderContext): string {
    return `
      <input type='date' name='${field.colId}' />
    `;
  }
}

class DateTime implements Question {
  public toHTML(field: FieldModel, context: RenderContext): string {
    return `
      <input type='datetime-local' name='${field.colId}' />
    `;
  }
}

class Choice implements Question {
  public toHTML(field: FieldModel, context: RenderContext): string {
    const choices: string[] = field.options.choices || [];
    return `
      <select name='${field.colId}'>
        ${choices.map((choice) => `<option value='${choice}'>${choice}</option>`).join('')}
      </select>
    `;
  }
}

class Bool implements Question {
  public toHTML(field: FieldModel, context: RenderContext): string {
    return `
      <label>
        <input type='checkbox' name='${field.colId}' value="1" />
        Yes
      </label>
    `;
  }
}

class ChoiceList implements Question {
  public toHTML(field: FieldModel, context: RenderContext): string {
    const choices: string[] = field.options.choices || [];
    return `
      <div name='${field.colId}' class='grist-choice-list'>
        ${choices.map((choice) => `
          <label>
            <input type='checkbox' name='${field.colId}[]' value='${choice}' />
            ${choice}
          </label>
        `).join('')}
      </div>
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
};
