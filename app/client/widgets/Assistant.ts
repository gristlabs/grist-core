import {
  Banner,
  buildBannerMessage,
  cssBannerLink,
} from "app/client/components/Banner";
import { GristDoc } from "app/client/components/GristDoc";
import { ChatHistory, ChatMessage } from "app/client/models/ChatHistory";
import { domAsync } from "app/client/lib/domAsync";
import { makeT } from "app/client/lib/localization";
import { sessionStorageBoolObs } from "app/client/lib/localStorageObs";
import { getLoginOrSignupUrl } from "app/client/lib/urlUtils";
import { constructUrl, urlState } from "app/client/models/gristUrlState";
import { showEnterpriseToggle } from "app/client/ui/ActivationPage";
import { buildCodeHighlighter } from "app/client/ui/CodeHighlight";
import { autoGrow } from "app/client/ui/forms";
import { sanitizeHTML } from "app/client/ui/sanitizeHTML";
import { createUserImage } from "app/client/ui/UserImage";
import { bigPrimaryButtonLink, primaryButton, textButton } from "app/client/ui2018/buttons";
import { colors, theme, vars } from "app/client/ui2018/cssVars";
import { gristThemeObs } from "app/client/ui2018/theme";
import { icon } from "app/client/ui2018/icons";
import { cssLink, gristIconLink } from "app/client/ui2018/links";
import { loadingDots } from "app/client/ui2018/loaders";
import { ApiError } from "app/common/ApiError";
import { AssistanceResponse } from "app/common/Assistance";
import { AsyncCreate } from "app/common/AsyncCreate";
import { DocAction } from "app/common/DocActions";
import { isFreePlan } from "app/common/Features";
import { commonUrls } from "app/common/gristUrls";
import { TelemetryEvent, TelemetryMetadata } from "app/common/Telemetry";
import { getGristConfig } from "app/common/urlUtils";
import {
  Computed,
  Disposable,
  dom,
  DomContents,
  DomElementArg,
  makeTestId,
  MutableObsArray,
  obsArray,
  Observable,
  styled,
  subscribeElem,
} from "grainjs";
import { marked, Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import { v4 as uuidv4 } from "uuid";

const t = makeT("Assistant");

const testId = makeTestId("test-assistant-");

const LOW_CREDITS_WARNING_BANNER_THRESHOLD = 10;

interface AssistantOptions {
  history: Observable<ChatHistory>;
  gristDoc: GristDoc;
  parentHeightPx?: Observable<number>;
  onSend(message: string): Promise<AssistanceResponse>;
  buildIntroMessage(...args: DomElementArg[]): DomContents;
  /**
   * Only used by version 1 of the AI assistant (`FormulaAssistant`).
   */
  onApplyFormula?(formula: string): Promise<void>;
  onEscape?(): void;
  logTelemetryEvent?(event: TelemetryEvent, includeContext?: boolean, metadata?: TelemetryMetadata): void;
}

/**
 * A widget that lets you talk to an AI-powered assistant.
 *
 * Displays a list of sent and received messages (`AssistantConversation`)
 * and inputs to send a new message.
 *
 * Used by both `FormulaAssistant` and `AssistantPopup`:
 *  - The former is a panel shown in `FormulaEditor` when version 1
 *    of the AI assistant is configured in the backend. Available in all
 *    flavors of Grist.
 *  - The latter is a popup opened from the left panel when version 2
 *    of the AI assistant in configured in the backend. Available in SaaS
 *    and Enterprise flavors of Grist.
 */
export class Assistant extends Disposable {
  private _history = this._options.history;
  private _gristDoc = this._options.gristDoc;
  private _appModel = this._gristDoc.appModel;
  private _parentHeightPx = this._options.parentHeightPx;
  private _conversation: AssistantConversation;
  /** State of the user input */
  private _userInput = Observable.create(this, "");
  /** Dom element that holds the user input */
  private _input: HTMLTextAreaElement;
  // Input wrapper element (used for resizing).
  private _inputWrapper: HTMLElement;
  /** Whether the low credit limit banner should be shown. */
  private _showApproachingLimitBanner = this.autoDispose(
    sessionStorageBoolObs(
      `org:${
        this._appModel.currentOrg?.id ?? 0
      };assistantShowApproachingLimitBanner`,
      true
    )
  );
  private _showUpgradeBanner = Computed.create(this, (use) => {
    const { assistant, deploymentType } = getGristConfig();
    return (
      assistant?.version === 1 &&
      deploymentType === "core" &&
      showEnterpriseToggle() &&
      !use(this._appModel.dismissedPopups).includes("upgradeNewAssistant")
    );
  });
  /** Number of remaining credits. If null, assistant usage is unlimited. */
  private _numRemainingCredits = Observable.create<number | null>(this, null);
  private _lastSendPromise: Promise<AssistanceResponse>|null = null;

  constructor(private _options: AssistantOptions) {
    super();

    this._conversation = AssistantConversation.create(this, {
      history: this._history,
      gristDoc: this._gristDoc,
      buildIntroMessage: this._options.buildIntroMessage,
      onClearConversation: this.clear.bind(this),
      onApplyFormula: this._options.onApplyFormula,
    });
  }

  public buildDom() {
    return [
      this._buildBanner(),
      this._conversation.buildDom(),
      this._appModel.currentValidUser
        ? this._buildChatInput()
        : this._buildSignupNudge(),
    ];
  }

  public async send(message: string): Promise<void> {
    this._conversation.addQuestion(message);
    this._userInput.set("");
    await this._doAsk(message);
  }

  public clear() {
    this._lastSendPromise = null;
    this._conversation.clear();
    this._userInput.set("");
    this._options.logTelemetryEvent?.("assistantClearConversation", true);
  }

  public focus() {
    if (!this._input) {
      return;
    }

    this._input.focus();
    if (this._input.value.length > 0) {
      // Make sure focus moves to the last character.
      this._input.selectionStart = this._input.value.length;
      this._input.scrollTop = this._input.scrollHeight;
    }
  }

  public scrollToBottom(options: { smooth?: boolean; sync?: boolean } = {}) {
    this._conversation.scrollDown(options);
  }

  public get conversationId() {
    return this._conversation.id.get();
  }

  public get conversationLength() {
    return this._conversation.length.get();
  }

  public get conversationHistoryLength() {
    return this._conversation.historyLength.get();
  }

  public get conversationSuggestedFormulas() {
    return this._conversation.suggestedFormulas.get();
  }

  private _buildBanner() {
    return dom.domComputed((use) => {
      const numCredits = use(this._numRemainingCredits);
      if (numCredits === 0) {
        return dom.create(Banner, {
          content: buildBannerMessage(
            t("You have used all available credits."),
            " ",
            this._buildBannerUpgradeMessage(),
            testId("banner-message")
          ),
          style: "error",
          bannerCssClass: cssBanner.className,
        });
      } else if (
        numCredits !== null &&
        numCredits <= LOW_CREDITS_WARNING_BANNER_THRESHOLD &&
        use(this._showApproachingLimitBanner)
      ) {
        return dom.create(Banner, {
          content: buildBannerMessage(
            t("You have {{numCredits}} remaining credits.", { numCredits }),
            " ",
            this._buildBannerUpgradeMessage(),
            testId("banner-message")
          ),
          style: "warning",
          showCloseButton: true,
          onClose: () => {
            this._showApproachingLimitBanner.set(false);
          },
          bannerCssClass: cssBanner.className,
        });
      } else if (use(this._showUpgradeBanner)) {
        return dom.create(Banner, {
          content: buildBannerMessage(
            t("Upgrade to Grist Enterprise to try the new Grist Assistant. {{learnMoreLink}}", {
              learnMoreLink: cssBannerAnchorLink(
                { href: commonUrls.helpAssistant, target: "_blank" },
                t("Learn more.")
              )
            }),
            testId("banner-message")
          ),
          style: "custom",
          background: "linear-gradient(to right, #29A3A3, #16A772)",
          showCloseButton: true,
          onClose: () => {
            this._appModel.dismissPopup("upgradeNewAssistant", true);
          },
          bannerCssClass: cssBanner.className,
        });
      }
    });
  }

  private _buildBannerUpgradeMessage() {
    const canUpgradeSite =
      this._appModel.isOwner() &&
      Boolean(this._appModel.planName && isFreePlan(this._appModel.planName));
    const isBillingManager =
      this._appModel.isBillingManager() || this._appModel.isSupport();
    if (!canUpgradeSite && !isBillingManager) {
      return t("For higher limits, contact the site owner.");
    }

    return t("For higher limits, {{upgradeNudge}}.", {
      upgradeNudge: cssBannerLink(
        canUpgradeSite
          ? t("upgrade to the Pro Team plan")
          : t("upgrade your plan"),
        dom.on("click", async () => {
          if (canUpgradeSite) {
            this._gristDoc.appModel.showUpgradeModal().catch(reportError);
          } else {
            await urlState().pushUrl({ billing: "billing" });
          }
        })
      ),
    });
  }

  /**
   * Builds the chat input at the bottom of the chat.
   */
  private _buildChatInput() {
    // Make sure we dispose the previous input.
    if (this._input) {
      dom.domDispose(this._input);
    }

    // Input is created by hand, as we need a finer control of the user input than what is available
    // in generic textInput control.
    this._input = cssInput(
      dom.on("input", (ev: Event) => {
        this._userInput.set((ev.target as HTMLInputElement).value);
      }),
      autoGrow(this._userInput),
      dom.style("max-height", (use) => {
        // Set an upper bound on the height the input can grow to, so that when the parent container
        // is resized, the input is automatically resized to fit and doesn't overflow.
        const panelHeight = this._parentHeightPx
          ? use(this._parentHeightPx)
          : 0;
        // The available input height is computed by taking the parent height, and subtracting
        // the heights of all the other elements (except for the input).
        const availableInputHeight =
          panelHeight -
          ((this._inputWrapper?.clientHeight ?? 0) -
            (this._input?.clientHeight ?? 0)) -
          MIN_CHAT_HISTORY_HEIGHT_PX;
        return `${Math.max(availableInputHeight, MIN_CHAT_INPUT_HEIGHT_PX)}px`;
      }),
      dom.onKeyDown({
        Enter$: (ev) => this._handleChatEnterKeyDown(ev),
        Escape: () => this._options.onEscape?.(),
      }),
      dom.autoDispose(
        this._userInput.addListener((value) => (this._input.value = value))
      ),
      dom.prop("disabled", this._conversation.thinking),
      dom.prop("placeholder", (use) => {
        const lastFormula = use(this._conversation.lastSuggestedFormula);
        if (lastFormula && this._options.onApplyFormula) {
          return t("Press Enter to apply suggested formula.");
        } else {
          return t("What do you need help with?");
        }
      }),
      dom.autoDispose(
        this._conversation.thinking.addListener((value) => {
          if (!value) {
            setTimeout(() => this.focus(), 0);
          }
        })
      ),
    );

    return (this._inputWrapper = cssHContainer(
      testId("input"),
      dom.cls(cssTopBorder.className),
      dom.cls(cssVSpace.className),
      cssInputWrapper(
        dom.cls(cssTypography.className),
        this._input,
        cssInputButtonsRow(
          cssSendButton(
            icon("FieldAny"),
            dom.on("click", this._ask.bind(this)),
            dom.show(use => !use(this._conversation.thinking)),
            cssButton.cls(
              "-disabled",
              (use) => use(this._conversation.thinking) || use(this._userInput).length === 0
            ),
            testId("send")
          ),
          cssCancelButton(
            cssCancelIcon("Stop"),
            dom.on("click", this._cancel.bind(this)),
            dom.show(this._conversation.thinking),
            testId("cancel")
          ),
          dom.on("click", (ev) => {
            ev.stopPropagation();
            this.focus();
          }),
          cssInputButtonsRow.cls("-disabled", this._conversation.thinking)
        ),
        cssInputWrapper.cls("-disabled", this._conversation.thinking)
      )
    ));
  }

  /**
   * Builds the signup nudge shown to anonymous users at the bottom of the chat.
   */
  private _buildSignupNudge() {
    const { deploymentType } = getGristConfig();
    return deploymentType === "saas" ? buildSignupNudge() : buildAnonNudge();
  }

  private _handleChatEnterKeyDown(ev: KeyboardEvent) {
    // If shift is pressed, we want to insert a new line.
    if (ev.shiftKey) {
      return;
    }

    ev.preventDefault();
    const lastFormula = this._conversation.lastSuggestedFormula.get();
    if (
      this._input.value === "" &&
      lastFormula &&
      this._options.onApplyFormula
    ) {
      this._options.onApplyFormula(lastFormula).catch(reportError);
    } else {
      this._ask().catch(reportError);
    }
  }

  private _addResponse(response: AssistanceResponse) {
    console.debug("received assistant response: ", response);
    const { reply, state, limit } = response;
    let suggestedActions: DocAction[] | undefined;
    let suggestedFormula: string | undefined;
    if (limit && limit.limit >= 0) {
      this._numRemainingCredits.set(Math.max(limit.limit - limit.usage, 0));
    } else {
      this._numRemainingCredits.set(null);
    }
    if ("suggestedFormula" in response) {
      suggestedFormula = response.suggestedFormula;
      suggestedActions = response.suggestedActions;
    }
    // If back-end is capable of conversation, keep its state.
    this._history.set({ ...this._history.get(), state });
    // If model has a conversational skills (and maintains a history), we might get actually
    // some markdown text back, so we need to parse it.
    const prettyMessage = state
      ? reply || suggestedFormula || ""
      : suggestedFormula || reply || "";
    // Add it to the chat.
    this._conversation.addResponse({
      message: prettyMessage,
      formula: suggestedFormula,
      action: suggestedActions?.[0],
      sender: "ai",
    });
  }

  private async _ask() {
    if (this._conversation.thinking.get()) {
      return;
    }
    const message = this._userInput.get();
    if (!message) {
      return;
    }
    this._conversation.addQuestion(message);
    this._userInput.set("");
    await this._doAsk(message);
  }

  private async _doAsk(message: string) {
    this._conversation.thinking.set(true);
    const sendPromise = this._options.onSend(message);
    this._lastSendPromise = sendPromise;
    try {
      const response = await sendPromise;
      if (this.isDisposed() || this._lastSendPromise !== sendPromise) {
        return;
      }

      this._addResponse(response);
    } catch (err: unknown) {
      if (this.isDisposed() || this._lastSendPromise !== sendPromise) {
        return;
      }

      if (err instanceof ApiError && err.status === 429 && err.details?.limit) {
        const { projectedValue, maximum } = err.details.limit;
        if (projectedValue >= maximum) {
          this._numRemainingCredits.set(0);
          return;
        }
      }
      if (err instanceof ApiError) {
        this._conversation.addError(err);
        return;
      }

      throw err;
    } finally {
      if (!this.isDisposed() && this._lastSendPromise === sendPromise) {
        this._conversation.thinking.set(false);
      }
    }
  }

  private _cancel() {
    this._lastSendPromise = null;
    this._conversation.thinking.set(false);
  }
}

const renderer = new marked.Renderer();

renderer.link = ({href, text}) => gristIconLink(constructUrl(href), text).outerHTML;


/**
 * A chat conversation. It is responsible for keeping the history of the chat and
 * sending messages to the AI.
 */
class AssistantConversation extends Disposable {
  private static _marked?: AsyncCreate<Marked>;

  public id: Observable<string>;
  public newMessages: MutableObsArray<ChatMessage>;
  public allMessages: MutableObsArray<ChatMessage>;
  public length: Computed<number>;
  public historyLength: Computed<number>;
  public suggestedFormulas: Computed<string[]>;
  public lastSuggestedFormula: Computed<string | null>;
  public thinking: Observable<boolean>;

  private _history = this._options.history;
  private _gristDoc = this._options.gristDoc;
  private _element: HTMLElement;

  constructor(
    private _options: {
      history: Observable<ChatHistory>;
      gristDoc: GristDoc;
      buildIntroMessage: (...args: DomElementArg[]) => DomContents;
      onClearConversation: () => void;
      onApplyFormula?: (formula: string) => void;
    }
  ) {
    super();

    if (!AssistantConversation._marked) {
      AssistantConversation._marked = new AsyncCreate(async () => {
        const highlight = await buildCodeHighlighter({ maxLines: 60 });
        return new Marked(
          markedHighlight({
            highlight: (code) => highlight(code),
          }),
        );
      });
    }

    let conversationId = this._history.get().conversationId;
    if (!conversationId) {
      conversationId = uuidv4();
      this._history.set({ ...this._history.get(), conversationId });
    }
    this.id = Observable.create(this, conversationId);
    this.autoDispose(
      this.id.addListener((newId) => {
        // If a new conversation id was generated (e.g. on Clear Conversation), save it.
        this._history.set({
          conversationId: newId,
          messages: [],
          state: undefined,
          developerPromptVersion: "default",
        });
        this.allMessages.set([]);
        this.newMessages.set([]);
      })
    );

    // Create observable array of messages that is connected to the ChatHistory.
    this.allMessages = this.autoDispose(obsArray(this._history.get().messages));
    this.autoDispose(
      this.allMessages.addListener((messages) => {
        this._history.set({ ...this._history.get(), messages: [...messages] });
      })
    );
    this.newMessages = this.autoDispose(obsArray());

    this.historyLength = Computed.create(
      this,
      (use) => use(this.allMessages).length
    );
    this.length = Computed.create(this, (use) => use(this.newMessages).length);

    this.suggestedFormulas = Computed.create(this, (use) => {
      return use(this.allMessages)
        .map(({ formula }) => formula)
        .filter((formula): formula is string => Boolean(formula));
    });
    this.lastSuggestedFormula = Computed.create(this, (use) => {
      return (
        [...use(this.allMessages)].reverse().find(({ formula }) => formula)
          ?.formula ?? null
      );
    });

    this.thinking = Observable.create(this, false);
    this.autoDispose(this.thinking.addListener((thinking) => {
      if (thinking) {
        this.scrollDown();
      }
    }));
  }

  public addResponse(message: ChatMessage) {
    // Clear any thinking from messages.
    this.thinking.set(false);
    const entry: ChatMessage = { ...message, sender: "ai" };
    this.allMessages.push(entry);
    this.newMessages.push(entry);
    this.scrollDown();
  }

  public addQuestion(message: string) {
    this.thinking.set(false);
    const entry: ChatMessage = { message, sender: "user" };
    this.allMessages.push(entry);
    this.newMessages.push(entry);
    this.scrollDown();
  }

  public addError(error: ApiError) {
    this.thinking.set(false);
    const entry: ChatMessage = { message: "", error, sender: "ai" };
    this.allMessages.push(entry);
    this.newMessages.push(entry);
    this.scrollDown();
  }

  public clear() {
    this.thinking.set(false);
    this.id.set(uuidv4());
  }

  public scrollDown(options: { smooth?: boolean; sync?: boolean } = {}) {
    if (!this._element) { return; }

    const { smooth = true, sync = false } = options;
    const scrollToOptions: ScrollToOptions = {
      top: 99999,
      behavior: smooth ? "smooth" : "auto",
    };
    if (sync) {
      this._element.scroll(scrollToOptions);
    } else {
      setTimeout(() => this._element.scroll(scrollToOptions), 0);
    }
  }

  public buildDom() {
    return domAsync(
      AssistantConversation._marked!.get().then(() => {
        return (this._element = cssHistory(
          this._buildIntroMessage(),
          dom.forEach(this.allMessages, (entry) => {
            if (entry.sender === "user") {
              return cssMessage(
                dom("span",
                  dom.text(entry.message),
                  testId("message-user"),
                  testId("message")
                ),
                cssAvatar(buildAvatar(this._gristDoc))
              );
            } else if (entry.error) {
              return cssAiMessage(
                cssAvatar(cssAiImage()),
                this._buildErrorMessage(entry.error)
              );
            } else {
              return dom("div",
                cssAiMessage(
                  cssAvatar(cssAiImage()),
                  this._render(
                    entry.message,
                    testId("message-ai"),
                    testId("message")
                  )
                ),
                !this._options.onApplyFormula
                  ? null
                  : cssAiMessageButtonsRow(
                      cssAiMessageButtons(
                        primaryButton(
                          t("Apply"),
                          dom.on("click", () => {
                            this._options.onApplyFormula?.(entry.formula!);
                          })
                        )
                      ),
                      dom.show(Boolean(entry.formula))
                    )
              );
            }
          }),
          dom.maybe(this.thinking, () =>
            dom("div",
              cssAiMessage(
                cssAvatar(cssAiImage()),
                cssLoadingDots()
              )
            )
          ),
          () => { this.scrollDown({ smooth: false }); },
        ));
      })
    );
  }

  private _buildErrorMessage(error: ApiError) {
    const code = error.details?.code;
    switch (code) {
      case "ContextLimitExceeded": {
        return dom("div",
          t(
            "The conversation has become too long and I can no longer \
respond effectively. Please {{startANewChatButton}} to continue \
receiving assistance.",
            {
              startANewChatButton: textButton(
                textButton.cls('-hover-bg-padding-sm'),
                t("start a new chat"),
                dom.on("click", () => this._options.onClearConversation()),
              )
            }
          )
        );
      }
      default: {
        return this._render(error.details?.userError ?? error.message);
      }
    }
  }

  private _buildIntroMessage() {
    return this._options.buildIntroMessage(
      testId("message-intro"),
    );
  }

  /**
   * Renders the message as markdown.
   */
  private _render(message: string, ...args: DomElementArg[]) {
    return domAsync(
      AssistantConversation._marked!.get().then(({ parse }) => {
        return dom("div",
          (el) =>
            subscribeElem(el, gristThemeObs(), () => {
              el.innerHTML = sanitizeHTML(
                parse(message, { async: false, renderer })
              );
            }),
          ...args
        );
      })
    );
  }
}

function buildSignupNudge() {
  return cssSignupNudgeWrapper(
    cssSignupNudgeParagraph(
      t("Sign up for a free Grist account to start using the AI Assistant.")
    ),
    cssSignupNudgeButtonsRow(
      bigPrimaryButtonLink(
        t("Sign Up for Free"),
        { href: getLoginOrSignupUrl() },
        testId("sign-up")
      )
    )
  );
}

function buildAnonNudge() {
  return cssSignupNudgeWrapper(
    cssSignupNudgeWrapper.cls("-center"),
    cssSignupNudgeParagraph(
      t("AI Assistant is only available for logged in users.")
    )
  );
}

/** Builds avatar image for user or assistant. */
function buildAvatar(grist: GristDoc) {
  const user = grist.app.topAppModel.appObs.get()?.currentUser || null;
  if (user) {
    return createUserImage(user, "medium");
  } else {
    // TODO: this will not happen, as this should be only for logged in users.
    return dom("div", "");
  }
}

const MIN_CHAT_HISTORY_HEIGHT_PX = 160;

const MIN_CHAT_INPUT_HEIGHT_PX = 42;

const cssHistory = styled("div", `
  overflow: auto;
  display: flex;
  flex-direction: column;
  color: ${theme.inputFg};
`);

const cssHContainer = styled("div", `
  margin-top: auto;
  padding-left: 18px;
  padding-right: 18px;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
`);

const cssTopBorder = styled("div", `
  border-top: 1px solid ${theme.formulaAssistantBorder};
`);

const cssVSpace = styled("div", `
  padding-top: 18px;
  padding-bottom: 18px;
`);

const cssInputButtonsRow = styled("div", `
  padding-top: 8px;
  width: 100%;
  justify-content: flex-end;
  cursor: text;
  display: flex;

  &-disabled {
    cursor: default;
  }
`);

const cssTypography = styled("div", `
  color: ${theme.inputFg};
`);

const cssButton = styled("div", `
  border-radius: 4px;
  display: flex;
  align-self: flex-end;
  margin-bottom: 6px;
  margin-right: 6px;

  &-disabled {
    --icon-color: ${theme.controlSecondaryFg};
  }

  &:not(&-disabled) {
    cursor: pointer;
    --icon-color: ${theme.controlPrimaryFg};
    color: ${theme.controlPrimaryFg};
    background-color: ${theme.controlPrimaryBg};
  }

  &:hover:not(&-disabled) {
    background-color: ${theme.controlPrimaryHoverBg};
  }
`);

const cssSendButton = styled(cssButton, `
  padding: 3px;
`);

const cssCancelButton = styled(cssButton, `
  padding: 6px;
`);

const cssCancelIcon = styled(icon, `
  width: 10px;
  height: 10px;
`);

const cssInputWrapper = styled("div", `
  display: flex;
  flex-direction: column;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  align-items: center;
  --icon-color: ${theme.controlSecondaryFg};
  &-disabled {
    background-color: ${theme.inputDisabledBg};
  }
  & > input {
    outline: none;
    padding: 0px;
    align-self: stretch;
    flex: 1;
    border: none;
    background-color: inherit;
  }
`);

const cssMessage = styled("div", `
  display: grid;
  grid-template-columns: 1fr 60px;
  border-top: 1px solid ${theme.formulaAssistantBorder};
  padding: 20px 0px 20px 20px;
`);

export const cssAiMessage = styled("div", `
  position: relative;
  display: grid;
  grid-template-columns: 60px 1fr;
  border-top: 1px solid ${theme.formulaAssistantBorder};
  padding: 20px 20px 20px 0px;
  white-space: normal;
  word-break: break-word;

  & h1, & h2, & h3, & h4, & h5, & h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
  }
  & h1 {
    padding-bottom: .3em;
    font-size: 2em;
  }
  & h2 {
    padding-bottom: .3em;
    font-size: 1.5em;
  }
  & h3 {
    font-size: 1.25em;
  }
  & h4 {
    font-size: 1em;
  }
  & h5 {
    font-size: .875em;
  }
  & h6 {
    color: ${theme.lightText};
    font-size: .85em;
  }
  & p, & blockquote, & ul, & ol, & dl, & pre {
    margin-top: 0px;
    margin-bottom: 10px;
  }
  & hr {
    border-color: ${theme.lightText};
  }
  & img {
    max-width: 100%;
  }
  & code, & pre {
    color: ${theme.text};
    font-size: 85%;
    background-color: ${theme.formulaAssistantPreformattedTextBg};
    border: 0;
    border-radius: 6px;
  }
  & code {
    padding: .2em .4em;
    margin: 0;
    white-space: pre-wrap;
  }
  & pre {
    padding: 16px;
    overflow: auto;
    line-height: 1.45;
  }
  & pre code {
    font-size: 100%;
    display: inline;
    max-width: auto;
    margin: 0;
    padding: 0;
    overflow: visible;
    line-height: inherit;
    word-wrap: normal;
    background: transparent;
  }
  & pre > code {
    background: transparent;
    margin: 0;
    padding: 0;
  }
  & pre .ace-chrome, & pre .ace-dracula {
    background: ${theme.formulaAssistantPreformattedTextBg} !important;
  }
  & .ace_indent-guide {
    background: none;
  }
  & .ace_static_highlight {
    white-space: pre-wrap;
  }
  & ul, & ol {
    padding-left: 2em;
  }
  & li > ol, & li > ul {
    margin: 0;
  }
  & li + li,
  & li > ol > li:first-child,
  & li > ul > li:first-child {
    margin-top: .25em;
  }
  & blockquote {
    font-size: ${vars.mediumFontSize};
    border-left: .25em solid ${theme.markdownCellMediumBorder};
    padding: 0 1em;
  }
  & table {
    margin: 0 0 10px;
    border: 1px solid ${theme.tableBodyBorder};
  }
  & table > thead > tr {
    background-color: ${theme.tableHeaderBg};
  }
  & table > tbody > tr {
    background-color: ${theme.tableBodyBg};
  }
  & table th,
  & table td {
    border: 1px solid ${theme.tableBodyBorder};
    padding: 6px 13px;
  }
`);

export const cssAvatar = styled("div", `
  display: flex;
  align-items: flex-start;
  justify-content: center;
`);

export const cssAiImage = styled("div", `
  flex: none;
  height: 32px;
  width: 32px;
  border-radius: 50%;
  background-color: white;
  background-image: var(--icon-GristLogo);
  background-size: 22px 22px;
  background-repeat: no-repeat;
  background-position: center;
`);

const cssAiMessageButtonsRow = styled("div", `
  display: flex;
  justify-content: flex-end;
  padding: 8px;
`);

const cssAiMessageButtons = styled("div", `
  display: flex;
  column-gap: 8px;
`);

const cssInput = styled("textarea", `
  border: 0px;
  flex-grow: 1;
  outline: none;
  width: 100%;
  padding: 4px 6px;
  padding-top: 6px;
  resize: none;
  min-height: ${MIN_CHAT_INPUT_HEIGHT_PX}px;
  background: transparent;

  &:disabled {
    background-color: ${theme.inputDisabledBg};
    color: ${theme.inputDisabledFg};
  }

  &::placeholder {
    color: ${theme.inputPlaceholderFg};
  }
`);

const cssLoadingDots = styled(loadingDots, `
  --dot-size: 5px;
  align-items: center;
`);

const cssSignupNudgeWrapper = styled("div", `
  border-top: 1px solid ${theme.formulaAssistantBorder};
  padding: 16px;
  margin-top: auto;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;

  &-center {
    display: flex;
    justify-content: center;
    align-items: center;
  }
`);

const cssSignupNudgeParagraph = styled("div", `
  color: ${theme.text};
  font-size: ${vars.mediumFontSize};
  font-weight: 500;
  margin-bottom: 12px;
  text-align: center;
`);

const cssSignupNudgeButtonsRow = styled("div", `
  display: flex;
  justify-content: center;
`);

const cssBanner = styled("div", `
  padding: 6px 8px 6px 8px;
  text-align: center;
`);

const cssBannerAnchorLink = styled(cssLink, `
  color: ${colors.light};

  &:hover {
    color: ${colors.light};
  }
`);
