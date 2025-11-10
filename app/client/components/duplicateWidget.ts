import {cleanFormLayoutSpec} from 'app/client/components/FormRenderer';
import {GristDoc} from 'app/client/components/GristDoc';
import {BoxSpec, purgeBoxSpec} from 'app/client/lib/BoxSpec';
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {cssField, cssLabel} from 'app/client/ui/MakeCopyMenu';
import {IPageWidget, toPageWidget} from 'app/client/ui/PageWidgetPicker';
import {IOption, select} from 'app/client/ui2018/menus';
import {saveModal} from 'app/client/ui2018/modals';
import {BulkColValues, getColValues, RowRecord, UserAction} from 'app/common/DocActions';
import {arrayRepeat} from 'app/common/gutil';
import {schema} from 'app/common/schema';
import {dom, fromKo, Observable} from 'grainjs';
import cloneDeepWith from 'lodash/cloneDeepWith';
import flatten from 'lodash/flatten';
import forEach from 'lodash/forEach';
import {testId} from 'app/client/ui2018/cssVars';
import {logTelemetryEvent} from 'app/client/lib/telemetry';
import sortBy from 'lodash/sortBy';
import fromPairs from 'lodash/fromPairs';
import ko from 'knockout';

const t = makeT('duplicateWidget');

type PageSelectOption = IOption<number> & { isActivePage: boolean }

export async function buildDuplicateWidgetModal(gristDoc: GristDoc, viewSectionId: number) {
  saveModal((ctl, owner) => {
    const activeView = gristDoc.activeViewId.get();
    const pageSelectOptions = fromKo(ko.pureComputed(() => {
      const allPages = gristDoc.docModel.allPages();
      const validPages = allPages.filter(page => !page.isHidden());
      const sortedPages = sortBy(validPages, [(page) => page.pagePos()]);
      const views = sortedPages.map(page => page.view());

      const options: PageSelectOption[] = views.map(view => {
        const isActivePage = view.getRowId() === activeView;
        const suffix = isActivePage ? (" (" + t('Active') + ")") : "";
        return {
          label: `${view.name()}${suffix}`,
          value: view.getRowId(),
          isActivePage: isActivePage,
        };
      });
      options.push({ label: t('Create new page'), value: 0, isActivePage: false, icon: "Plus" });
      return options;
    }));

    const initialSelectedPage =
      pageSelectOptions.get().find(option => option.isActivePage)?.value ?? pageSelectOptions.get()[0].value;
    const pageSelectObs = Observable.create<number>(owner, initialSelectedPage);

    return {
      title: t('Duplicate widget'),
      body: dom('div', [
        cssField(
          cssLabel("Page"),
          select(pageSelectObs, pageSelectOptions),
          testId("duplicate-widget-page-select"),
        )
      ]),
      async saveFunc() {
        await duplicateWidgets(
          gristDoc, [viewSectionId], pageSelectObs.get()
        );
      }
    };
  });
}

export async function duplicateWidgets(gristDoc: GristDoc, srcViewSectionIds: number[], destViewId: number) {
  const allViewSectionModels = gristDoc.docModel.viewSections.rowModels;
  const sourceViewSections = srcViewSectionIds.map(id => allViewSectionModels[id]).filter(viewSec => viewSec);

  // Generally this shouldn't happen, but it catches a theoretically possible edge case.
  if (sourceViewSections.length === 0) {
    throw new Error("Unable to duplicate widgets as no valid source widget ids were provided");
  }
  const sourceView = sourceViewSections[0].view.peek();
  const isNewView = destViewId < 1;
  let resolvedDestViewId = destViewId;

  logTelemetryEvent('duplicatedWidget', {
    full: {
      docIdDigest: gristDoc.docId(),
      destPage: isNewView ? 'NEW' : (destViewId === sourceView.getRowId() ? 'SAME' : 'OTHER'),
    }
  });

  await gristDoc.docData.bundleActions(
    t("Duplicate widgets"),
    async () => {
      // Creates new view sections using the existing ones as a template. This isn't a perfect
      // copy, as only certain options can be passed when creating a new view section.
      const {
        duplicatedViewSections,
        viewRef,
        viewSectionIdMap
      } = await createNewViewSections(gristDoc, sourceViewSections, destViewId);
      resolvedDestViewId = viewRef;

      // Gets the IDs of the view fields that were automatically created above when we created
      // the new view sections. These shouldn't be in the final duplicated widget, so they'll need
      // to be removed later. They can't be removed now due as it breaks the widget's layout spec.
      const autoCreatedViewFieldIds = listAllViewFields(duplicatedViewSections.map(pair => pair.destViewSection));
      // Adds copies of the original fields to the new view sections. Retain a map of fields in the source
      // view section to their copies in the new section, so that we can update the widget layout later with
      // the new fields.
      const viewFieldsIdMap = await copyOriginalViewFields(gristDoc, duplicatedViewSections);

      // If we're creating a new page, we should copy the page layout over, updating its ids
      // to match the newly created view sections.
      let layoutSpecUpdatePromise = Promise.resolve();
      if (isNewView) {
          const newLayoutSpec = patchLayoutSpec(sourceView.layoutSpecObj.peek(), viewSectionIdMap);
          layoutSpecUpdatePromise = gristDoc.docData.sendAction(
            ['UpdateRecord', '_grist_Views', resolvedDestViewId, { layoutSpec: JSON.stringify(newLayoutSpec)}]
          );
      }
      await Promise.all([
        layoutSpecUpdatePromise,
        updateViewSections(gristDoc, duplicatedViewSections, viewFieldsIdMap, viewSectionIdMap),
        copyFilters(gristDoc, sourceViewSections, viewSectionIdMap)
      ]);

      // Remove the fields that were automatically created when the view sections were created,.
      // only after we've patched the widgets' layout specs.
      // These specs are JSON representations of how the fields are laid out, and reference the ids
      // of the automatically created fields.
      // If we remove those fields before the removing the references in the layout spec,
      // the UI will either break, throw errors, or both, due to it temporarily being in an invalid
      // state (referencing non-existent fields).
      await removeViewFields(gristDoc, autoCreatedViewFieldIds);

    },
    // If called from duplicatePage (or similar), we don't want to start a new bundle.
    {nestInActiveBundle: true}
  );

  // Give copy focus
  await gristDoc.openDocPage(resolvedDestViewId);

  return {
    viewId: resolvedDestViewId,
  };
}

/**
 * Copies _grist_Filters from source sections.
 */
async function copyFilters(
  gristDoc: GristDoc,
  srcViewSections: ViewSectionRec[],
  viewSectionMap: {[id: number]: number}) {

  // Get all filters for selected sections.
  const filters: RowRecord[] = [];
  const table = gristDoc.docData.getMetaTable('_grist_Filters');
  for (const srcViewSection of srcViewSections) {
    const sectionFilters = table
      .filterRecords({ viewSectionRef : srcViewSection.id.peek()})
      .map(filter => ({
        // Replace section ref with destination ref.
        ...filter, viewSectionRef : viewSectionMap[srcViewSection.id.peek()]
      }));
    filters.push(...sectionFilters);
  }
  if (filters.length) {
    const filterInfo = getColValues(filters);
    await gristDoc.docData.sendAction(['BulkAddRecord', '_grist_Filters',
      new Array(filters.length).fill(null), filterInfo]);
  }
}

/**
 * Update all of destViewSections with srcViewSections, use fieldsMap to patch the section layout
 * (for detail/cardlist sections), use viewSectionMap to patch the sections ids for linking.
 */
async function updateViewSections(gristDoc: GristDoc, duplicatedViewSections: DuplicatedViewSection[],
                                  fieldsMap: {[id: number]: number}, viewSectionMap: {[id: number]: number}) {

  const destRowIds: number[] = [];
  const records: RowRecord[] = [];
  for (const { srcViewSection, destViewSection } of duplicatedViewSections) {
    const viewSectionLayoutSpec =
      srcViewSection.parentKey.peek() === 'form'
          ? cleanFormLayoutSpec(srcViewSection.layoutSpecObj.peek(), fieldsMap)
          : patchLayoutSpec(srcViewSection.layoutSpecObj.peek(), fieldsMap);
    const record = gristDoc.docData.getMetaTable('_grist_Views_section').getRecord(srcViewSection.getRowId())!;

    const isNewView = srcViewSection.view.peek().id.peek() != destViewSection.view.peek().id.peek();
    const originalLinkRef = srcViewSection.linkSrcSectionRef.peek();
    const linkRef = isNewView ? viewSectionMap[originalLinkRef] : originalLinkRef;

    destRowIds.push(destViewSection.getRowId());
    records.push({
      ...record,
      layoutSpec: JSON.stringify(viewSectionLayoutSpec),
      linkSrcSectionRef: linkRef ?? false,
      shareOptions: '',
    });
  }

  // transpose data
  const sectionsInfo = getColValues(records);

  delete sectionsInfo.parentId;

  await gristDoc.docData.sendAction(['BulkUpdateRecord', '_grist_Views_section', destRowIds, sectionsInfo]);
}

async function copyOriginalViewFields(gristDoc: GristDoc, viewSectionPairs: DuplicatedViewSection[]) {
  const docData = gristDoc.docData;

  // collect all the fields to add
  const srcViewFieldIds: number[] = [];
  const fieldsToAdd: RowRecord[] = [];
  for (const { srcViewSection, destViewSection } of viewSectionPairs) {
    const srcViewFields: ViewFieldRec[] = srcViewSection.viewFields.peek().peek();
    const parentId = destViewSection.getRowId();
    for (const field of srcViewFields) {
      const record = docData.getMetaTable('_grist_Views_section_field').getRecord(field.getRowId())!;
      fieldsToAdd.push({...record, parentId});
      srcViewFieldIds.push(field.getRowId());
    }
  }

  // transpose data
  const fieldsInfo = {} as BulkColValues;
  forEach(schema._grist_Views_section_field, (val, key) => fieldsInfo[key] = fieldsToAdd.map(rec => rec[key]));
  const rowIds = arrayRepeat(fieldsInfo.parentId.length, null);

  const addAction: UserAction = ['BulkAddRecord', '_grist_Views_section_field', rowIds, fieldsInfo];
  // Add then remove to workaround a bug, where fields won't work in the UI when a duplicate widget
  // has a 'SelectBy' set and all fields are showing.
  // This looks to be an issue deep within the computed values, where something isn't updating
  // correctly / at the right time. Possibly due to the widget IDs being re-used if remove
  // occurs before add.
  const results = await gristDoc.docData.sendActions([
    addAction,
  ]);

  const newFieldIds: number[] = results[0];
  return fromPairs(srcViewFieldIds.map((srcId, index) => [srcId, newFieldIds[index]]));
}

function listAllViewFields(viewSections: ViewSectionRec[]) {
  return flatten(viewSections.map(
    (viewSection) => viewSection.viewFields.peek().peek().map((field) => field.getRowId())
  ));
}

async function removeViewFields(gristDoc: GristDoc, fieldIds: number[]) {
  await gristDoc.docData.sendAction(['BulkRemoveRecord', '_grist_Views_section_field', fieldIds]);
}

/**
 * Create a new view containing all of the viewSections. Note that it doesn't copy view fields, for
 * which you can use `updateViewFields`.
 */
async function createNewViewSections(gristDoc: GristDoc, viewSections: ViewSectionRec[], viewId: number) {
  const [first, ...rest] = viewSections.map(toPageWidget);

  // Passing a viewId of 0 will create a new view.
  const createdViewSectionResults = [
    await gristDoc.docData.sendAction(newViewSectionAction(first, viewId))
  ];
  const targetViewRef = createdViewSectionResults[0].viewRef;

  // Other view sections are added to the newly created view.
  const otherViewSectionActions = rest.map((widget) => newViewSectionAction(widget, targetViewRef));

  // Avoid sending an empty list of actions - it causes a bug in the bundling code that results
  // in the bundle being split into two bundles (2025-07-18).
  if (otherViewSectionActions.length > 0) {
    createdViewSectionResults.push(...(await gristDoc.docData.sendActions(otherViewSectionActions)));
  }

  // Technically a race condition can here, where the viewSections model isn't up to date with the
  // backend. In practice, this typically won't occur, and a more correct solution would require major work.
  // Either moving duplicate to the backend, or not using viewSection models at all (only ids).
  const newViewSections = createdViewSectionResults.map(
    result => gristDoc.docModel.viewSections.rowModels[result.sectionRef]
  );

  const duplicatedViewSections: DuplicatedViewSection[] =
    viewSections.map((srcSection, index) => ({ srcViewSection: srcSection, destViewSection: newViewSections[index] }));

  return {
    duplicatedViewSections,
    viewSectionIdMap: fromPairs(duplicatedViewSections.map((
      { srcViewSection, destViewSection }) => [srcViewSection.getRowId(), destViewSection.getRowId()]
    )),
    viewRef: targetViewRef,
  };
}

// Helper to create an action that add widget to the view with viewId.
function newViewSectionAction(widget: IPageWidget, viewId: number) {
  return ['CreateViewSection', widget.table, viewId, widget.type, widget.summarize ? widget.columns : null, null];
}

/**
 * Replaces each `leaf` id in layoutSpec by its corresponding id in mapIds. Leave unchanged if id
 * is
 * missing from mapIds.
 * LayoutSpec is a tree structure with leaves (that have `leaf` property) or containers of leaves.
 * The root container (or leaf) also includes a list of collapsed leaves in `collapsed` property.
 *
 * Example use:
 *   patchLayoutSpec({
 *     leaf: 1,
*      collapsed: [{leaf: 2}]
 *   }, {1: 10, 2: 20})
 */
function patchLayoutSpec(layoutSpec: BoxSpec, mapIds: {[id: number]: number}) {
  // First remove any invalid ids from the layoutSpec. We are doing the same thing what
  // `ViewLayout` does when it load itself.
  layoutSpec = purgeBoxSpec({
    spec: layoutSpec,
    validLeafIds: Object.keys(mapIds).map(Number),
    restoreCollapsed: true
  });
  return cloneDeepWith(layoutSpec, (val, key) => {
    if (key === 'leaf' && mapIds[val]) {
      return mapIds[val];
    }
  });
}

interface DuplicatedViewSection {
  srcViewSection: ViewSectionRec,
  destViewSection: ViewSectionRec,
}
