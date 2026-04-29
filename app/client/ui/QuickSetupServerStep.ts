import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/errors";
import { BaseUrlSection } from "app/client/ui/BaseUrlSection";
import { DraftChangesManager } from "app/client/ui/DraftChanges";
import { EditionSection } from "app/client/ui/EditionSection";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";

import { Computed, Disposable, dom, DomContents, makeTestId, styled } from "grainjs";

const t = makeT("QuickSetupServerStep");
const testId = makeTestId("test-quick-setup-");

/**
 * First step of the setup wizard: Base URL + Edition. Collects draft
 * changes and applies them in a single batch when the user clicks Continue.
 *
 * Extracted into its own file to keep QuickSetup.ts focused on step
 * navigation; the other setup steps (sandboxing, backups, etc.) live in
 * their own modules too.
 */
export class QuickSetupServerStep extends Disposable {
  private _baseUrl = BaseUrlSection.create(this);
  private _edition = EditionSection.create(this);
  private _drafts = DraftChangesManager.create(this);

  private _canProceed: Computed<boolean>;

  constructor(private _onComplete: () => void) {
    super();
    this._drafts.addSection(this._baseUrl);
    this._drafts.addSection(this._edition);
    this._canProceed = Computed.create(this, use =>
      use(this._baseUrl.canProceed) && use(this._edition.canProceed),
    );
  }

  public buildDom(): DomContents {
    return dom("div",
      cssStepHeading(
        cssStepHeadingIcon(icon("Home")),
        t("Server"),
      ),
      cssStepDescription(
        t("Set your server's base URL and choose which edition of Grist to run."),
      ),
      cssStepSection(
        cssStepSectionTitle(t("Base URL")),
        this._baseUrl.buildWizardDom(),
      ),
      cssStepSection(
        cssStepSectionTitle(t("Edition")),
        this._edition.buildWizardDom(),
      ),
      cssContinueRow(
        bigPrimaryButton(
          dom.text((use) => {
            // Subscribe to all deps up front: a later re-eval that adds a dep
            // not seen on the first pass can read a stale value once.
            const urlOk = use(this._baseUrl.canProceed);
            const edOk = use(this._edition.canProceed);
            const hasChanges = use(this._drafts.hasDraftChanges);
            if (!urlOk && !edOk) { return t("Confirm base URL and edition to continue"); }
            if (!urlOk) { return t("Confirm base URL to continue"); }
            if (!edOk) { return t("Confirm edition to continue"); }
            return hasChanges ? t("Apply and Continue") : t("Continue");
          }),
          dom.boolAttr("disabled", use => !use(this._canProceed) || use(this._drafts.isApplying)),
          dom.on("click", async () => {
            try {
              await this._drafts.applyAll();
              this._onComplete();
            } catch (err) {
              reportError(err as Error);
            }
          }),
          testId("server-continue"),
        ),
      ),
    );
  }
}

const cssStepHeading = styled("div", `
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 4px;
`);

const cssStepHeadingIcon = styled("div", `
  display: flex;
  --icon-color: ${theme.controlPrimaryBg};
`);

const cssStepDescription = styled("div", `
  font-size: 14px;
  line-height: 1.5;
  margin-bottom: 20px;
`);

const cssStepSection = styled("div", `
  margin-bottom: 24px;
`);

const cssStepSectionTitle = styled("h3", `
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px 0;
`);

const cssContinueRow = styled("div", `
  display: flex;
  justify-content: flex-end;
  margin-top: 24px;
`);
