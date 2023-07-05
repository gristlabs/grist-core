import * as commands from 'app/client/components/commands';
import {GristDoc} from 'app/client/components/GristDoc';
import {makeT} from 'app/client/lib/localization';
import {ColumnRec, ViewFieldRec} from 'app/client/models/DocModel';
import {ChatMessage} from 'app/client/models/entities/ColumnRec';
import {GRIST_FORMULA_ASSISTANT} from 'app/client/models/features';
import {buildHighlightedCode} from 'app/client/ui/CodeHighlight';
import {sanitizeHTML} from 'app/client/ui/sanitizeHTML';
import {createUserImage} from 'app/client/ui/UserImage';
import {loadingDots} from 'app/client/ui2018/loaders';
import {FormulaEditor} from 'app/client/widgets/FormulaEditor';
import {AssistanceResponse, AssistanceState} from 'app/common/AssistancePrompts';
import {commonUrls} from 'app/common/gristUrls';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {theme} from 'app/client/ui2018/cssVars';
import {autoGrow} from 'app/client/ui/forms';
import {IconName} from 'app/client/ui2018/IconList';
import {icon} from 'app/client/ui2018/icons';
import {cssLink} from 'app/client/ui2018/links';
import {movable} from 'app/client/lib/popupUtils';

import debounce from 'lodash/debounce';
import {Computed, Disposable, dom, DomContents, DomElementArg, keyframes,
  makeTestId,
  MutableObsArray, obsArray, Observable, styled} from 'grainjs';
  import noop from 'lodash/noop';
import {marked} from 'marked';

const t = makeT('FormulaEditor');
const testId = makeTestId('test-formula-editor-');

/**
 * An extension or the FormulaEditor that provides assistance for writing formulas.
 * It renders itself in the detached FormulaEditor and adds some extra UI elements.
 * - Save button: a subscription for the Enter key that saves the formula and closes the assistant.
 * - Preview button: a new functionality that allows to preview the formula in a temporary column.
 * - Two info cards: that describes what this is and how to use it.
 * - A chat component: that allows to communicate with the assistant.
 */
export class FormulaAssistant extends Disposable {
  /** Chat component */
  private _chat: ChatHistory;
  /** State of the user input */
  private _userInput = Observable.create(this, '');
  /** Is formula description card dismissed */
  private _isFormulaInfoClosed: Observable<boolean>;
  /** Is Ai card dismissed */
  private _isAssistantInfoClosed: Observable<boolean>;
  /** Are any cards dismissed */
  private _cardsVisible: Observable<boolean>;
  /** Dom element that holds the user input */
  // TODO: move it to a separate component
  private _input: HTMLTextAreaElement;
  /** Do we need to show an intro, we show it when history is empty */
  private _introVisible: Observable<boolean>;
  /** Do we need to show a robot icon, we show it when history is empty and assistant is disabled */
  private _robotIconVisible: Observable<boolean>;
  /** Is chat active, we show it when history is not empty */
  private _chatActive = Observable.create(this, false);
  /** Is the request pending */
  private _waiting = Observable.create(this, false);
  /** Is this feature enabled at all */
  private _assistantEnabled: Computed<boolean>;
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

    this._assistantEnabled = Computed.create(this, use => {
      const enabledByFlag = use(GRIST_FORMULA_ASSISTANT());
      const notAnonymous = Boolean(this._options.gristDoc.appModel.currentValidUser);
      return enabledByFlag && notAnonymous;
    });

    if (!this._options.field) {
      // TODO: field is not passed only for rules (as there is no preview there available to the user yet)
      // this should be implemented but it requires creating a helper column to helper column and we don't
      // have infrastructure for that yet.
      throw new Error('Formula assistant requires a field to be passed.');
    }

    this._chat = ChatHistory.create(this, {
      ...this._options,
      copyClicked: this._copyClicked.bind(this),
    });

    const hasHistory = Computed.create(this, use => use(this._chat.length) > 0);
    if (hasHistory.get()) {
      this._chatActive.set(true);
    }

    this.autoDispose(commands.createGroup({
      activateAssistant: () => {
        this._robotIconClicked();
        setTimeout(() => {
          this._input.focus();
        }, 0);
      }
    }, this, true));

    // Calculate some flags what to show when.
    this._isFormulaInfoClosed = this.autoDispose(_options.gristDoc.appModel.dismissedPopup('formulaHelpInfo'));
    this._isAssistantInfoClosed = this.autoDispose(_options.gristDoc.appModel.dismissedPopup('formulaAssistantInfo'));
    this._cardsVisible = Computed.create(this, use => {
      const seenInfo = use(this._isFormulaInfoClosed);
      const seenAi = use(this._isAssistantInfoClosed);
      const aiEnable = use(this._assistantEnabled);
      const nothingToShow = seenInfo && (seenAi || !aiEnable);
      if (nothingToShow) {
        return false;
      }
      if (use(hasHistory)) {
        return false;
      }
      if (use(this._chatActive)) {
        return false;
      }
      return true;
    });
    this._introVisible = Computed.create(this, use => {
      if (use(hasHistory)) {
        return false;
      }
      if (use(this._chatActive)) {
        return true;
      }
      return false;
    });
    this._robotIconVisible = Computed.create(this, use => {
      if (!use(this._assistantEnabled)) { return false; }
      if (use(hasHistory)) {
        return false;
      }
      if (use(this._introVisible)) {
        return false;
      }
      if (use(this._chatActive)) {
        return false;
      }
      return true;
    });

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
      shouldIncludeInBundle: (a) => {
        const tableId = this._options.column.table.peek().tableId.peek();
        const allowed = a.length === 1
          && a[0][0] === 'ModifyColumn'
          && a[0][1] === tableId
          && typeof a[0][2] === 'string'
          && [this._transformColId, this._options.column.id.peek()].includes(a[0][2]);
        return allowed;
      }
    });

    this._triggerFinalize = bundleInfo.triggerFinalize;
    this.onDispose(() => {
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
        primaryButton(t('Save'), dom.on('click', () => {
          this.saveOrClose();
        }), testId('save-button')),
        basicButton(t('Preview'), dom.on('click', async () => {
          await this.preview();
        }), testId('preview-button')),
        this.buildInlineRobotButton(),
      ),
      this.buildInfoCards(),
      this.buildChat(),
    );
    return this._domElement;
  }

  public buildInfoCards() {
    return cssCardList(
      dom.show(this._cardsVisible),
      dom.maybe(use => use(this._assistantEnabled) && !use(this._isAssistantInfoClosed), () =>
        buildCard({
          close: () => this._isAssistantInfoClosed.set(true),
          icon: "Robot",
          title: t("Grist's AI Formula Assistance. "),
          content: dom('span',
            t('Need help? Our AI assistant can help.'), ' ',
            textButton(t('Ask the bot.'), dom.on('click', this._robotIconClicked.bind(this)),),
          ),
          args: [testId('ai-well')]
        }),
      ),
      dom.maybe(use => !use(this._isFormulaInfoClosed), () =>
        buildCard({
          close: () => this._isFormulaInfoClosed.set(true),
          icon: 'Help',
          title: t("Formula Help. "),
          content: dom('span',
            t('See our {{helpFunction}} and {{formulaCheat}}, or visit our {{community}} for more help.', {
            helpFunction: cssLink(t('Function List'), {href: commonUrls.functions, target: '_blank'}),
            formulaCheat: cssLink(t('Formula Cheat Sheet'), {href: commonUrls.formulaSheet, target: '_blank'}),
            community: cssLink(t('Community'), {href: commonUrls.community, target: '_blank'}),
          })),
          args: [testId('formula-well')]
        })
      ),
    );
  }

  public buildChat() {
    return dom.maybe(this._assistantEnabled, () => {
      setTimeout(() => {
        if (!this.isDisposed()) {
          // Scroll to the bottom of the chat right after it is rendered without the animation.
          this._chat.scrollDown(false);
        }
        this._options.editor.resize();
      }, 0);
      return cssChat(
        testId('chat'),
        dom.maybe(this._chatActive, () => [
          cssTopGreenBorder(
            movable({
              onStart: this._onResizeStart.bind(this),
              onMove: this._onResizeMove.bind(this),
            })
          ),
        ]),
        this._buildIntro(),
        this._chat.buildDom(),
        this._buildChatInput(),
        // Stop propagation of mousedown events, as the formula editor will still focus.
        dom.on('mousedown', (ev) => ev.stopPropagation()),
      );
    });
  }


  /**
   * Save button handler. We just store the action and wait for the bundler to finalize.
   */
  public saveOrClose() {
    this._action = 'save';
    this._triggerFinalize();
  }

  /**
   * Cancel button handler.
   */
  public async cancel() {
    this._action = 'cancel';
    this._triggerFinalize();
  }

  /**
   * Preview button handler.
   */
  public async preview() {
    const tableId = this._options.column.table.peek().tableId.peek();
    // const colId = this._options.column.colId.peek();
    const formula = this._options.editor.getCellValue();
    const isFormula = true;
    await this._options.gristDoc.docData.sendAction(
      ['ModifyColumn', tableId, this._transformColId, {formula, isFormula}
    ]);
    if (!this.isDisposed()) {
      this._options.editor.focus();
    }
  }

  public buildInlineRobotButton() {
    return cssRobotButton(
      icon('Robot'),
      dom.show(this._robotIconVisible),
      dom.on('click', this._robotIconClicked.bind(this)),
      testId('robot-button'),
    );
  }

  private async _preparePreview() {
    const docData = this._options.gristDoc.docData;
    const tableId = this._options.column.table.peek().tableId.peek();

    // Add a new column to the table, and set it as the transform column.
    const colInfo = await docData.sendAction(['AddColumn', tableId, 'gristHelper_Transform', {
      type: this._options.column.type.peek(),
      label: this._options.column.colId.peek(),
      isFormula: true,
      formula: this._options.column.formula.peek(),
    }]);
    this._options.field?.colRef(colInfo.colRef); // Don't save, it is only in browser.
    this._transformColId = colInfo.colId;

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

  private _onResizeStart() {
    const start = this._domElement?.clientHeight;
    const total = this._options.editor.getDom().clientHeight;
    return {
      start, total
    };
  }

  /**
   * Resize handler for the chat window.
   */
  private _onResizeMove(x: number, y: number, {start, total}: {start: number, total: number}) {
    // We want to keep the formula well at least 100px tall.
    const minFormulaHeight = 100;
    // The total height of the tools, input and resize line.
    const toolsHeight = 43 + this._inputWrapper.clientHeight + 7;
    const desiredHeight = start - y;
    // Calculate the correct height in the allowed range.
    const calculatedHeight = Math.max(toolsHeight + 10,  Math.min(total - minFormulaHeight, desiredHeight));
    this._domElement.style.height = `${calculatedHeight}px`;
  }

  /**
   * Builds the chat input at the bottom of the chat.
   */
  private _buildChatInput() {
    // Make sure we dispose the previous input.
    if (this._input) {
      dom.domDispose(this._input);
    }
    const ask = () => this._ask();
    // Input is created by hand, as we need a finer control of the user input than what is available
    // in generic textInput control.
    this._input = cssInput(
      dom.on('input', (ev: Event) => {
        this._userInput.set((ev.target as HTMLInputElement).value);
      }),
      autoGrow(this._userInput),
      dom.onKeyDown({
        Enter$: (ev) => {
          // If shift is pressed, we want to insert a new line.
          if (!ev.shiftKey) {
            ev.preventDefault();
            ask().catch(reportError);
          }
        },
        Escape: this.cancel.bind(this),
      }),
      dom.autoDispose(this._userInput.addListener(value => this._input.value = value)),
      dom.prop('disabled', this._waiting),
      dom.autoDispose(this._waiting.addListener(value => {
        if (!value) {
          setTimeout(() => this._input.focus(), 0);
        }
      })),
    );
    return this._inputWrapper = cssHContainer(
      testId('chat-input'),
      dom.style('margin-top', 'auto'),
      dom.cls(cssTopBorder.className),
      dom.cls(cssVSpace.className),
      dom.on('click', () => this._input.focus()),
      dom.show(this._chatActive),
      cssInputWrapper(
        dom.cls(cssTypography.className),
        this._input,
        dom.domComputed(this._waiting, (waiting) => {
          if (!waiting) { return cssClickableIcon('FieldAny', dom.on('click', ask)); }
          else { return cssLoadingDots(); }
        })
      ),
      cssVContainer(
        cssHBox(
          cssPlainButton(
            icon('Script'),
            t('New Chat'),
            dom.on('click', this._clear.bind(this)),
            testId('chat-new')
          ),
          cssPlainButton(icon('Revert'), t('Regenerate'),
            dom.on('click', this._regenerate.bind(this)), dom.style('margin-left', '8px'),
            testId('chat-regenerate')
          ),
        ),
        dom.style('padding-bottom', '0'),
        dom.style('padding-top', '12px'),
      )
    );
  }

  /**
   * Builds the intro section of the chat panel. TODO the copy.
   */
  private _buildIntro() {
    return dom.maybe(this._introVisible, () => cssInfo(
      testId('chat-intro'),
      cssTopHeader(t("Grist's AI Assistance")),
      cssHeader(t('Tips')),
      cssCardList(
        buildCard({
          title: 'Example prompt: ',
          content: 'Some instructions for how to draft a prompt. A link to even more examples in support. ',
        }),
        buildCard({
          title: 'Example Values: ',
          content: 'Some instructions for how to draft a prompt. A link to even more examples in support. ',
        }),
      ),
      cssHeader(t('Capabilities')),
      cssCardList(
        buildCard({
          title: 'Example prompt: ',
          content: 'Some instructions for how to draft a prompt. A link to even more examples in support. ',
        }),
        buildCard({
          title: 'Example Values: ',
          content: 'Some instructions for how to draft a prompt. A link to even more examples in support. ',
        }),
      ),
      cssHeader(t('Data')),
      cssCardList(
        buildCard({
          title: 'Data usage. ',
          content: 'Some instructions for how to draft a prompt. A link to even more examples in support. ',
        }),
        buildCard({
          title: 'Data sharing. ',
          content: 'Some instructions for how to draft a prompt. A link to even more examples in support. ',
        }),
      )
    ));
  }

  private _robotIconClicked() {
    this._chatActive.set(true);
  }

  private _copyClicked(entry: ChatMessage) {
    this._options.editor.setFormula(entry.formula!);
  }

  private async _sendMessage(description: string, regenerate = false): Promise<ChatMessage> {
    // Destruct options.
    const {column, gristDoc} = this._options;
    // Get the state of the chat from the column.
    const prevState = column.chatHistory.peek().get().state;
    // Send the message back to the AI with previous state and a mark that we want to regenerate.
    // We can't modify the state here as we treat it as a black box, so we only removed last message
    // from ai from the chat, we grabbed last question and we are sending it back to the AI with a
    // flag that it should clear last response and regenerate it.
    const {reply, suggestedActions, state} = await askAI(gristDoc, {
      column, description, state: prevState,
      regenerate,
    });
    console.debug('suggestedActions', {suggestedActions, reply, state});
    // If back-end is capable of conversation, keep its state.
    const chatHistoryNew = column.chatHistory.peek();
    const value = chatHistoryNew.get();
    value.state = state;
    const formula = (suggestedActions[0]?.[3] as any)?.formula as string;
    // If model has a conversational skills (and maintains a history), we might get actually
    // some markdown text back, so we need to parse it.
    const prettyMessage = state ? (reply || formula || '') : (formula || reply || '');
    // Add it to the chat.
    return {
      message: prettyMessage,
      formula,
      action: suggestedActions[0],
      sender: 'ai',
    };
  }

  private _clear() {
    this._chat.clear();
    this._userInput.set('');
  }

  private async _regenerate() {
    if (this._waiting.get()) {
      return;
    }
    this._chat.removeLastResponse();
    const last = this._chat.lastQuestion();
    if (!last) {
      return;
    }
    await this._doAsk(last);
  }

  private async _ask() {
    if (this._waiting.get()) {
      return;
    }
    const message= this._userInput.get();
    if (!message) { return; }
    this._chat.addQuestion(message);
    this._userInput.set('');
    await this._doAsk(message);
  }

  private async _doAsk(message: string) {
    this._chat.thinking();
    this._waiting.set(true);
    try {
      const response = await this._sendMessage(message, false);
      this._chat.addResponse(response);
    } catch(err) {
      this._chat.thinking(false);
      throw err;
    } finally {
      this._waiting.set(false);
    }
  }
}

/**
 * A model for the chat panel. It is responsible for keeping the history of the chat and
 * sending messages to the AI.
 */
class ChatHistory extends Disposable {
  public history: MutableObsArray<ChatMessage>;
  public length: Computed<number>;

  private _element: HTMLElement;

  constructor(private _options: {
    column: ColumnRec,
    gristDoc: GristDoc,
    copyClicked: (entry: ChatMessage) => void,
  }) {
    super();
    const column = this._options.column;
    // Create observable array of messages that is connected to the column's chatHistory.
    this.history = this.autoDispose(obsArray(column.chatHistory.peek().get().messages));
    this.autoDispose(this.history.addListener((cur) => {
      const chatHistory = column.chatHistory.peek();
      chatHistory.set({...chatHistory.get(), messages: [...cur]});
    }));
    this.length = Computed.create(this, use => use(this.history).length); // ??
  }

  public thinking(on = true) {
    if (!on) {
      // Find all index of all thinking messages.
      const messages = [...this.history.get()].filter(m => m.message === '...');
      // Remove all thinking messages.
      for (const message of messages) {
        this.history.splice(this.history.get().indexOf(message), 1);
      }
    } else {
      this.history.push({
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
    this.history.push({...message, sender: 'ai'});
    this.scrollDown();
  }

  public addQuestion(message: string) {
    this.thinking(false);
    this.history.push({
      message,
      sender: 'user',
    });
  }

  public lastQuestion() {
    const list = this.history.get();
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
    const lastMessage = this.history.get()[this.history.get().length - 1];
    if (lastMessage?.sender === 'ai') {
      this.history.pop();
    }
  }

  public clear() {
    this.history.set([]);
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
      dom.forEach(this.history, entry => {
        if (entry.sender === 'user') {
          return cssMessage(
            cssAvatar(buildAvatar(this._options.gristDoc)),
            dom('span',
              dom.text(entry.message),
              testId('user-message'),
              testId('chat-message'),
            )
          );
        } else {
          return cssAiMessage(
            cssAvatar(cssAiImage()),
            entry.message === '...' ? cssCursor() :
            this._render(entry.message,
              testId('assistant-message'),
              testId('chat-message'),
            ),
            cssCopyIconWrapper(
              dom.show(Boolean(entry.formula)),
              icon('Copy', dom.on('click', () => this._options.copyClicked(entry))),
            )
          );
        }
      })
    );
  }

  /**
   * Renders the message as markdown if possible, otherwise as a code block.
   */
  private _render(message: string, ...args: DomElementArg[]) {
    const doc = this._options.gristDoc;
    if (this.supportsMarkdown()) {
      return dom('div',
        (el) => {
          const content = sanitizeHTML(marked(message, {
            highlight: (code) => {
              const codeBlock = buildHighlightedCode(code, {
                gristTheme: doc.currentTheme,
                maxLines: 60,
              }, cssCodeStyles.cls(''));
              return codeBlock.innerHTML;
            },
          }));
          el.innerHTML = content;
        },
        ...args
      );

    } else {
      return buildHighlightedCode(message, {
        gristTheme: doc.currentTheme,
        maxLines: 100,
      }, cssCodeStyles.cls(''));
    }
  }
}

/**
 * Sends the message to the backend and returns the response.
 */
async function askAI(grist: GristDoc, options: {
  column: ColumnRec,
  description: string,
  regenerate?: boolean,
  state?: AssistanceState
}): Promise<AssistanceResponse> {
  const {column, description, state, regenerate} = options;
  const tableId = column.table.peek().tableId.peek();
  const colId = column.colId.peek();
  const result = await grist.docApi.getAssistance({
    context: {type: 'formula', tableId, colId},
    text: description,
    state,
    regenerate,
  });
  return result;
}

/**
 * Builds a card with the given title and content.
 */
function buildCard(options: {
  icon?: IconName,
  title: string,
  content: DomContents,
  close?: () => void,
  args?: DomElementArg[]
}) {
  return cssCard(
    options.icon && dom('div', cssCard.cls(`-icon`), icon(options.icon)),
    dom('div', cssCard.cls('-body'), dom('span',
      dom('span', cssCard.cls('-title'), options.title),
      dom('span', cssCard.cls('-content'), options.content),
    )),
    options.icon && dom('div',
      dom.on('click', options.close ?? noop),
      cssCard.cls('-close'),
      icon('CrossSmall'),
      testId('well-close'),
    ),
    ...(options.args ?? [])
  );
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

// TODO: for now this icon is hidden as more design is needed. It overlaps various elements.
const detachRobotVisible = false;
export function buildRobotIcon() {
  if (!detachRobotVisible) { return null; }
  return dom.maybe(GRIST_FORMULA_ASSISTANT(), () =>
    cssDetachedRobotIcon(
      'Robot',
      dom.on('click', () => {
        commands.allCommands.detachEditor.run();
        commands.allCommands.activateAssistant.run();
      }),
      testId('detached-robot-icon'),
    )
  );
}

const cssDetachedRobotIcon = styled(icon, `
  left: -25px;
  --icon-color: ${theme.iconButtonPrimaryBg};
  position: absolute;
  cursor: pointer;
  &:hover {
    --icon-color: ${theme.iconButtonPrimaryHoverBg};
  }
`);

const cssInfo = styled('div', `
  overflow: auto;
  height: 100%;
`);

const cssTopHeader = styled('div', `
  font-size: 20px;
  padding-left: 16px;
  padding-right: 16px;
  margin-top: 20px;
  color: ${theme.inputFg};
`);

const cssHeader = styled('div', `
  font-size: 16px;
  padding-left: 16px;
  padding-right: 16px;
  margin: 10px 0px;
  color: ${theme.inputFg};
`);


const cssTopGreenBorder = styled('div', `
  background: ${theme.accentBorder};
  height: 7px;
  border-top: 3px solid ${theme.pageBg};
  border-bottom: 3px solid ${theme.pageBg};
  cursor: ns-resize;
  flex: none;
`);

const cssChat = styled('div', `
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
`);


const cssRobotButton = styled('div', `
  padding-left: 9px;
  padding-right: 9px;
  padding-top: 4px;
  padding-bottom: 6px;
  margin-left: -8px;
  --icon-color: ${theme.controlPrimaryBg};
  cursor: pointer;
  &:hover {
    --icon-color: ${theme.controlPrimaryHoverBg};
  }
`);

const cssCardList = styled('div', `
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  padding-top: 0px;
  & a {
    font-weight: bold;
  }
`);

const cssCard = styled('div', `
  position: relative;
  display: flex;
  column-gap: 8px;
  padding: 8px;
  padding-bottom: 12px;
  color: ${theme.inputFg};
  border-radius: 4px;
  background-color: ${theme.cardCompactWidgetBg};
  &-icon {
    --icon-color: ${theme.accentText};
  }
  &-title {
    font-weight: 600;
  }
  &-close {
    position: absolute;
    top: 4px;
    right: 4px;
    height: 20px;
    width: 20px;
    cursor: pointer;
  }
  &-close:hover {
    background-color: ${theme.pageHoverBg};
    --icon-color: ${theme.linkHover};
    border-radius: 4px;
  }
  &-body {
    padding-top: 2px;
    padding-right: 12px;
    line-height: 1.6em;
  }
  & button {
    font-weight: 600;
  }
`);

const cssTopBorder = styled('div', `
  border-top: 1px solid ${theme.inputBorder};
`);

const cssVSpace = styled('div', `
  padding-top: 18px;
  padding-bottom: 18px;
`);

const cssHContainer = styled('div', `
  padding-left: 18px;
  padding-right: 18px;
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
`);

const cssTypography = styled('div', `
  color: ${theme.inputFg};
`);

const cssHBox = styled('div',  `
  display: flex;
`);

const cssVContainer = styled('div', `
  padding-top: 18px;
  padding-bottom: 18px;
  display: flex;
  flex-direction: column;
`);


const cssHistory = styled('div', `
  overflow: auto;
  display: flex;
  flex-direction: column;
  color: ${theme.inputFg};
`);


const cssPlainButton = styled(basicButton, `
  border-color: ${theme.inputBorder};
  color: ${theme.controlSecondaryFg};
  --icon-color: ${theme.controlSecondaryFg};
  display: inline-flex;
  gap: 10px;
  align-items: flex-end;
  border-radius: 3px;
  padding: 5px 7px;
  padding-right: 13px;
`);

const cssInputWrapper = styled('div', `
  display: flex;
  border: 1px solid ${theme.inputBorder};
  border-radius: 3px;
  background-color: ${theme.mainPanelBg};
  align-items: center;
  gap: 8px;
  padding-right: 8px !important;
  --icon-color: ${theme.controlSecondaryFg};
  &:hover, &:focus-within {
    --icon-color: ${theme.accentIcon};
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
  grid-template-columns: 60px 1fr;
  padding-right: 54px;
  padding-top: 12px;
  padding-bottom: 12px;
`);

const cssAiMessage = styled('div', `
  display: grid;
  grid-template-columns: 60px 1fr 54px;
  padding-top: 20px;
  padding-bottom: 20px;
  background: #D9D9D94f;
  & pre {
    background: ${theme.cellBg};
    font-size: 10px;
  }
`);

const cssCodeStyles = styled('div', `
  background: #E3E3E3;
  border: none;
  & .ace-chrome {
    background: #E3E3E3;
    border: none;
  }
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


const cssCopyIconWrapper = styled('div', `
  display: none;
  align-items: center;
  justify-content: center;
  flex: none;
  cursor: pointer;
  .${cssAiMessage.className}:hover & {
    display: flex;
  }
`);

const blink = keyframes(`
  0% { opacity: 1; }
  50% { opacity: 0; }
  100% { opacity: 1; }
`);

const cssCursor = styled('div', `
  height: 1rem;
  width: 3px;
  background-color: ${theme.darkText};
  animation: ${blink} 1s infinite;
`);

const cssLoadingDots = styled(loadingDots, `
  --dot-size: 4px;
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

const cssClickableIcon = styled(icon, `
  cursor: pointer;
`);


const cssInput = styled('textarea', `
  border: 0px;
  flex-grow: 1;
  outline: none;
  padding: 4px 6px;
  padding-top: 6px;
  resize: none;
  min-height: 28px;
  background: transparent;
}
`);
