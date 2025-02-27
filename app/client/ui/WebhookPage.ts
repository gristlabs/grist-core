import {GristDoc} from 'app/client/components/GristDoc';
import {ViewSectionHelper} from 'app/client/components/ViewLayout';
import {makeT} from 'app/client/lib/localization';
import {reportMessage, reportSuccess} from 'app/client/models/errors';
import {IEdit, IExternalTable, VirtualTableRegistration} from 'app/client/models/VirtualTable';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {bigPrimaryButton} from 'app/client/ui2018/buttons';
import {mediaSmall, testId} from 'app/client/ui2018/cssVars';
import {ApiError} from 'app/common/ApiError';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {
  DocAction,
  getColIdsFromDocAction,
  getColValues,
  isDataAction,
  TableDataAction,
  UserAction
} from 'app/common/DocActions';
import {VirtualId} from 'app/common/SortSpec';
import {WebhookSummary} from 'app/common/Triggers';
import {DocAPI} from 'app/common/UserAPI';
import {GristObjCode, RowRecord} from 'app/plugin/GristData';
import {dom, styled} from 'grainjs';
import {observableArray, ObservableArray} from "knockout";
import omit = require('lodash/omit');
import pick = require('lodash/pick');
import range = require('lodash/range');
import without = require('lodash/without');

const t = makeT('WebhookPage');

const TABLE_COLUMN_ROW_ID = VirtualId();

/**
 * A list of columns for a virtual table about webhooks.
 * The ids need to be strings.
 */
const WEBHOOK_COLUMNS = [
  {
    id: TABLE_COLUMN_ROW_ID,
    colId: 'tableId',
    type: 'Choice',
    label: t('Table'),
    // widgetOptions are configured later, since the choices depend
    // on the user tables in the document.
  },
  {
    id: VirtualId(),
    colId: 'url',
    type: 'Text',
    label: t('URL'),
  },
  {
    id: VirtualId(),
    colId: 'eventTypes',
    type: 'ChoiceList',
    label: t('Event Types'),
    widgetOptions: JSON.stringify({
      widget: 'TextBox',
      alignment: 'left',
      choices: ['add', 'update'],
      choiceOptions: {},
    }),
  },
  {
    id: VirtualId(),
    colId: 'watchedColIdsText',
    type: 'Text',
    label: t('Filter for changes in these columns (semicolon-separated ids)'),
  },
  {
    id: VirtualId(),
    colId: 'enabled',
    type: 'Bool',
    label: t('Enabled'),
    widgetOptions: JSON.stringify({
      widget: 'Switch',
    }),
  },
  {
    id: VirtualId(),
    colId: 'isReadyColumn',
    type: 'Text',
    label: t('Ready Column'),
  },
  {
    id: VirtualId(),
    colId: 'webhookId',
    type: 'Text',
    label: t('Webhook Id'),
  },
  {
    id: VirtualId(),
    colId: 'name',
    type: 'Text',
    label: t('Name'),
  },
  {
    id: VirtualId(),
    colId: 'memo',
    type: 'Text',
    label: t('Memo'),
  },
  {
    id: VirtualId(),
    colId: 'status',
    type: 'Text',
    label: t('Status'),
  },
  {
    id: VirtualId(),
    colId: 'authorization',
    type: 'Text',
    label: t('Header Authorization'),
  },
] as const;

/**
 * Layout of fields in a view, with a specific ordering.
 */
const WEBHOOK_VIEW_FIELDS: Array<(typeof WEBHOOK_COLUMNS)[number]['colId']> = [
  'name', 'memo',
  'eventTypes', 'tableId',
  'watchedColIdsText', 'isReadyColumn',
  'url', 'authorization',
  'webhookId', 'enabled',
  'status'
];

/**
 *
 * Change webhooks based on a virtual table.
 *
 * TODO: error handling is not rock-solid. If a set of actions are
 * applied all together, and one fails, then state between UI and
 * back-end may end up being inconsistent. One option would be just to
 * resync in the case of an error. In practice, the way the virtual
 * table is used in a card list, it would be hard to tickle this case
 * right now, so I'm not going to worry about it.
 *
 */
class WebhookExternalTable implements IExternalTable {
  public name = 'GristHidden_WebhookTable';
  public saveableFields = [
    'tableId', 'watchedColIdsText', 'url', 'authorization', 'eventTypes', 'enabled', 'name', 'memo', 'isReadyColumn',
  ];
  public webhooks: ObservableArray<UIWebhookSummary> = observableArray<UIWebhookSummary>([]);

  public constructor(private _docApi: DocAPI) {
  }

  public initialActions(): DocAction[] {
    return _prepareWebhookInitialActions(this.name);
  }

  public async fetchAll(): Promise<TableDataAction> {
    const webhooks = (await this._docApi.getWebhooks()).webhooks;
    this._initalizeWebhookList(webhooks);
    const indices = range(webhooks.length);
    return ['TableData', this.name, indices.map(i => i + 1),
      getColValues(indices.map(rowId => _mapWebhookValues(webhooks[rowId])))];
  }

  public async beforeEdit(editor: IEdit) {
    const results = editor.actions;
    for (const r of results) {
      for (const d of r.stored) {
        if (!isDataAction(d)) {
          continue;
        }
        const colIds = new Set(getColIdsFromDocAction(d) || []);
        if (colIds.has('webhookId') || colIds.has('status')) {
          throw new Error(t(`Sorry, not all fields can be edited.`));
        }
      }
    }
    const delta = editor.delta;
    for (const recId of delta.removeRows) {
      const rec = editor.getRecord(recId);
      if (!rec) {
        continue;
      }
      await this._removeWebhook(rec);
      reportMessage(t(`Removed webhook.`));
    }
    const updates = new Set(delta.updateRows);
    const t2 = editor;
    for (const recId of updates) {
      const rec = t2.getRecordNew(recId);
      if (rec?.webhookId) {
        await this._updateWebhook(String(rec?.webhookId), rec);
      }
    }
  }

  public async afterEdit(editor: IEdit) {
    const {delta} = editor;
    const updates = new Set(delta.updateRows);
    const addsAndUpdates = new Set([...delta.addRows, ...delta.updateRows]);
    for (const recId of addsAndUpdates) {
      const rec = editor.getRecord(recId);
      if (!rec) {
        continue;
      }
      const notes: string[] = [];
      const values: Record<string, any> = {};
      if (!rec.webhookId) {
        try {
          const webhookId = await this._addWebhook(rec);
          values.webhookId = webhookId;
          notes.push("Added");
        } catch (e) {
          notes.push("Incomplete" + ' | ' + this._getErrorString(e).replace(/^Error: /, '').replace('\n', ' | '));
        }
      } else {
        notes.push("Updated");
      }
      if (!values.status) {
        values.status = notes.join('\n');
      }
      if (!updates.has(recId)) {
        // 'enabled' needs an initial value, otherwise it is unsettable
        values.enabled = false;
      }
      await editor.patch([
        ['UpdateRecord', this.name, recId, values],
      ]);
    }
  }

  public async sync(editor: IEdit): Promise<void> {
    // Map from external webhookId to local arbitrary rowId.
    const rowMap = new Map(editor.getRowIds().map(rowId => [editor.getRecord(rowId)!.webhookId, rowId]));
    // Provisional list of rows to remove (we'll be trimming this down
    // as we go).
    const toRemove = new Set(editor.getRowIds());
    // Synchronization is done by applying a collected list of actions.
    const actions: UserAction[] = [];

    // Prepare to add or update webhook listings stored locally. Uses
    // brute force, on the assumption that there won't be many
    // webhooks, or that "updating" something that hasn't actually
    // changed is not disruptive.
    const webhooks = (await this._docApi.getWebhooks()).webhooks;
    this._initalizeWebhookList(webhooks);
    for (const webhook of webhooks) {
      const values = _mapWebhookValues(webhook);
      const rowId = rowMap.get(webhook.id);

      if (rowId) {
        toRemove.delete(rowId);
        actions.push(
          ['UpdateRecord', this.name, rowId, values]
        );
      } else {
        actions.push(
          ['AddRecord', this.name, null, values]
        );
      }
    }

    // Prepare to remove webhook rows that no longer correspond to something that
    // exists externally.
    for (const rowId of toRemove) {
      if (editor.getRecord(rowId)?.webhookId) {
        actions.push(['RemoveRecord', this.name, rowId]);
      }
    }

    // Apply the changes.
    await editor.patch(actions);
  }

  public async afterAnySchemaChange(editor: IEdit) {
    // Configure the table picker, since the set of tables may have changed.
    // TODO: should do something about the ready column picker. Right now,
    // Grist doesn't have a good way to handle contingent choices.
    const choices = editor.docModel.visibleTables.all().map(tableRec => tableRec.tableId());
    editor.docModel.docData.receiveAction([
      'UpdateRecord', '_grist_Tables_column', TABLE_COLUMN_ROW_ID as any, {
        widgetOptions: JSON.stringify({
          widget: 'TextBox',
          alignment: 'left',
          choices,
        })
      }]);
  }

  private _initalizeWebhookList(webhooks: WebhookSummary[]){

    this.webhooks.removeAll();
    this.webhooks.push(
      ...webhooks.map(webhook => {
        const uiWebhook: UIWebhookSummary = {...webhook};
        uiWebhook.fields.watchedColIdsText = webhook.fields.watchedColIds ? webhook.fields.watchedColIds.join(";") : "";
        return uiWebhook;
      }));
  }

  private _getErrorString(e: ApiError): string {
    return e.details?.userError || e.message;
  }

  private async _addWebhook(rec: RowRecord) {
    const fields = this._prepareFields(rec);
    // Leave enabled at default, meaning it will enable on successful
    // creation. It seems likely we'd get support requests asking why
    // webhooks are not working otherwise.
    const {webhookId} = await this._docApi.addWebhook(omit(fields, 'enabled'));
    return webhookId;
  }

  private async _updateWebhook(id: string, rec: RowRecord) {
    const fields = this._prepareFields(rec);
    if (Object.keys(fields).length) {
      await this._docApi.updateWebhook({id, fields});
    }
  }

  private async _removeWebhook(rec: RowRecord) {
    if (rec.webhookId) {
      await this._docApi.removeWebhook(String(rec.webhookId), String(rec.tableId));
    }
  }

  /**
   * Perform some transformations for sending fields to api:
   *   - (1) removes all non saveble props and
   *   - (2) removes the leading 'L' from eventTypes.
   */
  private _prepareFields(fields: any) {
    fields = pick(fields, ...this.saveableFields);
    if (fields.eventTypes) {
      fields.eventTypes = without(fields.eventTypes, 'L');
    }
    fields.watchedColIds = fields.watchedColIdsText
      ? fields.watchedColIdsText.split(";").filter((colId: string) => colId.trim() !== "")
      : [];
    return fields;
  }
}

/**
 * Visualize webhooks. There's a button to clear the queue, and
 * a card list of webhooks.
 */
export class WebhookPage extends DisposableWithEvents {

  public docApi = this.gristDoc.docPageModel.appModel.api.getDocAPI(this.gristDoc.docId());
  public sharedTable: VirtualTableRegistration;
  private _webhookExternalTable: WebhookExternalTable;


  constructor(public gristDoc: GristDoc) {
    super();
    //this._webhooks = observableArray<WebhookSummary>();
    this._webhookExternalTable = new WebhookExternalTable(this.docApi);
    const table = this.autoDispose(new VirtualTableRegistration(gristDoc.docModel, this._webhookExternalTable));
    this.listenTo(gristDoc, 'webhooks', async () => {
      await table.lazySync();
    });
  }



  public buildDom() {
    const viewSectionModel = this.gristDoc.docModel.viewSections.getRowModel('vt_webhook_fs1' as any);
    ViewSectionHelper.create(this, this.gristDoc, viewSectionModel);
    return cssContainer(
      cssHeader(t('Webhook Settings')),
      cssControlRow(
        bigPrimaryButton(t("Clear Queue"),
          dom.on('click', () => this.reset()),
          testId('webhook-reset'),
        )
      ),
      // active_section here is a bit of a hack, to allow tests to run
      // more easily.
      dom('div.active_section.view_data_pane_container.flexvbox', viewSectionModel.viewInstance()!.viewPane),
    );
  }

  public async reset() {
    await this.docApi.flushWebhooks();
    reportSuccess(t('Cleared webhook queue.'));
  }

  public async resetSelected(id: string) {
    await this.docApi.flushWebhook(id);
    reportSuccess(t(`Cleared webhook ${id} queue.`));
  }
}

const cssHeader = styled(docListHeader, `
  margin-bottom: 0;
  &:not(:first-of-type) {
    margin-top: 40px;
  }
`);

const cssControlRow = styled('div', `
  flex: none;
  margin-bottom: 16px;
  margin-top: 16px;
  display: flex;
  gap: 16px;
`);

const cssContainer = styled('div', `
  overflow-y: auto;
  position: relative;
  height: 100%;
  padding: 32px 64px 24px 64px;

  display: flex;
  flex-direction: column;
  @media ${mediaSmall} {
    & {
      padding: 32px 24px 24px 24px;
    }
  }
`);


/**
 * Actions needed to create the virtual table about webhooks, and a
 * view for it. There are some "any" casts to place string ids where
 * numbers are expected.
 */
function _prepareWebhookInitialActions(tableId: string): DocAction[] {
  return [[
    // Add the virtual table.
    'AddTable', tableId,
    WEBHOOK_COLUMNS.map(col => ({
      isFormula: true,
      type: 'Any',
      formula: '',
      id: col.colId
    }))
  ], [
    // Add an entry for the virtual table.
    'AddRecord', '_grist_Tables', 'vt_webhook_ft1' as any, {tableId, primaryViewId: 0},
  ], [
    // Add entries for the columns of the virtual table.
    'BulkAddRecord', '_grist_Tables_column',
    WEBHOOK_COLUMNS.map(col => col.id) as any, getColValues(WEBHOOK_COLUMNS.map(rec =>
      Object.assign({
        isFormula: false,
        formula: '',
        widgetOptions: '',
        parentId: 'vt_webhook_ft1' as any,
      }, omit(rec, ['id']) as any))),
  ], [
    // Add a view section.
    'AddRecord', '_grist_Views_section', 'vt_webhook_fs1' as any,
    {tableRef: 'vt_webhook_ft1', parentKey: 'detail', title: '', borderWidth: 1, defaultWidth: 100, theme: 'blocks'}
  ], [
    // List the fields shown in the view section.
    'BulkAddRecord', '_grist_Views_section_field', WEBHOOK_VIEW_FIELDS.map((_, i) => `vt_webhook_ff${i + 1}`) as any, {
      colRef: WEBHOOK_VIEW_FIELDS.map(colId => WEBHOOK_COLUMNS.find(r => r.colId === colId)!.id),
      parentId: WEBHOOK_VIEW_FIELDS.map(() => 'vt_webhook_fs1'),
      parentPos: WEBHOOK_VIEW_FIELDS.map((_, i) => i),
    }
  ]];
}

/**
 * Map a webhook summary to a webhook table raw record.  The main
 * difference is that `eventTypes` is tweaked to be in a cell format,
 * `status` is converted to a string,
 * and `watchedColIdsText` is converted to list in a cell format.
 */
function _mapWebhookValues(webhookSummary: UIWebhookSummary): Partial<WebhookSchemaType> {
  const fields = webhookSummary.fields;
  const {eventTypes, watchedColIdsText} = fields;
  const watchedColIds = watchedColIdsText
    ? watchedColIdsText.split(";").filter(colId => colId.trim() !== "")
    : [];
  return {
    ...fields,
    webhookId: webhookSummary.id,
    status: JSON.stringify(webhookSummary.usage),
    eventTypes: [GristObjCode.List, ...eventTypes],
    watchedColIds: [GristObjCode.List, ...watchedColIds],
  };
}

type WebhookSchemaType = {
  [prop in keyof WebhookSummary['fields']]: WebhookSummary['fields'][prop]
} & {
  eventTypes: [GristObjCode, ...unknown[]];
  watchedColIds: [GristObjCode, ...unknown[]];
  status: string;
  webhookId: string;
}

type UIWebhookSummary = WebhookSummary & {
  fields: {watchedColIdsText?: string;}
}
