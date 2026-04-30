/**
 * Accumulates draft configuration changes from multiple sections,
 * then applies them together. Used by both the setup wizard and the
 * admin panel to batch saves and minimize restarts.
 *
 * Each section registers itself via `addSection()`. The manager
 * tracks aggregate dirty state and provides `applyAll()` to persist
 * everything, restart if needed, and reset dirty tracking.
 *
 * Sections report two things about their draft changes:
 *   - `isDirty`: there is an unsaved change to persist.
 *   - `needsRestart`: the change, once persisted, requires a server
 *     restart to take effect.
 * A section can be dirty without needing a restart -- e.g. a setting
 * stored in the DB that the server picks up live. We still route it
 * through here so the Apply button can save *all* draft changes in
 * one click and so the restart banner only triggers when at least one
 * dirty section actually needs a restart.
 *
 * "Draft" here is an in-memory, session-scoped concept: changes the
 * user has made in the current page load but not yet saved. Not to
 * be confused with `PendingChanges` in `app/common/Install.ts`, which
 * is the server-side durable list of on-restart directives.
 */
import { getHomeUrl } from "app/client/models/AppModel";
import { ConfigAPI } from "app/common/ConfigAPI";

import { Computed, Disposable, Observable } from "grainjs";

/**
 * A human-readable description of a draft change. The `label` is
 * translated (e.g. "Base URL"); the `value` is a literal (e.g. a URL)
 * that shouldn't pass through the translation pipeline.
 */
export interface DraftChangeDescription {
  label: string;
  value: string;
}

export interface ConfigSection {
  /** True when the section's confirmed state differs from the server. */
  isDirty: Computed<boolean>;
  /** True when the section's changes require a server restart to take effect. */
  needsRestart: boolean;
  /**
   * Persist the section's changes to the server and update its own view of
   * the server state so `isDirty` goes false. No-op if not dirty. On error,
   * throws without updating; `isDirty` stays true.
   */
  apply(): Promise<void>;
  /**
   * Describe the draft change for display in the restart banner.
   * Only called when isDirty is true. Re-read whenever any section's
   * `isDirty` fires -- sections whose described value can drift while
   * `isDirty` stays true should toggle `isDirty` to trigger a refresh.
   */
  describeChange(): DraftChangeDescription;
}

export class DraftChangesManager extends Disposable {
  /** List of draft changes, one per dirty section. Drives the banner's bullet list. */
  public readonly changes: Computed<readonly DraftChangeDescription[]>;
  /** True when at least one section has an unsaved change. */
  public readonly hasDraftChanges: Computed<boolean>;
  /** True when at least one dirty section requires a restart to take effect. */
  public readonly needsRestart: Computed<boolean>;

  private _sections: Observable<ConfigSection[]> = Observable.create(this, []);
  private _configAPI = new ConfigAPI(getHomeUrl());
  private _applying = Observable.create<boolean>(this, false);

  constructor() {
    super();
    this.changes = Computed.create(this, use =>
      use(this._sections).filter(s => use(s.isDirty)).map(s => s.describeChange()),
    );
    this.hasDraftChanges = Computed.create(this, use => use(this.changes).length > 0);
    this.needsRestart = Computed.create(this, use =>
      use(this._sections).some(s => use(s.isDirty) && s.needsRestart),
    );
  }

  public addSection(section: ConfigSection) {
    this._sections.set([...this._sections.get(), section]);
  }

  public get isApplying() { return this._applying; }

  public async applyAll(): Promise<void> {
    await this._apply({ restart: true });
  }

  /**
   * Persist all draft changes without restarting. Use when the server
   * can't auto-restart (no supervisor); the user restarts manually.
   */
  public async applyWithoutRestart(): Promise<void> {
    await this._apply({ restart: false });
  }

  private async _apply({ restart }: { restart: boolean }): Promise<void> {
    if (this._applying.get()) { return; }
    this._applying.set(true);
    try {
      // Snapshot labels before apply() -- a section's state can change as
      // it applies, and we want the error message to name the change the
      // user asked for, not whatever it looks like after the attempt.
      const dirty = this._sections.get().filter(s => s.isDirty.get());
      const labels = new Map(dirty.map(s => [s, s.describeChange().label]));

      const failures: { label: string; error: Error }[] = [];
      for (const section of dirty) {
        try {
          await section.apply();
        } catch (err) {
          failures.push({ label: labels.get(section)!, error: err as Error });
        }
      }

      // Only restart when every dirty section succeeded -- a half-applied
      // set would either strand changes behind another restart or look
      // complete when it wasn't.
      if (restart && failures.length === 0 && dirty.some(s => s.needsRestart)) {
        const { id: priorRestartId } = await this._configAPI.getRestartIdentity();
        await this._configAPI.restartServer();
        if (!await this._configAPI.waitUntilReady({ priorRestartId })) {
          throw new Error("Timed out waiting for Grist server to restart");
        }
      }

      if (failures.length > 0) {
        const parts = failures.map(f => `${f.label}: ${f.error.message || String(f.error)}`);
        throw new Error(`Could not apply: ${parts.join("; ")}`);
      }
    } finally {
      if (!this.isDisposed()) { this._applying.set(false); }
    }
  }
}
