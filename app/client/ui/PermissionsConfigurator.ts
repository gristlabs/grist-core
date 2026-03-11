import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { testId, theme } from "app/client/ui2018/cssVars";
import { InstallAPI } from "app/common/InstallAPI";
import { getGristConfig } from "app/common/urlUtils";

import { Computed, Disposable, dom, DomContents, Observable, styled } from "grainjs";

const t = makeT("PermissionsConfigurator");

interface PermItemDef {
  id: string;
  title: string;
  desc: string;
}

type ProfileId = "locked-down" | "recommended" | "open";

const PERM_ITEMS: PermItemDef[] = [
  {
    id: "team-creation",
    title: t("Allow anyone to create team sites"),
    desc: t("Any logged-in user can create new team sites. " +
      "Turn off to restrict team creation to admins only."),
  },
  {
    id: "personal-sites",
    title: t("Allow personal sites"),
    desc: t("Users can create their own personal sites with documents. " +
      "Turn off to restrict all documents to team sites managed by admins."),
  },
  {
    id: "anonymous-access",
    title: t("Allow anonymous access"),
    desc: t("Visitors who aren't signed in can view publicly shared documents. " +
      "This is needed for link sharing and published forms."),
  },
  {
    id: "anonymous-playground",
    title: t("Allow anonymous playground"),
    desc: t("Visitors who aren't signed in can create and edit documents in a temporary playground. " +
      "Turn off to require sign-in before creating any documents."),
  },
];

const PROFILES: Record<ProfileId, { label: string; values: Record<string, boolean> }> = {
  "locked-down": {
    label: t("Locked down"),
    values: {
      "team-creation": false,
      "personal-sites": false,
      "anonymous-access": false,
      "anonymous-playground": false,
    },
  },
  "recommended": {
    label: t("Recommended"),
    values: {
      "team-creation": false,
      "personal-sites": false,
      "anonymous-access": true,
      "anonymous-playground": false,
    },
  },
  "open": {
    label: t("Open"),
    values: {
      "team-creation": true,
      "personal-sites": true,
      "anonymous-access": true,
      "anonymous-playground": true,
    },
  },
};

const PROFILE_IDS: ProfileId[] = ["locked-down", "recommended", "open"];

// Mapping from toggle id to [env var name, inverted?]
const ENV_MAPPING: [string, string, boolean][] = [
  ["team-creation", "GRIST_ORG_CREATION_ANYONE", false],
  ["personal-sites", "GRIST_PERSONAL_ORGS", false],
  ["anonymous-access", "GRIST_FORCE_LOGIN", true],    // inverted
  ["anonymous-playground", "GRIST_ANON_PLAYGROUND", false],
];

/**
 * Shared component for configuring permission defaults.
 * Used by the setup wizard (pre-launch checklist) and the admin panel
 * (security section).
 */
export class PermissionsConfigurator extends Disposable {
  // Toggle observables keyed by item id.
  public readonly toggles = new Map<string, Observable<boolean>>(
    PERM_ITEMS.map(item => [item.id, Observable.create<boolean>(this, PROFILES.recommended.values[item.id])]),
  );

  // Snapshot of last-saved values. null = never loaded (fresh install).
  public readonly saved = Observable.create<Record<string, boolean> | null>(this, null);

  // True when any toggle differs from the saved state.
  public readonly dirty = Computed.create(this, (use) => {
    const snap = use(this.saved);
    for (const [id, obs] of this.toggles) {
      const current = use(obs);
      if (snap?.[id] !== current) { return true; }
    }
    return false;
  });

  // Observable for single-org note visibility (can be toggled by mockup panel).
  public readonly hasSingleOrg = Observable.create<boolean>(this, Boolean(getGristConfig().singleOrg));

  // Computed: which profile matches current toggles (empty string if none).
  public readonly activeProfile = Computed.create(this, (use) => {
    for (const pid of PROFILE_IDS) {
      const vals = PROFILES[pid].values;
      const matches = PERM_ITEMS.every(item => use(this.toggles.get(item.id)!) === vals[item.id]);
      if (matches) { return pid; }
    }
    return "";
  });

  private _installAPI: InstallAPI;

  constructor(parent: Disposable, installAPI: InstallAPI) {
    super();
    parent.autoDispose(this);
    this._installAPI = installAPI;
  }

  /**
   * Load current permission values from the server and update toggles.
   */
  public async load() {
    try {
      const prefs = await this._installAPI.getInstallPrefs();
      const envVars = (prefs as any).envVars as Record<string, string> | undefined;
      if (!envVars) { return; }
      const snapshot: Record<string, boolean> = {};
      let found = false;
      for (const [toggleId, envKey, invert] of ENV_MAPPING) {
        if (envKey in envVars) {
          const raw = String(envVars[envKey]).toLowerCase();
          const val = raw === "true" || raw === "1";
          const effective = invert ? !val : val;
          this.toggles.get(toggleId)!.set(effective);
          snapshot[toggleId] = effective;
          found = true;
        }
      }
      if (found) {
        for (const [id, obs] of this.toggles) {
          if (!(id in snapshot)) { snapshot[id] = obs.get(); }
        }
        this.saved.set(snapshot);
      }
    } catch (_) { /* ok — prefs not available yet */ }
  }

  /**
   * Convert checklist toggles to the env var format expected by the server.
   */
  public getEnvVars(): Record<string, string> {
    return {
      GRIST_ORG_CREATION_ANYONE: String(this.toggles.get("team-creation")!.get()),
      GRIST_PERSONAL_ORGS: String(this.toggles.get("personal-sites")!.get()),
      GRIST_FORCE_LOGIN: String(!this.toggles.get("anonymous-access")!.get()),
      GRIST_ANON_PLAYGROUND: String(this.toggles.get("anonymous-playground")!.get()),
    };
  }

  /**
   * Save current permissions to the server directly (for admin panel use).
   */
  public async save(): Promise<void> {
    const permissions = this.getEnvVars();
    const resp = await fetch(getHomeUrl() + "/api/admin/save-permissions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permissions }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `Server returned ${resp.status}`);
    }
    // Update saved snapshot.
    const snapshot: Record<string, boolean> = {};
    for (const [id, obs] of this.toggles) {
      snapshot[id] = obs.get();
    }
    this.saved.set(snapshot);
  }

  /**
   * Apply a named profile, setting all toggles at once.
   */
  public applyProfile(pid: ProfileId) {
    const vals = PROFILES[pid].values;
    for (const item of PERM_ITEMS) {
      this.toggles.get(item.id)!.set(vals[item.id]);
    }
  }

  /**
   * Build the full permissions configurator DOM.
   * @param options.showSaveButton — if true, show a standalone save button (for admin panel).
   */
  public buildDom(options?: { showSaveButton?: boolean }): DomContents {
    return cssChecklist(
      cssChecklistHeader(
        cssChecklistTitle(t("Default permissions")),
        dom.maybe(this.dirty, () =>
          cssUnsavedBadge(t("Unsaved changes"), testId("checklist-unsaved")),
        ),
      ),
      cssProfileBar(
        ...PROFILE_IDS.map(pid =>
          cssProfileSegment(
            PROFILES[pid].label,
            dom.cls("active", use => use(this.activeProfile) === pid),
            dom.on("click", () => this.applyProfile(pid)),
            testId(`profile-${pid}`),
          ),
        ),
      ),
      ...PERM_ITEMS.map((item) => {
        const on = this.toggles.get(item.id)!;
        return cssChecklistItem(
          cssChecklistToggle(
            cssChecklistSwitch(
              dom.cls("on", on),
              dom.on("click", () => on.set(!on.get())),
              cssChecklistSwitchKnob(),
              testId(`checklist-toggle-${item.id}`),
            ),
            cssChecklistLabel(item.title),
          ),
          cssChecklistDesc(item.desc),
          testId(`checklist-item-${item.id}`),
        );
      }),
      dom.maybe(this.hasSingleOrg, () => {
        const orgName = getGristConfig().singleOrg || "";
        const prefix = orgName ?
          t("You have GRIST_SINGLE_ORG={{orgName}} set.", { orgName }) :
          t("You have GRIST_SINGLE_ORG set.");
        return cssChecklistNote(
          prefix + " " +
          t("With this, users only see one team site — but personal sites " +
            "and team creation still work behind the scenes. Worth locking down unless you " +
            "have a specific reason to keep them."),
        );
      }),
      options?.showSaveButton ? this._buildSaveButton() : null,
      testId("pre-launch-checklist"),
    );
  }

  private _buildSaveButton(): DomContents {
    const saving = Observable.create(this, false);
    const saveError = Observable.create(this, "");
    return [
      dom.maybe(saveError, err => cssSaveError(err)),
      bigPrimaryButton(
        dom.domComputed((use) => {
          if (use(saving)) { return t("Saving..."); }
          return use(this.dirty) ? t("Save permissions") : t("Saved");
        }),
        dom.prop("disabled", use => use(saving) || !use(this.dirty)),
        dom.on("click", async () => {
          saving.set(true);
          saveError.set("");
          try {
            await this.save();
          } catch (e) {
            saveError.set((e as Error).message);
          } finally {
            saving.set(false);
          }
        }),
        testId("permissions-save"),
      ),
    ];
  }
}

// --- Styles ---

const cssChecklist = styled("div", `
  margin-bottom: 20px;
  padding: 20px 24px;
  border: 1px solid ${theme.pagePanelsBorder};
  border-radius: 10px;
  background: ${theme.mainPanelBg};
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.03);
`);

const cssChecklistHeader = styled("div", `
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
`);

const cssChecklistTitle = styled("div", `
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: ${theme.lightText};
`);

const cssUnsavedBadge = styled("div", `
  font-size: 11px;
  font-weight: 500;
  color: #b45309;
  background: #fef7e0;
  padding: 2px 8px;
  border-radius: 10px;
`);

const cssProfileBar = styled("div", `
  display: flex;
  padding: 3px;
  border-radius: 10px;
  background: ${theme.inputBorder};
  gap: 3px;
  margin-bottom: 16px;
`);

const cssProfileSegment = styled("div", `
  flex: 1;
  text-align: center;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
  color: ${theme.lightText};
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;

  &:hover:not(.active) {
    color: ${theme.text};
    background: ${theme.mainPanelBg}80;
  }

  &.active {
    color: ${theme.text};
    font-weight: 600;
    background: ${theme.mainPanelBg};
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15), 0 1px 2px rgba(0, 0, 0, 0.1);
  }
`);

const cssChecklistItem = styled("div", `
  padding: 12px 0;
  & + & {
    border-top: 1px solid ${theme.pagePanelsBorder};
  }
`);

const cssChecklistToggle = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
`);

const cssChecklistSwitch = styled("div", `
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: ${theme.pagePanelsBorder};
  cursor: pointer;
  transition: background 0.2s ease;
  flex-shrink: 0;

  &.on {
    background: #1e7e34;
  }
`);

const cssChecklistSwitchKnob = styled("div", `
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;

  .on > & {
    transform: translateX(16px);
  }
`);

const cssChecklistLabel = styled("div", `
  font-size: 13.5px;
  font-weight: 600;
  color: ${theme.text};
`);

const cssChecklistDesc = styled("div", `
  font-size: 12px;
  color: ${theme.lightText};
  line-height: 1.5;
  margin-top: 4px;
  margin-left: 48px;
`);

const cssChecklistNote = styled("div", `
  font-size: 12px;
  line-height: 1.5;
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #fef7e0;
  color: #b45309;
`);

const cssSaveError = styled("div", `
  margin-top: 12px;
  padding: 8px 12px;
  background-color: #fce8e6;
  color: #c5221f;
  border-radius: 4px;
  font-size: 12px;
`);
