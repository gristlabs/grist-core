/**
 * Commands are invoked by the user via keyboard shortcuts or mouse clicks, for example, to move
 * the cursor or to delete the selected records.
 *
 * This module provides APIs for other components to implement groups of commands. Any given
 * command may be implemented by different components, but at most one implementation of any
 * command is active at any time.
 */


/* global navigator */

var _ = require('underscore');
var ko = require('knockout');
var Mousetrap = require('../lib/Mousetrap');
var dom = require('../lib/dom');
var gutil = require('app/common/gutil');
var dispose = require('../lib/dispose');
var commandList = require('./commandList');
require('../lib/koUtil');    // for subscribeInit

var G = require('../lib/browserGlobals').get('window');

// Same logic as used by mousetrap to map 'Mod' key to platform-specific key.
var isMac = (typeof navigator !== 'undefined' && navigator &&
             /Mac|iPod|iPhone|iPad/.test(navigator.platform));

/**
 * Globally-exposed map of command names to Command objects. E.g. typing "cmd.cursorDown.run()" in
 * the browser console should move the cursor down as long as it makes sense in the currently
 * shown view. If the command is inactive, its run() function is a no-op.
 *
 * See also Command object below.
 */
var allCommands = {};
exports.allCommands = allCommands;

/**
 * This is an internal variable, mapping key combinations to the stack of CommandGroups which
 * include them (see also CommandGroup.knownKeys). It's used for deciding which CommandGroup to
 * use when different Commands use the same key.
 */
var _allKeys = {};

/**
 * Populate allCommands from those provided, or listed in commandList.js. Also populates the
 * globally exposed `cmd` object whose properties invoke commands: e.g. typing `cmd.cursorDown` in
 * the browser console will run allCommands.cursorDown.run().
 */
function init(optCommandGroups) {
  var commandGroups = optCommandGroups || commandList.groups;

  // Clear out the objects holding the global state.
  Object.keys(allCommands).forEach(function(c) {
    delete allCommands[c];
  });
  Object.keys(_allKeys).forEach(function(k) {
    delete _allKeys[k];
  });

  commandGroups.forEach(function(commandGroup) {
    commandGroup.commands.forEach(function(c) {
      if (allCommands[c.name]) {
        console.error("Ignoring duplicate command %s in commandList", c.name);
      } else {
        allCommands[c.name] = new Command(c.name, c.desc, c.keys);
      }
    });
  });

  // Define the browser console interface.
  G.window.cmd = {};
  _.each(allCommands, function(cmd, name) {
    Object.defineProperty(G.window.cmd, name, {get: cmd.run});
  });
}
exports.init = init;

//----------------------------------------------------------------------

const KEY_MAP_MAC = {
  Mod: '⌘',
  Alt: '⌥',
  Shift: '⇧',
  Ctrl: '⌃',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
};

const KEY_MAP_WIN = {
  Mod: 'Ctrl',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
};

function getHumanKey(key, isMac) {
  const keyMap = isMac ? KEY_MAP_MAC : KEY_MAP_WIN;
  let keys = key.split('+').map(s => s.trim());
  keys = keys.map(k => {
    if (k in keyMap) { return keyMap[k]; }
    if (k.length === 1) { return k.toUpperCase(); }
    return k;
  });
  return keys.join( isMac ? '' : ' + ');
}

/**
 * Command represents a single command. It is exposed via the `allCommands` map.
 * @property {String} name: The name of the command, same as the key into the `allCommands` map.
 * @property {String} desc: The description of the command.
 * @property {Array}  keys: The array of keyboard shortcuts for the command.
 * @property {Function} run: A bound function that will run the currently active implementation.
 * @property {Observable} isActive: Knockout observable for whether this command is active.
 */
function Command(name, desc, keys) {
  this.name = name;
  this.desc = desc;
  this.humanKeys = keys.map(key => getHumanKey(key, isMac));
  this.keys = keys.map(function(k) { return k.trim().toLowerCase().replace(/ *\+ */g, '+'); });
  this.isActive = ko.observable(false);
  this._implGroupStack = [];
  this._activeFunc = _.noop;   // The function to run when this command is invoked.

  // Let .run bind the Command object, so that it can be used as a stand-alone callback.
  this.run = this._run.bind(this);
}
exports.Command = Command;

Command.prototype._run = function() {
  return this._activeFunc.apply(null, arguments);
};

/**
 * Returns the text description for the command, including the keyboard shortcuts.
 */
Command.prototype.getDesc = function() {
  var desc = this.desc;
  if (this.humanKeys.length) {
    desc += " (" + this.humanKeys.join(", ") + ")";
  }
  return desc;
};

/**
 * Returns DOM for the keyboard shortcuts, wrapped in cute boxes that look like keyboard keys.
 */
Command.prototype.getKeysDom = function() {
  return dom('span.shortcut_keys',
    this.humanKeys.map(key => dom('span.shortcut_key_image', key))
  );
};

/**
 * Adds a CommandGroup that implements this Command to the top of the stack of groups.
 */
Command.prototype._addGroup = function(cmdGroup) {
  this._implGroupStack.push(cmdGroup);
  this._updateActive();
};

/**
 * Removes a CommandGroup from the stack of groups implementing this Command.
 */
Command.prototype._removeGroup = function(cmdGroup) {
  gutil.arrayRemove(this._implGroupStack, cmdGroup);
  this._updateActive();
};

/**
 * Updates the command's state to reflect the currently active group, if any.
 */
Command.prototype._updateActive = function() {
  if (this._implGroupStack.length > 0) {
    this.isActive(true);
    this._activeFunc = _.last(this._implGroupStack).commands[this.name];
  } else {
    this.isActive(false);
    this._activeFunc = _.noop;
  }

  // Now bind or unbind the affected key combinations.
  this.keys.forEach(function(key) {
    var keyGroups = _allKeys[key];
    if (keyGroups && keyGroups.length > 0) {
      var commandGroup = _.last(keyGroups);
      // Command name might be different from this.name in case we are deactivating a command, and
      // the previous meaning of the key points to a different command.
      var commandName = commandGroup.knownKeys[key];
      Mousetrap.bind(key, wrapKeyCallback(commandGroup.commands[commandName]));
    } else {
      Mousetrap.unbind(key);
    }
  });
};

/**
 * Helper for mousetrap callbacks, which returns a version of the callback that by default stops
 * the propagation of the keyboard event (unless the callback returns a true value).
 */
function wrapKeyCallback(callback) {
  return function() {
    return callback.apply(null, arguments) || false;
  };
}

//----------------------------------------------------------------------

/**
 * CommandGroup is the way for other components to provide implementations for a group of
 * commands. Note that CommandGroups are stacked, with groups activated later having priority over
 * groups activated earlier.
 * @param {String->Function} commands: The map of command names to implementations.
 * @param {Object} context: "this" context with which to invoke implementation functions.
 * @param {Boolean|Observable<boolean>} activate: Whether to activate this group immediately, false if
 *      omitted. This may be an Observable.
 */
function CommandGroup(commands, context, activate) {
  // Keep only valid commands, so that we don't have to check for validity elsewhere, and bind
  // each to the passed-in context object.
  this.commands = {};
  this.isActive = false;

  var name;
  for (name in commands) {
    if (allCommands[name]) {
      this.commands[name] = commands[name].bind(context);
    } else {
      console.warn("Ignoring unknown command %s", name);
    }
  }

  // Map recognized key combinations to the corresponding command names.
  this.knownKeys = {};
  for (name in this.commands) {
    var keys = allCommands[name].keys;
    for (var i = 0; i < keys.length; i++) {
      this.knownKeys[keys[i]] = name;
    }
  }

  // On disposal, remove the CommandGroup from all the commands and keys.
  this.autoDisposeCallback(this._removeGroup);

  // Finally, set the activatation status of the command group, subscribing if an observable.
  if (ko.isObservable(activate)) {
    this.autoDispose(activate.subscribeInit(this.activate, this));
  } else {
    this.activate(activate);
  }
}
exports.CommandGroup = CommandGroup;
dispose.makeDisposable(CommandGroup);

/**
 * Just a shorthand for CommandGroup.create constructor.
 */
function createGroup(commands, context, activate) {
  return CommandGroup.create(commands, context, activate);
}
exports.createGroup = createGroup;


/**
 * Activate or deactivate this implementation group.
 */
CommandGroup.prototype.activate = function(yesNo) {
  if (yesNo) {
    this._addGroup();
  } else {
    this._removeGroup();
  }
};

CommandGroup.prototype._addGroup = function() {
  if (!this.isActive) {
    this.isActive = true;
    // Add this CommandGroup to each key combination that it recognizes.
    for (var key in this.knownKeys) {
      (_allKeys[key] || (_allKeys[key] = [])).push(this);
    }
    // Add this CommandGroup to each command that it implements.
    for (var name in this.commands) {
      allCommands[name]._addGroup(this);
    }
  }
};

CommandGroup.prototype._removeGroup = function() {
  if (this.isActive) {
    // On disposal, remove the CommandGroup from all the commands and keys.
    for (var key in this.knownKeys) {
      gutil.arrayRemove(_allKeys[key], this);
    }
    for (var name in this.commands) {
      allCommands[name]._removeGroup(this);
    }
    this.isActive = false;
  }
};

/**
 * Attach this CommandGroup to a DOM element, to allow it to accept key events, limiting them to
 * this group only. This is useful for inputs and textareas, where only a limited set of keyboard
 * shortcuts should be applicable and where by default mousetrap ignores shortcuts completely.
 *
 * See also stopCallback in app/client/lib/Mousetrap.js.
 */
CommandGroup.prototype.attach = dom.inlinable(function(elem) {
  Mousetrap.setCustomStopCallback(elem, (combo) => !this.knownKeys.hasOwnProperty(combo));
});

//----------------------------------------------------------------------

/**
 * Tie the button to an command listed in commandList.js, triggering the callback from the
 * currently active CommandLayer (if any), and showing a description and keyboard shortcuts in its
 * tooltip.
 *
 * You may use this inline while building dom, as in
 *      dom('button', commands.setButtomCommand(dom, 'command'))
 */
exports.setButtonCommand = dom.inlinable(function(elem, commandName) {
  var cmd = allCommands[commandName];
  elem.setAttribute('title', cmd.getDesc());
  dom.on(elem, 'click', cmd.run);
});
