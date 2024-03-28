import { GristDoc } from 'app/client/components/GristDoc';
import { logTelemetryEvent } from 'app/client/lib/telemetry';
import { ViewFieldRec, ViewSectionRec } from 'app/client/models/DocModel';
import { cssInput } from 'app/client/ui/cssInput';
import { cssField, cssLabel } from 'app/client/ui/MakeCopyMenu';
import { IPageWidget, toPageWidget } from 'app/client/ui/PageWidgetPicker';
import { confirmModal } from 'app/client/ui2018/modals';
import { BulkColValues, getColValues, RowRecord, UserAction } from 'app/common/DocActions';
import { arrayRepeat } from 'app/common/gutil';
import { schema } from 'app/common/schema';
import { dom } from 'grainjs';
import cloneDeepWith = require('lodash/cloneDeepWith');
import flatten = require('lodash/flatten');
import forEach = require('lodash/forEach');
import zip = require('lodash/zip');
import zipObject = require('lodash/zipObject');
import {makeT} from 'app/client/lib/localization';

const t = makeT('duplicatePage');

// Duplicate page with pageId. Starts by prompting user for a new name.
export async function duplicatePage(gristDoc: GristDoc, pageId: number) {
  const pagesTable = gristDoc.docModel.pages;
  const pageName = pagesTable.rowModels[pageId].view.peek().name.peek();
  let inputEl: HTMLInputElement;
  setTimeout(() => { inputEl.focus(); inputEl.select(); }, 100);

  confirmModal('Duplicate page', 'Save', () => makeDuplicate(gristDoc, pageId, inputEl.value), {
    explanation: dom('div', [
      cssField(
        cssLabel("Name"),
        inputEl = cssInput({value: pageName + ' (copy)'}),
      ),
      t("Note that this does not copy data, but creates another view of the same data."),
    ]),
  });
}

async function makeDuplicate(gristDoc: GristDoc, pageId: number, pageName: string = '') {
  const sourceView = gristDoc.docModel.pages.rowModels[pageId].view.peek();
  pageName = pageName || `${sourceView.name.peek()} (copy)`;
  const viewSections = sourceView.viewSections.peek().peek();
  let viewRef = 0;
  await gristDoc.docData.bundleActions(
    t("Duplicate page {{pageName}}", {pageName}),
    async () => {
      logTelemetryEvent('addedPage', {full: {docIdDigest: gristDoc.docId()}});

      // create new view and new sections
      const results = await createNewViewSections(gristDoc.docData, viewSections);
      viewRef = results[0].viewRef;

      // give it a better name
      await gristDoc.docModel.views.rowModels[viewRef].name.saveOnly(pageName);

      // create a map from source to target section ids
      const viewSectionIdMap = zipObject(
        viewSections.map(vs => vs.getRowId()),
        results.map(res => res.sectionRef)
      ) as {[id: number]: number};

      // update the view fields
      const destViewSections = viewSections.map((vs) => (
        gristDoc.docModel.viewSections.rowModels[viewSectionIdMap[vs.getRowId()]]
      ));
      const newViewFieldIds = await updateViewFields(gristDoc, destViewSections, viewSections);

      // create map for mapping from a src field's id to its corresponding dest field's id
      const viewFieldsIdMap = zipObject(
        flatten(viewSections.map((vs) => vs.viewFields.peek().peek().map((field) => field.getRowId()))),
        flatten(newViewFieldIds)) as {[id: number]: number};

      // update layout spec
      const viewLayoutSpec = patchLayoutSpec(sourceView.layoutSpecObj.peek(), viewSectionIdMap);
      await Promise.all([
        gristDoc.docData.sendAction(
          ['UpdateRecord', '_grist_Views', viewRef, { layoutSpec: JSON.stringify(viewLayoutSpec)}]
        ),
        updateViewSections(gristDoc, destViewSections, viewSections, viewFieldsIdMap, viewSectionIdMap),
        copyFilters(gristDoc, viewSections, viewSectionIdMap)
      ]);
    });

  // Give copy focus
  await gristDoc.openDocPage(viewRef);
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
    const viewSectionLayoutSpec = patchLayoutSpec(srcViewSection.layoutSpecObj.peek(), fieldsMap);
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
async function createNewViewSections(docData: GristDoc['docData'], viewSections: ViewSectionRec[]) {
  const [first, ...rest] = viewSections.map(toPageWidget);

  // Passing a viewId of 0 will create a new view.
  const firstResult = await docData.sendAction(newViewSectionAction(first, 0));

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
 * Replaces each `leaf` id in layoutSpec by its corresponding id in mapIds. Leave unchanged if id is
 * missing from mapIds.
 */
export function patchLayoutSpec(layoutSpec: any, mapIds: {[id: number]: number}) {
  return cloneDeepWith(layoutSpec, (val) => {
    if (typeof val === 'object' && val !== null) {
      if (mapIds[val.leaf]) {
        return {...val, leaf: mapIds[val.leaf]};
      }
    }
  });
}
