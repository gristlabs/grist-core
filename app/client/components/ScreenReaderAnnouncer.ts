import { makeT } from "app/client/lib/localization";
import { Notifier } from "app/client/models/NotifyModel";
import { visuallyHidden } from "app/client/ui2018/visuallyHidden";

import { Disposable, dom } from "grainjs";
import debounce from "lodash/debounce";

const t = makeT("ScreenReaderAnnouncer");

export class ScreenReaderAnnouncer extends Disposable {
  private readonly _container: HTMLDivElement;
  private _debouncedByKey: Record<string, ReturnType<typeof debounce<(announcements: string[]) => void>>> = {};
  private _debouncedCleanup: ReturnType<typeof debounce<() => void>>;

  constructor() {
    super();

    this._container = visuallyHidden({
      "id": "screen-reader-announcer",
      "role": "region",
      "aria-live": "polite",
      "aria-atomic": "false",
      // This is not supported by all screen readers but it helps with some of them.
      "aria-relevant": "additions",
    });

    this._debouncedCleanup = debounce(() => this._cleanup(), 1000);

    document.body.appendChild(this._container);

    this.onDispose(() => {
      dom.domDispose(this._container);
      this._container.remove();
      Object.values(this._debouncedByKey).forEach(debouncedFunction => debouncedFunction.cancel());
      this._debouncedByKey = {};
      this._debouncedCleanup.cancel();
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
      this._debouncedByKey[key] = debounce((messages: string[]) => this._announce(messages), 350);
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

    // Cancel the potential ongoing cleanup process so that it doesn't interfere with the new announcement.
    this._debouncedCleanup.cancel();

    // Since aria-live regions strip HTML semantics, we play with punctuation to help SRs make pauses at the right
    // time when announcing multiple things in a row. We add a comma every time we want the SR to make a brief pause.
    // Be careful if you change this. The "," char was picked after careful testing across different screen readers.
    let toAnnounce = announcements.map(a => a.trim()).join(", ");
    const endCharacters = ".!,:?;";
    if (!endCharacters.includes(toAnnounce.at(-1)!)) {
      toAnnounce += ",";
    }
    this._container.appendChild(dom("div", toAnnounce));

    // Schedule a cleanup process that will happen after a tiny pause if no new announcement is made.
    this._debouncedCleanup();
  }

  /**
   * Remove the content of the announcer div if it has more than 10 children.
   *
   * This is meant to be called regularly, to prevent the DOM from getting too big.
   */
  private _cleanup() {
    // We could just cleanup directly instead of checking for children count first, but it's pretty handy when
    // developing to have a recent history of announcements.
    if (this._container.children.length <= 10) {
      return;
    }
    // The "clean up" is done through *removing all children*, and not another way, on purpose. Changing content of an
    // `aria-live` region is rather sensitive, and doing it wrong can lead to major announcement issues from some SRs.
    // You should test the behavior manually with NVDA, JAWS and VoiceOver if you change this.
    this._container.innerHTML = "";
  }
}
