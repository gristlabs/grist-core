import { handleFormError, handleSubmit } from "app/client/lib/formUtils";
import { makeT } from "app/client/lib/localization";
import { AuditLogsModel } from "app/client/models/AuditLogsModel";
import { textInput } from "app/client/ui/inputs";
import { bigBasicButton, bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { loadingSpinner } from "app/client/ui2018/loaders";
import { menu, menuItem } from "app/client/ui2018/menus";
import { confirmModal, modal } from "app/client/ui2018/modals";
import {
  AuditLogStreamingDestination,
  AuditLogStreamingDestinationName,
  AuditLogStreamingDestinationNameChecker,
} from "app/common/Config";
import { commonUrls } from "app/common/gristUrls";
import { Computed, Disposable, dom, makeTestId, Observable, styled } from "grainjs";

const t = makeT("AuditLogStreamingConfig");

const testId = makeTestId("test-audit-logs-");

export class AuditLogStreamingConfig extends Disposable {
  constructor(private _model: AuditLogsModel) {
    super();
  }

  public buildDom() {
    return dom.domComputed(
      this._model.streamingDestinations,
      (destinations) => {
        if (destinations === null) {
          return cssLoadingSpinner(loadingSpinner());
        }

        return dom("div",
          cssParagraph(
            t(
              "Set up streaming of audit events from Grist to an external " +
                "security information and event management (SIEM) system like " +
                "Splunk. {{learnMoreLink}}.",
              {
                learnMoreLink: cssLink(
                  { href: commonUrls.helpInstallAuditLogs, target: "_blank" },
                  t("Learn more")
                ),
              }
            )
          ),
          dom("div",
            dom.hide(destinations.length === 0),
            dom("div",
              cssSectionHeading(t("Destinations")),
              cssDestinations(
                dom.forEach(destinations, (destination) =>
                  cssDestination(
                    cssDestinationName(
                      getDestinationDisplayName(destination.name),
                      testId("streaming-destination-name")
                    ),
                    cssDestinationUrl(
                      destination.url,
                      testId("streaming-destination-url")
                    ),
                    cssDestinationOptions(
                      icon("Dots"),
                      menu(
                        () => [
                          menuItem(
                            () =>
                              this._handleEditDestinationClick(destination),
                            t("Edit")
                          ),
                          menuItem(
                            () =>
                              this._handleDeleteDestinationClick(destination),
                            t("Delete")
                          ),
                        ],
                        { placement: "bottom-start" }
                      ),
                      dom.on("click", (ev) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                      }),
                      testId("streaming-destination-options")
                    ),
                    testId("streaming-destination")
                  )
                )
              )
            )
          ),
          bigPrimaryButton(
            destinations.length === 0
              ? t("Start streaming")
              : t("Add destination"),
            dom.on("click", () => this._handleAddDestinationClick()),
            testId("add-streaming-destination")
          )
        );
      }
    );
  }

  private _handleAddDestinationClick() {
    showDestinationForm({
      title: t("Add streaming destination"),
      submitButtonLabel: t("Add destination"),
      onSubmit: (destination) =>
        this._model.createStreamingDestination(destination),
    });
  }

  private _handleDeleteDestinationClick({ id }: AuditLogStreamingDestination) {
    confirmModal(
      t("Delete streaming destination?"),
      t("Delete"),
      () => this._model.deleteStreamingDestination(id),
      {
        explanation: t(
          "Are you sure you want to delete this streaming destination? This action cannot be undone."
        ),
      }
    );
  }

  private _handleEditDestinationClick(
    destination: AuditLogStreamingDestination
  ) {
    showDestinationForm({
      title: t("Edit streaming destination"),
      submitButtonLabel: t("Save"),
      destination,
      onSubmit: (properties) =>
        this._model.updateStreamingDestination(destination.id, properties),
    });
  }
}

export function getDestinationDisplayName(name: AuditLogStreamingDestinationName) {
  switch (name) {
    case "splunk": {
      return t("Splunk");
    }
    case "other": {
      return t("Other");
    }
  }
}

interface DestinationFormOptions {
  title: string;
  submitButtonLabel: string;
  destination?: AuditLogStreamingDestination;
  onSubmit(properties: Omit<AuditLogStreamingDestination, "id">): Promise<void>;
}

function showDestinationForm(options: DestinationFormOptions) {
  const { title, submitButtonLabel, onSubmit, destination } = options;
  return modal((ctl, owner) => {
    const name = Observable.create<AuditLogStreamingDestinationName | null>(
      owner,
      destination?.name ?? null
    );
    const url = Observable.create<string>(owner, destination?.url ?? "");
    const token = Observable.create<string>(owner, destination?.token ?? "");
    const pending = Observable.create(owner, false);
    const disabled = Computed.create(owner, (use) => !use(name) || !use(url));
    const error = Observable.create(owner, "");

    const handleDestinationChange = (event: Event) => {
      const value = (event.target as HTMLInputElement)?.value;
      assertStreamingDestinationName(value);
      name.set(value);
    };

    return [
      cssModal.cls(""),
      cssModalTitle(title),
      dom("form",
        handleSubmit({
          pending,
          disabled,
          onSubmit: (fields) => onSubmit(toStreamingDestination(fields)),
          onSuccess: () => ctl.close(),
          onError: (e) => handleFormError(e, error),
        }),
        cssLabelAndInput(
          cssLabel(t("Destination")),
          cssCards(
            cssCard(
              cssCard.cls("-selected", use => use(name) === "splunk"),
              { for: "splunk" },
              cssCardInput(
                {
                  id: "splunk",
                  name: "name",
                  type: "radio",
                  value: "splunk",
                },
                dom.prop("checked", (use) => use(name) === "splunk"),
                dom.on("change", handleDestinationChange),
              ),
              cssCardContent(
                cssCardImage({src: "img/audit-logs-splunk.svg"})
              )
            ),
            cssCard(
              cssCard.cls("-selected", use => use(name) === "other"),
              { for: "other" },
              cssCardInput(
                {
                  id: "other",
                  name: "name",
                  type: "radio",
                  value: "other",
                },
                dom.prop("checked", (use) => use(name) === "other"),
                dom.on("change", handleDestinationChange),
              ),
              cssCardContent(
                cssCardImage({src: "img/audit-logs-other.svg"})
              )
            ),
          )
        ),
        cssLabelAndInput(
          cssLabel(t("URL"), { for: "url" }),
          cssTextInput(url, {
            id: "url",
            name: "url",
            type: "url",
            placeholder: t("Enter URL"),
          })
        ),
        cssLabelAndInput(
          cssLabel(t("Token"), { for: "token" }),
          cssTextInput(token, {
            id: "token",
            name: "token",
            type: "text",
            placeholder: t("Enter token"),
          })
        ),
        cssMessages(
          dom.maybe(error, (e) => cssError(e)),
        ),
        cssModalButtons(
          bigBasicButton(
            t("Cancel"),
            { type: "button" },
            dom.on("click", () => ctl.close()),
            testId("streaming-destination-form-cancel")
          ),
          bigPrimaryButton(
            t(submitButtonLabel),
            { type: "submit" },
            dom.boolAttr("disabled", (use) => use(pending) || use(disabled)),
            testId("streaming-destination-form-apply")
          )
        ),
      ),
    ];
  });
}

function toStreamingDestination(formData: Record<string, string>) {
  const { name, url, token } = formData;
  assertStreamingDestinationName(name);
  const destination: Omit<AuditLogStreamingDestination, "id"> = {
    name,
    url,
    token,
  };
  return destination;
}

function assertStreamingDestinationName(name: string): asserts name is AuditLogStreamingDestinationName {
  AuditLogStreamingDestinationNameChecker.check(name);
}

const cssLoadingSpinner = styled("div", `
  display: flex;
  justify-content: center;
  align-items: center;
`);

const cssParagraph = styled("div", `
  margin-bottom: 16px;
`);

const cssSectionHeading = styled("div", `
  font-size: ${vars.introFontSize};
  font-weight: 600;
  margin-bottom: 16px;
`);

const cssDestinations = styled("div", `
  display: flex;
  flex-direction: column;
  row-gap: 16px;
  margin-bottom: 16px;
`);

const cssDestination = styled("div", `
  display: flex;
  column-gap: 8px;
  align-items: center;
  height: 32px;
  line-height: 32px;
  border-radius: 3px;
`);

const cssDestinationName = styled("div", `
  font-weight: 600;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 100%;
  padding: 4px;
`);

const cssDestinationUrl = styled("div", `
  flex-grow: 1;
  color: ${theme.lightText};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: normal;
`);

const cssDestinationOptions = styled("div", `
  flex-shrink: 0;
  margin: 0 4px 0 auto;
  height: 24px;
  width: 24px;
  padding: 4px;
  line-height: 0px;
  border-radius: 3px;
  cursor: pointer;
  --icon-color: ${theme.lightText};

  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
`);

const cssModal = styled("div", `
  padding: 32px;
  width: min(100%, 480px);
`);

const cssModalTitle = styled("div", `
  font-size: 24px;
  font-weight: 600;
  line-height: 32px;
  margin-bottom: 16px;
`);

const cssLabelAndInput = styled("div", `
  margin-bottom: 16px;
`);

const cssLabel = styled("label", `
  color: ${theme.text};
  display: inline-block;
  line-height: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
`);

const cssCards = styled("grid", `
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
`);

const cssCard = styled("label", `
  display: inline-flex;
  background: #FFF;
  border: 2px solid ${theme.cardButtonBorder};
  box-shadow: 1px 1px 4px 1px ${theme.cardButtonShadow};
  padding: 8px;
  border-radius: 4px;
  position: relative;
  cursor: pointer;

  &:hover {
    background-color: #E8E8E8;
  }
  &-selected {
    outline: 2px solid ${theme.cardButtonBorderSelected};
    outline-offset: -2px;
  }
`);

const cssCardInput = styled("input", `
  flex-shrink: 0;
  background-color: #FFF;
  appearance: none;
  width: 16px;
  height: 16px;
  margin: 0px;
  border-radius: 50%;
  background-clip: content-box;
  border: 1px solid #D9D9D9;
  outline-color: #009058;
  cursor: pointer;

  &:hover {
    border: 1px solid #BFBFBF;
  }
  &:focus {
    outline: unset !important;
    outline-offset: unset !important;
  }
  &:focus-visible {
    outline: 2px solid #009058 !important;
    outline-offset: 0px !important;
  }
  &:checked {
    padding: 2px;
    background-color: ${vars.primaryBg};
    border: 1px solid ${vars.primaryBg};
  }
`);

const cssCardContent = styled("span", `
  padding: 8px;
  flex-grow: 1;
`);

const cssCardImage = styled("img", `
  height: 100%;
  width: 100%;
  object-fit: contain;
  aspect-ratio: 3;
`);

const cssTextInput = styled(textInput, `
  height: unset;
  padding: 8px;
`);

const cssMessages = styled("div", `
  text-align: center;
  min-height: 15px;
`);

const cssError = styled("span", `
  color: ${theme.errorText};
`);

const cssModalButtons = styled("div", `
  display: flex;
  justify-content: flex-end;
  column-gap: 8px;
  margin-top: 16px;
`);
