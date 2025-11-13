import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {ChatHistory} from 'app/client/models/ChatHistory';
import {makeT} from 'app/client/lib/localization';
import {localStorageBoolObs} from 'app/client/lib/localStorageObs';
import {movable} from 'app/client/lib/popupUtils';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import {ColumnRec, ViewFieldRec} from 'app/client/models/DocModel';
import {urlState} from 'app/client/models/gristUrlState';
import {basicButton, primaryButton} from 'app/client/ui2018/buttons';
import {theme, vars} from 'app/client/ui2018/cssVars';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {menu, menuItem} from 'app/client/ui2018/menus';
import {Assistant, cssAiImage, cssAiMessage, cssAvatar} from 'app/client/widgets/Assistant';
import {FormulaEditor} from 'app/client/widgets/FormulaEditor';
import {AssistanceState} from 'app/common/Assistance';
import {commonUrls} from 'app/common/gristUrls';
import {TelemetryEvent, TelemetryMetadata} from 'app/common/Telemetry';
import {getGristConfig} from 'app/common/urlUtils';
import {Disposable, dom, DomElementArg, makeTestId, Observable, styled} from 'grainjs';
import debounce from 'lodash/debounce';
import noop from 'lodash/noop';

const t = makeT('FormulaAssistant');
const testId = makeTestId('test-formula-editor-');

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
  private _history: Observable<ChatHistory>;
  /** Chat component */
  private _chat: Assistant;
  /** Is the formula assistant expanded */
  private _assistantExpanded = this.autoDispose(localStorageBoolObs(
    `u:${this._appModel.currentUser?.id ?? 0};formulaAssistantExpanded`, true));
  /** Is assistant features are enabled */
  private _assistantEnabled = getGristConfig().assistant?.version === 1;
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

    if (!this._options.field) {
      // TODO: field is not passed only for rules (as there is no preview there available to the user yet)
      // this should be implemented but it requires creating a helper column to helper column and we don't
      // have infrastructure for that yet.
      throw new Error('Formula assistant requires a field to be passed.');
    }

    this._history = this._options.column.chatHistory.peek();

    this._chat = Assistant.create(this, {
      history: this._history,
      gristDoc: this._gristDoc,
      parentHeightPx: this._chatPanelBodyClientHeight,
      onSend: this._sendMessage.bind(this),
      buildIntroMessage,
      onApplyFormula: this._applyFormula.bind(this),
      onEscape: this._cancel.bind(this),
      logTelemetryEvent: this._logTelemetryEvent.bind(this),
    });

    this.autoDispose(commands.createGroup({
      activateAssistant: () => {
        this._expandChatPanel();
        setTimeout(() => { this._chat.focus(); }, 0);
      }
    }, this, this._assistantEnabled));

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
        const suggestionApplied = this._chat.conversationSuggestedFormulas
          .includes(this._options.column.formula.peek());
        if (suggestionApplied) {
          this._logTelemetryEvent('assistantApplySuggestion', false, {
            conversationLength: this._chat.conversationLength,
            conversationHistoryLength: this._chat.conversationHistoryLength,
          });
        }
        this._logTelemetryEvent('assistantClose', false, {
          suggestionApplied,
          conversationLength: this._chat.conversationLength,
          conversationHistoryLength: this._chat.conversationHistoryLength,
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
        version: 1,
        docIdDigest: this._gristDoc.docId(),
        conversationId: this._chat.conversationId,
        ...(!includeContext ? {} : {context: {
          tableId: this._options.column.table.peek().tableId.peek(),
          colId: this._options.column.colId.peek(),
        }}),
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
              () => this._chat.clear(),
              t('Clear conversation'),
              testId('ai-assistant-options-clear-conversation'),
            ),
          ], {menuWrapCssClass: cssChatOptionsMenu.className}),
          testId('ai-assistant-options'),
        ),
      ),
    );
  }

  private _buildChatPanelBody() {
    setTimeout(() => {
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
      this._chat.buildDom(),
      cssChatPanelBody.cls('-resizing', this._isResizing),
      // Stop propagation of mousedown events, as the formula editor will still focus.
      dom.on('mousedown', (ev) => ev.stopPropagation()),
    );

    observer.observe(this._chatPanelBody);

    return this._chatPanelBody;
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
        conversationLength: this._chat.conversationLength,
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

  private async _sendMessage(message: string) {
    return await askAI(this._gristDoc, {
      column: this._options.column,
      description: message,
      conversationId: this._chat.conversationId,
      state: this._history.get().state,
    });
  }

  private async _applyFormula(formula: string) {
    this._options.editor.setFormula(formula);
    this._resizeEditor();
    await this._preview();
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
}) {
  const {column, description, conversationId, state} = options;
  const tableId = column.table.peek().tableId.peek();
  const colId = column.colId.peek();
  return await grist.docComm.getAssistance({
    conversationId,
    context: {tableId, colId},
    text: description,
    state,
  });
}

function buildIntroMessage(...args: DomElementArg[]) {
  return cssAiIntroMessage(
    cssAvatar(cssAiImage()),
    dom("div",
      cssAiMessageParagraph(t(`Hi, I'm the Grist Formula AI Assistant.`)),
      cssAiMessageParagraph(
        t(`There are some things you should know when working with me:`)
      ),
      cssAiMessageParagraph(
        cssAiMessageBullet(
          cssTickIcon("Tick"),
          t(
            "I can only help with formulas. I cannot build tables, columns, and views, or write access rules."
          )
        ),
        cssAiMessageBullet(
          cssTickIcon("Tick"),
          t(
            'Talk to me like a person. No need to specify tables and column names. For example, you can ask \
"Please calculate the total invoice amount."'
          )
        ),
        getGristConfig().assistant?.provider === "OpenAI"
          ? cssAiMessageBullet(
              cssTickIcon("Tick"),
              dom("div",
                t(
                  "When you talk to me, your questions and your document structure (visible in {{codeView}}) \
are sent to OpenAI. {{learnMore}}.",
                  {
                    codeView: cssLink(
                      t("Code view"),
                      urlState().setLinkUrl({ docPage: "code" })
                    ),
                    learnMore: cssLink(t("Learn more"), {
                      href: commonUrls.helpFormulaAssistantDataUse,
                      target: "_blank",
                    }),
                  }
                )
              )
            )
          : null
      ),
      cssAiMessageParagraph(
        t(
          "For more help with formulas, check out our {{functionList}} and {{formulaCheatSheet}}, \
or visit our {{community}} for more help.",
          {
            functionList: cssLink(t("Function List"), {
              href: commonUrls.functions,
              target: "_blank",
            }),
            formulaCheatSheet: cssLink(t("Formula Cheat Sheet"), {
              href: commonUrls.formulaSheet,
              target: "_blank",
            }),
            community: cssLink(t("Community"), {
              href: commonUrls.community,
              target: "_blank",
            }),
          }
        )
      )
    ),
    ...args,
  );
}

const MIN_FORMULA_EDITOR_HEIGHT_PX = 100;

const FORMULA_EDITOR_BUTTONS_HEIGHT_PX = 42;

const MIN_CHAT_PANEL_BODY_HEIGHT_PX = 180;

const CHAT_PANEL_HEADER_HEIGHT_PX = 30;

export const cssAiIntroMessage = styled(cssAiMessage, `
  border-top: unset;
`);

export const cssAiMessageParagraph = styled("div", `
  margin-bottom: 8px;
`);

const cssAiMessageBullet = styled("div", `
  display: flex;
  align-items: flex-start;
  margin-bottom: 6px;
`);

const cssTickIcon = styled(icon, `
  --icon-color: ${theme.accentIcon};
  margin-right: 8px;
  flex-shrink: 0;
`);

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

const cssChatOptionsMenu = styled('div', `
  z-index: ${vars.floatingPopupMenuZIndex};
`);
