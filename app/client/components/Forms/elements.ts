import {Columns, Placeholder} from 'app/client/components/Forms/Columns';
import {Box, BoxType} from 'app/client/components/Forms/Model';
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

export function defaultElement(type: BoxType): Box {
  switch(type) {
    case 'Columns': return Columns();
    case 'Placeholder': return Placeholder();
    default: return {type};
  }
}
