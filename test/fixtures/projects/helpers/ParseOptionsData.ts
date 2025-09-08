/**
 * Includes a fake schema and values for ParseOptions, to Importer fixture.
 */
import {ParseOptionValues} from 'app/client/components/ParseOptions';
import {ParseOptionSchema} from 'app/plugin/FileParserAPI';

export const initValues: ParseOptionValues = {
  delimiter: ",",
  lineterminator: "\n",
  doublequote: true,
  quoting: 1,
  include_col_names_as_headers: true,
  excludes: "11,12,13",
  unused: "UNXPECTED",
};

export const initSchema: ParseOptionSchema[] = [{
  name: 'delimiter',
  type: 'string',
  visible: true,
}, {
  name: 'lineterminator',
  type: 'string',
  visible: true,
}, {
  name: 'doublequote',
  type: 'boolean',
  visible: true,
}, {
  name: 'quoting',
  type: 'number',
  visible: true,
}, {
  name: 'include_col_names_as_headers',
  type: 'boolean',
  visible: true,
}, {
  name: 'excludes',
  type: 'string',
  visible: true
}, {
  name: 'unused',
  type: 'number',
  visible: false,
}];
