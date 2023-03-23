import * as AceEditor from 'app/client/components/AceEditor';
import {GristDoc} from 'app/client/components/GristDoc';
import {ColumnRec} from 'app/client/models/entities/ColumnRec';
import {buildHighlightedCode} from 'app/client/ui/CodeHighlight';
import {FloatingPopup} from 'app/client/ui/FloatingPopup';
import {createUserImage} from 'app/client/ui/UserImage';
import {basicButton, primaryButton, textButton} from 'app/client/ui2018/buttons';
import {theme} from 'app/client/ui2018/cssVars';
import {cssTextInput, rawTextInput} from 'app/client/ui2018/editableLabel';
import {icon} from 'app/client/ui2018/icons';
import {Suggestion} from 'app/common/AssistancePrompts';
import {Disposable, dom, makeTestId, MultiHolder, obsArray, Observable, styled} from 'grainjs';
import noop from 'lodash/noop';

const testId = makeTestId('test-assistant-');

export function buildAiButton(grist: GristDoc, column: ColumnRec) {
  column = grist.docModel.columns.createFloatingRowModel(column.origColRef);
  return textButton(
    dom.autoDispose(column),
    'Open AI assistant',
    testId('open-button'),
    dom.on('click', () => openAIAssistant(grist, column))
  );
}

interface Context {
  grist: GristDoc;
  column: ColumnRec;
}

function buildFormula(owner: MultiHolder, props: Context) {
  const { grist, column } = props;
  const formula = Observable.create(owner, column.formula.peek());
  const calcSize = (fullDom: HTMLElement, size: any) => {
    return {
      width: fullDom.clientWidth,
      height: size.height,
    };
  };
  const editor = AceEditor.create({
    column,
    gristDoc: grist,
    calcSize,
    editorState: formula,
  });
  owner.autoDispose(editor);
  const buildDom = () => {
    return cssFormulaWrapper(
      dom.cls('formula_field_sidepane'),
      editor.buildDom((aceObj: any) => {
        aceObj.setFontSize(11);
        aceObj.setHighlightActiveLine(false);
        aceObj.getSession().setUseWrapMode(false);
        aceObj.renderer.setPadding(0);
        setTimeout(() => editor.editor.focus());
        editor.setValue(formula.get());
      }),
    );
  };
  return {
    buildDom,
    set(value: string) {
      editor.setValue(value);
    },
    get() {
      return editor.getValue();
    },
  };
}

function buildControls(
  owner: MultiHolder,
  props: Context & {
    currentFormula: () => string;
    savedClicked: () => void,
    robotClicked: () => void,
  }
) {

  const hasHistory = props.column.chatHistory.peek().get().length > 0;

  // State variables, to show various parts of the UI.
  const saveButtonVisible = Observable.create(owner, true);
  const previewButtonVisible = Observable.create(owner, true);
  const robotWellVisible = Observable.create(owner, !hasHistory);
  const robotButtonVisible = Observable.create(owner, !hasHistory && !robotWellVisible.get());
  const helpWellVisible = Observable.create(owner, !hasHistory);



  // Click handlers
  const saveClicked = async () => {
    await preview();
    props.savedClicked();
  };
  const previewClicked = async () => await preview();
  const robotClicked = () => props.robotClicked();

  // Public API
  const preview = async () => {
    // Currently we don't have a preview, so just save.
    const formula = props.currentFormula();
    const tableId = props.column.table.peek().tableId.peek();
    const colId = props.column.colId.peek();
    props.grist.docData.sendAction([
      'ModifyColumn',
      tableId,
      colId,
      { formula, isFormula: true },
    ]).catch(reportError);
  };

  const buildWells = () => {
    return cssContainer(
      cssWell(
        'Grist’s AI Formula Assistance. Need help? Our AI assistant can help. ',
        textButton('Ask the bot.', dom.on('click', robotClicked)),
        dom.show(robotWellVisible)
      ),
      cssWell(
        'Formula Help. See our Function List and Formula Cheat Sheet, or visit our Community for more help.',
        dom.show(helpWellVisible)
      ),
      dom.show(use => use(robotWellVisible) || use(helpWellVisible))
    );
  };
  const buildDom = () => {
    return [
      cssButtonsWrapper(
        cssButtons(
          primaryButton('Save', dom.show(saveButtonVisible), dom.on('click', saveClicked)),
          basicButton('Preview', dom.show(previewButtonVisible), dom.on('click', previewClicked)),
          textButton('🤖', dom.show(robotButtonVisible), dom.on('click', robotClicked)),
          dom.show(
            use => use(previewButtonVisible) || use(saveButtonVisible) || use(robotButtonVisible)
          )
        )
      ),
      buildWells(),
    ];
  };
  return {
    buildDom,
    preview,
    hideHelp() {
      robotWellVisible.set(false);
      helpWellVisible.set(false);
    },
    hideRobot() {
      robotButtonVisible.set(false);
    }
  };
}

function buildChat(owner: Disposable, context: Context & { formulaClicked: (formula: string) => void }) {
  const { grist, column } = context;

  const history = owner.autoDispose(obsArray(column.chatHistory.peek().get()));
  const hasHistory = history.get().length > 0;
  const enabled = Observable.create(owner, hasHistory);
  const introVisible = Observable.create(owner, !hasHistory);
  owner.autoDispose(history.addListener((cur) => {
    column.chatHistory.peek().set([...cur]);
  }));

  const submit = async () => {
    // Ask about suggestion, and send the whole history. Currently the chat is implemented by just sending
    // all previous user prompts back to the AI. This is subject to change (and probably should be done in the backend).
    const prompt = history.get().filter(x => x.sender === 'user')
                                .map(entry => entry.message)
                                .filter(Boolean)
                                .join("\n");
    console.debug('prompt', prompt);
    const { suggestedActions } = await askAI(grist, column, prompt);
    console.debug('suggestedActions', suggestedActions);
    const firstAction = suggestedActions[0] as any;
    // Add the formula to the history.
    const formula = firstAction[3].formula as string;
    // Add to history
    history.push({
      message: formula,
      sender: 'ai',
      formula
    });
    return formula;
  };

  const chatEnterClicked = async (val: string) => {
    if (!val) { return; }
    // Hide intro.
    introVisible.set(false);
    // Add question to the history.
    history.push({
      message: val,
      sender: 'user',
    });
    // Submit all questions to the AI.
    context.formulaClicked(await submit());
  };

  const regenerateClick = async () => {
    // Remove the last AI response from the history.
    history.pop();
    // And submit again.
    context.formulaClicked(await submit());
  };

  const newChat = () => {
    // Clear the history.
    history.set([]);
    // Show intro.
    introVisible.set(true);
  };

  const userPrompt = Observable.create(owner, '');

  const userImage = () => {
    const user = grist.app.topAppModel.appObs.get()?.currentUser || null;
    if (user) {
      return (createUserImage(user, 'medium'));
    } else {
      // TODO: this will not happen, as this should be only for logged in users.
      return (dom('div', ''));
    }
  };

  const buildHistory = () => {
    return cssVBox(
      dom.forEach(history, entry => {
        if (entry.sender === 'user') {
          return cssMessage(
            cssAvatar(userImage()),
            dom.text(entry.message),
          );
        } else {
          return cssAiMessage(
            cssAvatar(cssAiImage()),
            buildHighlightedCode(entry.message, { maxLines: 10 }, cssCodeStyles.cls('')),
            cssCopyIconWrapper(
              icon('Copy', dom.on('click', () => context.formulaClicked(entry.message))),
            )
          );
        }
      })
    );
  };

  const buildIntro = () => {
    return cssVBox(
      dom.cls(cssTopGreenBorder.className),
      dom.cls(cssTypography.className),
      dom.style('flex-grow', '1'),
      dom.style('min-height', '0'),
      dom.style('overflow-y', 'auto'),
      dom.maybe(introVisible, () =>
        cssHContainer(
          dom.style('margin-bottom', '10px'),
          cssVBox(
            dom('h4', 'Grist’s AI Assistance'),
            dom('h5', 'Tips'),
            cssWell(
              '“Example prompt” Some instructions for how to draft a prompt. A link to even more examples in support.'
            ),
            cssWell(
              'Example Values. Instruction about entering example values in the column, maybe with an image?'
            ),
            dom('h5', 'Capabilities'),
            cssWell(
              'Formula Assistance Only. Python code. Spreadsheet functions? May sometimes get it wrong. '
            ),
            cssWell('Conversational. Remembers what was said and allows follow-up corrections.'),
            dom('h5', 'Data'),
            cssWell(
            'Data Usage. Something about how we can see prompts to improve the feature and product, but cannot see doc.'
            ),
            cssWell(
              'Data Sharing. Something about OpenAI, what’s being transmitted. How does it expose doc data?'
            ),
            textButton('Learn more', dom.style('align-self', 'flex-start'))
          )
        )
      ),
      dom.maybe(
        use => !use(introVisible),
        () => buildHistory()
      ),
    );
  };

  const buildButtons = () => {
    // We will show buttons only if we have a history.
    return dom.maybe(use => use(history).length > 0, () => cssVContainer(
      cssHBox(
        cssPlainButton(icon('Script'), 'New Chat',  dom.on('click', newChat)),
        cssPlainButton(icon('Revert'), 'Regenerate', dom.on('click', regenerateClick), dom.style('margin-left', '8px')),
      ),
      dom.style('padding-bottom', '0'),
      dom.style('padding-top', '12px'),
    ));
  };

  const buildInput = () => {
    return cssHContainer(
      dom.cls(cssTopBorder.className),
      dom.cls(cssVSpace.className),
      cssInputWrapper(
        dom.cls(cssTextInput.className),
        dom.cls(cssTypography.className),
        rawTextInput(userPrompt, chatEnterClicked, noop),
        icon('FieldAny')
      ),
      buildButtons()
    );
  };

  const buildDom = () => {
    return dom.maybe(enabled, () => cssVFullBox(
      buildIntro(),
      cssSpacer(),
      buildInput(),
      dom.style('overflow', 'hidden'),
      dom.style('flex-grow', '1')
    ));
  };

  return {
    buildDom,
    show() {
      enabled.set(true);
      introVisible.set(true);
    }
  };
}

/**
 * Builds and opens up a Formula Popup with an AI assistant.
 */
function openAIAssistant(grist: GristDoc, column: ColumnRec) {
  const owner = MultiHolder.create(null);
  const props: Context = { grist, column };

  // Build up all components, and wire up them to each other.

  // First is the formula editor displayed in the upper part of the popup.
  const formulaEditor = buildFormula(owner, props);

  // Next are the buttons in the middle. It has a Save, Preview, and Robot button, and probably some wells
  // with tips or other buttons.
  const controls = buildControls(owner, {
    ...props,
    // Pass a formula accessor, it is used to get the current formula and apply or preview it.
    currentFormula: () => formulaEditor.get(),
    // Event or saving, we listen to it to close the popup.
    savedClicked() {
      grist.formulaPopup.clear();
    },
    // Handler for robot icon click. We hide the robot icon and the help, and show the chat area.
    robotClicked() {
      chat.show();
      controls.hideHelp();
      controls.hideRobot();
    }
  });

  // Now, the chat area. It has a history of previous questions, and a prompt for the user to ask a new
  // question.
  const chat = buildChat(owner, {...props,
    // When a formula is clicked (or just was returned from the AI), we set it in the formula editor and hit
    // the preview button.
    formulaClicked: (formula: string) => {
      formulaEditor.set(formula);
      controls.preview().catch(reportError);
    },
  });

  const header = `${column.table.peek().tableNameDef.peek()}.${column.label.peek()}`;
  const popup = FloatingPopup.create(null, {
    title: () =>  header,
    content: () => [
      formulaEditor.buildDom(),
      controls.buildDom(),
      chat.buildDom(),
    ],
    onClose: () => grist.formulaPopup.clear(),
    closeButton: true,
    autoHeight: true,
  });

  popup.autoDispose(owner);
  popup.showPopup();

  // Add this popup to the main holder (and dispose the previous one).
  grist.formulaPopup.autoDispose(popup);
}

async function askAI(grist: GristDoc, column: ColumnRec, description: string): Promise<Suggestion> {
  const tableId = column.table.peek().tableId.peek();
  const colId = column.colId.peek();
  try {
    const result = await grist.docComm.getAssistance({tableId, colId, description});
    return result;
  } catch (error) {
    reportError(error);
    throw error;
  }
}

const cssVBox = styled('div', `
  display: flex;
  flex-direction: column;
`);

const cssFormulaWrapper = styled('div.formula_field_edit.formula_editor', `
  position: relative;
  padding: 5px 0 5px 24px;
  flex: auto;
  overflow-y: auto;
`);

const cssVFullBox = styled(cssVBox, `
  flex-grow: 1;
`);

const cssHBox = styled('div',  `
  display: flex;
`);

const cssVSpace = styled('div', `
  padding-top: 18px;
  padding-bottom: 18px;
`);

const cssHContainer = styled('div', `
  padding-left: 18px;
  padding-right: 18px;
  display: flex;
  flex-direction: column;
`);

const cssButtonsWrapper = styled(cssHContainer, `
  padding-top: 0;
  background-color: ${theme.formulaEditorBg};
`);

const cssVContainer = styled('div', `
  padding-top: 18px;
  padding-bottom: 18px;
  display: flex;
  flex-direction: column;
`);

const cssContainer = styled('div', `
  padding: 18px;
  display: flex;
  flex-direction: column;
`);

const cssSpacer = styled('div', `
  margin-top: auto;
  display: flex;
`);

const cssButtons = styled('div', `
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 0px;
`);

const cssWell = styled('div', `
  padding: 8px;
  color: ${theme.inputFg};
  border-radius: 4px;
  background-color: ${theme.rightPanelBg};
  & + & {
    margin-top: 8px;
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

const cssTopGreenBorder = styled('div', `
  border-top: 1px solid ${theme.accentBorder};
`);

const cssTypography = styled('div', `
  color: ${theme.inputFg};
`);

const cssTopBorder = styled('div', `
  border-top: 1px solid ${theme.inputBorder};
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

const cssInputWrapper = styled('div', `
  display: flex;
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
