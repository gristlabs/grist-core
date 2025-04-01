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
  label: 'Delimiter',
  type: 'string',
  visible: true,
}, {
  name: 'lineterminator',
  label: 'Line terminator',
  type: 'string',
  visible: true,
}, {
  name: 'doublequote',
  label: 'Doublequote',
  type: 'boolean',
  visible: true,
}, {
  name: 'quoting',
  label: 'Quoting',
  type: 'number',
  visible: true,
}, {
  name: 'include_col_names_as_headers',
  label: 'Include column names as headers',
  type: 'boolean',
  visible: true,
}, {
  name: 'excludes',
  label: 'Exclude columns (comma-separated list of column numbers)',
  type: 'string',
  visible: true
}, {
  name: 'unused',
  label: 'SHOULD NOT SEE THIS',
  type: 'number',
  visible: false,
}];
