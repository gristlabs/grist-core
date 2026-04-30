import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/AppModel";
import { getHomeUrl } from "app/client/models/homeUrl";
import { ConfigSection, DraftChangeDescription } from "app/client/ui/DraftChanges";
import { InstallAPI, InstallAPIImpl, PermissionsStatus } from "app/common/InstallAPI";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, Observable } from "grainjs";

const t = makeT("PermissionsToggleModel");

/**
 * Shared model for the four install-wide permission toggles
 * (team sites / personal sites / anon access / playground).
 *
 * Used by both QuickSetup's "Apply & Restart" card and the admin
 * panel's Security Settings rows. Owns loading from the server,
 * dirty tracking against server values, env-locked detection,
 * preset application, and the `apply()` that persists changes.
 *
 * Implements ConfigSection so it can be registered with the admin
 * panel's DraftChangesManager and participate in the unified
 * Apply + Restart banner.
 */
export class PermissionsToggleModel extends Disposable implements ConfigSection {
  /** Toggle env-var changes only take effect after a restart. */
  public readonly needsRestart = true;

  /** Current loading status. */
  public readonly status = Observable.create<PermissionsStatus | null>(this, null);

  /** Live toggle values (what the UI binds to). */
  public readonly toggles: Record<ToggleKey, Observable<boolean>> = {
    teamSites: Observable.create<boolean>(this, false),
    personalSites: Observable.create<boolean>(this, false),
    anonAccess: Observable.create<boolean>(this, false),
    playground: Observable.create<boolean>(this, false),
  };

  /** True when any toggle has drifted from its server value. */
  public readonly isDirty: Computed<boolean>;

  /** Which preset, if any, the current toggle state matches. Null if none. */
  public readonly presetDetector: Computed<PresetName | null>;

  /** Resolves after the initial server fetch lands in `status`. */
  public readonly loaded: Promise<void>;

  // Last known server value for each toggle. Used for dirty tracking and
  // for `describeChange()` so the banner shows the new value, not the old.
  private _serverValues: Record<ToggleKey, Observable<boolean>> = {
    teamSites: Observable.create<boolean>(this, false),
    personalSites: Observable.create<boolean>(this, false),
    anonAccess: Observable.create<boolean>(this, false),
    playground: Observable.create<boolean>(this, false),
  };

  private _installAPI: InstallAPI;

  constructor(opts: { installAPI?: InstallAPI } = {}) {
    super();
    this._installAPI = opts.installAPI ?? new InstallAPIImpl(getHomeUrl());

    this.loaded = this._load();
    this.loaded.catch(reportError);

    this.isDirty = Computed.create(this, (use) => {
      const status = use(this.status);
      if (!status) { return false; }
      return TOGGLE_DEFS.some(({ key }) => {
        if (this._isEnvLocked(status, key)) { return false; }
        return use(this.toggles[key]) !== use(this._serverValues[key]);
      });
    });

    this.presetDetector = Computed.create(this, (use) => {
      const status = use(this.status);
      for (const [name, values] of PRESET_ENTRIES) {
        if (values.every(([k, v]) => {
          if (status && this._isEnvLocked(status, k)) { return true; }
          return use(this.toggles[k]) === v;
        })) {
          return name;
        }
      }
      return null;
    });
  }

  /** Apply a named preset, skipping env-locked toggles (they can't change). */
  public applyPreset(preset: PresetName): void {
    const status = this.status.get();
    for (const [toggleName, toggleValue] of Object.entries(PRESETS[preset])) {
      const key = toggleName as ToggleKey;
      if (status && this._isEnvLocked(status, key)) { continue; }
      this.toggles[key].set(toggleValue);
    }
  }

  public isEnvLocked(key: ToggleKey): boolean {
    const status = this.status.get();
    return !!status && this._isEnvLocked(status, key);
  }

  /**
   * Whether the given toggle is forced-on by a deployment constraint
   * (currently: GRIST_SINGLE_ORG=docs makes the personal org load-bearing).
   */
  public hasConflict(key: ToggleKey): boolean {
    return key === "personalSites" && getGristConfig().singleOrg === "docs";
  }

  // Always persists the current toggle values, even when they match the
  // current server state. The QuickSetup "Go Live" flow calls this with
  // whatever preset the user picked, which may be identical to defaults
  // but should still be committed as an explicit preference. The admin
  // panel routes through DraftChangesManager, which only calls apply()
  // on dirty sections, so the unconditional write is harmless there.
  public async apply(): Promise<void> {
    await this._installAPI.updateInstallPrefs({
      envVars: {
        GRIST_ORG_CREATION_ANYONE: String(this.toggles.teamSites.get()),
        GRIST_PERSONAL_ORGS: String(this.toggles.personalSites.get()),
        GRIST_FORCE_LOGIN: String(!this.toggles.anonAccess.get()),
        GRIST_ANON_PLAYGROUND: String(this.toggles.playground.get()),
      },
    });
    if (this.isDisposed()) { return; }
    for (const { key } of TOGGLE_DEFS) {
      this._serverValues[key].set(this.toggles[key].get());
    }
  }

  public describeChange(): DraftChangeDescription {
    const changed = TOGGLE_DEFS
      .filter(({ key }) => !this.isEnvLocked(key))
      .filter(({ key }) => this.toggles[key].get() !== this._serverValues[key].get())
      .map(({ key, label }) => `${label()}: ${this.toggles[key].get() ? t("on") : t("off")}`);
    return { label: t("Permissions"), value: changed.join(", ") };
  }

  private async _load(): Promise<void> {
    const s = await this._installAPI.getPermissionsStatus();
    if (this.isDisposed()) { return; }
    this._setBoth("teamSites", s.orgCreationAnyone.value ?? true);
    this._setBoth("personalSites", s.personalOrgs.value ?? true);
    this._setBoth("anonAccess", !(s.forceLogin.value ?? false));
    this._setBoth("playground", s.anonPlayground.value ?? true);
    this.status.set(s);
  }

  private _setBoth(key: ToggleKey, value: boolean): void {
    if (this.toggles[key].get() !== value) { this.toggles[key].set(value); }
    if (this._serverValues[key].get() !== value) { this._serverValues[key].set(value); }
  }

  private _isEnvLocked(status: PermissionsStatus, toggleKey: ToggleKey): boolean {
    const def = TOGGLE_DEF_BY_KEY.get(toggleKey);
    return !!def && status[def.permKey].source === "environment-variable";
  }
}

export type ToggleKey = "teamSites" | "personalSites" | "anonAccess" | "playground";
export type PresetName = "locked" | "recommended" | "open";
export type PermissionKey = keyof Omit<PermissionsStatus, "singleOrg">;

export interface ToggleDef {
  key: ToggleKey;
  permKey: PermissionKey;
  envVar: string;
  label: () => string;
  description: () => string;
}

export const PRESETS: Record<PresetName, Record<ToggleKey, boolean>> = {
  locked: { teamSites: false, personalSites: false, anonAccess: false, playground: false },
  recommended: { teamSites: false, personalSites: true, anonAccess: true, playground: false },
  open: { teamSites: true, personalSites: true, anonAccess: true, playground: true },
};

// Pre-typed entries so the presetDetector Computed doesn't widen back to
// `string` via Object.entries on every recomputation.
const PRESET_ENTRIES: readonly (readonly [PresetName, readonly (readonly [ToggleKey, boolean])[]])[] =
  (Object.entries(PRESETS) as [PresetName, Record<ToggleKey, boolean>][]).map(
    ([name, values]) => [name, Object.entries(values) as [ToggleKey, boolean][]],
  );

export const TOGGLE_DEFS: ToggleDef[] = [
  {
    key: "teamSites",
    permKey: "orgCreationAnyone",
    envVar: "GRIST_ORG_CREATION_ANYONE",
    label: () => t("Allow anyone to create team sites"),
    description: () => t("Any logged-in user can create new team sites. \
Turn off to restrict team creation to admins only."),
  },
  {
    key: "personalSites",
    permKey: "personalOrgs",
    envVar: "GRIST_PERSONAL_ORGS",
    label: () => t("Allow personal sites"),
    description: () => t("Users can create their own personal sites with documents. \
Turn off to restrict all documents to team sites managed by admins."),
  },
  {
    key: "anonAccess",
    permKey: "forceLogin",
    envVar: "GRIST_FORCE_LOGIN",
    label: () => t("Allow anonymous access"),
    description: () => t("Visitors who aren't signed in can view publicly shared documents. \
This is needed for link sharing and published forms."),
  },
  {
    key: "playground",
    permKey: "anonPlayground",
    envVar: "GRIST_ANON_PLAYGROUND",
    label: () => t("Allow anonymous playground"),
    description: () => t("Visitors who aren't signed in can create and edit documents \
in a temporary playground. Turn off to require sign-in before creating any documents."),
  },
];

const TOGGLE_DEF_BY_KEY = new Map<ToggleKey, ToggleDef>(TOGGLE_DEFS.map(d => [d.key, d]));

export function hasEnvLocked(status: PermissionsStatus): boolean {
  return TOGGLE_DEFS.some(({ permKey }) => status[permKey].source === "environment-variable");
}

export function getEnvLockedVars(status: PermissionsStatus): string[] {
  return TOGGLE_DEFS
    .filter(({ permKey }) => status[permKey].source === "environment-variable")
    .map(({ envVar }) => envVar);
}
