/**
 * Accumulates draft configuration changes from multiple sections,
 * then applies them together. Used by both the setup wizard and the
 * admin panel to batch saves and minimize restarts.
 *
 * Each section registers itself via `addSection()`. The manager
 * tracks aggregate dirty state and provides `applyAll()` to persist
 * everything, restart if needed, and reset dirty tracking.
 *
 * "Draft" here is an in-memory, session-scoped concept: changes the
 * user has made in the current page load but not yet saved. Not to
 * be confused with `PendingChanges` in `app/common/Install.ts`, which
 * is the server-side durable list of on-restart directives.
 */
import { getHomeUrl } from "app/client/models/AppModel";
import { ConfigAPI } from "app/common/ConfigAPI";
import { delay } from "app/common/delay";

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
  /** Persist this section's changes to the server. No-op if not dirty. */
  apply(): Promise<void>;
  /** Update internal tracking so isDirty becomes false. */
  markApplied(): void;
  /**
   * Describe the draft change for display in the restart banner.
   * Only called when isDirty is true. Re-read whenever any section's
   * `isDirty` fires -- sections whose described value can drift while
   * `isDirty` stays true should toggle `isDirty` to trigger a refresh.
   */
  describeChange?(): DraftChangeDescription;
}

/**
 * Thrown by `applyAll` / `applyWithoutRestart` when one or more sections
 * failed to persist. Successful sections will already have been marked
 * applied by the time this is thrown; only the listed `failures` remain
 * dirty. When `restartSkipped` is true, the manager declined to restart
 * the server because the set of changes wasn't fully applied.
 */
export class PartialApplyError extends Error {
  public readonly name = "PartialApplyError";

  constructor(
    public readonly failures: readonly { label: string; error: Error }[],
    public readonly restartSkipped: boolean,
  ) {
    const parts = failures.map(f => `${f.label}: ${f.error.message || String(f.error)}`);
    const prefix = failures.length === 1 ?
      "Could not apply change" :
      `Could not apply ${failures.length} changes`;
    const suffix = restartSkipped ? " -- server was not restarted" : "";
    super(`${prefix}${suffix}: ${parts.join("; ")}`);
  }
}

/** Aggregate state across all registered sections, recomputed whenever any section's `isDirty` flips. */
export interface DraftState {
  hasDraftChanges: boolean;
  needsRestart: boolean;
  changes: DraftChangeDescription[];
}

const EMPTY_STATE: DraftState = { hasDraftChanges: false, needsRestart: false, changes: [] };

export class DraftChangesManager extends Disposable {
  /**
   * Aggregate draft-state derived from all registered sections. Readers
   * bind to `state` for reactive UI, or to the convenience projections
   * (`hasDraftChanges`, `needsRestart`, `changes`) that unwrap fields.
   */
  public readonly state: Computed<DraftState>;
  public readonly hasDraftChanges: Computed<boolean>;
  public readonly needsRestart: Computed<boolean>;
  public readonly changes: Computed<DraftChangeDescription[]>;

  private _sections: Observable<ConfigSection[]> = Observable.create(this, []);
  private _configAPI = new ConfigAPI(getHomeUrl());
  private _applying = Observable.create<boolean>(this, false);

  constructor() {
    super();
    this.state = Computed.create(this, (use) => {
      const dirty = use(this._sections).filter(s => use(s.isDirty));
      if (dirty.length === 0) { return EMPTY_STATE; }
      return {
        hasDraftChanges: true,
        needsRestart: dirty.some(s => s.needsRestart),
        changes: dirty.flatMap(s => s.describeChange ? [s.describeChange()] : []),
      };
    });
    this.hasDraftChanges = Computed.create(this, use => use(this.state).hasDraftChanges);
    this.needsRestart = Computed.create(this, use => use(this.state).needsRestart);
    this.changes = Computed.create(this, use => use(this.state).changes);
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

  /** One-shot accessor; prefer binding to `state`/`changes` for reactive UI. */
  public describeChanges(): DraftChangeDescription[] {
    return this.state.get().changes;
  }

  private async _apply({ restart }: { restart: boolean }): Promise<void> {
    if (this._applying.get()) { return; }
    this._applying.set(true);
    try {
      // Apply sections sequentially so one section's failure doesn't leave
      // another mid-flight. We collect per-section outcomes and only mark
      // successful ones applied -- any failure keeps its section dirty so the
      // UI stays aligned with the server and the user can retry.
      const dirty = this._sections.get().filter(s => s.isDirty.get());
      const applied: ConfigSection[] = [];
      const failures: { label: string; error: Error }[] = [];

      for (const section of dirty) {
        try {
          await section.apply();
          applied.push(section);
        } catch (err) {
          failures.push({
            label: section.describeChange?.().label ?? "change",
            error: err as Error,
          });
        }
      }

      // Reflect DB state: sections that persisted successfully should appear
      // clean regardless of whether a peer failed.
      for (const section of applied) {
        section.markApplied();
      }

      // Only restart when every dirty section succeeded. Restarting with a
      // half-applied set would either strand draft changes behind another
      // restart (if we re-try later) or advertise the run as complete when
      // it isn't. Better to require retry first.
      if (restart && failures.length === 0 && applied.some(s => s.needsRestart)) {
        await this._configAPI.restartServer();
        await this._waitForServer();
      }

      if (failures.length > 0) {
        throw new PartialApplyError(failures, restart && dirty.some(s => s.needsRestart));
      }
    } finally {
      this._applying.set(false);
    }
  }

  private async _waitForServer() {
    for (let i = 0; i < 30; i++) {
      try {
        await this._configAPI.healthcheck();
        return;
      } catch {
        await delay(1000);
      }
    }
    throw new Error("Timed out waiting for Grist server to restart");
  }
}
