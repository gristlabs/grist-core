import { BehavioralPromptsManager } from "app/client/components/BehavioralPromptsManager";
import { GristDoc } from "app/client/components/GristDoc";
import {
  cssWhenKeyboardUser,
  highlightKeyboardFocus,
  isKeyboardUser,
  kbFocusHighlighterClass,
} from "app/client/components/KeyboardFocusHighlighter";
import { FocusLayer } from "app/client/lib/FocusLayer";
import { focusAdjacentFocusable, trapTabKey } from "app/client/lib/focusUtils";
import { makeT } from "app/client/lib/localization";
import { reportError } from "app/client/models/AppModel";
import { ColumnRec, TableRec, ViewSectionRec } from "app/client/models/DocModel";
import { PERMITTED_CUSTOM_WIDGETS } from "app/client/models/features";
import { linkId, NoLink } from "app/client/ui/selectBy";
import { overflowTooltip, withInfoTooltip } from "app/client/ui/tooltips";
import { getWidgetTypes } from "app/client/ui/widgetTypesMap";
import { bigPrimaryButton } from "app/client/ui2018/buttons";
import { theme, vars } from "app/client/ui2018/cssVars";
import { icon } from "app/client/ui2018/icons";
import { spinnerModal } from "app/client/ui2018/modals";
import { unstyledButton } from "app/client/ui2018/unstyled";
import { isLongerThan, nativeCompare } from "app/common/gutil";
import { IAttachedCustomWidget, IWidgetType } from "app/common/widgetTypes";

import {
  computed,
  Computed,
  Disposable,
  dom,
  DomArg,
  domComputed,
  DomElementArg,
  fromKo,
  IOption,
  makeTestId,
  Observable,
  onKeyDown,
  select,
  styled,
} from "grainjs";
import without from "lodash/without";
import Popper from "popper.js";
import { IOpenController, popupOpen, setPopupToCreateDom } from "popweasel";

const t = makeT("PageWidgetPicker");

type TableRef = number | "New Table" | null;

type KeyboardZone = "widgets" | "data" | "pivot" | "summarize" | "submit";

// Describes a widget selection.
export interface IPageWidget {

  // The widget type
  type: IWidgetType;

  // The table (one of the listed tables or 'New Table')
  table: TableRef;

  // Whether to summarize the table (not available for "New Table").
  summarize: boolean;

  // some of the listed columns to use to summarize the table.
  columns: number[];

  // link
  link: string;

  // the page widget section id (should be 0 for a to-be-saved new widget)
  section: number;
}

export const DefaultPageWidget: () => IPageWidget = () => ({
  type: "record",
  table: null,
  summarize: false,
  columns: [],
  link: NoLink,
  section: 0,
});

// Creates a IPageWidget from a ViewSectionRec.
export function toPageWidget(section: ViewSectionRec): IPageWidget {
  const link = linkId({
    srcSectionRef: section.linkSrcSectionRef.peek(),
    srcColRef: section.linkSrcColRef.peek(),
    targetColRef: section.linkTargetColRef.peek(),
  });
  return {
    type: section.parentKey.peek() as IWidgetType,
    table: section.table.peek().summarySourceTable.peek() || section.tableRef.peek(),
    summarize: Boolean(section.table.peek().summarySourceTable.peek()),
    columns: section.table.peek().columns.peek().peek()
      .filter(col => col.summarySourceCol.peek())
      .map(col => col.summarySourceCol.peek()),
    link, section: section.id.peek(),
  };
}

export interface IOptions extends ISelectOptions {

  // the initial selected value, we call the function when the popup get triggered
  value?: () => IPageWidget;

  // placement, directly passed to the underlying Popper library.
  placement?: Popper.Placement;
}

export interface ICompatibleTypes {

  // true if "New Page" is selected in Page Picker
  isNewPage: boolean | undefined;

  // true if can be summarized
  summarize: boolean;
}

const testId = makeTestId("test-wselect-");

// The picker disables some choices that do not make much sense. This function return the list of
// compatible types given the tableId and whether user is creating a new page or not.
function getCompatibleTypes(tableId: TableRef,
  { isNewPage, summarize }: ICompatibleTypes): IWidgetType[] {
  let compatibleTypes: IWidgetType[] = [];
  if (tableId !== "New Table") {
    compatibleTypes = ["record", "single", "detail", "chart", "custom", "custom.calendar", "form"];
  } else if (isNewPage) {
    // New view + new table means we'll be switching to the primary view.
    compatibleTypes = ["record", "form"];
  } else {
    // The type 'chart' makes little sense when creating a new table.
    compatibleTypes = ["record", "single", "detail", "form"];
  }
  return summarize ? compatibleTypes.filter(el => isSummaryCompatible(el)) : compatibleTypes;
}

// The Picker disables some choices that do not make much sense.
// This function return a boolean telling if summary can be used with this type.
function isSummaryCompatible(widgetType: IWidgetType): boolean {
  const incompatibleTypes: IWidgetType[] = ["form"];
  return !incompatibleTypes.includes(widgetType);
}

// Whether table and type make for a valid selection whether the user is creating a new page or not.
function isValidSelection(table: TableRef,
  type: IWidgetType,
  { isNewPage, summarize }: ICompatibleTypes) {
  return table !== null && getCompatibleTypes(table, { isNewPage, summarize }).includes(type);
}

export type ISaveFunc = (val: IPageWidget) => Promise<any>;

// Delay in milliseconds, after a user click on the save btn, before we start showing a modal
// spinner. If saving completes before this time elapses (which is likely to happen for regular
// table) we don't show the modal spinner.
const DELAY_BEFORE_SPINNER_MS = 500;

// Attaches the page widget picker to elem to open on 'click' on the left.
export function attachPageWidgetPicker(elem: HTMLElement, gristDoc: GristDoc, onSave: ISaveFunc,
  options: IOptions = {}) {
  // Overrides .placement, this is needed to enable the page widget to update position when user
  // expand the `Group By` panel.
  // TODO: remove .placement from the options of this method (note: breaking buildPageWidgetPicker
  // into two steps, one for model creation and the other for building UI, seems promising. In
  // particular listening to value.summarize to update popup position could be done directly in
  // code).
  options.placement = "left";
  const domCreator = (ctl: IOpenController) => buildPageWidgetPicker(ctl, gristDoc, onSave, options);
  setPopupToCreateDom(elem, domCreator, {
    placement: "left",
    trigger: ["click"],
    attach: "body",
    boundaries: "viewport",
  });
}

// Open page widget widget picker on the right of element.
export function openPageWidgetPicker(elem: HTMLElement, gristDoc: GristDoc, onSave: ISaveFunc,
  options: IOptions = {}) {
  popupOpen(elem, ctl => buildPageWidgetPicker(
    ctl, gristDoc, onSave, options,
  ), { placement: "right" });
}

// Builds a picker to stick into the popup. Takes care of setting up the initial selected value and
// bind various events to the popup behaviours: close popup on save, gives focus to the picker,
// binds cancel and save to Escape and Enter keydown events. Also takes care of preventing the popup
// to overlay the trigger element (which could happen when the 'Group By' panel is expanded for the
// first time). When saving is taking time, show a modal spinner (see DELAY_BEFORE_SPINNER_MS).
export function buildPageWidgetPicker(
  ctl: IOpenController,
  gristDoc: GristDoc,
  onSave: ISaveFunc,
  options: IOptions = {},
) {
  const { behavioralPromptsManager, docModel } = gristDoc;
  const tables = fromKo(docModel.visibleTables.getObservable());
  const columns = fromKo(docModel.columns.createAllRowsModel("parentPos").getObservable());

  // default value for when it is omitted
  const defaultValue: IPageWidget = {
    type: "record",
    table: null, // when creating a new widget, let's initially have no table selected
    summarize: false,
    columns: [],
    link: NoLink,
    section: 0,
  };

  // get initial value and setup state for the picker.
  const initValue = options.value?.() || defaultValue;
  const value: IWidgetValueObs = {
    type: Observable.create(ctl, initValue.type),
    table: Observable.create(ctl, initValue.table),
    summarize: Observable.create(ctl, initValue.summarize),
    columns: Observable.create(ctl, initValue.columns),
    link: Observable.create(ctl, initValue.link),
    section: Observable.create(ctl, initValue.section),
  };

  // calls onSave and closes the popup. Failure must be handled by the caller.
  async function onSaveCB() {
    ctl.close();
    const type = value.type.get();
    const savePromise = onSave({
      type,
      table: value.table.get(),
      summarize: value.summarize.get(),
      columns: sortedAs(value.columns.get(), columns.get().map(col => col.id.peek())),
      link: value.link.get(),
      section: value.section.get(),
    });
    if (value.table.get() === "New Table") {
      // Adding empty table will show a prompt, so we don't want to wait for it.
      await savePromise;
    } else {
      // If savePromise throws an error, before or after timeout, we let the error propagate as it
      // should be handle by the caller.
      if (await isLongerThan(savePromise, DELAY_BEFORE_SPINNER_MS)) {
        const label = getWidgetTypes(type).getLabel();
        await spinnerModal(t("Building {{- label}} widget", { label }), savePromise);
      }
    }
  }

  // whether the current selection is valid
  function isValid() {
    return isValidSelection(
      value.table.get(),
      value.type.get(),
      {
        isNewPage: options.isNewPage,
        summarize: value.summarize.get(),
      });
  }

  // Summarizing a table causes the 'Group By' panel to expand on the right. To prevent it from
  // overlaying the trigger, we bind an update of the popup to it when it is on the left of the
  // trigger.
  // WARN: This does not work when the picker is triggered from a menu item because the trigger
  // element does not exist anymore at this time so calling update will misplace the popup. However,
  // this is not a problem at the time or writing because the picker is never placed at the left of
  // a menu item (currently picker is only placed at the right of a menu item and at the left of a
  // basic button).
  if (options.placement && options.placement === "left") {
    ctl.autoDispose(value.summarize.addListener((val, old) => val && ctl.update()));
  }

  // dom
  return cssPopupWrapper(
    dom.create(PageWidgetSelect,
      value, tables, columns, onSaveCB, behavioralPromptsManager, options),

    (elem) => {
      FocusLayer.create(ctl, { defaultFocusElem: elem, pauseMousetrap: true });

      // We have a rather specific keyboard handling in this whole popup.
      // We give focus to the first item in the widgets list when the popup is opened.
      // We do this in a setTimeout to avoid conflicts with the FocusLayer.
      setTimeout(() => {
        let button = elem.querySelector<HTMLElement>(
          `[data-kb-zone="widgets"] .${cssEntry.className}-selected:not(:disabled)`,
        );
        if (!button) {
          button = elem.querySelector<HTMLElement>(
            `[data-kb-zone="widgets"] .${cssEntry.className}:not(:disabled)`,
          );
        }
        button?.focus();
      }, 0);
    },
    onKeyDown({
      Escape: () => ctl.close(),
      Enter$: (ev: KeyboardEvent) => {
        if (!ev.ctrlKey && !ev.metaKey) {
          return;
        }
        if (!isValid()) {
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        return onSaveCB();
      },
    }),
  );
}

// Same as IWidgetValue but with observable values
export type IWidgetValueObs = {
  [P in keyof IPageWidget]: Observable<IPageWidget[P]>;
};

export interface ISelectOptions {
  // the button's label
  buttonLabel?: string;

  // Indicates whether the section builder is in a new view
  isNewPage?: boolean;

  // A callback to provides the links that are available to a page widget. It is called any time the
  // user changes in the selected page widget (type, table, summary ...) and we update the "SELECT
  // BY" dropdown with the result list of options. The "SELECT BY" dropdown is hidden if omitted.
  selectBy?: (val: IPageWidget) => IOption<string>[];
}

const registeredCustomWidgets: IAttachedCustomWidget[] =  ["custom.calendar"];

const permittedCustomWidgets: IAttachedCustomWidget[] = PERMITTED_CUSTOM_WIDGETS().get().map(widget =>
  widget as IAttachedCustomWidget) ?? [];
// the list of widget types in the order they should be listed by the widget.
const finalListOfCustomWidgetToShow =  permittedCustomWidgets.filter(a =>
  registeredCustomWidgets.includes(a));
const sectionTypes: IWidgetType[] = [
  "record", "single", "detail", "form", "chart", ...finalListOfCustomWidgetToShow, "custom",
];

// Returns dom that let a user select a page widget. User can select a widget type (id: 'grid',
// 'card', ...), one of `tables` and optionally some of the `columns` of the selected table if she
// wants to generate a summary. Clicking the `Add ...` button trigger `onSave()`. Note: this is an
// internal method used by widgetPicker, it is only exposed for testing reason.
export class PageWidgetSelect extends Disposable {
  // an observable holding the list of options of the `select by` dropdown
  private _selectByOptions = this._options.selectBy ?
    Computed.create(this, (use) => {
      // TODO: it is unfortunate to have to convert from IWidgetValueObs to IWidgetValue. Maybe
      // better to change this._value to be Observable<IWidgetValue> instead.
      const val = {
        type: use(this._value.type),
        table: use(this._value.table),
        summarize: use(this._value.summarize),
        columns: use(this._value.columns),
        // should not have a dependency on .link
        link: this._value.link.get(),
        section: use(this._value.section),
      };
      return this._options.selectBy!(val);
    }) :
    null;

  private _isNewTableDisabled = Computed.create(this, this._value.type, (use, type) => !isValidSelection(
    "New Table", type, { isNewPage: this._options.isNewPage, summarize: use(this._value.summarize) }));

  private _isSummaryDisabled = Computed.create(this, this._value.type, (_use, type) => !isSummaryCompatible(type));

  private _rootEl: HTMLElement | undefined;

  constructor(
    private _value: IWidgetValueObs,
    private _tables: Observable<TableRec[]>,
    private _columns: Observable<ColumnRec[]>,
    private _onSave: () => Promise<void>,
    private _behavioralPromptsManager: BehavioralPromptsManager,
    private _options: ISelectOptions = {},
  ) { super(); }

  public buildDom() {
    return cssContainer(
      dom.cls(kbFocusHighlighterClass),
      (el) => {
        this._rootEl = el as HTMLElement;
      },
      // Keyboard navigation is done through using Arrow keys to navigate in lists, Esc to go back, Enter to submit.
      onKeyDown({
        ArrowDown: (ev, root) => {
          if (this._getFocusedZone() !== "submit") {
            highlightKeyboardFocus();
            focusAdjacentFocusable(root, 1);
          }
        },
        ArrowUp: (ev, root) => {
          if (this._getFocusedZone() !== "submit") {
            highlightKeyboardFocus();
            focusAdjacentFocusable(root, -1);
          }
        },
        Enter$: (ev) => {
          // If we pressed ctrl/command+Enter, we let the outer listener potential submit the choices.
          if (ev.ctrlKey || ev.metaKey) {
            ev.preventDefault();
            return;
          }
          highlightKeyboardFocus();
          // If we pressed Enter to navigate between sections inside the picker, dont let outer elements know about it.
          if (this._keyboardGoNext()) {
            ev.preventDefault();
            ev.stopPropagation();
          }
        },
        Escape$: (ev) => {
          // If we pressed Esc to navigate between sections inside the picker, dont let outer elements know about it.
          // If we didn't detect an actual keyboard usage with arrow keys/tab, we assume the user pressed Esc to close
          // the picker directly.
          if (isKeyboardUser() && this._keyboardGoBack()) {
            ev.preventDefault();
            ev.stopPropagation();
          }
        },
        Tab$: (ev) => {
          highlightKeyboardFocus();
          // We allow tab navigation in the submit zone, where a select input might be rendered with the submit button.
          if (this._getFocusedZone() === "submit") {
            trapTabKey(this._rootEl!.querySelector<HTMLElement>('[data-kb-zone="submit"]')!, ev);
            return;
          }
          // Otherwise, we disable the Tab key, user navigates with Arrows/Esc/Enter.
          ev.preventDefault();
          ev.stopPropagation();
        },
      }),
      testId("container"),
      cssBody(
        cssPanel(
          {
            "data-kb-zone": "widgets",
            "role": "group",
            "aria-labelledby": "picker-widgets-header",
            "aria-describedby": "picker-kb-help",
          },
          header(t("Select widget"), { id: "picker-widgets-header" }),
          sectionTypes.map((value) => {
            const widgetInfo = getWidgetTypes(value);
            const disabled = computed(this._value.table,
              (use, tid) => this._isTypeDisabled(value, tid, use(this._value.summarize)),
            );
            return cssEntry(
              dom.autoDispose(disabled),
              cssTypeIcon(widgetInfo.icon),
              widgetInfo.getLabel(),
              dom.on("click", (event) => {
                if (disabled.get()) {
                  return;
                }
                event.preventDefault();
                this._selectType(value);
              }),
              dom.data("widget-type", value),
              cssEntry.cls("-selected", use => use(this._value.type) === value),
              dom.attr("aria-pressed", use => use(this._value.type) === value ? "true" : undefined),
              cssEntry.cls("-disabled", disabled),
              dom.prop("disabled", disabled),
              testId("type"),
            );
          }),
        ),
        cssPanel(
          testId("data"),
          {
            "data-kb-zone": "data",
            "role": "group",
            "aria-labelledby": "picker-data-header",
            "aria-describedby": "picker-kb-help",
          },
          header(t("Select data"), { id: "picker-data-header" }),
          cssEntry(
            cssIcon("TypeTable"), t("New Table"),
            // prevent the selection of 'New Table' if it is disabled
            dom.on("click", ev => !this._isNewTableDisabled.get() && this._selectTable("New Table")),
            this._behavioralPromptsManager.attachPopup("pageWidgetPicker", {
              popupOptions: {
                attach: null,
                placement: "right-start",
              },
            }),
            dom.data("tid", "New Table"),
            cssEntry.cls("-selected", use => use(this._value.table) === "New Table"),
            dom.attr("aria-pressed", use => use(this._value.table) === "New Table" ? "true" : undefined),
            cssEntry.cls("-disabled", this._isNewTableDisabled),
            dom.prop("disabled", use => use(this._isNewTableDisabled)),
            testId("table"),
          ),
          dom.forEach(this._tables, table => dom("div",
            cssEntryWrapper(
              cssEntry(
                dom.data("tid", String(table.id())),
                cssIcon("TypeTable"),
                cssLabel(dom.text(table.tableNameDef), overflowTooltip()),
                dom.on("click", () => this._selectTable(table.id())),
                cssEntry.cls("-selected", use => use(this._value.table) === table.id()),
                dom.attr("aria-pressed", use => use(this._value.table) === table.id() ? "true" : undefined),
                testId("table-label"),
              ),
              cssPivot(
                dom.attr("data-kb-zone", "pivot"),
                dom.data("pivot-tid", String(table.id())),
                dom.attr("aria-label", use =>
                  t("{{table}} grouped by… (press to select fields)", {
                    table: use(table.tableNameDef),
                  }),
                ),
                cssBigIcon("Pivot"),
                cssEntry.cls("-selected", use => use(this._value.summarize) &&
                  use(this._value.table) === table.id(),
                ),
                dom.attr("aria-pressed", use => use(this._value.summarize) &&
                  use(this._value.table) === table.id() ? "true" : undefined),
                cssEntry.cls("-disabled", this._isSummaryDisabled),
                dom.prop("disabled", this._isSummaryDisabled),
                dom.on("click", (_ev, el) =>
                  !this._isSummaryDisabled.get() && this._selectPivot(table.id(), el as HTMLElement)),
                testId("pivot"),
              ),
              testId("table"),
            ),
          )),
        ),
        cssPanel(
          {
            "data-kb-zone": "summarize",
            "role": "group",
            "aria-labelledby": "picker-summarize-header",
            "aria-describedby": "picker-kb-help",
          },
          header(
            [t("Group by"), cssHeaderKeyboardInstructions(t("Press Space to add fields"))],
            { id: "picker-summarize-header" },
          ),
          dom.hide(use => !use(this._value.summarize)),
          domComputed(
            use => use(this._columns)
              .filter(col => !col.isHiddenCol() && col.parentId() === use(this._value.table)),
            cols => cols ?
              dom.forEach(cols, col =>
                cssEntry(
                  cssIcon("FieldColumn"), cssFieldLabel(dom.text(col.label)),
                  dom.on("click", () => this._toggleColumnId(col.id())),
                  cssEntry.cls("-selected", use => use(this._value.columns).includes(col.id())),
                  dom.attr("aria-pressed", use => use(this._value.columns).includes(col.id()) ? "true" : "false"),
                  testId("column"),
                ),
              ) :
              null,
          ),
        ),
      ),
      cssFooter(
        dom.attr("data-kb-zone", "submit"),
        cssKeyboardInstructions(
          { id: "picker-kb-help" },
          t("Use up and down arrow keys to move through options. Press Enter and Esc to move between steps."),
          testId("kb-help"),
        ),
        cssFooterContent(
          // If _selectByOptions exists and has more than then "NoLinkOption", show the selector.
          dom.maybe(use => this._selectByOptions && use(this._selectByOptions).length > 1, () =>
            withInfoTooltip(
              cssSelectBy(
                cssSmallLabel(t("SELECT BY"), { id: "picker-selectby-label" }),
                dom.update(cssSelect(this._value.link, this._selectByOptions!),
                  testId("selectby"),
                  { "aria-labelledby": "picker-selectby-label" },
                ),
              ),
              "selectBy",
              { popupOptions: { attach: null }, domArgs: [
                this._behavioralPromptsManager.attachPopup("pageWidgetPickerSelectBy", {
                  popupOptions: {
                    attach: null,
                    placement: "bottom-start",
                  },
                }),
              ] },
            ),
          ),
          cssSubmitButton(
            // TODO: The button's label of the page widget picker should read 'Close' instead when
            // there are no changes.
            this._options.buttonLabel || t("Add to page"),
            dom.prop("disabled", use => !isValidSelection(
              use(this._value.table),
              use(this._value.type),
              {
                isNewPage: this._options.isNewPage,
                summarize: use(this._value.summarize),
              }),
            ),
            dom.on("click", () => this._onSave().catch(reportError)),
            testId("addBtn"),
          ),
        ),
      ),
    );
  }

  private _closeSummarizePanel() {
    this._value.summarize.set(false);
    this._value.columns.set([]);
  }

  private _openSummarizePanel() {
    this._value.summarize.set(true);
  }

  private _selectType(type: IWidgetType) {
    this._value.type.set(type);
  }

  private _selectTable(tid: TableRef) {
    if (tid !== this._value.table.get()) {
      this._value.link.set(NoLink);
    }
    this._value.table.set(tid);
    this._closeSummarizePanel();
  }

  private _isSelected(el: Element) {
    return el.classList.contains(cssEntry.className + "-selected");
  }

  private _selectPivot(tid: TableRef, pivotEl: Element) {
    if (this._isSelected(pivotEl)) {
      this._closeSummarizePanel();
    } else {
      if (tid !== this._value.table.get()) {
        this._value.columns.set([]);
        this._value.table.set(tid);
        this._value.link.set(NoLink);
      }
      this._openSummarizePanel();
    }
  }

  private _toggleColumnId(cid: number) {
    const ids = this._value.columns.get();
    const newIds = ids.includes(cid) ? without(ids, cid) : [...ids, cid];
    this._value.columns.set(newIds);
  }

  private _isTypeDisabled(type: IWidgetType, table: TableRef, isSummaryOn: boolean) {
    if (table === null) {
      return false;
    }
    return !getCompatibleTypes(table, { isNewPage: this._options.isNewPage, summarize: isSummaryOn }).includes(type);
  }

  private _getFocusedZone(): KeyboardZone | undefined {
    return document.activeElement?.closest("[data-kb-zone]")?.getAttribute("data-kb-zone") as KeyboardZone | undefined;
  }

  /**
   * Submit current step's selection and move keyboard focus to the next step.
   *
   * Returns false if we didn't do anything.
   */
  private _keyboardGoNext(): boolean {
    switch (this._getFocusedZone()) {
      case "widgets":
        if (this._selectFocusedType()) {
          this._focusZone("data");
          return true;
        }
        return false;

      case "data": {
        if (this._selectFocusedTable()) {
          this._focusSubmitButton();
          return true;
        }
        return false;
      }

      case "pivot": {
        this._selectFocusedPivot();
        if (this._value.summarize.get()) {
          this._focusZone("summarize");
        }
        return true;
      }

      case "summarize": {
        // Just go to next step with Enter, user must use Space to toggle items
        this._focusSubmitButton();
        return true;
      }

      case "submit":
      default:
        return false;
    }
  }

  /**
   * Focus the previous panel.
   *
   * Returns false if we didn't do anything.
   */
  private _keyboardGoBack(): boolean {
    switch (this._getFocusedZone()) {
      case "widgets":
      default:
        return false;

      case "data":
      case "pivot":
        this._value.link.set(NoLink);
        this._value.table.set(null);
        this._focusZone("widgets");
        return true;

      case "summarize":
        this._focusPivot();
        this._closeSummarizePanel();
        return true;

      case "submit":
        if (this._value.summarize.get()) {
          this._focusZone("summarize");
        } else {
          this._focusZone("data");
        }
        return true;
    }
  }

  private _selectFocusedType(): boolean {
    const activeEl = document.activeElement;
    const type = activeEl && dom.getData(activeEl, "widget-type") as IWidgetType | undefined;
    if (type && !this._isTypeDisabled(type, this._value.table.get(), this._value.summarize.get())) {
      this._selectType(type);
      return true;
    }
    return false;
  }

  private _selectFocusedTable(): boolean {
    const activeEl = document.activeElement;
    const table = activeEl && dom.getData(activeEl, "tid") as TableRef | undefined;
    if (table === "New Table" && this._isNewTableDisabled.get()) {
      return false;
    }
    if (table) {
      this._selectTable(table === "New Table" ? "New Table" : Number(table));
      return true;
    }
    return false;
  }

  private _selectFocusedPivot(): boolean {
    const activeEl = document.activeElement;
    const table = activeEl && dom.getData(activeEl, "pivot-tid") as TableRef | undefined;
    if (table && !this._isSummaryDisabled.get()) {
      this._selectPivot(Number(table), activeEl);
      return true;
    }
    return false;
  }

  private _focusZone(zone: KeyboardZone): void {
    let button = this._rootEl?.querySelector<HTMLElement>(
      `[data-kb-zone="${zone}"] .${cssEntry.className}-selected:not(:disabled)`,
    );
    if (!button) {
      button = this._rootEl?.querySelector<HTMLElement>(
        `[data-kb-zone="${zone}"] .${cssEntry.className}:not(:disabled)`,
      );
    }
    button?.focus();
  }

  private _focusPivot(): void {
    let button = this._rootEl?.querySelector<HTMLElement>(
      `.${cssPivot.className}.${cssEntry.className}-selected:not(:disabled)`,
    );
    if (!button) {
      button = this._rootEl?.querySelector<HTMLElement>(`.${cssPivot.className}:not(:disabled)`);
    }
    button?.focus();
  }

  private _focusSubmitButton(): void {
    const el = this._rootEl?.querySelector<HTMLButtonElement>('[data-kb-zone="submit"] button:not(:disabled)');
    el?.focus();
  }
}

function header(label: DomArg, ...args: DomElementArg[]) {
  return cssHeader(dom("h4", label), ...args, testId("heading"));
}

const cssContainer = styled("div", `
  --outline: 1px solid ${theme.widgetPickerBorder};

  max-height: 386px;
  box-shadow: 0 2px 20px 0 ${theme.widgetPickerShadow};
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  user-select: none;
  background-color: ${theme.widgetPickerPrimaryBg};
`);

const cssPopupWrapper = styled("div", `
  &:focus {
    outline: none;
  }
`);

const cssBody = styled("div", `
  display: flex;
  min-height: 0;
`);

// todo: try replace min-width / max-width
const cssPanel = styled("div", `
  width: 224px;
  font-size: ${vars.mediumFontSize};
  overflow: auto;
  padding-bottom: 18px;
  &:nth-of-type(2n) {
    background-color: ${theme.widgetPickerSecondaryBg};
    outline: var(--outline);
  }
`);

const cssHeader = styled("div", `
  color: ${theme.text};
  margin: 24px 0 24px 24px;
  font-size: ${vars.mediumFontSize};
`);

const cssEntry = styled(unstyledButton, `
  color: ${theme.widgetPickerItemFg};
  padding: 0 0 0 24px;
  height: 32px;
  display: flex;
  width: 100%;
  flex-direction: row;
  flex: 1 1 0px;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  &-selected {
    background-color: ${theme.widgetPickerItemSelectedBg};
  }
  &-disabled {
    color: ${theme.widgetPickerItemDisabledBg};
    cursor: default;
  }
  &-disabled&-selected {
    background-color: inherit;
  }
`);

const cssIcon = styled(icon, `
  margin-right: 8px;
  flex-shrink: 0;
  --icon-color: ${theme.widgetPickerIcon};
  .${cssEntry.className}-disabled > & {
    opacity: 0.25;
  }
`);

const cssTypeIcon = styled(cssIcon, `
  --icon-color: ${theme.widgetPickerPrimaryIcon};
`);

const cssLabel = styled("span", `
  text-overflow: ellipsis;
  overflow: hidden;
`);

const cssFieldLabel = styled(cssLabel, `
  padding-right: 8px;
`);

const cssEntryWrapper = styled("div", `
  display: flex;
  align-items: center;
`);

const cssPivot = styled(cssEntry, `
  width: 48px;
  padding-left: 8px;
  flex: 0 0 auto;
`);

const cssBigIcon = styled(icon, `
  width: 24px;
  height: 24px;
  background-color: ${theme.widgetPickerSummaryIcon};
  .${cssEntry.className}-disabled > & {
    opacity: 0.25;
    filter: saturate(0);
  }
`);

const cssFooter = styled("div", `
  display: flex;
  border-top: var(--outline);
  flex-direction: column;
`);

const cssFooterContent = styled("div", `
  flex-grow: 1;
  min-height: 65px;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 0 24px 0 24px;
  gap: 8px;
`);

const cssSmallLabel = styled("span", `
  color: ${theme.text};
  font-size: ${vars.xsmallFontSize};
  margin-right: 8px;
`);

const cssSelect = styled(select, `
  color: ${theme.selectButtonFg};
  background-color: ${theme.selectButtonBg};
  flex: 1 0 160px;
  width: 160px;
`);

const cssSelectBy = styled("div", `
  display: flex;
  align-items: center;
`);

const cssSubmitButton = styled(bigPrimaryButton, `
  margin-left: auto;
`);

const cssKeyboardInstructions = styled(cssWhenKeyboardUser, `
  margin: 0;
  padding: 12px 24px 0;
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  max-width: 410px;
`);

const cssHeaderKeyboardInstructions = styled(cssWhenKeyboardUser, `
  margin: 5px 10px 0 0;
  font-size: ${vars.smallFontSize};
  color: ${theme.lightText};
  font-weight: normal;
`);

// Returns a copy of array with its items sorted in the same order as they appear in other.
function sortedAs(array: number[], other: number[]) {
  const order: { [id: number]: number } = {};
  for (const [index, item] of other.entries()) {
    order[item] = index;
  }
  return array.slice().sort((a, b) => nativeCompare(order[a], order[b]));
}
