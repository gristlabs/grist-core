import { ACIndexImpl, ACItem } from 'app/client/lib/ACIndex';
import { buildHighlightedDom } from 'app/client/lib/ACIndex';
import { IAutocompleteOptions } from 'app/client/lib/autocomplete';
import { IToken, TokenField } from 'app/client/lib/TokenField';
import { colors, cssRootVars, testId } from 'app/client/ui2018/cssVars';
import { menuCssClass } from 'app/client/ui2018/menus';
import { dom, styled } from 'grainjs';
import { withLocale } from 'test/fixtures/projects/helpers/withLocale';

/**
 * Tokenfield wishes ("+" means our implementation supports it).
 *
 * + Click on option to select
 * + Click on "x" to delete
 * + Shift+Click to extend selection (see how exactly others do it)
 * + Ctrl+Click to add to selection
 * + Cmd+A = select all options
 * + If no selection, backspace deletes last item. (What about delete?)
 * + Delete/Backspace delete selection
 * + Navigate selected token using arrow keys
 * + Shift+Up/Down | Shift+Left/Right (depending on orientation) to extend selection
 * + Cmd+C copies selection to clipboard, as comma-separated text, and a JSON blob with extra info
 * + Cmd+V pastes options from clipboard
 * + Cmd+X copies and deletes
 * + With textinput focused, copy+pasting should work fine.
 * + Copy-paste text format should CSV-encode when copying, CSV-decode when pasting.
 * - On pasting, should recognize and decode JSON.
 * + Horizontal: allow dragging. If selection, drag whole selection.
 * - Vertical: allow dragging.
 * + Support undo/redo for input + tokens (on best-effort basis, e.g. as gmail does).
 */

// LESSONS LEARNED FROM VARIOUS APPROACHES.
//
// (1) Relying on ContentEditable for editing. This browser feature is poor and underspecified.
// Deleting text leaves empty nodes, and sometimes extends them (deletes closing tag or opening),
// sometimes inserts <br>, etc. That's just in one browser. Expecting any consistent behavior
// across browsers is unrealistic.

// (2) Supporting undo/redo by tying it to its implementation in a text input, e.g. interpreting
// ranges of text (like "[key]") or individual characters as representing tokens. This doesn't
// work: changing the input's value programmatically breaks undo/redo (at least on FF). Changing
// the input's value using execCommand preserves undo/redo, but only works on FF for
// contentEditable which is deprecated and unreliable.
//
// (3) Gmail handles undo/redo, but without using browser's stack. Seems to just listen to
// keyboard events. That's what we do too.

class Item implements ACItem, IToken {
  public cleanText: string;

  constructor(
    public label: string,
    public numId: number,
  ) {
    this.cleanText = label.toLowerCase().trim();
  }

  public value(): string {
    return `${this.label}=${this.numId}`;
  }
}

function setupTest() {
  const items: Item[] = [
    new Item('Cat', 10),
    new Item('Dog', 20),
    new Item('Parakeet', 30),
    new Item('Frog', 40),
    new Item('Golden Monkey', 50),
  ];
  const acIndex = new ACIndexImpl<Item>(items);
  const acOptions: IAutocompleteOptions<Item> = {
    menuCssClass: menuCssClass + ' test-autocomplete',
    search: async (term: string) => acIndex.search(term),
    renderItem: (item: Item, highlightFunc) =>
      cssItem(buildHighlightedDom(item.label, highlightFunc, cssMatchText)),
    getItemText: (item: Item) => item.label,
  };

  const initialValue: Item[] = [items[0], items[3]];    // Cat, Frog
  const createToken = (label: string) => new Item(label, 0);
  const create2 = (label: string) => {
    const res = acIndex.search(label);
    return res.selectIndex >= 0 ? res.items[res.selectIndex] : undefined;
  };

  const renderToken = (item: IToken) => item.label;
  const tokenFieldPlain = TokenField.create(null, {initialValue, createToken, renderToken});
  const tokenFieldAC = TokenField.create(null, {initialValue, createToken: create2, acOptions, renderToken});

  return cssTestBox(
    cssExample(
      'TokenField with plain input',
      elem => tokenFieldPlain.attach(elem),
      cssValue(
        dom.text((use) => JSON.stringify(
          (use(tokenFieldPlain.tokensObs) as Item[])
          .map((t: Item) => t.value())
        )),
        testId('json-value'),
      ),
      testId('tokenfield-plain'),
    ),
    cssExample(
      'TokenField with autocomplete',
      elem => tokenFieldAC.attach(elem),
      cssValue(
        dom.text((use) => JSON.stringify(
          (use(tokenFieldAC.tokensObs) as Item[])
          .map((t: Item) => t.value())
        )),
        testId('json-value'),
      ),
      testId('tokenfield-ac'),
    ),
    cssTextArea({placeholder: 'Copy-paste testing area', rows: '3'},
      testId('copypaste'),
    ),
  );
}

const cssTestBox = styled('div', `
  display: flex;
  flex-direction: column;
  margin: 40px;
  max-width: 600px;
`);

const cssItem = styled('li', `
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  outline: none;
  padding: var(--weaseljs-menu-item-padding, 8px 24px);
  cursor: pointer;

  &.selected {
    background-color: var(--weaseljs-selected-background-color, #5AC09C);
    color: var(--weaseljs-selected-color, white);
  }
`);

const cssMatchText = styled('span', `
  color: ${colors.lightGreen};
  .selected > & {
    color: ${colors.lighterGreen};
  }
`);

const cssExample = styled('div', `
  margin: 16px;
`);

const cssValue = styled('div', `
  color: blue;
  margin: 8px 0;
`);

const cssTextArea = styled('textarea', `
  margin: 16px;
`);

void withLocale(() => dom.update(document.body, dom.cls(cssRootVars), setupTest()));
