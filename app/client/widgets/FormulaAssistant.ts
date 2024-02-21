import {Banner, buildBannerMessage, cssBannerLink} from 'app/client/components/Banner';
import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {localStorageBoolObs, sessionStorageBoolObs} from 'app/client/lib/localStorageObs';
import {movable} from 'app/client/lib/popupUtils';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {ColumnRec, ViewFieldRec} from 'app/client/models/DocModel';
import {ChatMessage} from 'app/client/models/entities/ColumnRec';
import {HAS_FORMULA_ASSISTANT, WHICH_FORMULA_ASSISTANT} from 'app/client/models/features';
import {getLoginOrSignupUrl, urlState} from 'app/client/models/gristUrlState';
import {buildHighlightedCode} from 'app/client/ui/CodeHighlight';
import {autoGrow} from 'app/client/ui/forms';
import {sanitizeHTML} from 'app/client/ui/sanitizeHTML';
import {createUserImage} from 'app/client/ui/UserImage';
import {basicButton, bigPrimaryButtonLink, primaryButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {loadingDots} from 'app/client/ui2018/loaders';
import {menu, menuCssClass, menuItem} from 'app/client/ui2018/menus';
import {FormulaEditor} from 'app/client/widgets/FormulaEditor';
import {ApiError} from 'app/common/ApiError';
import {AssistanceResponse, AssistanceState, FormulaAssistanceContext} from 'app/common/AssistancePrompts';
import {isFreePlan} from 'app/common/Features';
import {commonUrls} from 'app/common/gristUrls';
import {TelemetryEvent, TelemetryMetadata} from 'app/common/Telemetry';
import {getGristConfig} from 'app/common/urlUtils';
import {Computed, Disposable, dom, DomElementArg, makeTestId, MutableObsArray,
        obsArray, Observable, styled, subscribeElem} from 'grainjs';
import debounce from 'lodash/debounce';
import noop from 'lodash/noop';
import {marked} from 'marked';
import {v4 as uuidv4} from 'uuid';

const t = makeT('FormulaEditor');
const testId = makeTestId('test-formula-editor-');

const LOW_CREDITS_WARNING_BANNER_THRESHOLD = 10;

/**
 * An extension or the FormulaEditor that provides assistance for writing formulas.
 * It renders itself in the detached FormulaEditor and adds some extra UI elements.
 * - Save button: a subscription for the Enter key that saves the formula and closes the assistant.
 * - Preview button: a new functionality that allows to preview the formula in a temporary column.
 * - Cancel button: a subscription for the Escape key that discards all changes and closes the assistant.
 * - A chat component: that allows to communicate with the assistant.
 */
export class FormulaAssistant extends Disposable {
  private _gristDoc = this._options.gristDoc;
  private _appModel = this._gristDoc.appModel;
  /** Chat component */
  private _chat: ChatHistory;
  /** State of the user input */
  private _userInput = Observable.create(this, '');
  /** Dom element that holds the user input */
  // TODO: move it to a separate component
  private _input: HTMLTextAreaElement;
  /** Is the formula assistant expanded */
  private _assistantExpanded = this.autoDispose(localStorageBoolObs(
    `u:${this._appModel.currentUser?.id ?? 0};formulaAssistantExpanded`, true));
  /** Is the request pending */
  private _waiting = Observable.create(this, false);
  /** Is assistant features are enabled */
  private _assistantEnabled: boolean;
  /** Preview column ref */
  private _transformColRef: string;
  /** Preview column id */
  private _transformColId: string;
  /** Method to invoke when we are closed, it saves or reverts */
  private _triggerFinalize: (() => void) = noop;
  /** What action button was clicked, by default close without saving */
  private _action: 'save' | 'cancel' | 'close' = 'close';
  // Our dom element (used for resizing).
  private _domElement: HTMLElement;
  // Input wrapper element (used for resizing).
  private _inputWrapper: HTMLElement;
  /** Chat panel body element. */
  private _chatPanelBody: HTMLElement;
  /** Client height of the chat panel body element. */
  private _chatPanelBodyClientHeight = Observable.create<number>(this, 0);
  /** Set to true the first time the panel has been expanded (including by default). */
  private _hasExpandedOnce = false;
  /**
   * Last known height of the chat panel.
   *
   * This is like `_chatPanelBodyClientHeight`, but updated only for the purposes of
   * being able to collapse and expand the panel to a known height.
   */
  private _lastChatPanelHeight: number|undefined;
  /** True if the chat panel is being resized via dragging. */
  private _isResizing = Observable.create(this, false);
  /** Whether the low credit limit banner should be shown. */
  private _showApproachingLimitBanner = this.autoDispose(
    sessionStorageBoolObs(
      `org:${this._appModel.currentOrg?.id ?? 0};formulaAssistantShowApproachingLimitBanner`,
      true
    ));
  /** Number of remaining credits. If null, assistant usage is unlimited. */
  private _numRemainingCredits = Observable.create<number|null>(this, null);

  /**
   * Debounced version of the method that will force parent editor to resize, we call it often
   * as we have an ability to resize the chat window.
   */
  private _resizeEditor = debounce(() => {
    if (!this.isDisposed()) {
      this._options.editor.resize();
    }
  }, 10);

  constructor(private _options: {
    column: ColumnRec,
    field?: ViewFieldRec,
    gristDoc: GristDoc,
    editor: FormulaEditor
  }) {
    super();

    this._assistantEnabled = HAS_FORMULA_ASSISTANT();

    if (!this._options.field) {
      // TODO: field is not passed only for rules (as there is no preview there available to the user yet)
      // this should be implemented but it requires creating a helper column to helper column and we don't
      // have infrastructure for that yet.
      throw new Error('Formula assistant requires a field to be passed.');
    }

    this._chat = ChatHistory.create(this, {
      ...this._options,
      apply: this._apply.bind(this),
      logTelemetryEvent: this._logTelemetryEvent.bind(this),
    });

    this.autoDispose(commands.createGroup({
      activateAssistant: () => {
        this._expandChatPanel();
        setTimeout(() => {
          this._focusChatInput();
        }, 0);
      }
    }, this, true));

    // Unfortunately we need to observe the size of the formula editor dom and resize it accordingly.
    const observer = new ResizeObserver(this._resizeEditor);
    observer.observe(this._options.editor.getDom());
    this.onDispose(() => observer.disconnect());

    // Start bundling all actions from this moment on and close the editor as soon,
    // as user tries to do something different.
    const bundleInfo = this._options.gristDoc.docData.startBundlingActions({
      description: 'Formula Editor',
      prepare: () => this._preparePreview(),
      finalize: () => this._cleanupPreview(),
      shouldIncludeInBundle: (actions) => {
        if (actions.length !== 1) { return false; }

        const actionName = actions[0][0];
        if (actionName === 'ModifyColumn') {
          const tableId = this._options.column.table.peek().tableId.peek();
          return actions[0][1] === tableId
            && typeof actions[0][2] === 'string'
            && [this._transformColId, this._options.column.id.peek()].includes(actions[0][2]);
        } else if (actionName === 'UpdateRecord') {
          return actions[0][1] === '_grist_Tables_column' && actions[0][2] === this._transformColRef;
        } else {
          return false;
        }
      }
    });

    this._triggerFinalize = bundleInfo.triggerFinalize;
    this.onDispose(() => {
      if (this._hasExpandedOnce) {
        const suggestionApplied = this._chat.conversationSuggestedFormulas.get()
          .includes(this._options.column.formula.peek());
        if (suggestionApplied) {
          this._logTelemetryEvent('assistantApplySuggestion', false, {
            conversationLength: this._chat.conversationLength.get(),
            conversationHistoryLength: this._chat.conversationHistoryLength.get(),
          });
        }
        this._logTelemetryEvent('assistantClose', false, {
          suggestionApplied,
          conversationLength: this._chat.conversationLength.get(),
          conversationHistoryLength: this._chat.conversationHistoryLength.get(),
        });
      }

      // This will be noop if already called.
      this._triggerFinalize();
    });
  }

  // The main dom added to the editor and the bottom (3 buttons and chat window).
  public buildDom() {
    // When the tools are resized, resize the editor.
    const observer = new ResizeObserver(this._resizeEditor);
    this._domElement = cssTools(
      (el) => observer.observe(el),
      dom.onDispose(() => observer.disconnect()),
      cssButtons(
        basicButton(t('Cancel'), dom.on('click', () => {
          this._cancel();
        }), testId('cancel-button')),
        basicButton(t('Preview'), dom.on('click', async () => {
          await this._preview();
        }), testId('preview-button')),
        primaryButton(t('Save'), dom.on('click', () => {
          this._saveOrClose();
        }), testId('save-button')),
      ),
      this._buildChatPanel(),
    );

    if (this._assistantEnabled) {
      if (!this._assistantExpanded.get()) {
        this._chatPanelBody.style.setProperty('height', '0px');
      } else {
        // The actual height doesn't matter too much here, so we just pick
        // a value that guarantees the assistant will fill as much of the
        // available space as possible.
        this._chatPanelBody.style.setProperty('height', '999px');
      }
    }

    if (this._assistantEnabled && this._assistantExpanded.get()) {
      this._logTelemetryEvent('assistantOpen', true);
      this._hasExpandedOnce = true;
    }

    return this._domElement;
  }

  private _buildChatPanel() {
    return dom.maybe(this._assistantEnabled, () => {
      return cssChatPanel(
        cssChatPanelHeaderResizer(
          movable({
            onStart: this._onResizeStart.bind(this),
            onMove: this._onResizeMove.bind(this),
            onEnd: this._onResizeEnd.bind(this),
          }),
          cssChatPanelHeaderResizer.cls('-collapsed', use => !use(this._assistantExpanded)),
        ),
        this._buildChatPanelHeader(),
        this._buildChatPanelBody(),
      );
    });
  }

  private _logTelemetryEvent(event: TelemetryEvent, includeContext = false, metadata: TelemetryMetadata = {}) {
    logTelemetryEvent(event, {
      full: {
        docIdDigest: this._gristDoc.docId(),
        conversationId: this._chat.conversationId.get(),
        ...(!includeContext ? {} : {context: {
          type: 'formula',
          tableId: this._options.column.table.peek().tableId.peek(),
          colId: this._options.column.colId.peek(),
        } as FormulaAssistanceContext}),
        ...metadata,
      },
    });
  }

  private _buildChatPanelHeader() {
    return cssChatPanelHeader(
      cssChatPanelHeaderTitle(
        icon('Robot'),
        t('AI Assistant'),
      ),
      cssChatPanelHeaderButtons(
        cssChatPanelHeaderButton(
          dom.domComputed(this._assistantExpanded, isExpanded => isExpanded
            ? icon('Dropdown') : icon('DropdownUp')),
          dom.on('click', () => {
            if (this._assistantExpanded.get()) {
              this._collapseChatPanel();
            } else {
              this._expandChatPanel();
            }
          }),
          testId('ai-assistant-expand-collapse'),
        ),
        cssChatPanelHeaderButton(
          icon('Dots'),
          menu(() => [
            menuItem(
              () => this._clear(),
              t('Clear Conversation'),
              testId('ai-assistant-options-clear-conversation'),
            ),
          ], {menuCssClass: menuCssClass + ' ' + cssChatOptionsMenu.className}),
          testId('ai-assistant-options'),
        ),
      ),
    );
  }

  private _buildChatPanelBody() {
    setTimeout(() => {
      if (!this.isDisposed()) {
        // Scroll to the bottom of the chat right after it is rendered without the animation.
        this._chat.scrollDown(false);
      }
      this._options.editor.resize();
    }, 0);

    const observer = new ResizeObserver(() => {
      // Keep track of changes to the chat panel body height; its children need to know it to adjust
      // their max heights accordingly.
      this._chatPanelBodyClientHeight.set(this._chatPanelBody.clientHeight);
    });

    this._chatPanelBody = cssChatPanelBody(
      dom.onDispose(() => observer.disconnect()),
      testId('ai-assistant-chat-panel'),
      this._buildChatPanelBanner(),
      this._chat.buildDom(),
      this._appModel.currentValidUser ? this._buildChatInput() : this._buildSignupNudge(),
      cssChatPanelBody.cls('-resizing', this._isResizing),
      // Stop propagation of mousedown events, as the formula editor will still focus.
      dom.on('mousedown', (ev) => ev.stopPropagation()),
    );

    observer.observe(this._chatPanelBody);

    return this._chatPanelBody;
  }

  private _buildChatPanelBanner() {
    return dom.domComputed(use => {
      const numCredits = use(this._numRemainingCredits);
      if (
        numCredits === null ||
        numCredits > LOW_CREDITS_WARNING_BANNER_THRESHOLD
      ) {
        return null;
      } else if (numCredits === 0) {
        return dom.create(Banner, {
          content: buildBannerMessage(
            t('You have used all available credits.'),
            ' ',
            this._buildBannerUpgradeMessage(),
            testId('ai-assistant-banner-message'),
          ),
          style: 'error',
          bannerCssClass: cssBanner.className,
        });
      } else {
        const showBanner = use(this._showApproachingLimitBanner);
        if (!showBanner) { return null; }

        return dom.create(Banner, {
          content: buildBannerMessage(
            t('You have {{numCredits}} remaining credits.', {numCredits}),
            ' ',
            this._buildBannerUpgradeMessage(),
            testId('ai-assistant-banner-message'),
          ),
          style: 'warning',
          showCloseButton: true,
          onClose: () => { this._showApproachingLimitBanner.set(false); },
          bannerCssClass: cssBanner.className,
        });
      }
    });
  }

  private _buildBannerUpgradeMessage() {
    const canUpgradeSite = this._appModel.isOwner()
      && Boolean(this._appModel.planName && isFreePlan(this._appModel.planName));
    const isBillingManager = this._appModel.isBillingManager() || this._appModel.isSupport();
    if (!canUpgradeSite && !isBillingManager) {
      return t('For higher limits, contact the site owner.');
    }

    return t('For higher limits, {{upgradeNudge}}.', {upgradeNudge: cssBannerLink(
      canUpgradeSite ? t('upgrade to the Pro Team plan') : t('upgrade your plan'),
      dom.on('click', async () => {
        if (canUpgradeSite) {
          this._gristDoc.appModel.showUpgradeModal();
        } else {
          await urlState().pushUrl({billing: 'billing'});
        }
      }))
    });
  }

  /**
   * Save button handler. We just store the action and wait for the bundler to finalize.
   */
  private _saveOrClose() {
    if (this._hasExpandedOnce) {
      this._logTelemetryEvent('assistantSave', true, {
        oldFormula: this._options.column.formula.peek(),
        newFormula: this._options.editor.getTextValue(),
      });
    }
    this._action = 'save';
    this._triggerFinalize();
  }

  /**
   * Cancel button handler.
   */
  private _cancel() {
    if (this._hasExpandedOnce) {
      this._logTelemetryEvent('assistantCancel', true, {
        conversationLength: this._chat.conversationLength.get(),
      });
    }
    this._action = 'cancel';
    this._triggerFinalize();
  }

  /**
   * Preview button handler.
   */
  private async _preview() {
    const tableId = this._options.column.table.peek().tableId.peek();
    const formula = this._options.editor.getCellValue();
    const isFormula = true;
    await this._options.gristDoc.docData.sendAction(
      ['ModifyColumn', tableId, this._transformColId, {formula, isFormula}
    ]);
    if (!this.isDisposed()) {
      this._options.editor.focus();
    }
  }

  private async _preparePreview() {
    const docData = this._options.gristDoc.docData;
    const tableId = this._options.column.table.peek().tableId.peek();

    // Add a new column to the table, and set it as the transform column.
    const {colRef, colId} = await docData.sendAction(['AddColumn', tableId, 'gristHelper_Transform', {
      type: this._options.column.type.peek(),
      label: this._options.column.colId.peek(),
      isFormula: true,
      formula: this._options.column.formula.peek(),
      widgetOptions: JSON.stringify(this._options.field?.widgetOptionsJson()),
    }]);

    this._transformColRef = colRef;
    this._transformColId = colId;

    const rules = this._options.field?.rulesList();
    if (rules) {
      await docData.sendAction(['UpdateRecord', '_grist_Tables_column', colRef, {
        rules: this._options.field?.rulesList(),
      }]);
    }

    this._options.field?.colRef(colRef); // Don't save, it is only in browser.

    // Update the transform column so that it points to the original column.
    const transformColumn = this._options.field?.column.peek();
    if (transformColumn) {
      transformColumn.isTransforming(true);
      this._options.column.isTransforming(true);
      transformColumn.origColRef(this._options.column.getRowId()); // Don't save
    }
  }

  private async _cleanupPreview() {
    // Mark that we did finalize already.
    this._triggerFinalize = noop;
    const docData = this._options.gristDoc.docData;
    const tableId = this._options.column.table.peek().tableId.peek();
    const column = this._options.column;
    try {
      if (this._action === 'save') {
        const formula = this._options.editor.getCellValue();
        // Modify column right away, so that it looks smoother on the ui, when we
        // switch the column for the field.
        await docData.sendActions([
          ['ModifyColumn', tableId, column.colId.peek(), { formula, isFormula: true}],
        ]);
      }
      // Switch the column for the field, this isn't sending any actions, we are just restoring it to what it is
      // in database. But now the column has already correct data as it was already calculated.
      this._options.field?.colRef(column.getRowId());

      // Now trigger the action in our owner that should dispose us. The save
      // method will be no op if we saved anything.
      if (this._action === 'save') {
        commands.allCommands.fieldEditSaveHere.run();
      } else if (this._action === 'cancel') {
        commands.allCommands.fieldEditCancel.run();
      } else {
        if (this._action !== 'close') {
          throw new Error('Unexpected value for _action');
        }
        if (!this.isDisposed()) {
          commands.allCommands.fieldEditCancel.run();
        }
      }
      await docData.sendActions([
        ['RemoveColumn', tableId, this._transformColId]
      ]);
    } finally {
      // Repeat the change, in case of an error.
      this._options.field?.colRef(column.getRowId());
      column.isTransforming(false);
    }
  }

  private _collapseChatPanel() {
    if (!this._assistantExpanded.get()) { return; }

    this._assistantExpanded.set(false);
    // The panel's height and client height may differ; to ensure the collapse transition
    // appears linear, temporarily disable the transition and sync the height and client
    // height.
    this._chatPanelBody.style.setProperty('transition', 'none');
    this._chatPanelBody.style.setProperty('height', `${this._chatPanelBody.clientHeight}px`);
    // eslint-disable-next-line no-unused-expressions
    this._chatPanelBody.offsetHeight; // Flush CSS changes.
    this._chatPanelBody.style.removeProperty('transition');
    this._chatPanelBody.style.setProperty('height', '0px');
    this._resizeEditor();
  }

  private _expandChatPanel() {
    if (!this._hasExpandedOnce) {
      this._logTelemetryEvent('assistantOpen', true);
      this._hasExpandedOnce = true;
    }
    if (this._assistantExpanded.get()) { return; }

    this._assistantExpanded.set(true);
    const editor = this._options.editor.getDom();
    let availableSpace = editor.clientHeight - MIN_FORMULA_EDITOR_HEIGHT_PX
      - FORMULA_EDITOR_BUTTONS_HEIGHT_PX - CHAT_PANEL_HEADER_HEIGHT_PX;
    if (editor.querySelector('.error_msg')) {
      availableSpace -= editor.querySelector('.error_msg')!.clientHeight;
    }
    if (editor.querySelector('.error_details')) {
      availableSpace -= editor.querySelector('.error_details')!.clientHeight;
    }
    if (this._lastChatPanelHeight) {
      const height = Math.min(Math.max(this._lastChatPanelHeight, 220), availableSpace);
      this._chatPanelBody.style.setProperty('height', `${height}px`);
      this._lastChatPanelHeight = height;
    } else {
      this._lastChatPanelHeight = availableSpace;
      this._chatPanelBody.style.setProperty('height', `${this._lastChatPanelHeight}px`);
    }
    this._resizeEditor();
  }

  private _onResizeStart() {
    this._isResizing.set(true);
    const start = this._domElement?.clientHeight;
    const total = this._options.editor.getDom().clientHeight;
    return {
      start, total
    };
  }

  /**
   * Resize handler for the chat window.
   */
  private _onResizeMove(x: number, y: number, {start, total}: {start: number, total: number}): void {
    // The y axis includes the panel header and formula editor buttons; excluded them from the
    // new height of the panel body.
    const newChatPanelBodyHeight = start - y - CHAT_PANEL_HEADER_HEIGHT_PX - FORMULA_EDITOR_BUTTONS_HEIGHT_PX;

    // Toggle `_isResizing` whenever the new panel body height crosses the threshold for the minimum
    // height. As of now, the sole purpose of this observable is to control when the animation for
    // expanding and collapsing is shown.
    if (newChatPanelBodyHeight < MIN_CHAT_PANEL_BODY_HEIGHT_PX && this._isResizing.get()) {
      this._isResizing.set(false);
    } else if (newChatPanelBodyHeight >= MIN_CHAT_PANEL_BODY_HEIGHT_PX && !this._isResizing.get()) {
      this._isResizing.set(true);
    }

    const collapseThreshold = 78;
    if (newChatPanelBodyHeight < collapseThreshold) {
      this._collapseChatPanel();
    } else {
      this._expandChatPanel();
      const calculatedHeight = Math.max(
        MIN_CHAT_PANEL_BODY_HEIGHT_PX,
        Math.min(total - MIN_FORMULA_EDITOR_HEIGHT_PX, newChatPanelBodyHeight)
      );
      this._chatPanelBody.style.height = `${calculatedHeight}px`;
    }
  }

  private _onResizeEnd() {
    this._isResizing.set(false);
    if (this._assistantExpanded.get()) {
      this._lastChatPanelHeight = this._chatPanelBody.clientHeight;
    }
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
      dom.on('input', (ev: Event) => {
        this._userInput.set((ev.target as HTMLInputElement).value);
      }),
      autoGrow(this._userInput),
      dom.style('max-height', use => {
        // Set an upper bound on the height the input can grow to, so that when the chat panel
        // is resized, the input is automatically resized to fit and doesn't overflow.
        const panelHeight = use(this._chatPanelBodyClientHeight);
        // The available input height is computed by taking the the panel height, and subtracting
        // the heights of all the other elements (except for the input).
        const availableInputHeight = panelHeight -
          ((this._inputWrapper?.clientHeight ?? 0) - (this._input?.clientHeight ?? 0)) -
          MIN_CHAT_HISTORY_HEIGHT_PX;
        return `${Math.max(availableInputHeight, MIN_CHAT_INPUT_HEIGHT_PX)}px`;
      }),
      dom.onKeyDown({
        Enter$: (ev) => this._handleChatEnterKeyDown(ev),
        Escape: () => this._cancel(),
      }),
      dom.autoDispose(this._userInput.addListener(value => this._input.value = value)),
      dom.prop('disabled', this._waiting),
      dom.prop('placeholder', use => {
        const lastFormula  = use(this._chat.lastSuggestedFormula);
        if (lastFormula) {
          return t('Press Enter to apply suggested formula.');
        } else {
          return t('What do you need help with?');
        }
      }),
      dom.autoDispose(this._waiting.addListener(value => {
        if (!value) {
          setTimeout(() => this._focusChatInput(), 0);
        }
      })),
    );

    return this._inputWrapper = cssHContainer(
      testId('ai-assistant-chat-input'),
      dom.cls(cssTopBorder.className),
      dom.cls(cssVSpace.className),
      cssInputWrapper(
        dom.cls(cssTypography.className),
        this._input,
        cssInputButtonsRow(
          cssSendMessageButton(
            icon('FieldAny'),
            dom.on('click', this._handleSendMessageClick.bind(this)),
            cssSendMessageButton.cls('-disabled', use =>
              use(this._waiting) || use(this._userInput).length === 0
            ),
          ),
          dom.on('click', (ev) => {
            ev.stopPropagation();
            this._focusChatInput();
          }),
          cssInputButtonsRow.cls('-disabled', this._waiting),
        ),
        cssInputWrapper.cls('-disabled', this._waiting),
      ),
    );
  }

  /**
   * Builds the signup nudge shown to anonymous users at the bottom of the chat.
   */
  private _buildSignupNudge() {
    const {deploymentType} = getGristConfig();
    return deploymentType === 'saas' ? buildSignupNudge() : buildAnonNudge();
  }

  private async _handleChatEnterKeyDown(ev: KeyboardEvent) {
    // If shift is pressed, we want to insert a new line.
    if (ev.shiftKey) { return; }

    ev.preventDefault();
    const lastFormula = this._chat.lastSuggestedFormula.get();
    if (this._input.value === '' && lastFormula) {
      this._apply(lastFormula).catch(reportError);
    } else {
      this._ask().catch(reportError);
    }
  }

  private async _handleSendMessageClick(ev: MouseEvent) {
    if (this._waiting.get() || this._input.value.length === 0) { return; }

    await this._ask();
  }

  private async _apply(formula: string) {
    this._options.editor.setFormula(formula);
    this._resizeEditor();
    await this._preview();
  }

  private async _sendMessage(description: string): Promise<ChatMessage> {
    // Destruct options.
    const {column, gristDoc} = this._options;
    // Get the state of the chat from the column.
    const conversationId = this._chat.conversationId.get();
    const prevState = column.chatHistory.peek().get().state;
    const {reply, suggestedActions, suggestedFormula, state, limit} = await askAI(gristDoc, {
      conversationId,
      column,
      description,
      state: prevState,
    });
    if (limit && limit.limit >= 0) {
      this._numRemainingCredits.set(Math.max(limit.limit - limit.usage, 0));
    } else {
      this._numRemainingCredits.set(null);
    }
    console.debug('received formula assistant response: ', {suggestedActions, suggestedFormula, reply, state});
    // If back-end is capable of conversation, keep its state.
    const chatHistoryNew = column.chatHistory.peek();
    const value = chatHistoryNew.get();
    value.state = state;
    // If model has a conversational skills (and maintains a history), we might get actually
    // some markdown text back, so we need to parse it.
    const prettyMessage = state ? (reply || suggestedFormula || '') : (suggestedFormula || reply || '');
    // Add it to the chat.
    return {
      message: prettyMessage,
      formula: suggestedFormula,
      action: suggestedActions[0],
      sender: 'ai',
    };
  }

  private _focusChatInput() {
    if (!this._input) { return; }

    this._input.focus();
    if (this._input.value.length > 0) {
      // Make sure focus moves to the last character.
      this._input.selectionStart = this._input.value.length;
      this._input.scrollTop = this._input.scrollHeight;
    }
  }

  private _clear() {
    this._chat.clear();
    this._userInput.set('');
  }

  private async _ask() {
    if (this._waiting.get()) {
      return;
    }
    const message = this._userInput.get();
    if (!message) { return; }
    this._chat.addQuestion(message);
    this._userInput.set('');
    await this._doAsk(message);
  }

  private async _doAsk(message: string) {
    this._chat.thinking();
    this._waiting.set(true);
    try {
      const response = await this._sendMessage(message);
      this._chat.addResponse(response);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 429 && err.details?.limit) {
        const {projectedValue, maximum} = err.details.limit;
        if (projectedValue >= maximum) {
          this._numRemainingCredits.set(0);
          return;
        }
      }

      throw err;
    } finally {
      this._chat.thinking(false);
      this._waiting.set(false);
    }
  }
}

/**
 * A model for the chat panel. It is responsible for keeping the history of the chat and
 * sending messages to the AI.
 */
class ChatHistory extends Disposable {
  public conversationId: Observable<string>;
  public conversation: MutableObsArray<ChatMessage>;
  public conversationHistory: MutableObsArray<ChatMessage>;
  public conversationLength: Computed<number>;
  public conversationHistoryLength: Computed<number>;
  public conversationSuggestedFormulas: Computed<string[]>;
  public lastSuggestedFormula: Computed<string|null>;

  private _element: HTMLElement;

  constructor(private _options: {
    column: ColumnRec,
    gristDoc: GristDoc,
    apply: (formula: string) => void,
    logTelemetryEvent: (event: TelemetryEvent, includeContext?: boolean, metadata?: TelemetryMetadata) => void,
  }) {
    super();

    const column = this._options.column;
    let conversationId = column.chatHistory.peek().get().conversationId;
    if (!conversationId) {
      conversationId = uuidv4();
      const chatHistory = column.chatHistory.peek();
      chatHistory.set({...chatHistory.get(), conversationId});
    }
    this.conversationId = Observable.create(this, conversationId);
    this.autoDispose(this.conversationId.addListener((newConversationId) => {
      // If a new conversation id was generated (e.g. on Clear Conversation), save it
      // to the column's history.
      const chatHistory = column.chatHistory.peek();
      chatHistory.set({...chatHistory.get(), conversationId: newConversationId});
    }));

    // Create observable array of messages that is connected to the column's chatHistory.
    this.conversationHistory = this.autoDispose(obsArray(column.chatHistory.peek().get().messages));
    this.autoDispose(this.conversationHistory.addListener((cur) => {
      const chatHistory = column.chatHistory.peek();
      chatHistory.set({...chatHistory.get(), messages: [...cur]});
    }));
    this.conversation = this.autoDispose(obsArray());

    this.conversationHistoryLength = Computed.create(this, use => use(this.conversationHistory).length);
    this.conversationLength = Computed.create(this, use => use(this.conversation).length);

    this.conversationSuggestedFormulas = Computed.create(this, use => {
      return use(this.conversation)
        .map(({formula}) => formula)
        .filter((formula): formula is string => Boolean(formula));
    });
    this.lastSuggestedFormula = Computed.create(this, use => {
      return [...use(this.conversationHistory)].reverse().find(({formula}) => formula)?.formula ?? null;
    });
  }

  public thinking(on = true) {
    if (!on) {
      // Find all index of all thinking messages.
      const messages = [...this.conversationHistory.get()].filter(m => m.message === '...');
      // Remove all thinking messages.
      for (const message of messages) {
        this.conversationHistory.splice(this.conversationHistory.get().indexOf(message), 1);
      }
    } else {
      this.conversationHistory.push({
        message: '...',
        sender: 'ai',
      });
      this.scrollDown();
    }
  }

  public supportsMarkdown() {
    return this._options.column.chatHistory.peek().get().state !== undefined;
  }

  public addResponse(message: ChatMessage) {
    // Clear any thinking from messages.
    this.thinking(false);
    const entry: ChatMessage = {...message, sender: 'ai'};
    this.conversationHistory.push(entry);
    this.conversation.push(entry);
    this.scrollDown();
  }

  public addQuestion(message: string) {
    this.thinking(false);
    const entry: ChatMessage = {message, sender: 'user'};
    this.conversationHistory.push(entry);
    this.conversation.push(entry);
  }

  public lastQuestion() {
    const list = this.conversationHistory.get();
    if (list.length === 0) {
      return null;
    }
    const lastMessage = list[list.length - 1];
    if (lastMessage?.sender === 'user') {
      return lastMessage.message;
    }
    throw new Error('No last question found');
  }

  public removeLastResponse() {
    const lastMessage = this.conversationHistory.get()[this.conversationHistory.get().length - 1];
    if (lastMessage?.sender === 'ai') {
      this.conversationHistory.pop();
    }
  }

  public clear() {
    this._options.logTelemetryEvent('assistantClearConversation', true);
    this.conversationId.set(uuidv4());
    this.conversationHistory.set([]);
    const {column} = this._options;
    // Get the state of the chat from the column.
    const prevState = column.chatHistory.peek().get();
    prevState.state = undefined;
  }

  public scrollDown(smooth = true) {
    this._element.scroll({
      top: 99999,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }

  public buildDom() {
    return this._element = cssHistory(
      this._buildIntroMessage(),
      dom.forEach(this.conversationHistory, entry => {
        if (entry.sender === 'user') {
          return cssMessage(
            dom('span',
              dom.text(entry.message),
              testId('ai-assistant-message-user'),
              testId('ai-assistant-message'),
            ),
            cssAvatar(buildAvatar(this._options.gristDoc)),
          );
        } else {
          return dom('div',
            cssAiMessage(
              cssAvatar(cssAiImage()),
                entry.message === '...' ? cssLoadingDots() :
              this._render(entry.message,
                dom.cls('formula-assistant-message'),
                testId('ai-assistant-message-ai'),
                testId('ai-assistant-message'),
              ),
            ),
            cssAiMessageButtonsRow(
              cssAiMessageButtons(
                primaryButton(t('Apply'), dom.on('click', () => {
                  this._options.apply(entry.formula!);
                })),
              ),
              dom.show(Boolean(entry.formula)),
            ),
          );
        }
      }),
    );
  }

  private _buildIntroMessage() {
    return cssAiIntroMessage(
      cssAvatar(cssAiImage()),
      dom('div',
        cssAiMessageParagraph(t(`Hi, I'm the Grist Formula AI Assistant.`)),
        cssAiMessageParagraph(t(`There are some things you should know when working with me:`)),
        cssAiMessageParagraph(
          cssAiMessageBullet(
            cssTickIcon('Tick'),
            t('I can only help with formulas. I cannot build tables, columns, and views, or write access rules.'),
          ),
          cssAiMessageBullet(
            cssTickIcon('Tick'),
            t(
              'Talk to me like a person. No need to specify tables and column names. For example, you can ask ' +
              '"Please calculate the total invoice amount."'
            ),
          ),
          (WHICH_FORMULA_ASSISTANT() === 'OpenAI') ? cssAiMessageBullet(
            cssTickIcon('Tick'),
            dom('div',
              t(
                'When you talk to me, your questions and your document structure (visible in {{codeView}}) ' +
                'are sent to OpenAI. {{learnMore}}.',
                {
                  codeView: cssLink(t('Code View'), urlState().setLinkUrl({docPage: 'code'})),
                  learnMore: cssLink(t('Learn more'), {href: commonUrls.helpAssistantDataUse, target: '_blank'}),
                }
              ),
            ),
          ) : null,
        ),
        cssAiMessageParagraph(
          t(
            'For more help with formulas, check out our {{functionList}} and {{formulaCheatSheet}}, ' +
            'or visit our {{community}} for more help.',
            {
              functionList: cssLink(t('Function List'), {href: commonUrls.functions, target: '_blank'}),
              formulaCheatSheet: cssLink(t('Formula Cheat Sheet'), {href: commonUrls.formulaSheet, target: '_blank'}),
              community: cssLink(t('Community'), {href: commonUrls.community, target: '_blank'}),
            }
          ),
        ),
      ),
      testId('ai-assistant-message-intro'),
    );
  }

  /**
   * Renders the message as markdown if possible, otherwise as a code block.
   */
  private _render(message: string, ...args: DomElementArg[]) {
    const doc = this._options.gristDoc;
    if (this.supportsMarkdown()) {
      return dom('div',
        (el) => subscribeElem(el, doc.currentTheme, () => {
          const content = sanitizeHTML(marked(message, {
            highlight: (code) => {
              const codeBlock = buildHighlightedCode(code, {
                gristTheme: doc.currentTheme,
                maxLines: 60,
              });
              return codeBlock.innerHTML;
            },
          }));
          el.innerHTML = content;
        }),
        ...args
      );
    } else {
      return buildHighlightedCode(message, {
        gristTheme: doc.currentTheme,
        maxLines: 100,
      });
    }
  }
}

/**
 * Sends the message to the backend and returns the response.
 */
async function askAI(grist: GristDoc, options: {
  column: ColumnRec,
  description: string,
  conversationId: string,
  state?: AssistanceState
}): Promise<AssistanceResponse> {
  const {column, description, conversationId, state} = options;
  const tableId = column.table.peek().tableId.peek();
  const colId = column.colId.peek();
  return await grist.docApi.getAssistance({
    conversationId,
    context: {type: 'formula', tableId, colId},
    text: description,
    state,
  });
}

/** Builds avatar image for user or assistant. */
function buildAvatar(grist: GristDoc) {
  const user = grist.app.topAppModel.appObs.get()?.currentUser || null;
  if (user) {
    return (createUserImage(user, 'medium'));
  } else {
    // TODO: this will not happen, as this should be only for logged in users.
    return (dom('div', ''));
  }
}

function buildSignupNudge() {
  return cssSignupNudgeWrapper(
    cssSignupNudgeParagraph(
      t('Sign up for a free Grist account to start using the Formula AI Assistant.'),
    ),
    cssSignupNudgeButtonsRow(
      bigPrimaryButtonLink(
        t('Sign Up for Free'),
        {href: getLoginOrSignupUrl()},
        testId('ai-assistant-sign-up'),
      ),
    ),
  );
}

function buildAnonNudge() {
  return cssSignupNudgeWrapper(
    cssSignupNudgeWrapper.cls('-center'),
    cssSignupNudgeParagraph(
      t('Formula AI Assistant is only available for logged in users.'),
    ),
  );
}

const MIN_FORMULA_EDITOR_HEIGHT_PX = 100;

const FORMULA_EDITOR_BUTTONS_HEIGHT_PX = 42;

const MIN_CHAT_HISTORY_HEIGHT_PX = 160;

const MIN_CHAT_PANEL_BODY_HEIGHT_PX = 180;

const CHAT_PANEL_HEADER_HEIGHT_PX = 30;

const MIN_CHAT_INPUT_HEIGHT_PX = 42;

const cssChatPanel = styled('div', `
  position: relative;
  display: flex;
  flex-direction: column;
  overflow:hidden;
  flex-grow: 1;
`);

const cssChatPanelHeader = styled('div', `
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  padding: 0px 8px 0px 8px;
  background-color: ${theme.formulaAssistantHeaderBg};
  height: ${CHAT_PANEL_HEADER_HEIGHT_PX}px;
  border-top: 1px solid ${theme.formulaAssistantBorder};
  border-bottom: 1px solid ${theme.formulaAssistantBorder};
`);

const cssChatPanelHeaderTitle = styled('div', `
  display: flex;
  align-items: center;
  color: ${theme.lightText};
  --icon-color: ${theme.accentIcon};
  column-gap: 8px;
  user-select: none;
`);

const cssChatPanelHeaderButtons = styled('div', `
  display: flex;
  align-items: center;
  column-gap: 8px;
`);

const cssChatPanelHeaderButton = styled('div', `
  --icon-color: ${theme.controlSecondaryFg};
  border-radius: 3px;
  padding: 3px;
  cursor: pointer;
  user-select: none;
  &:hover, &.weasel-popup-open {
    background-color: ${theme.hover};
  }
`);

const cssChatPanelHeaderResizer = styled('div', `
  position: absolute;
  top: -3px;
  height: 7px;
  width: 100%;
  cursor: ns-resize;
`);

const cssChatPanelBody = styled('div', `
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  transition: height 0.4s;

  &-resizing {
    transition: unset;
  }
`);

const cssTopBorder = styled('div', `
  border-top: 1px solid ${theme.formulaAssistantBorder};
`);

const cssVSpace = styled('div', `
  padding-top: 18px;
  padding-bottom: 18px;
`);

const cssHContainer = styled('div', `
  margin-top: auto;
  padding-left: 18px;
  padding-right: 18px;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
`);

const cssTypography = styled('div', `
  color: ${theme.inputFg};
`);

const cssHistory = styled('div', `
  overflow: auto;
  display: flex;
  flex-direction: column;
  color: ${theme.inputFg};
`);

const cssInputWrapper = styled('div', `
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

const cssMessage = styled('div', `
  display: grid;
  grid-template-columns: 1fr 60px;
  border-top: 1px solid ${theme.formulaAssistantBorder};
  padding: 20px 0px 20px 20px;
`);

const cssAiMessage = styled('div', `
  position: relative;
  display: grid;
  grid-template-columns: 60px 1fr;
  border-top: 1px solid ${theme.formulaAssistantBorder};
  padding: 20px 20px 20px 0px;

  & pre {
    border: none;
    background: ${theme.formulaAssistantPreformattedTextBg};
    font-size: 10px;
  }

  & pre .ace-chrome, & pre .ace-dracula {
    background: ${theme.formulaAssistantPreformattedTextBg} !important;
  }

  & p > code {
    background: #FFFFFF;
    border: 1px solid #E1E4E5;
    color: #333333;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
`);

const cssAiIntroMessage = styled(cssAiMessage, `
  border-top: unset;
`);

const cssAvatar = styled('div', `
  display: flex;
  align-items: flex-start;
  justify-content: center;
`);

const cssAiImage = styled('div', `
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

const cssButtons = styled('div', `
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px;
`);

const cssTools = styled('div._tools_container', `
  display: flex;
  flex-direction: column;
  overflow: hidden;
`);

const cssInputButtonsRow = styled('div', `
  padding-top: 8px;
  width: 100%;
  justify-content: flex-end;
  cursor: text;
  display: flex;

  &-disabled {
    cursor: default;
  }
`);

const cssSendMessageButton = styled('div', `
  padding: 3px;
  border-radius: 4px;
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

const cssInput = styled('textarea', `
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

const cssChatOptionsMenu = styled('div', `
  z-index: ${vars.floatingPopupMenuZIndex};
`);

const cssAiMessageButtonsRow = styled('div', `
  display: flex;
  justify-content: flex-end;
  padding: 8px;
`);

const cssAiMessageButtons = styled('div', `
  display: flex;
  column-gap: 8px;
`);

const cssAiMessageParagraph = styled('div', `
  margin-bottom: 8px;
`);

const cssAiMessageBullet = styled('div', `
  display: flex;
  align-items: flex-start;
  margin-bottom: 6px;
`);

const cssTickIcon = styled(icon, `
  --icon-color: ${theme.accentIcon};
  margin-right: 8px;
  flex-shrink: 0;
`);

const cssLoadingDots = styled(loadingDots, `
  --dot-size: 5px;
  align-items: center;
`);

const cssSignupNudgeWrapper = styled('div', `
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

const cssSignupNudgeParagraph = styled('div', `
  font-size: ${vars.mediumFontSize};
  font-weight: 500;
  margin-bottom: 12px;
  text-align: center;
`);

const cssSignupNudgeButtonsRow = styled('div', `
  display: flex;
  justify-content: center;
`);

const cssBanner = styled('div', `
  padding: 6px 8px 6px 8px;
`);
