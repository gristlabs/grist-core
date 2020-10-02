var ace = require('brace');
var ko = require('knockout');
var _ = require('underscore');
// Used to load python language settings and 'chrome' ace style
require('brace/mode/python');
require('brace/theme/chrome');
require('brace/ext/language_tools');
var dom = require('../lib/dom');
var dispose = require('../lib/dispose');
var modelUtil = require('../models/modelUtil');

/**
 * A class to help set up the ace editor with standard formatting and convenience functions
 * @param {Observable} options.observable: If given, creates a 2-way binding between the observable
 *  and the value of the editor.
 * @param {Boolean} options.saveValueOnBlurEvent: Flag to indicate whether ace editor
 *  should save the value on `blur` event.
 * @param {Function} options.calcSize: Optional function used to resize the editor. It is called
 *  with (elem, desiredSize) as arguments, and should return the actual size to use for the
 *  element. Both desiredSize and the return value are objects with 'width' and 'height' members.
 */
function AceEditor(options) {
  // Observable subscription is not created until the dom is built
  this.observable = (options && options.observable) || null;
  this.saveValueOnBlurEvent = !(options && (options.saveValueOnBlurEvent === false));
  this.calcSize = (options && options.calcSize) || ((elem, size) => size);
  this.gristDoc = (options && options.gristDoc) || null;

  this.editor = null;
  this.editorDom = null;
  this.session = null;
  this._setupCallback = null;
  this._setupTimer = null;

  this.textPadding = 10; // Space after cursor when not using wrap mode
}
dispose.makeDisposable(AceEditor);

// Builds editor dom with additional setup possible in function `optSetupCallback`.
// May be called multiple times by an instance of AceEditor.
AceEditor.prototype.buildDom = function(optSetupCallback) {
  this._fullDom = dom('div.code_editor_container',
    this.editorDom = dom('div')
  );
  this._setupCallback = optSetupCallback;
  this._setupTimer = setTimeout(() => this._setup(), 0);
  return this._fullDom;
};

/**
 * You may optionally call this once the DOM returned from buildDom is attached to the document to
 * make setup and sizing more immediate.
 */
AceEditor.prototype.onAttach = function() {
  if (this._setupTimer) {
    clearTimeout(this._setupTimer);
    this._setupTimer = null;
    this._setup();
  }
};

AceEditor.prototype.writeObservable = function() {
  if (this.observable) {
    modelUtil.setSaveValue(this.observable, this.getValue());
  }
};

AceEditor.prototype.getEditor = function() {
  return this.editor;
};

AceEditor.prototype.getValue = function() {
  return this.editor && this.editor.getValue();
};

/**
 * @param {String} val: The new value to set the editor to.
 * @param {Number} optCursorPos: Position where to place the cursor: at the end if omitted.
 */
AceEditor.prototype.setValue = function(val, optCursorPos) {
  // Note that underlying setValue() has a special meaning for second parameter:
  // undefined or 0 is selectAll, -1 is at the document start, and 1 is at the end.
  this.editor.setValue(val, optCursorPos === 0 ? -1 : 1);
  if (optCursorPos > 0 && optCursorPos < val.length) {
    var pos = this.session.getDocument().indexToPosition(optCursorPos);
    this.editor.moveCursorTo(pos.row, pos.column);
  }
};

AceEditor.prototype.isBuilt = function() {
  return this.editor !== null;
};

// Enables or disables the AceEditor
AceEditor.prototype.enable = function(bool) {
  var editor = this.editor;
  editor.setReadOnly(!bool);
  editor.renderer.$cursorLayer.element.style.opacity = bool ? 100 : 0;
  editor.gotoLine(Infinity, Infinity); // Prevents text selection on disable
};

/**
 *  Commands must be added specially to the ace editor.
 *  Attaching commands to the textarea using commandGroup.attach() only
 *  works for certain keys.
 *
 *  Note: Commands to the aceEditor are always enabled.
 *  Note: Ace defers to standard behavior when false is returned.
 */
AceEditor.prototype.attachCommandGroup = function(commandGroup) {
  _.each(commandGroup.knownKeys, (command, key) => {
    this.editor.commands.addCommand({
      name: command,
      bindKey: {
        win: key,
        mac: key,
        sender: 'editor|cli'
      },
      // AceEditor wants a command to return true if it got handled, whereas our command returns
      // true to avoid stopPropagation/preventDefault, i.e. if it hasn't been handled.
      exec: () => !commandGroup.commands[command]()
    });
  });
};

/**
 *  Attaches a command to the editor which saves the current editor
 *  contents to the attached observable on 'Shift+Enter'.
 *  Throws error if there is no attached observable.
 *  TODO: Use instead of custom save command for more implementations of AceEditor
 */
AceEditor.prototype.attachSaveCommand = function() {
  if (!this.observable) {
    throw new Error("Cannot attach save command to editor with no bound observable");
  }
  var key = 'Shift+Enter';
  this.editor.commands.addCommand({
    name: 'saveFormula',
    bindKey: {
      win: key,
      mac: key,
      sender: 'editor|cli'
    },
    // AceEditor wants a command to return true if it got handled
    exec: () => {
      this.writeObservable();
      return true;
    }
  });
};

// Wraps words to the current width of the editor
AceEditor.prototype.adjustContentToWidth = function() {
  var characterWidth = this.editor.renderer.characterWidth;
  var contentWidth = this.editor.renderer.scroller.clientWidth;

  if(contentWidth > 0) {
    this.editor.getSession().setWrapLimit(parseInt(contentWidth/characterWidth, 10) - 1);
  }
};

AceEditor.prototype.setFontSize = function(pxVal) {
  this.editor.setFontSize(pxVal);
  this.resize();
};

AceEditor.prototype._setup = function() {
  // Standard editor setup
  this.editor = this.autoDisposeWith('destroy', ace.edit(this.editorDom));
  if (this.gristDoc) {
    // Add some autocompletion with partial access to document
    const aceLanguageTools = ace.acequire('ace/ext/language_tools');
    const gristDoc = this.gristDoc;
    aceLanguageTools.setCompleters([]);
    aceLanguageTools.addCompleter({
      // Default regexp stops at periods, which doesn't let autocomplete
      // work on members.  So we expand it to include periods.
      // We also include $, which grist uses for column names.
      identifierRegexps: [/[a-zA-Z_0-9.$\u00A2-\uFFFF]/],

      // For autocompletion we ship text to the sandbox and run standard completion there.
      getCompletions: function(editor, session, pos, prefix, callback) {
        if (prefix.length === 0) { callback(null, []); return; }
        const tableId = gristDoc.viewModel.activeSection().table().tableId();
        gristDoc.docComm.autocomplete(prefix, tableId)
        .then(suggestions => {
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
        });
      },
    });

    // Create Autocomplete object at this point so we can turn autoSelect off.
    // There doesn't seem to be any way to get ace to respect autoSelect otherwise.
    // It is important for autoSelect to be off so that hitting enter doesn't automatically
    // use a suggestion, a change of behavior that doesn't seem particularly desirable and
    // which also breaks several existing tests.
    const {Autocomplete} = ace.acequire('ace/autocomplete'); // lives in brace/ext/language_tools
    const completer = new Autocomplete();
    this.editor.completer = completer;
    this.editor.completer.autoSelect = false;
    aceCompleterAddHelpLinks(completer);

    // Explicitly destroy the auto-completer on disposal, since it doesn't not remove the element
    // it adds to body even when it detaches itself. Ace's AutoCompleter doesn't expose any
    // interface for this, so this takes some hacking. (One reason for this is that Ace seems to
    // expect that a single AutoCompleter would be used for all editor instances.)
    this.autoDisposeCallback(() => {
      if (completer.editor) {
        completer.detach();
      }
      if (completer.popup) {
        completer.popup.destroy();                // This is not enough, but seems relevant to call.
        ko.removeNode(completer.popup.container); // Removes the element and cleans up JQuery state if any.
      }
    });
  }
  this.editor.setOptions({
    enableLiveAutocompletion: true,   // use autocompletion without needing special activation.
  });
  this.session = this.editor.getSession();
  this.session.setMode('ace/mode/python');
  this.editor.setTheme('ace/theme/chrome');

  // Default line numbers to hidden
  this.editor.renderer.setShowGutter(false);
  this.session.setTabSize(2);
  this.session.setUseWrapMode(true);

  this.editor.on('change', this.resize.bind(this));
  this.editor.$blockScrolling = Infinity;
  this.editor.setFontSize(11);
  this.resize();

  // Set up the bound observable if supplied
  if (this.observable) {
    var subscription = this.observable.subscribeInit(val => {if (val !== undefined) {this.setValue(val);}});
    // Dispose with dom since subscription is created when dom is created
    dom(this.editorDom,
      dom.autoDispose(subscription)
    );

    if (this.saveValueOnBlurEvent) {
      this.editor.on('blur', () => {
        this.writeObservable();
      });
    }
  }

  if (this._setupCallback) {
    this._setupCallback.call(null, this.editor);
    this._setupCallback = null;
  }
};

AceEditor.prototype.resize = function() {
  var wrap = this.session.getUseWrapMode();
  var contentWidth = wrap ? 0 : this._getContentWidth();
  var desiredSize = {
    width: wrap ? 0 : contentWidth + this.textPadding,
    height: this._getContentHeight()
  };
  var size = this.calcSize(this._fullDom, desiredSize);
  if (size.width < contentWidth) {
    // Editor will show a horizontal scrollbar, so recalculate to make space for it.
    desiredSize.height += 20;
    size = this.calcSize(this._fullDom, desiredSize);
  }

  this.editorDom.style.width = size.width ? size.width + 'px' : 'auto';
  this.editorDom.style.height = size.height + 'px';
  this.editor.resize();
};

AceEditor.prototype._getContentWidth = function() {
  return this.session.getScreenWidth() * this.editor.renderer.characterWidth;
};

AceEditor.prototype._getContentHeight = function() {
  return Math.max(1, this.session.getScreenLength()) * this.editor.renderer.lineHeight;
};


let _RangeConstructor = null; //singleton, load it lazily
AceEditor.makeRange = function(a,b,c,d) {
  _RangeConstructor = _RangeConstructor || ace.acequire('ace/range').Range;
  return new _RangeConstructor(a,b,c,d);
};

/**
 * When autocompleting a known function (with funcname received from the server call), turn the
 * function name into a link to Grist documentation.
 *
 * ACE autocomplete is poorly documented, and poorly customizable, so this is accomplished by
 * monkey-patching it. Further, the only text styling is done via styled tokens, but we can style
 * them to look like links, and handle clicks to open the destination URL.
 *
 * This implementation relies a lot on the details of the implementation in
 * node_modules/brace/ext/language_tools.js. Updates to brace module may easily break it.
 */
function aceCompleterAddHelpLinks(completer) {
  // Replace the $init function in order to intercept the creation of the autocomplete popup.
  const init = completer.$init;
  completer.$init = function() {
    const popup = init.apply(this, arguments);
    customizeAceCompleterPopup(this, popup);
    return popup;
  };
}

function customizeAceCompleterPopup(completer, popup) {
  // Replace the $tokenizeRow function to produce customized tokens to style the link part.
  const origTokenize = popup.session.bgTokenizer.$tokenizeRow;
  popup.session.bgTokenizer.$tokenizeRow = function(row) {
    const tokens = origTokenize(row);
    return retokenizeAceCompleterRow(popup.data[row], tokens);
  };

  // Replace the click handler with one that handles link clicks.
  popup.removeAllListeners("click");
  popup.on("click", function(e) {
    if (!maybeAceCompleterLinkClick(e)) {
      completer.insertMatch();
    }
    e.stop();
  });
}

function retokenizeAceCompleterRow(rowData, tokens) {
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
function maybeAceCompleterLinkClick(event) {
  const tgt = event.domEvent.target;
  if (tgt && tgt.matches('.ace_grist_link')) {
    const dest = tgt.parentElement.querySelector('.ace_grist_link_hidden');
    if (dest) {
      window.open(dest.textContent, "_blank");
      return true;
    }
  }
  return false;
}

module.exports = AceEditor;
