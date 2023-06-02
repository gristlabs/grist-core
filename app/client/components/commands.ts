/**
 * Commands are invoked by the user via keyboard shortcuts or mouse clicks, for example, to move
 * the cursor or to delete the selected records.
 *
 * This module provides APIs for other components to implement groups of commands. Any given
 * command may be implemented by different components, but at most one implementation of any
 * command is active at any time.
 */

import * as Mousetrap from 'app/client/lib/Mousetrap';
import {arrayRemove, unwrap} from 'app/common/gutil';
import dom from 'app/client/lib/dom';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {CommandDef, CommandName, CommendGroupDef, groups} from 'app/client/components/commandList';

import {Disposable, Observable} from 'grainjs';
import * as _ from 'underscore';
import * as ko from 'knockout';

const G = getBrowserGlobals('window');
type BoolLike = boolean|ko.Observable<boolean>|ko.Computed<boolean>|Observable<boolean>;

/**
 * A helper method that can create a subscription to ko or grains observables.
 */
function subscribe(value: Exclude<BoolLike, boolean>, fn: (value: boolean) => void) {
  if (ko.isObservable(value)) {
    return value.subscribe(fn);
  } else if (value instanceof Observable) {
    return value.addListener(fn);
  } else {
    throw new Error('Expected an observable');
  }
}

// Same logic as used by mousetrap to map 'Mod' key to platform-specific key.
export const isMac = (typeof navigator !== 'undefined' && navigator &&
               /Mac|iPod|iPhone|iPad/.test(navigator.platform));

/**
 * Globally-exposed map of command names to Command objects. E.g. typing "cmd.cursorDown.run()" in
 * the browser console should move the cursor down as long as it makes sense in the currently
 * shown view. If the command is inactive, its run() function is a no-op.
 *
 * See also Command object below.
 */
export const allCommands: { [key in CommandName]: Command } = {} as any;

/**
 * This is an internal variable, mapping key combinations to the stack of CommandGroups which
 * include them (see also CommandGroup.knownKeys). It's used for deciding which CommandGroup to
 * use when different Commands use the same key.
 */
const _allKeys: Record<string, CommandGroup[]> = {};

/**
 * Populate allCommands from those provided, or listed in commandList.js. Also populates the
 * globally exposed `cmd` object whose properties invoke commands: e.g. typing `cmd.cursorDown` in
 * the browser console will run allCommands.cursorDown.run().
 */
export function init(optCommandGroups?: CommendGroupDef[]) {
  const commandGroups = optCommandGroups || groups;

  // Clear out the objects holding the global state.
  Object.keys(allCommands).forEach(function(c) {
    delete allCommands[c as CommandName];
  });
  Object.keys(_allKeys).forEach(function(k) {
    delete _allKeys[k as CommandName];
  });

  commandGroups.forEach(function(commandGroup) {
    commandGroup.commands.forEach(function(c) {
      if (allCommands[c.name]) {
        console.error("Ignoring duplicate command %s in commandList", c.name);
      } else {
        allCommands[c.name] = new Command(c.name, c.desc, c.keys, {
          bindKeys: c.bindKeys,
          deprecated: c.deprecated,
        });
      }
    });
  });

  // Define the browser console interface.
  G.window.cmd = {};
  _.each(allCommands, function(cmd, name) {
    Object.defineProperty(G.window.cmd, name, {get: cmd.run});
  });
}

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

export function getHumanKey(key: string, mac: boolean): string {
  const keyMap = mac ? KEY_MAP_MAC : KEY_MAP_WIN;
  let keys = key.split('+').map(s => s.trim());
  keys = keys.map(k => {
    if (k in keyMap) { return (keyMap as any)[k]; }
    if (k.length === 1) { return k.toUpperCase(); }
    return k;
  });
  return keys.join( mac ? '' : ' + ');
}

export interface CommandOptions {
  bindKeys?: boolean;
  deprecated?: boolean;
}

/**
 * Command represents a single command. It is exposed via the `allCommands` map.
 * @property {String} name: The name of the command, same as the key into the `allCommands` map.
 * @property {String} desc: The description of the command.
 * @property {Array}  keys: The array of keyboard shortcuts for the command.
 * @property {Function} run: A bound function that will run the currently active implementation.
 * @property {Observable} isActive: Knockout observable for whether this command is active.
 */
export class Command implements CommandDef {
  public name: CommandName;
  public desc: string|null;
  public humanKeys: string[];
  public keys: string[];
  public bindKeys: boolean;
  public isActive: ko.Observable<boolean>;
  public deprecated: boolean;
  public run: (...args: any[]) => any;
  private _implGroupStack: CommandGroup[] = [];
  private _activeFunc: (...args: any[]) => any = _.noop;

  constructor(name: CommandName, desc: string|null, keys: string[], options: CommandOptions = {}) {
    this.name = name;
    this.desc = desc;
    this.humanKeys = keys.map(key => getHumanKey(key, isMac));
    this.keys = keys.map(function(k) { return k.trim().toLowerCase().replace(/ *\+ */g, '+'); });
    this.bindKeys = options.bindKeys ?? true;
    this.isActive = ko.observable(false);
    this._implGroupStack = [];
    this._activeFunc = _.noop; // The function to run when this command is invoked.
    this.deprecated = options.deprecated || false;
    // Let .run bind the Command object, so that it can be used as a stand-alone callback.
    this.run = this._run.bind(this);
  }
  /**
   * Returns a comma-separated string of all keyboard shortcuts, or `null` if no
   * shortcuts exist.
   */
  public getKeysDesc() {
    if (this.humanKeys.length === 0) { return null; }

    return `(${this.humanKeys.join(', ')})`;
  }
  /**
   * Returns the text description for the command, including the keyboard shortcuts.
   */
  public getDesc() {
    const parts = [this.desc];

    const keysDesc = this.getKeysDesc();
    if (keysDesc) { parts.push(keysDesc); }

    return parts.join(' ');
  }
  /**
   * Returns DOM for the keyboard shortcuts, wrapped in cute boxes that look like keyboard keys.
   */
  public getKeysDom(separator?: ko.Observable<string>) {
    return dom('span.shortcut_keys',
      separator ? this.humanKeys.map((key, i) => [i ? separator() : null, dom('span.shortcut_key_image', key)])
        : this.humanKeys.map(key => dom('span.shortcut_key_image', key))
    );
  }
  /**
   * Adds a CommandGroup that implements this Command to the top of the stack of groups.
   */
  public addGroup(cmdGroup: CommandGroup) {
    this._implGroupStack.push(cmdGroup);
    this._updateActive();
  }
  /**
   * Removes a CommandGroup from the stack of groups implementing this Command.
   */
  public removeGroup(cmdGroup: CommandGroup) {
    arrayRemove(this._implGroupStack, cmdGroup);
    this._updateActive();
  }
  /**
   * Updates the command's state to reflect the currently active group, if any.
   */
  private _updateActive() {
    if (this._implGroupStack.length > 0) {
      this.isActive(true);
      this._activeFunc = _.last(this._implGroupStack)!.commands[this.name];
    } else {
      this.isActive(false);
      this._activeFunc = _.noop;
    }

    if (this.bindKeys) {
      // Now bind or unbind the affected key combinations.
      this.keys.forEach(function(key) {
        const keyGroups = _allKeys[key];
        if (keyGroups && keyGroups.length > 0) {
          const commandGroup = _.last(keyGroups)!;
          // Command name might be different from this.name in case we are deactivating a command, and
          // the previous meaning of the key points to a different command.
          const commandName = commandGroup.knownKeys[key];
          Mousetrap.bind(key, wrapKeyCallback(commandGroup.commands[commandName]));
        } else {
          Mousetrap.unbind(key);
        }
      });
    }
  }

  private _run(...args: any[]) {
    return this._activeFunc(...args);
  }
}

/**
 * Helper for mousetrap callbacks, which returns a version of the callback that by default stops
 * the propagation of the keyboard event (unless the callback returns a true value).
 */
function wrapKeyCallback(callback: Func) {
  return function() {
    return callback(...arguments) || false;
  };
}

//----------------------------------------------------------------------

type Func = (...args: any[]) => any;
type CommandMap = { [key in CommandName]?: Func };

/**
 * CommandGroup is the way for other components to provide implementations for a group of
 * commands. Note that CommandGroups are stacked, with groups activated later having priority over
 * groups activated earlier.
 * @param {String->Function} commands: The map of command names to implementations.
 * @param {Object} context: "this" context with which to invoke implementation functions.
 * @param {Boolean|Observable<boolean>} activate: Whether to activate this group immediately, false if
 *      omitted. This may be an Observable.
 */
export class CommandGroup extends Disposable {
  public commands: Record<string, Func>;
  public isActive: boolean;
  public knownKeys: Record<string, string>;
  /**
   * Attach this CommandGroup to a DOM element, to allow it to accept key events, limiting them to
   * this group only. This is useful for inputs and textareas, where only a limited set of keyboard
   * shortcuts should be applicable and where by default mousetrap ignores shortcuts completely.
   *
   * See also stopCallback in app/client/lib/Mousetrap.js.
   */
  public attach = dom.inlinable(function(this: any, elem: any) {
    Mousetrap.setCustomStopCallback(elem, (combo: any) => !this.knownKeys.hasOwnProperty(combo));
  });

  constructor(commands: CommandMap, context: any, activate?: BoolLike) {
    super();
    // Keep only valid commands, so that we don't have to check for validity elsewhere, and bind
    // each to the passed-in context object.
    this.commands = {};
    this.isActive = false;

    for (const name in commands) {
      if (allCommands[name as CommandName]) {
        this.commands[name] = commands[name as CommandName]!.bind(context);
      } else {
        console.warn("Ignoring unknown command %s", name);
      }
    }

    // Map recognized key combinations to the corresponding command names.
    this.knownKeys = {};
    for (const name in this.commands) {
      const keys = allCommands[name as CommandName]!.keys;
      for (let i = 0; i < keys.length; i++) {
        this.knownKeys[keys[i]] = name;
      }
    }

    // On disposal, remove the CommandGroup from all the commands and keys.
    this.onDispose(this._removeGroup.bind(this));

    // Finally, set the activation status of the command group, subscribing if an observable.
    if (typeof activate === 'boolean' || activate === undefined) {
      this.activate(activate ?? false);
    } else if (activate) {
      this.autoDispose(subscribe(activate, (val) => this.activate(val)));
      this.activate(unwrap(activate));
    }
  }

  /**
   * Activate or deactivate this implementation group.
   */
  public activate(yesNo: boolean) {
    if (yesNo) {
      this._addGroup();
    } else {
      this._removeGroup();
    }
  }

  private _addGroup() {
    if (!this.isActive) {
      this.isActive = true;
      // Add this CommandGroup to each key combination that it recognizes.
      for (const key in this.knownKeys) {
        (_allKeys[key] || (_allKeys[key] = [])).push(this);
      }
      // Add this CommandGroup to each command that it implements.
      for (const name in this.commands) {
        allCommands[name as CommandName]!.addGroup(this);
      }
    }
  }
  private _removeGroup() {
    if (this.isActive) {
      // On disposal, remove the CommandGroup from all the commands and keys.
      for (const key in this.knownKeys) {
        arrayRemove(_allKeys[key], this);
      }
      for (const name in this.commands) {
        allCommands[name as CommandName]!.removeGroup(this);
      }
      this.isActive = false;
    }
  }
}


type BoundedFunc<T> = (this: T, ...args: any[]) => any;
type BoundedMap<T> = { [key in CommandName]?: BoundedFunc<T> };

/**
 * Just a shorthand for CommandGroup.create constructor.
 */
export function createGroup<T>(commands: BoundedMap<T>|null, context: T, activate?: BoolLike) {
  return CommandGroup.create(null, commands ?? {}, context, activate);
}

//----------------------------------------------------------------------

/**
 * Tie the button to an command listed in commandList.js, triggering the callback from the
 * currently active CommandLayer (if any), and showing a description and keyboard shortcuts in its
 * tooltip.
 *
 * You may use this inline while building dom, as in
 *      dom('button', commands.setButtonCommand(dom, 'command'))
 */
export const setButtonCommand = dom.inlinable(function(elem: Element, commandName: CommandName) {
  const cmd = allCommands[commandName]!;
  elem.setAttribute('title', cmd.getDesc());
  dom.on(elem, 'click', cmd.run);
});
