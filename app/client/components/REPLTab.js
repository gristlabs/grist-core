/**
 * A Tab that contains a REPL.
 * The REPL allows the user to write snippets of python code and see the results of evaluating
 * them. In particular, the REPL has access to the usercode module, so they can see the results
 * of quick operations on their data.
 * The REPL supports evaluation of code, removal of lines from history, and re-computation
 * and editing of older lines.
 */
var kd  = require('../lib/koDom');
var ko  = require('knockout');
var dom = require('../lib/dom');
var Base = require('./Base');
var commands = require('./commands');

var NEW_LINE = -1;

/**
 * Hard tab used instead of soft tabs, as soft-tabs would require a lot of additional
 * editor logic (partial-width tabs, backspacing a tab, ...) for
 * which we may want to eventually use a 3rd-party library for in addition to syntax highlighting, etc
 */
var INDENT_STR = "\t";

function REPLTab(gristDoc) {
  Base.call(this, gristDoc);
  this.replHist = gristDoc.docModel.replHist.createAllRowsModel("id");
  this.docData = gristDoc.docData;
  this.editingIndex = ko.observable(null);
  this.histIndex = ko.observable(this.replHist.peekLength);

  this.editorActive = ko.observable(false);
  this.numLines = ko.observable(0);
  this.row = null;

  this._contentSizer = ko.observable('');
  this._originalValue = '';
  this._textInput = null;

  this.commandGroup = this.autoDispose(commands.createGroup(
    REPLTab.replCommands, this, this.editorActive));
}

Base.setBaseFor(REPLTab);

/**
 * Editor commands for the cellEditor in the REPL Tab
 * TODO: Using the command group, distinguish between "on enter" saves and "on blur" saves
 * So that we can give up focus on blur
 */
REPLTab.replCommands = {
  // TODO: GridView commands are activated more recently after startup.
  fieldEditSave: function() {
    if (!this._textInput || !this.editorActive() ||
      !this._textInput.value.trim() && this.editingIndex() === NEW_LINE) { return; }
    // TODO: Scroll pane does not automatically scroll down on save.
    var self = this;
    this.save()
    .then(function(success) {
      if (success) {
        self.editingIndex(NEW_LINE);
        self.clear();
        // Refresh the history index.
        self.histIndex(self.replHist.peekLength);
      } else {
        self.write("\n");
        // Since focus is staying in the current input, increment lines.
        self.numLines(self.numLines.peek()+1);
      }
    });
  },
  fieldEditCancel: function() {
    this.clear();
    this.editingIndex(NEW_LINE);
  },
  nextField: function() {
    // In this case, 'nextField' (Tab) inserts a tab.
    this.write(INDENT_STR);
  },
  historyPrevious: function() {
    // Fills the editor with the code previously entered.
    if (this.editingIndex() === NEW_LINE) { this.writePrev(); }
  },
  historyNext: function() {
    // Fills the editor with the code entered after the current code.
    if (this.editingIndex() === NEW_LINE) { this.writeNext(); }
  }
};


/**
 * Sends the entered code as an EvalCode Useraction.
 * @param {Function} callback - Is called with a single argument 'success' indicating
 *  whether the save was successful.
 */
REPLTab.prototype.save = function(callback) {
  if (!this._textInput.value.trim()) {
    // If its text is cleared, remove history item.
    var currentEditIndex = this.editingIndex();
    this.histIndex(this.replHist.peekLength - 1);
    this.editorActive(false);
    return this.docData.sendAction(["RemoveRecord", "_grist_REPL_Hist", currentEditIndex]);
  }
  else {
    // If something is entered, save value.
    var rowId = this.row ? this.row.id() : null;
    return this.docData.sendAction(["EvalCode", this._textInput.value, rowId]);
  }
};

// Builds object with REPLTab dom builder and settings for the sidepane.
REPLTab.prototype.buildConfigDomObj = function() {
  return [{
    'buildDom': this.buildDom.bind(this),
    'keywords': ['repl', 'console', 'python', 'code', 'terminal']
  }];
};

REPLTab.prototype.buildDom = function() {
  var self = this;
  return dom('div',
    kd.foreach(this.replHist, function(replLine) {
      return dom('div.repl-container',
        dom('div.repl-text_line',
          kd.scope(function() { return self.editingIndex() === replLine.id(); },
            function(isEditing) {
              if (isEditing) {
                return dom('div.field.repl-field',
                  kd.scope(self.numLines, function(numLines) {
                    return self.buildPointerGroup(numLines);
                  }),
                  self.attachEditorDom(replLine));
              } else {
                var numLines = replLine.code().trim().split('\n').length;
                return dom('div.repl-field',
                  dom.on('click', function() {
                    // TODO: Flickering occurs on click for multiline code segments.
                    self.editingIndex(replLine.id());
                    self.focus();
                  }),
                  self.buildPointerGroup(numLines),
                  dom('div.repl-text',
                    kd.text(replLine.code)
                  )
                );
              }
            }
          ),
          dom('div.erase_line_button.unselectable', dom.on('click', function() {
            self.histIndex(self.replHist.peekLength - 1);
            return self.docData.sendAction(
              ["RemoveRecord", "_grist_REPL_Hist", replLine.id()]
            );
          }), '\u2A09'),
          dom('div.re-eval_line_button.unselectable', dom.on('click', function() {
            return self.docData.sendAction(
              ["EvalCode", replLine.code(), replLine.id()]
            );
          }), '\u27f3') // 'refresh' symbol
        ),
        kd.maybe(replLine.outputText, function() {
          return dom('div.repl-text.repl-output', kd.text(replLine.outputText));
        }),
        kd.maybe(replLine.errorText, function() {
          return dom('div.repl-text.repl-error', kd.text(replLine.errorText));
        })
      );
    }),
    // Special bottom editor which sends actions to add new records to the REPL hist.
    dom('div.repl-newline',
      dom.on('click', function() {
        self.editingIndex(NEW_LINE);
        self.focus();
      }),
      dom('div.field.repl-field',
        kd.scope(self.numLines, function(numLines) {
          return self.buildPointerGroup(self.editingIndex() === NEW_LINE ? numLines : 1);
        }),
        kd.maybe(ko.pureComputed(function() { return self.editingIndex() === NEW_LINE; }),
          function() { return self.attachEditorDom(null); }
        )
      )
    )
  );
};

/**
 * Builds the set of pointers to the left of the code
 * @param {String} code - The code for which the pointer group is to be built.
 */
REPLTab.prototype.buildPointerGroup = function(numLines) {
  var pointers = [];
  for (var i = 0; i < numLines; i++) {
    pointers.push(dom('div.pointer', i ? '...' : '>>>'));
  }
  return dom('div.pointer_group.unselectable', pointers);
};

REPLTab.prototype.buildEditorDom = function() {
  var self = this;
  return dom('div.repl-cursor_editor',
    dom('div.repl-content_measure.formula-text', kd.text(this._contentSizer)),
    function() {
      self._textInput = dom('textarea.repl-text_editor.formula-text',
        kd.value(self.row ? self.row.code() : ""),
        dom.on('focus', function() {
          self.numLines(this.value.split('\n').length);
        }),
        dom.on('blur', function() {
          if (!this._textInput || !this.editorActive()) { return; }
          self.save()
          .then(function(success) {
            if (success) {
              // If editing a new line, clear it to start fresh.
              if (self.editingIndex() === NEW_LINE) { self.clear(); }
              // Refresh the history index.
              self.histIndex(self.replHist.peekLength);
            } else {
              self.write("\n");
            }
            self.editorActive(false);
          });
        }),
        //Resizes the textbox whenever user writes in it.
        dom.on('input', function() {
          self.numLines(this.value.split('\n').length);
          self.resizeElem();
        }),
        dom.defer(function(elem) {
          self.resizeElem();
          elem.focus();
          // Set the cursor at the end.
          var elemLen = elem.value.length;
          elem.selectionStart = elemLen;
          elem.selectionEnd = elemLen;
        }),
        dom.on('mouseup mousedown click', function(event) { event.stopPropagation(); }),
        self.commandGroup.attach()
      );
      return self._textInput;
    }
  );
};

/**
* This function measures a hidden div with the same value as the textarea being edited and then resizes the textarea to match.
*/
REPLTab.prototype.resizeElem = function() {
  // \u200B is a zero-width space; it is used so the textbox will expand vertically
  // on newlines, but it does not add any width the string
  this._contentSizer(this._textInput.value + '\u200B');
  var rect = this._textInput.parentNode.childNodes[0].getBoundingClientRect();
  //Allows form to expand passed its container div.
  this._textInput.style.width = Math.ceil(rect.width) + 'px';
  this._textInput.style.height = Math.ceil(rect.height) + 'px';
};

/**
 * Appends text to the contents being edited
 */
REPLTab.prototype.write = function(text) {
  this._textInput.value += text;
  this.resizeElem();
};

/**
 * Clears both the current text and any memory of text in the currently edited cell.
 */
REPLTab.prototype.clear = function() {
  this._textInput.value = "";
  this._orignalValue    = "";
  this.numLines(1);
  this.resizeElem();
};

/**
 * Restores focus to the most recent input.
 */
REPLTab.prototype.focus = function() {
  if (this._textInput) {
    this._textInput.focus();
    this.editorActive(true);
  }
};

/**
 * Writes the code entered before the current code to the input.
 */
REPLTab.prototype.writePrev = function() {
  this.histIndex(Math.max(this.histIndex.peek() - 1, 0));
  this.clear();
  if (this.replHist.at(this.histIndex.peek())) {
    this.write(this.replHist.at(this.histIndex.peek()).code());
  }
};

/**
 * Writes the code entered after the current code to the input.
 */
REPLTab.prototype.writeNext = function() {
  this.histIndex(Math.min(this.histIndex() + 1, this.replHist.peekLength));
  this.clear();
  if (this.histIndex.peek() < this.replHist.peekLength) {
    this.write(this.replHist.at(this.histIndex.peek()).code());
  }
};

/**
* This function is called in the DOM element where an editor is desired.
* It attaches to as a child of that element with that elements value as default or whatever is set as an override value.
*/
REPLTab.prototype.attachEditorDom = function(row) {
  var self = this;
  self.row = row;
  self._originalValue = self.row ? self.row.code() : "";
  return self.buildEditorDom();
};

module.exports = REPLTab;
