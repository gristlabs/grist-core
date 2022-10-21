import * as commands from 'app/client/components/commands';
import {Command} from 'app/client/components/commands';
import {markAsSeen} from 'app/client/models/UserPrefs';
import {get as getBrowserGlobals} from 'app/client/lib/browserGlobals';
import {reportMessage} from 'app/client/models/errors';
import {DeprecationWarning} from 'app/common/Prefs';
import {GristDoc} from 'app/client/components/GristDoc';
import {showDeprecatedWarning} from 'app/client/components/modals';
import {Disposable, dom, Holder, styled} from 'grainjs';
import intersection from "lodash/intersection";

const G = getBrowserGlobals('document', 'window');

/**
 * Manages deprecated commands and keyboard shortcuts. It subscribes itself to all commands and
 * keyboard shortcuts, and shows a warning when a deprecated command is used.
 */
export class DeprecatedCommands extends Disposable {
  // Holds the commands created by this class, so they can be disposed,
  // when this class is disposed or reattached.
  private _holder = Holder.create(this);

  constructor(private _gristDoc: GristDoc) {
    super();
    G.window.resetSeenWarnings = () => {};
  }

  public attach() {
    // We can be attached multiple times, so first clear previous commands.
    this._holder.clear();

    // Get all the warnings from the app model and expose reset function (used in tests only).
    // When we reset the warnings, we also need to reattach ourselves.
    const seenWarnings = this._gristDoc.docPageModel.appModel.deprecatedWarnings;
    G.window.resetSeenWarnings = () => {
      if (!this._gristDoc.isDisposed()) {
        seenWarnings.set([]);
        this.attach();
      }
    };

    // We wan't do anything for anonymous users.
    if (!this._gristDoc.docPageModel.appModel.currentValidUser) {
      return;
    }

    // If user has seen all keyboard warnings, don't need to do anything.
    const commandList = Object.values(commands.allCommands as Record<string, Command>);
    const deprecatedCommands = commandList.filter((command) => command.deprecated);
    const deprecatedNames = deprecatedCommands.map((command) => command.name);
    if (intersection(seenWarnings.get(), deprecatedNames).length === deprecatedNames.length) {
      return;
    }

    // Now subscribe to all the commands and handle them.
    const group: any = {};
    for (const c of deprecatedCommands) {
      group[c.name] = this._handleCommand.bind(this, c);
    }
    if (Object.keys(group).length) {
      this._holder.autoDispose(commands.createGroup(group, this, true));
    }
  }

  private _handleCommand(c: Command) {
    const seenWarnings = this._gristDoc.docPageModel.appModel.deprecatedWarnings;
    if (!this._hasSeenWarning(c.name)) {
      markAsSeen(seenWarnings, c.name);
      this._showWarning(c.desc);
      return false; // Stop processing.
    } else {
      return true; // Continue processing.
    }
  }

  private _showWarning(desc: string) {
    // Try to figure out where to show the message. If we have active view, we can try
    // to find the selected cell and show the message there. Otherwise, we show it in the
    // bottom right corner as a warning.
    const selectedCell = this._gristDoc.currentView.get()?.viewPane.querySelector(".selected_cursor");
    if (!selectedCell) {
      reportMessage(() => dom('div', this._createMessage(desc)), {
        level: 'info',
        key: 'deprecated-command',
      });
    } else {
      showDeprecatedWarning(selectedCell, this._createMessage(desc));
    }
  }

  private _hasSeenWarning(name: string) {
    const seenWarnings = this._gristDoc.docPageModel.appModel.deprecatedWarnings;
    const preference = seenWarnings.get() ?? [];
    return preference.includes(DeprecationWarning.check(name));
  }

  private _createMessage(description: string) {
    const elements: Node[] = [];
    // Description can have embedded commands in the form of {commandName}.
    // To construct message we need to replace all {name} to key strokes dom.
    for (const part of description.split(/({\w+})/g)) {
      // If it starts with {
      if (part[0] === '{') {
        const otherCommand = commands.allCommands[part.slice(1, -1)];
        if (otherCommand) {
          elements.push(otherCommand.getKeysDom());
        }
      } else {
        elements.push(cssTallerText(part));
      }
    }
    return elements;
  }
}

const cssTallerText = styled('span', `
  line-height: 24px;
`);
