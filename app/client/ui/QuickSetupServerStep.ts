import { makeT } from "app/client/lib/localization";
import { BaseUrlSection } from "app/client/ui/BaseUrlSection";
import { DraftChangesManager } from "app/client/ui/DraftChanges";
import { EditionSection } from "app/client/ui/EditionSection";
import { quickSetupContinueButton, QuickSetupSection } from "app/client/ui/QuickSetupContinueButton";
import { cssQuickSetupCard, quickSetupStepHeader } from "app/client/ui/QuickSetupStepHeader";

import { Computed, Disposable, dom, DomContents, makeTestId, Observable, styled, UseCBOwner } from "grainjs";

const t = makeT("QuickSetupServerStep");
const testId = makeTestId("test-quick-setup-");

/**
 * First step of QuickSetup: Base URL + Edition. Collects draft changes
 * across two sections and applies them in a single batch via the shared
 * QuickSetup continue button.
 *
 * Implements {@link QuickSetupSection} directly -- the step is itself
 * the unit the QuickSetup continue button drives, just composed of two
 * underlying sections via {@link DraftChangesManager}.
 */
export class QuickSetupServerStep extends Disposable implements QuickSetupSection {
  public canProceed: Computed<boolean>;
  public hasPendingChanges: Computed<boolean>;
  public isApplying: Observable<boolean>;

  private _baseUrl = BaseUrlSection.create(this);
  private _edition = EditionSection.create(this);
  private _drafts = DraftChangesManager.create(this);

  constructor(private _onComplete: () => void) {
    super();
    this._drafts.addSection(this._baseUrl);
    this._drafts.addSection(this._edition);
    this.canProceed = Computed.create(this, use =>
      use(this._baseUrl.canProceed) && use(this._edition.canProceed),
    );
    this.hasPendingChanges = this._drafts.hasDraftChanges;
    this.isApplying = this._drafts.isApplying;
  }

  /** Pre-confirm message when the user hasn't yet confirmed URL/edition. */
  public customLabel(use: UseCBOwner): string | null {
    const urlOk = use(this._baseUrl.canProceed);
    const edOk = use(this._edition.canProceed);
    if (!urlOk && !edOk) { return t("Confirm base URL and edition to continue"); }
    if (!urlOk) { return t("Confirm base URL to continue"); }
    if (!edOk) { return t("Confirm edition to continue"); }
    return null;
  }

  public async applyPendingChanges(): Promise<void> {
    await this._drafts.applyAll();
  }

  public buildDom(): DomContents {
    return dom("div",
      quickSetupStepHeader({
        icon: "Home",
        title: t("Server"),
        description: t("Set your server's base URL and choose which edition of Grist to run."),
      }),
      cssQuickSetupCard(
        cssStepSectionTitle(t("Base URL")),
        this._baseUrl.buildWizardDom(),
      ),
      cssQuickSetupCard(
        cssStepSectionTitle(t("Edition")),
        this._edition.buildWizardDom(),
      ),
      quickSetupContinueButton(this, () => this._onComplete(), testId("server-continue")),
    );
  }
}

const cssStepSectionTitle = styled("h3", `
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 8px 0;
`);
