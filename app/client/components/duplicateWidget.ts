import {cleanFormLayoutSpec} from 'app/client/components/FormRenderer';
import {GristDoc} from 'app/client/components/GristDoc';
import {BoxSpec, purgeBoxSpec} from 'app/client/lib/BoxSpec';
import {makeT} from 'app/client/lib/localization';
import {ViewFieldRec, ViewSectionRec} from 'app/client/models/DocModel';
import {cssInput} from 'app/client/ui/cssInput';
import {cssField, cssLabel} from 'app/client/ui/MakeCopyMenu';
import {IPageWidget, toPageWidget} from 'app/client/ui/PageWidgetPicker';
import {IOptionFull, select} from 'app/client/ui2018/menus';
import {saveModal} from 'app/client/ui2018/modals';
import {BulkColValues, getColValues, RowRecord, UserAction} from 'app/common/DocActions';
import {arrayRepeat} from 'app/common/gutil';
import {schema} from 'app/common/schema';
import {dom, Observable} from 'grainjs';
import cloneDeepWith from 'lodash/cloneDeepWith';
import flatten from 'lodash/flatten';
import forEach from 'lodash/forEach';
import zip from 'lodash/zip';
import zipObject from 'lodash/zipObject';

const t = makeT('duplicateWidget');

// Duplicate page with pageId. Starts by prompting user for a new name.
export async function buildDuplicateWidgetModal(gristDoc: GristDoc, viewSectionId: number) {
  const viewsTable = gristDoc.docModel.views;
  console.log(viewsTable.tableData.getRecords());
  const pageSelectOptions: IOptionFull<number>[] = viewsTable.rowModels.filter(x => x).map(row => ({
    label: row.name.peek(),
    value: row.getRowId(),
  }));

  // Logically this should never happen, as a Grist doc without pages should be impossible.
  if (pageSelectOptions.length < 1) {
    throw new Error("No pages available to duplicate widget to");
  }

  saveModal((ctl, owner) => {
    let titleInputEl: HTMLInputElement;
    let descriptionInputEl: HTMLInputElement;
    const pageSelectObs = Observable.create<number>(owner, pageSelectOptions[0].value);

    return {
      title: t('Duplicate widget'),
      body: dom('div', [
        cssField(
          cssLabel("Page"),
          select(pageSelectObs, pageSelectOptions),
        ),
        cssField(
          cssLabel("New title"),
          titleInputEl = cssInput({value: ' (copy)'}),
        ),
        cssField(
          cssLabel("New description"),
          descriptionInputEl = cssInput({value: ' (copy)'}),
        ),
      ]),
      async saveFunc() {
        const newWidget: DuplicatedWidgetSpec = {
          sourceViewSectionId: viewSectionId,
          title: titleInputEl.value.trim() || undefined,
          description: descriptionInputEl.value.trim() || undefined,
        };
        // TODO - Make this actually respect newWidget's title and description properties.
        await duplicateWidgets(
          gristDoc, [newWidget], pageSelectObs.get()
        );
      }
    };
  });
}

// TODO - change this to 'duplicateWidgets'
// TODO - Get it working
// TODO - Export this to duplicatePage with same API
// TODO - Simplify API where possible / improve code quality
//      - Include a check to make sure all widgets are all coming from the same page.
// TODO - Make sure all telemetry is still in place
// TODO - Write tests that cover duplicating widgets

export interface DuplicatedWidgetSpec {
  sourceViewSectionId: number;
  title?: string;
  description?: string;
}

export async function duplicateWidgets(gristDoc: GristDoc, widgetSpecs: DuplicatedWidgetSpec[], destViewId: number) {
  const allViewSectionModels = gristDoc.docModel.viewSections.rowModels;
  const validWidgetSpecs = widgetSpecs.filter(spec => allViewSectionModels[spec.sourceViewSectionId]);
  const sourceViewSections = validWidgetSpecs.map(spec => allViewSectionModels[spec.sourceViewSectionId]);

  // TODO - something if no valid widget specs exist. Should we also catch invalid ones and log?

  await gristDoc.docData.bundleActions(
    t("Duplicate widgets"),
    async () => {
      //logTelemetryEvent('duplicateWidgets', {full: {docIdDigest: gristDoc.docId()}});
      const sourceView = sourceViewSections[0].view.peek();
      const newViewSectionsDetails = await createNewViewSections(gristDoc.docData, sourceViewSections, destViewId);
      // If a new view was created, this ensures everything following uses that new view.
      destViewId = newViewSectionsDetails[0].viewRef;
      const newViewSectionRefs: number[] = newViewSectionsDetails.map(result => result.sectionRef);
      // TODO - I feel like we should be doing some sanity checking here or something.
      const newViewSections = newViewSectionRefs.map(id => gristDoc.docModel.viewSections.rowModels[id]);

      // create a map from source to target section ids
      const viewSectionIdMap = zipObject(
        sourceViewSections.map(vs => vs.getRowId()),
        newViewSectionRefs,
      );

      const newViewFieldIds = await updateViewFields(gristDoc, newViewSections, sourceViewSections);

      // TODO - Clean this up, it's horrifying and makes many assumptions about data ordering and structure.
      // create map for mapping from a src field's id to its corresponding dest field's id
      const viewFieldsIdMap = zipObject(
        flatten(sourceViewSections.map((vs) => vs.viewFields.peek().peek().map((field) => field.getRowId()))),
        flatten(newViewFieldIds)) as {[id: number]: number};

      // update layout spec
      const viewLayoutSpec = patchLayoutSpec(sourceView.layoutSpecObj.peek(), viewSectionIdMap);
      await Promise.all([
        gristDoc.docData.sendAction(
          ['UpdateRecord', '_grist_Views', destViewId, { layoutSpec: JSON.stringify(viewLayoutSpec)}]
        ),
        updateViewSections(gristDoc, newViewSections, sourceViewSections, viewFieldsIdMap, viewSectionIdMap),
        copyFilters(gristDoc, sourceViewSections, viewSectionIdMap)
      ]);
    },
    // If called from duplicatePage (or similar), we don't want to start a new bundle.
    {nestInActiveBundle: true}
  );

  // Give copy focus
  await gristDoc.openDocPage(destViewId);
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
async function updateViewSections(gristDoc: GristDoc, destViewSections: ViewSectionRec[],
                                  srcViewSections: ViewSectionRec[], fieldsMap: {[id: number]: number},
                                  viewSectionMap: {[id: number]: number}) {

  // collect all the records for the src view sections
  const records: RowRecord[] = [];
  for (const srcViewSection of srcViewSections) {
    const viewSectionLayoutSpec =
      srcViewSection.parentKey.peek() === 'form'
          ? cleanFormLayoutSpec(srcViewSection.layoutSpecObj.peek(), fieldsMap)
          : patchLayoutSpec(srcViewSection.layoutSpecObj.peek(), fieldsMap);
    const record = gristDoc.docData.getMetaTable('_grist_Views_section').getRecord(srcViewSection.getRowId())!;
    records.push({
      ...record,
      layoutSpec: JSON.stringify(viewSectionLayoutSpec),
      linkSrcSectionRef: viewSectionMap[srcViewSection.linkSrcSectionRef.peek()],
      shareOptions: '',
    });
  }

  // transpose data
  const sectionsInfo = getColValues(records);

  // ditch column parentId
  delete sectionsInfo.parentId;

  // send action
  const rowIds = destViewSections.map((vs) => vs.getRowId());
  await gristDoc.docData.sendAction(['BulkUpdateRecord', '_grist_Views_section', rowIds, sectionsInfo]);
}

async function updateViewFields(gristDoc: GristDoc, destViewSections: ViewSectionRec[],
                                srcViewSections: ViewSectionRec[]) {
  const actions: UserAction[] = [];
  const docData = gristDoc.docData;

  // First, remove all existing fields. Needed because `CreateViewSections` adds some by default.
  const toRemove = flatten(destViewSections.map((vs) => vs.viewFields.peek().peek().map((field) => field.getRowId())));
  actions.push(['BulkRemoveRecord', '_grist_Views_section_field', toRemove]);

  // collect all the fields to add
  const fieldsToAdd: RowRecord[] = [];
  for (const [destViewSection, srcViewSection] of zip(destViewSections, srcViewSections)) {
    const srcViewFields: ViewFieldRec[] = srcViewSection!.viewFields.peek().peek();
    const parentId = destViewSection!.getRowId();
    for (const field of srcViewFields) {
      const record = docData.getMetaTable('_grist_Views_section_field').getRecord(field.getRowId())!;
      fieldsToAdd.push({...record, parentId});
    }
  }

  // transpose data
  const fieldsInfo = {} as BulkColValues;
  forEach(schema._grist_Views_section_field, (val, key) => fieldsInfo[key] = fieldsToAdd.map(rec => rec[key]));
  const rowIds = arrayRepeat(fieldsInfo.parentId.length, null);
  actions.push(['BulkAddRecord', '_grist_Views_section_field', rowIds, fieldsInfo]);

  const results = await gristDoc.docData.sendActions(actions);
  return results[1];
}

/**
 * Create a new view containing all of the viewSections. Note that it doesn't copy view fields, for
 * which you can use `updateViewFields`.
 */
async function createNewViewSections(docData: GristDoc['docData'], viewSections: ViewSectionRec[], viewId: number) {
  const [first, ...rest] = viewSections.map(toPageWidget);

  // Passing a viewId of 0 will create a new view.
  const firstResult = await docData.sendAction(newViewSectionAction(first, viewId));

  const otherResult = await docData.sendActions(
    // other view section are added to the newly created view
    rest.map((widget) => newViewSectionAction(widget, firstResult.viewRef))
  );
  return [firstResult, ...otherResult];
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
  const cloned = cloneDeepWith(layoutSpec, (val, key) => {
    if (key === 'leaf' && mapIds[val]) {
      return mapIds[val];
    }
  });
  return cloned;
}
