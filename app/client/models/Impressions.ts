import { AppModel } from "app/client/models/AppModel";
import { Impression } from "app/common/Prefs";

import { Disposable } from "grainjs";

/**
 * The number of impressions after which the user is considered familiar with
 * something, and it should no longer be shown (e.g. an intro animation).
 *
 * Counts stop being incremented once they reach this number.
 */
const MAX_IMPRESSIONS: Record<Impression, number> = {
  assistantIntro: 10,
};

/**
 * Tracks how many times the user has seen or interacted with things.
 */
export class Impressions extends Disposable {
  private _initialCounts = { ...this._appModel.userPrefsObs.get().impressions };
  private _incremented = new Set<Impression>();

  constructor(private _appModel: AppModel) {
    super();
  }

  /**
   * Returns the number of times the user has seen or interacted with {@link key}.
   */
  public getCount(key: Impression): number {
    return this._initialCounts[key] ?? 0;
  }

  /**
   * Returns whether {@link key} should still be shown to the user (i.e. whether they've
   * seen or interacted with it fewer times than its entry in {@link MAX_IMPRESSIONS}).
   */
  public shouldShow(key: Impression): boolean {
    return this.getCount(key) < MAX_IMPRESSIONS[key];
  }

  /**
   * Increments the number of times the user has seen or interacted with {@link key},
   * up to the maximum tracked for it.
   *
   * Does nothing if already called once for a given {@link key}.
   */
  public incrementCount(key: Impression) {
    if (this._incremented.has(key)) { return; }

    this._incremented.add(key);

    if (!this.shouldShow(key)) { return; }

    const count = this.getCount(key);
    const prefs = this._appModel.userPrefsObs.get();
    this._appModel.userPrefsObs.set({
      ...prefs,
      impressions: { ...prefs.impressions, [key]: count + 1 },
    });
  }
}
