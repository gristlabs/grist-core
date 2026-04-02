import { makeT } from "app/client/lib/localization";
import { getHomeUrl } from "app/client/models/AppModel";
import { showEnterpriseToggle } from "app/client/ui/ActivationPage";
import { basicButton, bigPrimaryButton, primaryButton } from "app/client/ui2018/buttons";
import { labeledSquareCheckbox } from "app/client/ui2018/checkbox";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { commonUrls } from "app/common/gristUrls";
import { InstallAPI } from "app/common/InstallAPI";

import { Computed, Disposable, dom, DomContents, Observable, styled } from "grainjs";

const t = makeT("ServerConfigurator");

/**
 * Shared component for configuring fundamental server settings:
 * - APP_HOME_URL (the base URL others use to reach this Grist server)
 * - Edition toggle (Grist Community Edition vs Full Grist, when available)
 *
 * Used by both the setup wizard and the admin panel.
 */
export class ServerConfigurator extends Disposable {
  // APP_HOME_URL state
  public readonly detectedUrl = Observable.create<string>(this, "");
  public readonly savedUrl = Observable.create<string>(this, "");
  public readonly editedUrl = Observable.create<string>(this, "");
  public readonly urlStatus = Observable.create<"idle" | "loading" | "loaded" | "saving" | "saved" | "error">(
    this, "idle",
  );

  public readonly urlError = Observable.create<string>(this, "");
  public readonly urlManuallySet = Observable.create<boolean>(this, false);

  public readonly urlConfirmed = Observable.create<boolean>(this, false);

  // Edition selection: "full" or "community"
  public readonly selectedEdition = Observable.create<"full" | "community">(this, "full");
  public readonly editionConfirmed = Observable.create<boolean>(this, false);
  public readonly urlSkipped = Observable.create<boolean>(this, false);
  public readonly editionSkipped = Observable.create<boolean>(this, false);

  // Mockup override: controls whether Full Grist appears as available.
  // null = use real availability; true/false = override.
  public readonly mockFullGristAvailable = Observable.create<boolean | null>(this, null);

  // Whether Full Grist is available as a selectable option.
  public readonly fullGristAvailable: Computed<boolean> = Computed.create(this, (use) => {
    const mock = use(this.mockFullGristAvailable);
    if (mock !== null) { return mock; }
    return showEnterpriseToggle();
  });

  // True when both URL and edition have been addressed (confirmed, skipped, or acknowledged).
  public readonly serverReady: Computed<boolean> = Computed.create(this, use =>
    use(this.urlConfirmed) && use(this.editionConfirmed));

  // Whether the admin panel's standalone Save button is shown (vs wizard's go-live flow).
  private _hasStandaloneSave = false;

  constructor(_installAPI: InstallAPI) {
    super();

    // Detect URL from the browser
    this.detectedUrl.set(window.location.origin);
  }

  /**
   * Load current APP_HOME_URL from the server.
   */
  public async load(): Promise<void> {
    this.urlStatus.set("loading");
    try {
      const resp = await fetch(getHomeUrl() + "/api/admin/server-config", {
        credentials: "include",
      });
      if (!resp.ok) {
        throw new Error(`Server returned ${resp.status}`);
      }
      const body = await resp.json();
      const saved = body.APP_HOME_URL || "";
      this.savedUrl.set(saved);
      this.editedUrl.set(saved || this.detectedUrl.get());
      this.urlManuallySet.set(!!saved);
      this.urlStatus.set("loaded");
    } catch (e) {
      // If the endpoint doesn't exist yet, just use the detected URL.
      this.editedUrl.set(this.detectedUrl.get());
      this.urlStatus.set("loaded");
    }
  }

  /**
   * Get the env vars to persist for APP_HOME_URL.
   */
  public getEnvVars(): Record<string, string> {
    const url = this.editedUrl.get();
    return url ? { APP_HOME_URL: url } : {};
  }

  /**
   * Save APP_HOME_URL to the server (without restart).
   */
  public async save(): Promise<void> {
    const url = this.editedUrl.get();
    if (!url) { return; }
    this.urlStatus.set("saving");
    this.urlError.set("");
    try {
      const resp = await fetch(getHomeUrl() + "/api/admin/save-server-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ APP_HOME_URL: url }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${resp.status}`);
      }
      this.savedUrl.set(url);
      this.urlManuallySet.set(true);
      this.urlStatus.set("saved");
    } catch (e) {
      this.urlError.set((e as Error).message);
      this.urlStatus.set("error");
    }
  }

  /**
   * Build the full DOM for the server configurator.
   *
   * Wizard mode (onContinue): URL section has inline Confirm/Do later buttons.
   *   A separate Continue button at the bottom advances to the next step.
   * Admin panel mode (showSaveButton): standalone Save button at the bottom.
   */
  public buildDom(options: {
    showSaveButton?: boolean;
    onContinue?: () => void | Promise<void>;
  } = {}): DomContents {
    const { showSaveButton = false, onContinue } = options;
    this._hasStandaloneSave = showSaveButton;

    return cssConfigurator(
      this._buildUrlSection(!!onContinue),
      this._buildEditionSection(),
      showSaveButton ? this._buildSaveButton() : null,
      onContinue ? this._buildContinueButton(onContinue) : null,
      testId("server-configurator"),
    );
  }

  /**
   * Build a compact status display for the admin panel summary line.
   */
  public buildStatusDisplay(): DomContents {
    return dom.domComputed(this.urlStatus, (status) => {
      if (status === "loading") { return t("checking..."); }
      const saved = this.savedUrl.get();
      if (saved) { return saved; }
      return cssDetectedLabel(this.detectedUrl.get(), " ", t("(detected)"));
    });
  }

  // --- URL section ---

  private _buildUrlSection(showInlineConfirm: boolean): DomContents {
    return cssSectionBox(
      cssSectionHeader(t("Base URL")),
      cssSectionDesc(
        t("The URL where users and integrations reach this Grist server. " +
          "Auth callbacks, API links, and email notifications all depend on this being correct."),
      ),
      dom.domComputed(this.urlStatus, (status) => {
        if (status === "idle" || status === "loading") {
          return cssDetecting(t("Detecting..."));
        }
        return this._buildUrlEditor(showInlineConfirm);
      }),
      testId("server-url-section"),
    );
  }

  private _buildUrlEditor(showInlineConfirm: boolean): DomContents {
    const confirmBusy = Observable.create(null, false);

    return cssUrlEditor(
      dom.autoDispose(confirmBusy),
      cssUrlInputRow(
        cssUrlInput(
          dom.attr("type", "text"),
          dom.attr("placeholder", "https://grist.example.com"),
          dom.prop("value", this.editedUrl),
          dom.on("input", (_e, el) => {
            this.editedUrl.set(el.value);
          }),
          testId("server-url-input"),
        ),
      ),
      // Show detected URL hint when manual value differs from detected
      dom.maybe(
        (use) => {
          const edited = use(this.editedUrl);
          const detected = use(this.detectedUrl);
          return edited !== detected;
        },
        () => cssUrlHint(
          cssUrlHintIcon(icon("Info")),
          t("Detected from your browser: "),
          cssUrlHintLink(
            this.detectedUrl.get(),
            dom.on("click", () => {
              this.editedUrl.set(this.detectedUrl.get());
            }),
          ),
          testId("server-url-detected-hint"),
        ),
      ),
      // Show when URL was auto-detected and not yet explicitly saved
      dom.maybe(
        use => !use(this.urlManuallySet) && !use(this.urlConfirmed) && use(this.urlStatus) !== "saving",
        () => cssUrlNote(
          cssUrlNoteIcon("!"),
          this._hasStandaloneSave ?
            t("This URL was detected automatically — confirm it is correct, then save.") :
            t("This URL was detected from your browser. " +
              "Confirm it is the right address for your server, or skip for now."),
          testId("server-url-unsaved-note"),
        ),
      ),
      // Inline Confirm URL / Do later buttons (wizard mode only)
      showInlineConfirm ? dom.maybe(
        use => !use(this.urlConfirmed),
        () => cssActionRow(
          primaryButton(
            dom.domComputed(confirmBusy, b => b ? t("Saving...") : t("Confirm URL")),
            dom.prop("disabled", confirmBusy),
            dom.on("click", async () => {
              confirmBusy.set(true);
              try {
                await this.save();
                this.urlConfirmed.set(true);
              } finally {
                if (!confirmBusy.isDisposed()) { confirmBusy.set(false); }
              }
            }),
            testId("server-url-confirm"),
          ),
          basicButton(
            t("Do later"),
            dom.on("click", () => {
              this.urlSkipped.set(true);
              this.urlConfirmed.set(true);
            }),
            testId("server-url-skip"),
          ),
        ),
      ) : null,
      // Show confirmed indicator with edit button (wizard mode only)
      showInlineConfirm ? dom.maybe(this.urlConfirmed, () =>
        cssSavedRow(
          cssSavedIndicator(
            this.urlSkipped.get() ?
              t("Will do later in administrator panel") :
              t("Confirmed"),
          ),
          cssEditIcon(
            icon("Pencil"),
            dom.on("click", () => {
              this.urlConfirmed.set(false);
              this.urlSkipped.set(false);
            }),
          ),
          testId("server-url-confirmed"),
        ),
      ) : null,
      dom.maybe(this.urlError, err => cssError(err, testId("server-url-error"))),
      testId("server-url-editor"),
    );
  }

  // --- Edition section ---

  private _buildEditionSection(): DomContents {
    const showInlineConfirm = !this._hasStandaloneSave;

    // Whether the current selection is blocked (Full Grist selected but not available).
    const selectionBlocked = Computed.create(null, use =>
      use(this.selectedEdition) === "full" && !use(this.fullGristAvailable));

    return cssSectionBox(
      dom.autoDispose(selectionBlocked),
      cssSectionHeader(t("Edition")),
      cssSectionDesc(
        t("Choose which edition of Grist to run on this server."),
      ),
      cssEditionBar(
        cssEditionSegment(
          t("Full Grist"),
          dom.cls("active", use => use(this.selectedEdition) === "full"),
          dom.on("click", () => this.selectedEdition.set("full")),
          testId("edition-full"),
        ),
        cssEditionSegment(
          t("Community Edition"),
          dom.cls("active", use => use(this.selectedEdition) === "community"),
          dom.on("click", () => this.selectedEdition.set("community")),
          testId("edition-community"),
        ),
      ),
      dom.domComputed(
        use => [use(this.selectedEdition), use(this.fullGristAvailable)] as const,
        ([edition, available]) => {
          if (edition === "full") {
            return cssEditionNote(
              t("The full Grist experience, with all features enabled for improved " +
                "security, governance, and collaboration."),
              available ? [
                dom("div",
                  dom.style("margin-top", "8px"),
                  t("You have 30 days to enter an activation key. Free activation keys " +
                    "are available to individuals and small orgs with less than " +
                    "US $1 million in total annual funding. "),
                  cssLink({ href: commonUrls.enterpriseKeyFaq, target: "_blank" },
                    t("Learn more.")),
                  " ",
                  t("For larger orgs, "),
                  cssLink({ href: commonUrls.plans, target: "_blank" },
                    t("see pricing.")),
                ),
                dom("div",
                  dom.style("margin-top", "8px"),
                  t("Switch to and from Community Edition at any time — your core " +
                    "functionality and data will stay fully available."),
                ),
              ] : dom("div",
                dom.style("margin-top", "8px"),
                t("Your installation does not bundle the Full Grist edition. " +
                  "Want Full Grist? "),
                cssLink({ href: commonUrls.githubBuildFromSource, target: "_blank" },
                  t("See how to enable it.")),
                testId("edition-unavailable"),
              ),
              testId("edition-note"),
            );
          }
          return cssEditionNote(
            t("The free and open-source heart of Grist, with everything you need to " +
              "open and edit Grist documents, control access, create forms, connect to " +
              "single sign-on (SSO) providers, and much more."),
            testId("edition-note"),
          );
        },
      ),
      // Inline confirm / skip / acknowledge (wizard mode only)
      showInlineConfirm ? dom.domComputed(
        use => [use(this.editionConfirmed), use(selectionBlocked)] as const,
        ([confirmed, blocked]) => {
          if (confirmed) {
            return cssSavedRow(
              cssSavedIndicator(
                this.editionSkipped.get() ?
                  t("Will do later in administrator panel") :
                  t("Confirmed"),
              ),
              cssEditIcon(
                icon("Pencil"),
                dom.on("click", () => {
                  this.editionConfirmed.set(false);
                  this.editionSkipped.set(false);
                }),
              ),
              testId("edition-confirmed"),
            );
          }
          if (blocked) {
            return labeledSquareCheckbox(
              this.editionConfirmed,
              t("I understand I am running Grist Community Edition"),
              testId("edition-acknowledge"),
            );
          }
          return cssActionRow(
            primaryButton(
              t("Confirm edition"),
              dom.on("click", () => {
                this.editionConfirmed.set(true);
              }),
              testId("edition-confirm"),
            ),
            basicButton(
              t("Do later"),
              dom.on("click", () => {
                this.editionSkipped.set(true);
                this.editionConfirmed.set(true);
              }),
              testId("edition-skip"),
            ),
          );
        },
      ) : null,
      testId("server-edition-section"),
    );
  }

  // --- Action buttons ---

  private _buildSaveButton(): DomContents {
    return cssActionRow(
      bigPrimaryButton(
        dom.domComputed(this.urlStatus, s => s === "saving" ? t("Saving...") : t("Save")),
        dom.prop("disabled", (use) => {
          const status = use(this.urlStatus);
          return status === "saving" || use(this.editedUrl) === use(this.savedUrl);
        }),
        dom.on("click", () => this.save()),
        testId("server-save"),
      ),
      dom.maybe(
        use => use(this.urlStatus) === "saved" && use(this.editedUrl) === use(this.savedUrl),
        () => cssSavedIndicator(t("Saved")),
      ),
    );
  }

  private _buildContinueButton(
    onContinue: () => void | Promise<void>,
  ): DomContents {
    return cssActionRow(
      bigPrimaryButton(
        dom.domComputed((use) => {
          const url = use(this.urlConfirmed);
          const edition = use(this.editionConfirmed);
          if (url && edition) { return t("Continue"); }
          if (!url && !edition) { return t("Set base URL and edition to continue"); }
          if (!url) { return t("Set base URL to continue"); }
          return t("Set edition to continue");
        }),
        dom.prop("disabled", use => !use(this.serverReady)),
        dom.on("click", () => { void onContinue(); }),
        testId("server-continue"),
      ),
    );
  }
}

// --- Styles ---

const cssConfigurator = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 20px;
`);

const cssSectionBox = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssSectionHeader = styled("div", `
  font-weight: 700;
  font-size: 14px;
  color: ${theme.text};
`);

const cssSectionDesc = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  line-height: 1.5;
  margin-bottom: 4px;
`);

const cssUrlEditor = styled("div", `
  display: flex;
  flex-direction: column;
  gap: 8px;
`);

const cssUrlInputRow = styled("div", `
  display: flex;
  gap: 8px;
`);

const cssUrlInput = styled("input", `
  flex: 1;
  padding: 10px 14px;
  border: 1px solid ${theme.inputBorder};
  border-radius: 8px;
  font-size: 15px;
  font-family: inherit;
  color: ${theme.text};
  background: ${theme.inputBg};
  outline: none;
  transition: border-color 0.15s;

  &:focus {
    border-color: ${theme.controlFg};
  }
`);

const cssUrlHint = styled("div", `
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: ${theme.lightText};
`);

const cssUrlHintIcon = styled("div", `
  display: flex;
  --icon-color: ${theme.lightText};
  flex-shrink: 0;
`);

const cssUrlHintLink = styled("span", `
  color: ${theme.controlFg};
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;

  &:hover {
    text-decoration-style: solid;
  }
`);

const cssUrlNote = styled("div", `
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 14px;
  background-color: #fef7e0;
  color: #b45309;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
`);

const cssUrlNoteIcon = styled("span", `
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #b45309;
  color: white;
`);

const cssDetecting = styled("div", `
  font-size: 13px;
  color: ${theme.lightText};
  padding: 8px 0;
`);

const cssDetectedLabel = styled("span", `
  color: ${theme.lightText};
  font-size: ${vars.smallFontSize};
`);

const cssError = styled("div", `
  padding: 8px 12px;
  background-color: #fce8e6;
  color: #c5221f;
  border-radius: 6px;
  font-size: ${vars.mediumFontSize};
`);

const cssEditionBar = styled("div", `
  display: flex;
  padding: 3px;
  border-radius: 10px;
  background: ${theme.inputBorder};
  gap: 3px;
`);

const cssEditionSegment = styled("div", `
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

const cssEditionNote = styled("div", `
  font-size: 12px;
  color: ${theme.lightText};
  line-height: 1.5;
`);

const cssActionRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
`);

const cssSavedRow = styled("div", `
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
`);

const cssSavedIndicator = styled("span", `
  font-size: 13px;
  color: #1e7e34;
  font-weight: 500;
`);

const cssEditIcon = styled("div", `
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 2px;
  border-radius: 3px;
  --icon-color: ${theme.lightText};

  &:hover {
    --icon-color: ${theme.text};
    background: ${theme.hover};
  }
`);
