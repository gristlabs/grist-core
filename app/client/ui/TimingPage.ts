import BaseView = require('app/client/components/BaseView');
import {GristDoc} from 'app/client/components/GristDoc';
import {ViewSectionHelper} from 'app/client/components/ViewLayout';
import {makeT} from 'app/client/lib/localization';
import {IEdit, IExternalTable, VirtualTableRegistration} from 'app/client/models/VirtualTable';
import {urlState} from 'app/client/models/gristUrlState';
import {docListHeader} from 'app/client/ui/DocMenuCss';
import {isNarrowScreenObs, mediaSmall} from 'app/client/ui2018/cssVars';
import {loadingSpinner} from 'app/client/ui2018/loaders';
import {FormulaTimingInfo} from 'app/common/ActiveDocAPI';
import {DisposableWithEvents} from 'app/common/DisposableWithEvents';
import {
  DocAction,
  getColValues,
  TableDataAction} from 'app/common/DocActions';
import {VirtualId} from 'app/common/SortSpec';
import {not} from 'app/common/gutil';
import {Disposable, dom, makeTestId, Observable, styled} from 'grainjs';
import omit = require('lodash/omit');
import range = require('lodash/range');

const t = makeT('TimingPage');
const testId = makeTestId('test-timing-page-');

/**
 * A list of columns for a virtual table about formula timings.
 */
const COLUMNS = [
  {
    id: VirtualId(),
    colId: 'tableId',
    type: 'Text',
    label: t('Table ID'),
  },
  {
    id: VirtualId(),
    colId: 'colId',
    type: 'Text',
    label: t('Column ID'),
  },
  {
    id: VirtualId(),
    colId: 'sum',
    type: 'Numeric',
    label: t('Total Time (s)')
  },
  {
    id: VirtualId(),
    colId: 'calls',
    type: 'Numeric',
    label: t('Number of Calls')
  },
  {
    id: VirtualId(),
    colId: 'average',
    type: 'Numeric',
    label: t('Average Time (s)')
  },
  // max time
  {
    id: VirtualId(),
    colId: 'max',
    type: 'Numeric',
    label: t('Max Time (s)')
  },
] as const;

interface TimingRecord {
  tableId: string;
  colId: string;
  sum: number;
  calls: number;
  average: number;
  max: number;
}

const VIRTUAL_SECTION_ID = VirtualId();
const VIRTUAL_TABLE_ID = VirtualId();

/**
 * Layout of fields in a view, with a specific ordering.
 */
const FIELDS: Array<(typeof COLUMNS)[number]['colId']> = [
  'tableId', 'colId', 'sum', 'calls', 'average', 'max'
];


class TimingExternalTable extends Disposable implements IExternalTable {
  public name = 'GristHidden_TimingTable';
  public initialActions = _prepareInitialActions(this.name);
  public saveableFields = [];

  public constructor(private _initialData: FormulaTimingInfo[]) {
    super();
  }

  public async fetchAll(): Promise<TableDataAction> {
    const timingInfo = this._initialData;
    console.debug('Timing info:', timingInfo);
    const data = timingInfo || [];
    const indicies = range(data.length).map(i => i + 1);
    return ['TableData', this.name, indicies,
      getColValues(indicies.map(rowId => _mapModelValues(rowId, data[rowId - 1])))];
  }

  // Not used.
  public async beforeEdit(editor: IEdit) {}
  public async afterEdit(editor: IEdit) {}
  public async afterAnySchemaChange(editor: IEdit) {}
  public async sync(editor: IEdit): Promise<void> {}
}

export class TimingPage extends DisposableWithEvents {
  private _data: Observable<FormulaTimingInfo[]|null> = Observable.create(this, null);

  constructor(private _gristDoc: GristDoc) {
    super();
    if (this._gristDoc.isTimingOn.get() === false) {
      // Just redirect back to the settings page.
      this._openSettings();
    } else {
      this._start().catch(ex => {
        this._openSettings();
        reportError(ex);
      });
    }
  }

  public buildDom() {
    return cssContainer(
      dom.maybe(this._data, () =>
        dom('div', {style: 'display: flex; justify-content: space-between; align-items: baseline'},
          cssHeader(t('Formula timer')),
        )
      ),
      dom.maybeOwned(this._data, (owner) => {
        const viewSectionModel = this._gristDoc.docModel.viewSections.getRowModel(VIRTUAL_SECTION_ID as any);
        ViewSectionHelper.create(owner, this._gristDoc, viewSectionModel);
        return dom.maybe(use => use(viewSectionModel.viewInstance), (view: BaseView) =>
          dom('div.active_section.view_data_pane_container.flexvbox', view.viewPane,
            dom.maybe(use => !use(isNarrowScreenObs()), () => view.selectionSummary?.buildDom()),
          )
        );
      }),
      dom.maybe(not(this._data), () => cssLoaderScreen(
        loadingSpinner(),
        dom('div', t('Loading timing data. Don\'t close this tab.')),
        testId('spinner'),
      ))
    );
  }

  private _openSettings() {
    urlState().pushUrl({docPage: 'settings'}).catch(reportError);
  }

  private async _start() {
    const docApi = this._gristDoc.docPageModel.appModel.api.getDocAPI(this._gristDoc.docId());

    // Get the data from the server (and wait for the engine to calculate everything if it hasn't already).
    const data = await docApi.stopTiming();
    if (this.isDisposed()) { return; }

    // And wire up the UI.
    const ext = this.autoDispose(new TimingExternalTable(data));
    this.autoDispose(new VirtualTableRegistration(this._gristDoc, ext));
    this._data.set(data);
  }
}

// See the WebhookPage for more details on how this works.
function _prepareInitialActions(tableId: string): DocAction[] {
  return [[
    // Add the virtual table.
    'AddTable', tableId,
    COLUMNS.map(col => ({
      isFormula: true,
      type: 'Any',
      formula: '',
      id: col.colId
    }))
  ], [
    // Add an entry for the virtual table.
    'AddRecord', '_grist_Tables', VIRTUAL_TABLE_ID as any, {tableId, primaryViewId: 0},
  ], [
    // Add entries for the columns of the virtual table.
    'BulkAddRecord', '_grist_Tables_column',
    COLUMNS.map(col => col.id) as any, getColValues(COLUMNS.map(rec =>
      Object.assign({
        isFormula: false,
        formula: '',
        widgetOptions: '',
        parentId: VIRTUAL_TABLE_ID as any,
      }, omit(rec, ['id']) as any))),
  ], [
    // Add a view section.
    'AddRecord', '_grist_Views_section', VIRTUAL_SECTION_ID as any,
    {
      tableRef: VIRTUAL_TABLE_ID, parentKey: 'record',
      title: 'Timing', layout: 'vertical', showHeader: true,
      borderWidth: 1, defaultWidth: 100,
    }
  ], [
    // List the fields shown in the view section.
    'BulkAddRecord', '_grist_Views_section_field', FIELDS.map(VirtualId.bind(null, undefined)) as any, {
      colRef: FIELDS.map(colId => COLUMNS.find(r => r.colId === colId)!.id),
      parentId: FIELDS.map(() => VIRTUAL_SECTION_ID),
      parentPos: FIELDS.map((_, i) => i),
    }
  ]];
}

// See the WebhookPage for more details on how this works.
function _mapModelValues(rowId: number, model: FormulaTimingInfo): Partial<TimingRecord & {id: number}> {
  return {
    id: rowId,
    tableId: model.tableId,
    colId: model.colId,
    sum: model.sum,
    calls: model.count,
    average: model.average,
    max: model.max,
  };
}

const cssHeader = styled(docListHeader, `
  margin-bottom: 18px;
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

const cssLoaderScreen = styled('div', `
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
`);
