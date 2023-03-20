import {NumberFormatOptions} from 'app/common/NumberFormat';

export interface WidgetOptions extends NumberFormatOptions {
  textColor?: 'string';
  fillColor?: 'string';
  alignment?: 'left' | 'center' | 'right';
  dateFormat?: string;
  timeFormat?: string;
  widget?: 'HyperLink';
  choices?: Array<string>;
}