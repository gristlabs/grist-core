import { AppModel } from "app/client/models/AppModel";
import { Impression } from "app/common/Prefs";

import { Disposable } from "grainjs";

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
   * Increments the number of times the user has seen or interacted with {@link key},
   * up to the specified {@link max}.
   *
   * Does nothing if already called once for a given {@link key}.
   */
  public incrementCount(key: Impression, max: number) {
    if (this._incremented.has(key)) { return; }

    this._incremented.add(key);

    const count = this.getCount(key);
    if (count >= max) { return; }

    const prefs = this._appModel.userPrefsObs.get();
    this._appModel.userPrefsObs.set({
      ...prefs,
      impressions: { ...prefs.impressions, [key]: count + 1 },
    });
  }
}
