import {hooks} from 'app/client/Hooks';
import {makeT} from 'app/client/lib/localization';
import {allCommands} from 'app/client/components/commands';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {urlState} from 'app/client/models/gristUrlState';
import {testId} from 'app/client/ui2018/cssVars';
import {menuDivider, menuItemCmd, menuItemLink} from 'app/client/ui2018/menus';
import {GristDoc} from 'app/client/components/GristDoc';
import {dom, UseCB} from 'grainjs';
import {WidgetType} from 'app/common/widgetTypes';

const t = makeT('ViewLayoutMenu');

/**
 * Returns a list of menu items for a view section.
 */
export function makeViewLayoutMenu(viewSection: ViewSectionRec, isReadonly: boolean) {
  const viewInstance = viewSection.viewInstance.peek()!;
  const gristDoc = viewInstance.gristDoc;

  // get current row index from cursor
  const cursorRow = viewInstance.cursor.rowIndex.peek();
  // get row id from current data
  // rowId can be string - it is wrongly typed in cursor and in viewData
  const rowId = (cursorRow !== null ? viewInstance.viewData.getRowId(cursorRow) : null) as string|null|number;
  const isAddRow = rowId === 'new';

  const contextMenu = [
    menuItemCmd(allCommands.deleteRecords,
      t("Delete record"),
      testId('section-delete-card'),
      dom.cls('disabled', isReadonly || isAddRow)),
    menuItemCmd(allCommands.copyLink,
      t("Copy anchor link"),
      testId('section-card-link'),
    ),
    menuDivider(),
  ];

  const viewRec = viewSection.view();
  const isSinglePage = urlState().state.get().params?.style === 'singlePage';

  const sectionId = viewSection.table.peek().rawViewSectionRef.peek();
  const anchorUrlState = viewInstance.getAnchorLinkForSection(sectionId);
  anchorUrlState.hash!.popup = true;
  const rawUrl = urlState().makeUrl(anchorUrlState);

  // Count number of rendered sections on the viewLayout. Note that the layout might be detached or cleaned
  // when we have an external section in the popup.
  const expandedSectionCount = () => gristDoc.viewLayout?.layout.getAllLeafIds().length ?? 0 > 1;

  const dontRemoveSection = () =>
    !viewRec.getRowId() || viewRec.viewSections().peekLength <= 1 || isReadonly || expandedSectionCount() === 1;

  const dontCollapseSection = () =>
    dontRemoveSection() ||
    (gristDoc.externalSectionId.get() === viewSection.getRowId()) ||
    (gristDoc.maximizedSectionId.get() === viewSection.getRowId());

  const showRawData = (use: UseCB) => {
    return !use(viewSection.isRaw)// Don't show raw data if we're already in raw data.
        && !use(viewSection.isRecordCard)
        && !isSinglePage // Don't show raw data in single page mode.
           ;
  };

  const isCard = (use: UseCB) => use(viewSection.widgetType) === WidgetType.Card;
  const isTable = (use: UseCB) => use(viewSection.widgetType) === WidgetType.Table;

  return [
    dom.maybe(isCard, () => contextMenu),
    dom.maybe(showRawData,
      () => menuItemLink(
        { href: rawUrl}, t("Show raw data"), testId('show-raw-data'),
        dom.on('click', () => {
          // Replace the current URL so that the back button works as expected (it navigates back from
          // the current page).
          urlState().pushUrl(anchorUrlState, { replace: true }).catch(reportError);
        })
      )
    ),
    menuItemCmd(allCommands.printSection, t("Print widget"), testId('print-section')),
    menuItemLink(hooks.maybeModifyLinkAttrs({ href: gristDoc.getCsvLink(), target: '_blank', download: ''}),
      t("Download as CSV"), testId('download-section')),
    menuItemLink(hooks.maybeModifyLinkAttrs({ href: gristDoc.getXlsxActiveViewLink(), target: '_blank', download: ''}),
      t("Download as XLSX"), testId('download-section')),
    dom.maybe((use) => ['detail', 'single'].includes(use(viewSection.parentKey)), () =>
      menuItemCmd(allCommands.editLayout, t("Edit Card Layout"),
        dom.cls('disabled', isReadonly))),

    dom.maybe(!isSinglePage, () => [
      menuDivider(),
      menuItemCmd(allCommands.viewTabOpen, t("Widget options"), testId('widget-options')),
      menuItemCmd(allCommands.sortFilterTabOpen, t("Advanced Sort & Filter"), dom.hide(viewSection.isRecordCard)),
      menuItemCmd(allCommands.dataSelectionTabOpen, t("Data selection"), dom.hide(viewSection.isRecordCard)),
      menuItemCmd(allCommands.createForm, t("Create a form"), dom.show(isTable)),
    ]),

    menuDivider(dom.hide(viewSection.isRecordCard)),
    dom.maybe((use) => use(viewSection.parentKey) === 'custom' && use(viewSection.hasCustomOptions), () =>
      menuItemCmd(allCommands.openWidgetConfiguration, t("Open configuration"),
        testId('section-open-configuration')),
    ),
    menuItemCmd(allCommands.collapseSection, t("Collapse widget"),
      dom.cls('disabled', dontCollapseSection()),
      dom.hide(viewSection.isRecordCard),
      testId('section-collapse')),
    menuItemCmd(allCommands.deleteSection, t("Delete widget"),
      dom.cls('disabled', dontRemoveSection()),
      dom.hide(viewSection.isRecordCard),
      testId('section-delete')),
  ];
}


/**
 * Returns a list of menu items for a view section.
 */
export function makeCollapsedLayoutMenu(viewSection: ViewSectionRec, gristDoc: GristDoc) {
  const isReadonly = gristDoc.isReadonly.get();
  const isSinglePage = urlState().state.get().params?.style === 'singlePage';
  const sectionId = viewSection.table.peek().rawViewSectionRef.peek();
  const anchorUrlState = { hash: { sectionId, popup: true } };
  const rawUrl = urlState().makeUrl(anchorUrlState);
  return [
    dom.maybe((use) => !use(viewSection.isRaw) && !isSinglePage && !use(gristDoc.maximizedSectionId),
      () => menuItemLink(
        { href: rawUrl}, t("Show raw data"), testId('show-raw-data'),
        dom.on('click', () => {
          // Replace the current URL so that the back button works as expected (it navigates back from
          // the current page).
          urlState().pushUrl(anchorUrlState, { replace: true }).catch(reportError);
        })
      )
    ),
    menuDivider(),
    menuItemCmd(allCommands.restoreSection, t("Add to page"),
      dom.cls('disabled', isReadonly),
      testId('section-expand')),
    menuItemCmd(allCommands.deleteCollapsedSection, t("Delete widget"),
      dom.cls('disabled', isReadonly),
      testId('section-delete')),
  ];
}
