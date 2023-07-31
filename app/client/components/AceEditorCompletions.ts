import ace, {Ace} from 'ace-builds';
import {ISuggestionWithValue} from 'app/common/ActiveDocAPI';
import {commonUrls} from 'app/common/gristUrls';

export interface ICompletionOptions {
  getSuggestions(prefix: string): Promise<ISuggestionWithValue[]>;
}

const completionOptions = new WeakMap<Ace.Editor, ICompletionOptions>();

export function setupAceEditorCompletions(editor: Ace.Editor, options: ICompletionOptions) {
  initCustomCompleter();
  completionOptions.set(editor, options);

  // Create Autocomplete object at this point so we can turn autoSelect off.
  // There doesn't seem to be any way to get ace to respect autoSelect otherwise.
  // It is important for autoSelect to be off so that hitting enter doesn't automatically
  // use a suggestion, a change of behavior that doesn't seem particularly desirable and
  // which also breaks several existing tests.
  const {Autocomplete} = ace.require('ace/autocomplete');

  const completer = new Autocomplete();
  completer.autoSelect = false;
  (editor as any).completer = completer;

  // Used in the patches below. Returns true if the client should fetch fresh completions from the server,
  // as it may have new suggestions that aren't currently shown.
  completer._gristShouldRefreshCompletions = function(this: any, start: any) {
    // These two lines are based on updateCompletions() in the ace autocomplete source code.
    const end = this.editor.getCursorPosition();
    const prefix: string = this.editor.session.getTextRange({start, end}).toLowerCase();

    return (
      prefix.endsWith(".") ||  // to get fresh attributes of references
      prefix.endsWith(".lookupone(") ||  // to get initial argument suggestions
      prefix.endsWith(".lookuprecords(")
    );
  }.bind(completer);

  // Patch updateCompletions and insertMatch so that fresh completions are fetched when appropriate.
  const originalUpdate = completer.updateCompletions.bind(completer);
  completer.updateCompletions = function(this: any, keepPopupPosition: boolean) {
    // This next line is copied from updateCompletions() in the ace autocomplete source code.
    if (keepPopupPosition && this.base && this.completions) {
      // When we need fresh completions, prevent this same block from running
      // in the original updateCompletions() function. Otherwise it will just keep any remaining completions that match,
      // or not show any completions at all.
      if (this._gristShouldRefreshCompletions(this.base)) {
        this.completions = null;
      }
    }
    return originalUpdate(keepPopupPosition);
  }.bind(completer);

  // Similar patch to the above.
  const originalInsertMatch = completer.insertMatch.bind(completer);
  completer.insertMatch = function(this: any) {
    const base = this.base;  // this.base may become null after the next line, save it now.
    const result = originalInsertMatch.apply(...arguments);
    if (this._gristShouldRefreshCompletions(base)) {
      this.showPopup(this.editor);
    }
    return result;
  }.bind(completer);

  aceCompleterAddHelpLinks(completer);

  // Explicitly destroy the auto-completer on disposal, since it doesn't not remove the element
  // it adds to body even when it detaches itself. Ace's AutoCompleter doesn't expose any
  // interface for this, so this takes some hacking. (One reason for this is that Ace seems to
  // expect that a single AutoCompleter would be used for all editor instances.)
  editor.on('destroy' as any, () => {
    if (completer.editor) {
      completer.detach();
    }
    if (completer.popup) {
      completer.popup.destroy();                // This is not enough, but seems relevant to call.
      completer.popup.container.remove();       // Removes the element from DOM.
    }
  });
}

let _initialized = false;
function initCustomCompleter() {
  if (_initialized) { return; }
  _initialized = true;

  // The default regex just matches identifiers. We expand it to include periods (to capture
  // attributes) and "$", for Grist column names. In addition, we autocomplete lookup formulas
  // with the function name, to give suggestions for lookup keyword arguments.
  const prefixMatchRegex = /\w+\.(?:lookupRecords|lookupOne)\([\w.$\u00A2-\uFFFF]*$|[\w.$\u00A2-\uFFFF]+$/;

  // Monkey-patch getCompletionPrefix. This is based on the source code in
  // node_modules/ace-builds/src-noconflict/ext-language_tools.js, simplified to do the one thing
  // we want here (since the original method's generality doesn't help us here).
  const util = ace.require('ace/autocomplete/util');
  util.getCompletionPrefix = function getCompletionPrefix(this: any, editor: Ace.Editor) {
    const pos = editor.getCursorPosition();
    const line = editor.session.getLine(pos.row);
    const match = line.slice(0, pos.column).match(prefixMatchRegex);
    return match ? match[0] : "";
  };

  // Add some autocompletion with partial access to document
  const aceLanguageTools = ace.require('ace/ext/language_tools');
  aceLanguageTools.setCompleters([]);
  aceLanguageTools.addCompleter({
    // For autocompletion we ship text to the sandbox and run standard completion there.
    async getCompletions(
      editor: Ace.Editor,
      session: Ace.EditSession,
      pos: Ace.Position,
      prefix: string,
      callback: any
    ) {
      const options = completionOptions.get(editor);
      if (!options || prefix.length === 0) { callback(null, []); return; }

      // Autocompletion can be triggered in the middle of a function or method call, like
      // in the case where one function is being switched with another. Since we normally
      // append a "(" when completing such suggestions, we need to be careful not to do
      // so if a "(" is already present. One way to do this in ACE is to check if the
      // current token is a function/identifier, and the next token is a lparen; if both are
      // true, we skip appending a "(" to each suggestion.
      const wordRange = session.getWordRange(pos.row, pos.column);
      const token = session.getTokenAt(pos.row, wordRange.end.column) as Ace.Token;
      const nextToken = session.getTokenAt(pos.row, wordRange.end.column + 1);
      const isRenamingFunc = ['function.support', 'identifier'].includes(token.type)
        && nextToken?.type === 'paren.lparen';

      const suggestions = await options.getSuggestions(prefix);
      // ACE autocompletions are very poorly documented. This is somewhat helpful:
      // https://prog.world/implementing-code-completion-in-ace-editor/
      const completions: AceSuggestion[] = suggestions.map(suggestionWithValue => {
        const [suggestion, example] = suggestionWithValue;
        if (Array.isArray(suggestion)) {
          const [funcname, argSpec] = suggestion;
          return {
            value: funcname + (isRenamingFunc ? '' : '('),
            caption: funcname + argSpec,
            score: 1,
            example,
            funcname,
          };
        } else {
          return {
            value: suggestion,
            caption: suggestion,
            score: 1,
            example,
            funcname: '',
          };
        }
      });

      // For suggestions with example values, calculate the 'shared padding', i.e.
      // the minimum width in characters that all suggestions should fill
      // (before adding 'base padding') so that the examples are aligned.
      const captionLengths = completions.filter(c => c.example).map(c => c.caption.length);
      const sharedPadding = Math.min(
        Math.min(...captionLengths) + MAX_RELATIVE_SHARED_PADDING,
        Math.max(...captionLengths),
        MAX_ABSOLUTE_SHARED_PADDING,
      );

      // Add the padding spaces and example values to the captions.
      for (const c of completions) {
        if (!c.example) { continue; }
        const numSpaces = Math.max(0, sharedPadding - c.caption.length) + BASE_PADDING;
        c.caption = c.caption + ' '.repeat(numSpaces) + c.example;
      }

      callback(null, completions);
    },
  });
}

// Regardless of other suggestions, always add this many spaces between the caption and the example.
const BASE_PADDING = 8;
// In addition to the base padding, there's shared padding, which is the minimum number of spaces
// that all suggestions should fill so that the examples are aligned.
// However, one extremely long suggestion shouldn't result in huge padding for all suggestions.
// To mitigate this, there are two limits on the shared padding.
// The first limit is relative to the shortest caption in the suggestions.
// So if all the suggestions are similarly long, there will still be some shared padding.
const MAX_RELATIVE_SHARED_PADDING = 15;
// The second limit is absolute, so that even if all suggestions are long, we don't run out of popup space.
const MAX_ABSOLUTE_SHARED_PADDING = 40;

// Suggestion objects that are passed to ace.
interface AceSuggestion {
  value: string;    // the actual value inserted by the autocomplete
  caption: string;  // the value displayed in the popup
  score: number;

  // Custom attributes used only by us
  example: string | null;  // example value of the suggestion to show on the right
  funcname: string;        // name of a function to link to in documentation
}

/**
 * When autocompleting a known function (with funcname received from the server call), turn the
 * function name into a link to Grist documentation.
 *
 * This is only applied for items returned from getCompletions() that include a our custom
 * `funcname` attribute.
 *
 * ACE autocomplete is poorly documented, and poorly customizable, so this is accomplished by
 * monkey-patching it. Further, the only text styling is done via styled tokens, but we can style
 * them to look like links, and handle clicks to open the destination URL.
 *
 * This implementation relies a lot on the details of the implementation in
 * node_modules/ace-builds/src-noconflict/ext-language_tools.js. Updates to ace-builds module may
 * easily break it.
 */
function aceCompleterAddHelpLinks(completer: any) {
  // Replace the $init function in order to intercept the creation of the autocomplete popup.
  const init = completer.$init;
  completer.$init = function() {
    const popup = init.apply(this, arguments);
    customizeAceCompleterPopup(this, popup);
    return popup;
  };
}

function customizeAceCompleterPopup(completer: any, popup: any) {
  // Replace the $tokenizeRow function to produce customized tokens to style the link part.
  const origTokenize = popup.session.bgTokenizer.$tokenizeRow;
  popup.session.bgTokenizer.$tokenizeRow = function(row: any) {
    const tokens = origTokenize(row);
    return retokenizeAceCompleterRow(popup.data[row], tokens);
  };

  // Replace the click handler with one that handles link clicks.
  popup.removeAllListeners("click");
  popup.on("click", function(e: any) {
    if (!maybeAceCompleterLinkClick(e.domEvent)) {
      completer.insertMatch();
    }
    e.stop();
  });
}

function retokenizeAceCompleterRow(rowData: AceSuggestion, tokens: Ace.Token[]): Ace.Token[] {
  if (!(rowData.funcname || rowData.example)) {
    // Not a special completion, pass through the result of ACE's original tokenizing.
    return tokens;
  }

  // ACE's original tokenizer splits rowData.caption into tokens to highlight matching portions.
  // We jump in, and further divide the tokens so that those that form the link get an extra CSS
  // class. ACE's will turn token.type into CSS classes by splitting the type on "." and prefixing
  // the resulting substrings with "ace_".

  // Funcname may be the recognized name itself (e.g. "UPPER"), or a method (like
  // "Table1.lookupOne"), in which case only the portion after the dot is the recognized name.

  // Figure out the portion that should be linkified.
  const dot = rowData.funcname.lastIndexOf(".");
  const linkStart = dot < 0 ? 0 : dot + 1;
  const linkEnd = rowData.funcname.length;

  const newTokens = [];

  // Include into new tokens a special token that will be hidden, but include the link URL. On
  // click, we find it to know what URL to open.
  const href = `${commonUrls.functions}/#` +
    rowData.funcname.slice(linkStart, linkEnd).toLowerCase();
  newTokens.push({value: href, type: 'grist_link_hidden'});

  // Find where the example value (if any) starts, so that it can be shown in grey.
  let exampleStart: number | undefined;
  if (rowData.example) {
    if (!rowData.caption.endsWith(rowData.example)) {
      // Just being cautious, this shouldn't happen.
      console.warn(`Example "${rowData.example}" does not match caption "${rowData.caption}"`);
    } else {
      exampleStart = rowData.caption.length - rowData.example.length;
    }
  }

  // Go through tokens, splitting them if needed, and modifying those that form the link part.
  let position = 0;
  for (const t of tokens) {
    if (exampleStart && position + t.value.length > exampleStart) {
      // Ensure that all text after `exampleStart` has the type 'grist_example'.
      // Don't combine that type with the existing type, because ace highlights weirdly sometimes
      // and it's best to just override that.
      const end = exampleStart - position;
      if (end > 0) {
        newTokens.push({value: t.value.slice(0, end), type: t.type});
        newTokens.push({value: t.value.slice(end), type: 'grist_example'});
      } else {
        newTokens.push({value: t.value, type: 'grist_example'});
      }
    } else {
      // Handle links to documentation.
      // lStart/lEnd are indices of the link within the token, possibly negative.
      const lStart = linkStart - position, lEnd = linkEnd - position;
      if (lStart > 0) {
        const beforeLink = t.value.slice(0, lStart);
        newTokens.push({value: beforeLink, type: t.type});
      }
      if (lEnd > 0) {
        const inLink = t.value.slice(Math.max(0, lStart), lEnd);
        const newType = t.type + (t.type ? '.' : '') + 'grist_link';
        newTokens.push({value: inLink, type: newType});
        if (lEnd < t.value.length) {
          const afterLink = t.value.slice(lEnd);
          newTokens.push({value: afterLink, type: t.type});
        }
      } else {
        newTokens.push(t);
      }
    }
    position += t.value.length;
  }
  return newTokens;
}

// On any click on AceCompleter popup, we check if we happened to click .ace_grist_link class. If
// so, we should be able to find the URL and open another window to it.
function maybeAceCompleterLinkClick(domEvent: Event) {
  const tgt = domEvent.target as HTMLElement;
  if (tgt && tgt.matches('.ace_grist_link')) {
    const dest = tgt.parentElement?.querySelector('.ace_grist_link_hidden');
    if (dest) {
      window.open(dest.textContent!, "_blank");
      return true;
    }
  }
  return false;
}
