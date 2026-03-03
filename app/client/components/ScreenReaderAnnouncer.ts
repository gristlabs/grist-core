import { Notifier } from "app/client/models/NotifyModel";
import { visuallyHidden } from "app/client/ui2018/visuallyHidden";

import { Disposable, dom } from "grainjs";

export class ScreenReaderAnnouncer extends Disposable {
  private readonly _container: HTMLDivElement;

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
    });
  }

  /**
   * Announces the given things to screen reader users.
   *
   * You can pass simple strings, or DOM elements. null values are accepted and silently skipped
   * to easily pass results of querySelector.
   *
   * Passing DOM elements is useful to make the screen reader vocalize structured content like headings, lists, etc.
   */
  public announce(...elems: (HTMLElement | null | string)[]) {
    for (const elem of elems) {
      if (!elem) {
        continue;
      }
      // We append things to have some sort of announcement queue, instead of replacing content directly,
      // in case we want to announce different things at seemingly the same time.
      this._container.appendChild(
        elem instanceof HTMLElement ? elem.cloneNode(true) : dom("span", elem),
      );
      // Make sure the DOM doesn't get too big
      while (this._container.children.length > 10) {
        this._container.removeChild(this._container.firstChild!);
      }
    }
  }
}
