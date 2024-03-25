import {FormLayoutNode, FormLayoutNodeType} from 'app/client/components/FormRenderer';
import {Columns, Placeholder} from 'app/client/components/Forms/Columns';
import {Paragraph} from 'app/client/components/Forms/Paragraph';
import {Section} from 'app/client/components/Forms/Section';
import {v4 as uuidv4} from 'uuid';
/**
 * Add any other element you whish to use in the form here.
 * FormView will look for any exported BoxModel derived class in format `type` + `Model`, and use It
 * to render and manage the element.
 */
export * from "./Paragraph";
export * from "./Section";
export * from './Field';
export * from './Columns';
export * from './Submit';
export * from './Label';

export function defaultElement(type: FormLayoutNodeType): FormLayoutNode {
  switch(type) {
    case 'Columns': return Columns();
    case 'Placeholder': return Placeholder();
    case 'Separator': return Paragraph('---');
    case 'Header': return Paragraph('## **Header**', 'center');
    case 'Section': return Section();
    default: return {id: uuidv4(), type};
  }
}
