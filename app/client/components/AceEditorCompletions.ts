import * as ace from 'brace';

// Suggestion may be a string, or a tuple [funcname, argSpec, isGrist], where:
//  - funcname (e.g. "DATEADD") will be auto-completed with "(", AND linked to Grist
//    documentation.
//  - argSpec (e.g. "(start_date, days=0, ...)") is to be shown as autocomplete caption.
//  - isGrist determines whether to tag this suggestion as "grist" or "python".
export type ISuggestion = string | [string, string, boolean];

export interface ICompletionOptions {
  getSuggestions(prefix: string): Promise<ISuggestion[]>;
}

const completionOptions = new WeakMap<ace.Editor, ICompletionOptions>();

export function setupAceEditorCompletions(editor: ace.Editor, options: ICompletionOptions) {
  initCustomCompleter();
  completionOptions.set(editor, options);

  // Create Autocomplete object at this point so we can turn autoSelect off.
  // There doesn't seem to be any way to get ace to respect autoSelect otherwise.
  // It is important for autoSelect to be off so that hitting enter doesn't automatically
  // use a suggestion, a change of behavior that doesn't seem particularly desirable and
  // which also breaks several existing tests.
  const {Autocomplete} = ace.acequire('ace/autocomplete'); // lives in brace/ext/language_tools
  const completer = new Autocomplete();
  completer.autoSelect = false;
  (editor as any).completer = completer;

  aceCompleterAddHelpLinks(completer);

  // Explicitly destroy the auto-completer on disposal, since it doesn't not remove the element
  // it adds to body even when it detaches itself. Ace's AutoCompleter doesn't expose any
  // interface for this, so this takes some hacking. (One reason for this is that Ace seems to
  // expect that a single AutoCompleter would be used for all editor instances.)
  editor.on('destroy', () => {
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

  // Add some autocompletion with partial access to document
  const aceLanguageTools = ace.acequire('ace/ext/language_tools');
  aceLanguageTools.setCompleters([]);
  aceLanguageTools.addCompleter({
    // Default regexp stops at periods, which doesn't let autocomplete
    // work on members.  So we expand it to include periods.
    // We also include $, which grist uses for column names.
    identifierRegexps: [/[a-zA-Z_0-9.$\u00A2-\uFFFF]/],

    // For autocompletion we ship text to the sandbox and run standard completion there.
    async getCompletions(editor: ace.Editor, session: ace.IEditSession, pos: number, prefix: string, callback: any) {
      const options = completionOptions.get(editor);
      if (!options || prefix.length === 0) { callback(null, []); return; }
      const suggestions = await options.getSuggestions(prefix);
      // ACE autocompletions are very poorly documented. This is somewhat helpful:
      // https://prog.world/implementing-code-completion-in-ace-editor/
      callback(null, suggestions.map(suggestion => {
        if (Array.isArray(suggestion)) {
          const [funcname, argSpec, isGrist] = suggestion;
          const meta = isGrist ? 'grist' : 'python';
          return {value: funcname + '(', caption: funcname + argSpec, score: 1, meta, funcname};
        } else {
          return {value: suggestion, score: 1, meta: "python"};
        }
      }));
    },
  });
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
 * node_modules/brace/ext/language_tools.js. Updates to brace module may easily break it.
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

interface TokenInfo extends ace.TokenInfo {
  type: string;
}

function retokenizeAceCompleterRow(rowData: any, tokens: TokenInfo[]): TokenInfo[] {
  if (!rowData.funcname) {
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
  const href = 'https://support.getgrist.com/functions/#' +
    rowData.funcname.slice(linkStart, linkEnd).toLowerCase();
  newTokens.push({value: href, type: 'grist_link_hidden'});

  // Go through tokens, splitting them if needed, and modifying those that form the link part.
  let position = 0;
  for (const t of tokens) {
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
    }
    if (lEnd < t.value.length) {
      const afterLink = t.value.slice(lEnd);
      newTokens.push({value: afterLink, type: t.type});
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
