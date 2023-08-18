import {bigBasicButton, bigPrimaryButton} from 'app/client/ui2018/buttons';
import {squareCheckbox} from 'app/client/ui2018/checkbox';
import {testId, theme} from 'app/client/ui2018/cssVars';
import {makeLinks} from 'app/client/ui2018/links';
import {cssModalButtons} from 'app/client/ui2018/modals';
import {ParseOptionSchema} from 'app/plugin/FileParserAPI';
import {Computed, dom, DomContents, IDisposableOwner, input, Observable, styled} from 'grainjs';
import fromPairs = require('lodash/fromPairs');
import invert = require('lodash/invert');

export type ParseOptionValueType = boolean|string|number;

export interface ParseOptionValues {
  [name: string]: ParseOptionValueType;
}

/**
 * EscapeChars contains mapping for some escape characters that we need to convert
 * for displaying in input fields
 */
interface EscapeChars {
  [char: string]: string;
}

const escapeCharDict: EscapeChars = {
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};
const invertedEscapeCharDict: EscapeChars = invert(escapeCharDict);

// Helpers to escape and unescape certain non-printable characters that are useful in parsing
// options, e.g. as separators.
function escapeChars(value: string) {
  return value.replace(/[\n\r\t]/g, (match) => escapeCharDict[match]);
}
function unescapeChars(value: string) {
  return value.replace(/\\[nrt]/g, (match) => invertedEscapeCharDict[match]);
}

/**
 * Builds a DOM form consisting of inputs built according to schema, with the passed-in values.
 * The included "Update" button is enabled if any value has changed, and calls doUpdate() with the
 * current values.
 */
export function buildParseOptionsForm(
  owner: IDisposableOwner,
  schema: ParseOptionSchema[],
  values: ParseOptionValues,
  doUpdate: (v: ParseOptionValues) => void,
  doCancel: () => void,
): DomContents {
  const items = schema.filter(item => item.visible);
  const optionsMap = new Map<string, Observable<ParseOptionValueType>>(
    items.map((item) => [item.name, Observable.create(owner, values[item.name])]));

  function collectParseOptions(): ParseOptionValues {
    return fromPairs(items.map((item) => [item.name, optionsMap.get(item.name)!.get()]));
  }

  return [
    cssParseOptionForm(
      items.map((item) => cssParseOption(
        cssParseOptionName(makeLinks(item.label)),
        optionToInput(owner, item.type, optionsMap.get(item.name)!),
        testId('parseopts-opt'),
      )),
    ),
    cssModalButtons(
      dom.domComputed((use) => items.every((item) => use(optionsMap.get(item.name)!) === values[item.name]),
        (unchanged) => (unchanged ?
          bigBasicButton('Close', dom.on('click', doCancel), testId('parseopts-back')) :
          bigPrimaryButton('Update preview', dom.on('click', () => doUpdate(collectParseOptions())),
            testId('parseopts-update'))
        )
      )
    ),
  ];
}

function optionToInput(owner: IDisposableOwner, type: string, value: Observable<ParseOptionValueType>): HTMLElement {
  switch (type) {
    case 'boolean': return squareCheckbox(value as Observable<boolean>);
    default: {
      const obs = Computed.create(owner, (use) => escapeChars(String(use(value) || "")))
        .onWrite((val) => value.set(unescapeChars(val)));
      return cssInputText(obs, {onInput: true},
        dom.on('focus', (ev, elem) => elem.select()));
    }
  }
}

const cssParseOptionForm = styled('div', `
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  padding: 16px 0;
  width: 400px;
  overflow-y: auto;
`);
const cssParseOption = styled('div', `
  flex: none;
  margin: 8px 0;
  width: calc(50% - 16px);
  font-weight: initial;   /* negate bootstrap */
`);
const cssParseOptionName = styled('div', `
  margin-bottom: 8px;
`);
const cssInputText = styled(input, `
  color: ${theme.inputFg};
  background-color: ${theme.inputBg};
  position: relative;
  display: inline-block;
  outline: none;
  height: 28px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  padding: 0 6px;
  width: 100%;

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);
