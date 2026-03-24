import { makeT } from "app/client/lib/localization";
import { Notifier } from "app/client/models/NotifyModel";
import { visuallyHidden } from "app/client/ui2018/visuallyHidden";

import { Disposable, dom } from "grainjs";
import debounce from "lodash/debounce";

const t = makeT("ScreenReaderAnnouncer");

export class ScreenReaderAnnouncer extends Disposable {
  private readonly _container: HTMLDivElement;
  private _debouncedByKey: Record<string, ReturnType<typeof debounce<(announcements: string[]) => void>>> = {};

  constructor() {
    super();
    this._container = visuallyHidden({
      "id": "screen-reader-announcer",
      "aria-live": "polite",
      "aria-atomic": "false",
    });
    document.body.appendChild(this._container);
    this.onDispose(() => {
      dom.domDispose(this._container);
      this._container.remove();
      Object.values(this._debouncedByKey).forEach(debouncedFunction => debouncedFunction.cancel());
      this._debouncedByKey = {};
    });
  }

  /**
   * Announces the given string or array of strings to screen reader users.
   *
   * If the thing you announce risks being announced multiple times in rapid succession for wrong reasons
   * (example: state moves quickly while the app loading until it's stable), you can pass a `key` to
   * prevent the intermediate announcements from being actually vocalized. Announcements are debounced per key.
   */
  public announce(announcements: string | string[], key: string = "default") {
    if (!this._debouncedByKey[key]) {
      this._debouncedByKey[key] = debounce((messages: string[]) => this._announce(messages), 100);
    }
    this._debouncedByKey[key](Array.isArray(announcements) ? announcements : [announcements]);
  }

  public listenToNotifier(notifier: Notifier) {
    const { toasts } = notifier.getStateForUI();
    this.autoDispose(toasts.addListener((newToasts) => {
      for (const toast of newToasts) {
        const { title, message } = toast.options;
        this.announce(
          t("Notification: {{notification}}", { notification: `${title ? `${title} - ` : ""}${message}` }),
          toast.options.key ? `toast-${toast.options.key}` : undefined,
        );
      }
    }));
  }

  private _announce(announcements: string[]) {
    if (!announcements.length) {
      return;
    }
    // Since aria-live regions strip HTML semantics, we play with punctuation to help SRs make pauses at the right
    // time when announcing multiple things in a row:
    // - we add a comma between each "part of announcement"
    // - we add a period after each "pack of announcements" if none is present
    let toAnnounce = announcements.join(", ");
    if (!toAnnounce.endsWith(".")) {
      toAnnounce += ".";
    }
    this._container.appendChild(dom("div", toAnnounce));

    // Make sure the DOM doesn't get too big
    while (this._container.children.length > 10) {
      this._container.removeChild(this._container.firstChild!);
    }
  }
}
