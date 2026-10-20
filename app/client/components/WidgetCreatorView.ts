import * as AceEditor from "app/client/components/AceEditor";
import BaseView from "app/client/components/BaseView";
import { allCommands } from "app/client/components/commands";
import { createCustomWidgetFrame } from "app/client/components/CustomView";
import { GristDoc } from "app/client/components/GristDoc";
import { UnsavedChange } from "app/client/components/UnsavedChanges";
import { modKeyProp } from "app/client/lib/browserInfo";
import { copyToClipboard } from "app/client/lib/clipboardUtils";
import { makeT } from "app/client/lib/localization";
import { ViewSectionRec } from "app/client/models/DocModel";
import { MutedError, reportError, reportSuccess } from "app/client/models/errors";
import { IWidgetCreator } from "app/client/ui/IAssistantPanel";
import { resizeFlexVHandle } from "app/client/ui/resizeHandle";
import { hoverTooltip, infoTooltip } from "app/client/ui/tooltips";
import { transition } from "app/client/ui/transitions";
import { buildWidgetCreatorComposer } from "app/client/ui/WidgetCreatorComposer";
import { basicButton, bigBasicButton, primaryButton, textButton } from "app/client/ui2018/buttons";
import { testId, theme, vars } from "app/client/ui2018/cssVars";
import { cssIconButton, icon } from "app/client/ui2018/icons";
import { cssLink } from "app/client/ui2018/links";
import { saveModal } from "app/client/ui2018/modals";
import { toggleSwitch } from "app/client/ui2018/toggleSwitch";
import { AccessLevel } from "app/common/CustomWidget";
import { commonUrls } from "app/common/gristUrls";
import { canEdit as canEditRole } from "app/common/roles";
import { tokens } from "app/common/ThemePrefs";
import { DEFAULT_WIDGET_CREATOR_ACCESS } from "app/common/WidgetCreatorCode";
import { WidgetError } from "app/plugin/WidgetErrors";

import "ace-builds/src-noconflict/mode-html";
import {
  bundleChanges, Computed, dom, DomContents, DomElementArg, Observable, styled,
} from "grainjs";
import debounce from "lodash/debounce";

const t = makeT("WidgetCreatorView");

const AUTO_REFRESH_DELAY_MS = 800;

// How wide the source is, for each widget. It is kept until the page is closed.
const splitBySection = new Map<number, number>();

type SaveState = "save" | "saved" | "empty";

/**
 * A Widget Creator widget (section type "creator"): its own HTML and JavaScript, kept in the document.
 *
 * The HTML is in three places:
 * - `_htmlInDocument`: the HTML saved in the document. The widget runs it while the editor is closed.
 * - `_htmlInEditor`: the HTML in the editor.
 * - `_htmlInPreview`: the HTML the preview runs while the editor is open. A refresh copies
 *   `_htmlInEditor` into it, a moment after the user stops typing.
 */
export class WidgetCreatorView extends BaseView implements IWidgetCreator {
  /** If the user may change the HTML. A simple check: the server checks again on save. */
  public readonly canEdit: Computed<boolean>;

  /** If this Grist installation has the assistant. */
  public readonly hasAssistant = Boolean(this.gristDoc.assistantPanel);

  /** If the editor is open (with or without the source view). */
  public readonly editing = Observable.create(this, false);

  /** The HTML saved in the document. */
  private readonly _htmlInDocument = Computed.create(this, use => use(this.viewSection.optionsObj).html ?? "");

  /** The HTML in the editor. */
  private readonly _htmlInEditor = Observable.create(this, "");

  /** The HTML the preview runs while the editor is open. A refresh copies the typed HTML into it. */
  private readonly _htmlInPreview = Observable.create(this, "");

  /** If there is typed HTML that is not refreshed yet. */
  private readonly _isPending = Computed.create(this, use =>
    use(this.editing) && use(this._htmlInEditor) !== use(this._htmlInPreview));

  /** If the HTML in the editor differs from the HTML in the document. */
  private readonly _isDirty = Computed.create(this, use =>
    use(this.editing) && use(this._htmlInEditor) !== use(this._htmlInDocument));

  /** What the Save button shows: Save, Saved, or Empty. */
  private readonly _saveState = Computed.create(this, (use): SaveState => {
    if (use(this._isDirty)) { return "save"; }
    return use(this._htmlInEditor) ? "saved" : "empty";
  });

  /**
   * The first error of the preview. One mistake in the code often causes more errors after it,
   * so the first one is the one to fix.
   */
  private readonly _error = Observable.create<WidgetError | null>(this, null);

  /** If the Source toggle is checked. */
  private readonly _sourceSwitch = Observable.create(this, false);

  /** If the eye toggle (preview) is checked. */
  private readonly _previewSwitch = Observable.create(this, true);

  /** How wide the source is next to the preview, in percent. The user drags the line to change it. */
  private readonly _split: Observable<number>;

  /**
   * If the user drags the line between the source and the widget. While it is true, the widget's
   * frame ignores the mouse, so the drag does not stop when the mouse goes over it.
   */
  private readonly _dragging = Observable.create(this, false);

  /** The Ace editor of the source, while the editor is open. */
  private _aceEditor: any = null;

  /** If this class puts text into Ace right now, so its change events do not count as typing. */
  private _isSettingAce = false;

  /** Refreshes the widget a moment after the user stops typing. */
  private _autoRefresh = debounce(() => {
    if (!this.isDisposed()) { this._refresh(); }
  }, AUTO_REFRESH_DELAY_MS);

  constructor(gristDoc: GristDoc, viewSectionModel: ViewSectionRec) {
    super(gristDoc, viewSectionModel, { addNewRow: true, disabledCursor: true });

    this.canEdit = Computed.create(this, (use) => {
      const override = use(gristDoc.docPageModel.userOverride);
      return !use(gristDoc.isReadonly) && (!override?.access || canEditRole(override.access));
    });

    this._split = Observable.create(this, splitBySection.get(this.viewSection.getRowId()) ?? 50);

    // Drop the refresh that waits for the user to stop typing, so it does not run after the view is gone.
    this.onDispose(() => this._autoRefresh.cancel());

    UnsavedChange.create(this, async () => {
      if (this._isDirty.get() && await this._askToSave() === "stay") {
        // Stops the page change, so the user stays in the editor.
        throw new MutedError();
      }
    }, () => this._isDirty.get());

    this._openWhenEmpty();

    this.viewPane = this._buildDom();
    this.onDispose(() => { dom.domDispose(this.viewPane); this.viewPane.remove(); });
  }

  // "Edit source" in the empty widget and in the section menu, and "write it yourself" or
  // "Open the code" in the empty preview. Opens the editor with the source shown and focused.
  public onEditSourceClicked() {
    if (!this.canEdit.get()) { return; }
    this._openEditor();
    this._setSourceSwitch(true);
  }

  // The × button in the top bar, and "Close editor" in the section menu. Asks first to save any
  // changes.
  public onCloseClicked() {
    if (!this.editing.get()) { return; }
    if (!this._isDirty.get()) {
      this._stopEditing();
      return;
    }
    this._askToSave().then((choice) => {
      if (choice !== "stay" && !this.isDisposed()) { this._stopEditing(); }
    }).catch(reportError);
  }

  // "Edit code" or "Close editor" in the creator panel.
  public onEditCodeClicked() {
    if (this.editing.get()) { this.onCloseClicked(); } else { this.onEditSourceClicked(); }
  }

  // "Use assistant" in the top bar and in the section menu, "Ask assistant" in the creator panel,
  // and "Ask the assistant" in the empty preview.
  public onAskAssistantClicked() {
    this._useAssistant();
  }

  public applyHtml(html: string) {
    if (!this.canEdit.get()) { return; }
    this._openEditor();
    this._setHtmlInEditor(html);
    this._refresh();
  }

  public currentHtml() {
    return this.editing.get() ? this._htmlInEditor.get() : this._htmlInDocument.get();
  }

  // The Save button in the top bar, and Ctrl+S.
  private _onSaveClicked() {
    this._save().catch(reportError);
  }

  // A key pressed in the source or in the top bar. Ctrl+S (Cmd+S on Mac) saves the code.
  // Keys pressed in the preview go to the widget, so they do not come here.
  private _onKeyDown(ev: KeyboardEvent) {
    if (ev[modKeyProp()] && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      this._onSaveClicked();
    }
  }

  // The Source switch in the top bar.
  private _onSourceToggled(checked: boolean) {
    this._setSourceSwitch(checked);
  }

  // The eye button in the top bar. Hiding the preview shows the source, so the editor is never empty.
  private _onEyeClicked() {
    const show = !this._previewSwitch.get();
    if (!show && !this._sourceSwitch.get()) { this._setSourceSwitch(true); }
    this._previewSwitch.set(show);
  }

  // The message box in the empty widget.
  private _onPromptSubmitted(prompt: string) {
    this._useAssistant(prompt);
  }

  // When the editor is narrow: the expand button in the top bar, and "Expand the widget" in the
  // empty preview.
  private _onExpandClicked() {
    this.viewSection.hasFocus(true);
    allCommands.expandSection.run();
  }

  // "Send to assistant" in the error box under the widget.
  private _onSendErrorClicked() {
    const error = this._error.get();
    if (!error) { return; }
    this._useAssistant(t("Fix this error in the widget code: {{- error}}", { error: errorText(error) }));
  }

  // "Copy error" in the error box under the widget.
  private _onCopyErrorClicked(text: string) {
    copyToClipboard(text).then(() => toast(t("Error copied"))).catch(reportError);
  }

  // Any change of the text in the ace editor.
  private _onAceTextChange(html: string) {
    if (this._isSettingAce) { return; }
    this._htmlInEditor.set(html);
    this._autoRefresh();
  }

  // The user starts to drag the line between the source and the preview.
  private _onSplitDragStart() {
    this._dragging.set(true);
  }

  // The user stops dragging the line between the source and the preview.
  private _onSplitDragEnd(width: number, body: HTMLElement) {
    this._dragging.set(false);
    const total = body.getBoundingClientRect().width;
    if (!total) { return; }
    // The source pane's min-width and max-width keep it and the preview at least 120px wide.
    const split = Math.min(100, Math.max(0, width / total * 100));
    this._split.set(split);
    splitBySection.set(this.viewSection.getRowId(), split);
  }

  // Opens the assistant for this widget, and sends it `prompt` if there is one. The assistant gets
  // the active widget with each message, so the widget becomes active first.
  private _useAssistant(prompt?: string) {
    const panel = this.gristDoc.assistantPanel;
    if (!panel || !this.canEdit.get()) { return; }
    this.viewSection.hasFocus(true);
    if (prompt) {
      panel.ask(prompt);
    } else {
      panel.open();
    }
  }

  private _setSourceSwitch(show: boolean) {
    if (show === this._sourceSwitch.get()) {
      if (show) { this._focusAce(); }
      return;
    }
    bundleChanges(() => {
      this._sourceSwitch.set(show);
      if (!show) { this._previewSwitch.set(true); }
    });
    if (show) { this._focusAce(); }
  }

  private _refresh() {
    // This refresh runs now, so the one that waits for the user to stop typing is not needed.
    this._autoRefresh.cancel();
    if (!this._isPending.get()) { return; }
    this._htmlInPreview.set(this._htmlInEditor.get());
  }

  private async _save() {
    if (!this._isDirty.get()) { return; }
    this._refresh();
    await this._saveHtml(this._htmlInPreview.get());
  }

  private _askToSave(): Promise<"saved" | "discarded" | "stay"> {
    return new Promise((resolve) => {
      saveModal(ctl => ({
        title: t("Save your changes?"),
        body: dom("div", t("The widget has changes that are not saved. \
If you close the editor without saving, they are lost.")),
        saveLabel: t("Save"),
        hideCancel: true,
        saveFunc: async () => {
          await this._save();
          resolve("saved");
        },
        extraButtons: bigBasicButton(t("Don't save"),
          dom.on("click", () => {
            ctl.close();
            resolve("discarded");
          }),
          testId("widget-creator-dont-save"),
        ),
      }), { onCancel: () => resolve("stay") });
    });
  }

  // Opens the editor with the HTML from the document. Does nothing when the editor is open.
  private _openEditor(focus = true) {
    if (this.editing.get()) { return; }
    const html = this._htmlInDocument.get();
    bundleChanges(() => {
      this._setHtmlInEditor(html);
      this._htmlInPreview.set(html);
      this._previewSwitch.set(true);
      this.editing.set(true);
    });
    if (focus) { this.viewSection.hasFocus(true); }
  }

  // Without the assistant, the user can only write the HTML, so an empty widget opens in the editor
  // with the source shown. This happens once, when the widget is shown; Close still closes it.
  // It does not use onEditSourceClicked: it must not take the focus or start the animation.
  private _openWhenEmpty() {
    if (this.editing.get() || this._htmlInDocument.get() || !this.canEdit.get() || this.hasAssistant) { return; }
    bundleChanges(() => {
      this._openEditor(false);
      this._sourceSwitch.set(true);
    });
  }

  private _stopEditing() {
    // The editor closes, so the refresh that waits for the user to stop typing is not needed.
    this._autoRefresh.cancel();
    bundleChanges(() => {
      this.editing.set(false);
      this._sourceSwitch.set(false);
      this._previewSwitch.set(true);
    });
  }

  private _setHtmlInEditor(html: string) {
    const editor = this._aceEditor?.getEditor();
    if (editor && editor.getValue() !== html) {
      this._isSettingAce = true;
      try { editor.setValue(html, -1); } finally { this._isSettingAce = false; }
    }
    this._htmlInEditor.set(html);
  }

  private _focusAce() {
    setTimeout(() => {
      if (this.isDisposed()) { return; }
      const editor = this._aceEditor?.getEditor();
      if (editor && this._sourceSwitch.get()) { editor.focus(); }
    }, 0);
  }

  private async _saveHtml(html: string) {
    const { customDef, optionsObj } = this.viewSection;
    bundleChanges(() => {
      optionsObj.prop("html")(html);
      if (!customDef.access.peek()) { customDef.access(DEFAULT_WIDGET_CREATOR_ACCESS); }
    });
    // Saves all the section's options, the HTML and the access level together.
    await this.viewSection.saveCustomDef();
  }

  private _buildDom() {
    return cssBody(
      dom.cls("clipboard_group_focus"),
      dom.domComputed((use): "edit" | "widget" | "empty" => {
        if (use(this.editing)) { return "edit"; }
        if (use(this._htmlInDocument)) { return "widget"; }
        return "empty";
      }, (state) => {
        switch (state) {
          case "edit": return this._buildEditor();
          case "widget": return dom.domComputed(
            use => [use(this._htmlInDocument), use(this.viewSection.customDef.access)] as const,
            ([html, access]) => this._buildWidget(html, access as AccessLevel));
          case "empty": return this._buildEmpty();
        }
      }),
      testId("widget-creator"),
    );
  }

  private _buildEmpty() {
    const panel = this.gristDoc.assistantPanel;
    return dom.domComputed((use): "readonly" | "composer" | "text" => {
      if (!use(this.canEdit)) { return "readonly"; }
      return panel && !use(panel.isOpen) ? "composer" : "text";
    }, (state) => {
      switch (state) {
        case "readonly": return cssEmpty(cssEmptyTitle(t("This widget is empty.")), testId("widget-creator-empty"));
        case "composer": return this._buildEmptyAssistant();
        case "text": return this._buildNothingYet();
      }
    });
  }

  private _buildEmptyAssistant() {
    return this._buildEmptyWithAssistant(
      [
        cssEmptyTitle(t("What should this widget show?")),
        cssComposer(
          dom.create(buildWidgetCreatorComposer, { onSubmit: (prompt: string) => this._onPromptSubmitted(prompt) }),
        ),
      ],
      testId("widget-creator-empty-assistant"),
    );
  }

  private _buildEmptyWithAssistant(assistantEntry: DomContents, ...args: DomElementArg[]) {
    return cssEmpty(
      assistantEntry,
      cssOrDivider(t("or")),
      this._buildEditSourceButton(),
      this._learnMoreLink(),
      testId("widget-creator-empty"),
      ...args,
    );
  }

  private _buildEditSourceButton() {
    return cssBasicIconButton(
      icon("Code"), t("Edit source"),
      dom.on("click", () => this.onEditSourceClicked()),
      testId("widget-creator-edit-source"),
    );
  }

  private _learnMoreLink() {
    return cssLink(t("Learn more"), { href: commonUrls.helpWidgetCreator, target: "_blank" },
      testId("widget-creator-learn-more"));
  }

  private _buildEditor() {
    let body: HTMLElement;
    return cssEditor(
      dom.on("keydown", ev => this._onKeyDown(ev)),
      this._buildTopBar(),
      cssEditorBody(
        (elem) => { body = elem; },
        cssEditorBody.cls("-dragging", this._dragging),
        cssSourcePane(
          dom.show(this._sourceSwitch),
          dom.cls(cssWideOnly.className),
          dom.style("width", use => use(this._previewSwitch) ? `${use(this._split)}%` : ""),
          dom.style("max-width", use => use(this._previewSwitch) ? "" : "none"),
          dom.style("flex", use => use(this._previewSwitch) ? "" : "auto"),
          // The source slides in when the Source toggle is checked. The preview is on then, so the
          // source grows to its share of the width.
          transition(this._sourceSwitch, {
            prepare(elem, show) {
              if (show) { elem.style.width = "0"; elem.style.minWidth = "0"; }
            },
            run: (elem, show) => {
              if (show) { elem.style.width = `${this._split.get()}%`; elem.style.minWidth = ""; }
            },
          }),
          elem => this._buildAce(elem),
          testId("widget-creator-code"),
        ),
        resizeFlexVHandle(
          {
            target: "left",
            onSave: width => this._onSplitDragEnd(width, body),
          },
          dom.cls(cssSplitter.className),
          dom.show(use => use(this._sourceSwitch) && use(this._previewSwitch)),
          dom.cls(cssWideOnly.className),
          dom.on("mousedown", () => this._onSplitDragStart()),
          testId("widget-creator-splitter"),
        ),
        cssWidgetPane(
          dom.show(use => !use(this._sourceSwitch) || use(this._previewSwitch)),
          dom.domComputed(
            use => [use(this._htmlInPreview), use(this.viewSection.customDef.access)] as const,
            ([html, access]) => html ? this._buildWidget(html, access as AccessLevel) : this._buildNothingYet(),
          ),
        ),
      ),
      testId("widget-creator-editor"),
    );
  }

  private _buildNothingYet() {
    const link = (label: string, action: () => void, id: string) =>
      cssNothingYetLink(label, dom.on("click", action), testId(`widget-creator-nothing-yet-${id}`));
    return cssNothingYet(
      cssNarrowOnly(
        dom("div", t("Too narrow for the code")),
        dom("div", link(t("Expand the widget"), () => this._onExpandClicked(), "expand")),
      ),
      cssWideOnly(dom.domComputed((use): "assistant" | "source" | "sourceOn" => {
        if (this.hasAssistant) { return "assistant"; }
        return use(this._sourceSwitch) ? "sourceOn" : "source";
      }, (state) => {
        switch (state) {
          case "assistant": return [
            dom("div", t("Write html and js code")),
            dom("div", t("{{ask}}, or {{write}}", {
              ask: link(t("Ask the assistant"), () => this.onAskAssistantClicked(), "ask"),
              write: link(t("write it yourself"), () => this.onEditSourceClicked(), "write"),
            })),
          ];
          case "source": return [
            dom("div", t("Write html and js code")),
            dom("div", link(t("Open the code"), () => this.onEditSourceClicked(), "write")),
          ];
          case "sourceOn": return dom("div", t("Write html and js code"));
        }
      })),
      dom("div", cssNothingYetLink(t("Learn more"), { href: commonUrls.helpWidgetCreator, target: "_blank" },
        testId("widget-creator-nothing-yet-learn-more"))),
      testId("widget-creator-nothing-yet"),
    );
  }

  private _buildSaveLabel(state: SaveState, label: string) {
    return cssSaveLabel(label, cssSaveLabel.cls("-hidden", use => use(this._saveState) !== state));
  }

  private _buildTopBar() {
    const panel = this.gristDoc.assistantPanel;
    const sourceToggle = Computed.create(null, use => use(this._sourceSwitch))
      .onWrite(checked => this._onSourceToggled(checked));
    return cssBar(
      cssBarSide(
        cssSaveButton(
          // All labels are in the same place, so the button keeps its width when the text changes.
          this._buildSaveLabel("save", t("Save")),
          this._buildSaveLabel("saved", t("Saved")),
          this._buildSaveLabel("empty", t("Empty")),
          cssSaveButton.cls("-changes", use => use(this._saveState) === "save"),
          dom.on("click", () => this._onSaveClicked()),
          hoverTooltip(() => t("Save the code ({{shortcut}})",
            { shortcut: allCommands.widgetCreatorSave.humanKeys[0] }), { key: "widgetCreatorSave" }),
          testId("widget-creator-save"),
        ),
        panel ? cssBarGroup(
          dom.cls(cssWideOnly.className),
          cssBarSeparator(),
          cssBarTextButton(
            icon("Sparkle"),
            cssBarText(t("Use assistant")),
            dom.hide(panel.isOpen),
            dom.on("click", () => this.onAskAssistantClicked()),
            testId("widget-creator-use-assistant"),
          ),
        ) : null,
      ),
      cssBarSide(cssBarSide.cls("-right"),
        cssBarGroup(
          dom.cls(cssWideOnly.className),
          toggleSwitch(sourceToggle, {
            label: t("Source"),
            labelArgs: [
              dom.cls(cssBarText.className),
              // The label is before the switch, so the space is on its right side.
              dom.style("margin", "0 8px 0 0"),
              testId("widget-creator-source-label"),
            ],
            args: [
              dom.style("flex-direction", "row-reverse"),
              testId("widget-creator-source"),
            ],
          }),
          cssBarSeparator(),
          cssEyeButton(
            dom.domComputed(this._previewSwitch, show => icon(show ? "EyeShow" : "EyeHide")),
            cssEyeButton.cls("-hidden", use => !use(this._previewSwitch)),
            dom.on("click", () => this._onEyeClicked()),
            { title: t("Toggle preview") },
            testId("widget-creator-eye"),
          ),
          cssBarSeparator(),
          infoTooltip("widgetCreator", {}, testId("widget-creator-learn-more")),
          cssBarSeparator(),
        ),
        cssBarGroup(
          dom.cls(cssNarrowOnly.className),
          cssBarIconButton(icon("Grow"),
            dom.on("click", () => this._onExpandClicked()),
            hoverTooltip(t("Too narrow for the code. Expand to see and edit it."), { key: "widgetCreatorExpand" }),
            testId("widget-creator-expand"),
          ),
          cssBarSeparator(),
        ),
        cssBarIconButton(icon("CrossBig"),
          dom.on("click", () => this.onCloseClicked()),
          { title: t("Close editor") },
          testId("widget-creator-close"),
        ),
      ),
      dom.autoDispose(sourceToggle),
      testId("widget-creator-bar"),
    );
  }

  private _buildAce(pane: HTMLElement) {
    const aceEditor = AceEditor.create({
      // The source is always dark, in Grist's light mode too.
      theme: "dracula",
      calcSize: () => ({ width: pane.clientWidth, height: pane.clientHeight }),
    });
    this._aceEditor = aceEditor;
    const observer = new ResizeObserver(() => {
      if (aceEditor.isBuilt()) { aceEditor.resize(); }
    });
    observer.observe(pane);
    dom.update(pane,
      aceEditor.buildDom((editor: any) => {
        editor.setOptions({ enableLiveAutocompletion: false, showPrintMargin: false });
        editor.renderer.setShowGutter(true);
        editor.renderer.setPadding(12);
        editor.setFontSize(13);
        const session = editor.getSession();
        // Grist does not include Ace's syntax check workers.
        session.setUseWorker(false);
        session.setMode("ace/mode/html");
        session.setUseWrapMode(false);
        editor.setValue(this._htmlInEditor.get(), -1);
        editor.on("change", () => this._onAceTextChange(editor.getValue()));
        aceEditor.resize();
        if (this._sourceSwitch.get()) { editor.focus(); }
      }),
      dom.onDispose(() => {
        observer.disconnect();
        if (this._aceEditor === aceEditor) { this._aceEditor = null; }
        aceEditor.dispose();
      }),
    );
  }

  private _buildErrorBox(error: WidgetError) {
    const text = errorText(error);
    return cssErrorBox(
      cssErrorText(text, testId("widget-creator-error-text")),
      cssErrorActions(
        dom.maybe(use => this.hasAssistant && use(this.canEdit), () => primaryButton(
          icon("Sparkle"), t("Send to assistant"),
          dom.on("click", () => this._onSendErrorClicked()),
          testId("widget-creator-error-send"),
        )),
        basicButton(t("Copy error"),
          dom.on("click", () => this._onCopyErrorClicked(text)),
          testId("widget-creator-error-copy"),
        ),
      ),
      testId("widget-creator-error"),
    );
  }

  private _buildWidget(html: string, access: AccessLevel) {
    // A new frame runs the HTML again, so the old error is cleared.
    this._error.set(null);
    const widgetFrame = createCustomWidgetFrame(this, {
      url: null,
      srcdoc: html,
      // Keep only the first error: the next ones are often caused by it.
      onWidgetError: (error) => { if (!this._error.get()) { this._error.set(error); } },
      access,
    });
    return cssFrameBox(
      widgetFrame.buildDom(),
      dom.autoDispose(widgetFrame),
      dom.maybe(this._error, error => this._buildErrorBox(error)),
      testId("widget-creator-widget"),
    );
  }
}

/** The error as the widget shows it, for example "Error on line 17: Uncaught SyntaxError: ...". */
function errorText(error: WidgetError) {
  // An error from a promise has no line number, but its stack has one, for example
  // "at f (about:srcdoc:7:30)".
  const line = error.line ?? Number(/about:srcdoc:(\d+)/.exec(error.stack ?? "")?.[1] ?? 0);
  return line ?
    t("Error on line {{line}}: {{- message}}", { line, message: error.message }) :
    t("Error: {{- message}}", { message: error.message });
}

function toast(message: string) {
  reportSuccess(message, { expireSec: 2 });
}

const ACE_DRACULA_BG = "#282a36";

const cssBody = styled("div", `
  position: relative;
  flex: auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background-color: ${theme.widgetBg};
  container: widget-creator / inline-size;
`);

const cssFrameBox = styled("div", `
  position: relative;
  flex: auto;
  display: flex;
  min-height: 0;
  min-width: 0;
  & > iframe {
    flex: auto;
    border: none;
    width: 100%;
    height: 100%;
  }
`);

const cssErrorBox = styled("div", `
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  padding: 8px 10px;
  border: 1px solid ${theme.errorText};
  border-radius: 4px;
  background-color: ${theme.widgetBg};
`);

const cssErrorText = styled("div", `
  flex: 1 1 220px;
  min-width: 0;
  max-height: 64px;
  overflow-y: auto;
  overflow-wrap: anywhere;
  font-family: ${vars.fontFamilyData};
  font-size: ${vars.smallFontSize};
  color: ${theme.errorText};
`);

const cssErrorActions = styled("div", `
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-left: auto;
  & > button {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
`);

const cssEmpty = styled("div", `
  flex: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  text-align: center;
  color: ${theme.lightText};
  background-color: ${theme.widgetBg};
  overflow: auto;
`);

const cssEmptyTitle = styled("div", `
  font-size: ${vars.xlargeFontSize};
  font-weight: 600;
  color: ${theme.text};
`);

const cssComposer = styled("div", `
  width: 100%;
  max-width: 480px;
  margin-top: 4px;
`);

const cssOrDivider = styled("div", `
  display: flex;
  align-items: center;
  gap: 10px;
  width: 200px;
  max-width: 100%;
  margin: 4px 0;
  font-size: ${vars.smallFontSize};
  &::before, &::after {
    content: "";
    flex: 1;
    height: 1px;
    background-color: ${theme.pagePanelsBorder};
  }
`);

const iconButtonStyle = `
  display: flex;
  align-items: center;
  gap: 6px;
`;
const cssBasicIconButton = styled(basicButton, iconButtonStyle);

const cssEditor = styled("div", `
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
`);

// Shown only when the editor is wide enough for the source.
const cssWideOnly = styled("div", `
  @container widget-creator (max-width: 399px) {
    & {
      display: none !important;
    }
  }
`);

// Shown only when the editor is too narrow for the source.
const cssNarrowOnly = styled("div", `
  @container widget-creator (min-width: 400px) {
    & {
      display: none !important;
    }
  }
`);

const cssBar = styled("div", `
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 8px;
  overflow: hidden;
  background-color: ${tokens.bgSecondary};
  border-bottom: 1px solid ${theme.inputBorder};
  container-type: inline-size;
  user-select: none;
`);

const cssBarSide = styled("div", `
  flex: 1 1 0;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  min-width: 0;
  &-right {
    justify-content: flex-end;
  }
`);

const cssSaveButton = styled(basicButton, `
  display: inline-grid;
  justify-items: center;
  align-items: center;
  color: ${theme.lightText};
  border-color: ${theme.pagePanelsBorder};
  cursor: default;
  &:hover {
    border-color: ${theme.pagePanelsBorder};
  }
  &-changes {
    color: ${theme.controlPrimaryFg};
    background-color: ${theme.controlPrimaryBg};
    border-color: ${theme.controlPrimaryBg};
    cursor: pointer;
  }
  &-changes:hover {
    color: ${theme.controlPrimaryFg};
    background-color: ${theme.controlPrimaryHoverBg};
    border-color: ${theme.controlPrimaryHoverBg};
  }
`);

const cssSaveLabel = styled("span", `
  grid-area: 1 / 1;
  &-hidden {
    visibility: hidden;
  }
`);

const cssBarTextButton = styled(textButton, `
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
`);

const cssBarText = styled("span", `
  @container (max-width: 500px) {
    & {
      display: none;
    }
  }
`);

const cssBarSeparator = styled("div", `
  width: 1px;
  height: 20px;
  background-color: ${theme.text};
  opacity: 0.15;
  flex: none;
`);

const cssBarIconButton = styled(cssIconButton, `
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  cursor: pointer;
  --icon-color: ${theme.lightText};
  &:hover {
    --icon-color: ${theme.text};
  }
`);

const cssEditorBody = styled("div", `
  position: relative;
  flex: 1 1 0;
  display: flex;
  min-height: 0;
  overflow: hidden;
  --resize-handle-color: ${theme.inputBorder};
  --resize-handle-highlight: ${theme.controlPrimaryBg};
  &-dragging {
    cursor: ew-resize;
    user-select: none;
  }
  &-dragging iframe {
    pointer-events: none;
  }
`);

const cssSourcePane = styled("div", `
  flex: none;
  min-width: 120px;
  max-width: calc(100% - 120px);
  overflow: hidden;
  position: relative;
  /* Ace sets its own size in pixels; this keeps it from changing the size of the pane. */
  contain: size;
  transition: width .28s ease-out, min-width .28s ease-out;
  .${cssEditorBody.className}-dragging > & {
    transition: none;
  }
  & .ace_editor {
    line-height: 19px;
  }
  /* Grist's Ace style would replace the theme's background with its own. */
  &, & .ace_editor.ace-dracula {
    background-color: ${ACE_DRACULA_BG};
  }
`);

const cssWidgetPane = styled("div", `
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  overflow: hidden;
  @container widget-creator (max-width: 399px) {
    & {
      display: flex !important;
    }
  }
`);

const cssNothingYet = styled("div", `
  margin: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
  text-align: center;
  color: ${theme.lightText};
  line-height: 20px;
`);

const cssNothingYetLink = styled("a", `
  color: ${theme.controlFg};
  text-decoration: none;
  cursor: pointer;
  &:hover, &:focus {
    color: ${theme.controlHoverFg};
    text-decoration: none;
  }
`);

// Bar items that are hidden together. They are placed in the bar as if this box was not there.
const cssBarGroup = styled("div", `
  display: contents;
`);

const cssEyeButton = styled(cssBarIconButton, `
  width: 24px;
  height: 24px;
  &-hidden {
    background-color: ${theme.pagePanelsBorder};
    --icon-color: ${theme.text};
  }
`);

const cssSplitter = styled("div", `
  &::before, &::after {
    width: 3px;
    left: 2px;
    border-radius: 2px;
  }
  &::after {
    transition: opacity linear .1s;
  }
  &:hover::after {
    transition: opacity linear .1s .1s;
  }
`);
