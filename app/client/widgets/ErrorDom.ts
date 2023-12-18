import {DataRowModel} from 'app/client/models/DataRowModel';

import {ViewFieldRec} from 'app/client/models/entities/ViewFieldRec';
import {getObjCode} from 'app/common/gristTypes';
import {formatUnknown} from 'app/common/ValueFormatter';
import {dom} from 'grainjs';

export function buildErrorDom(row: DataRowModel, field: ViewFieldRec) {
  const value = row.cells[field.colId.peek()];
  if (value === undefined) { return null; }   // Work around JS errors during field removal.
  const options = field.widgetOptionsJson;
  // The "invalid" class sets the pink background, as long as the error text is non-empty.
  return dom('div.field_clip.invalid',
    // Sets CSS class field-error-P, field-error-U, etc.
    dom.clsPrefix('field-error-', (use) => getObjCode(use(value)) || ''),
    dom.style('text-align', options.prop('alignment')),
    dom.cls('text_wrapping', (use) => Boolean(use(options.prop('wrap')))),
    dom.text((use) => formatUnknown(value ? use(value) : '???'))
  );
}
