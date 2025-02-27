import {GristDoc} from 'app/client/components/GristDoc';
import {Importer, SourceInfo} from 'app/client/components/Importer';
import koArray from 'app/client/lib/koArray';
import {ViewSectionRec} from 'app/client/models/DocModel';
import {SortedRowSet} from 'app/client/models/rowset';
import {bigBasicButton, cssButton} from 'app/client/ui2018/buttons';
import {cssRootVars} from 'app/client/ui2018/cssVars';
import {UploadResult} from 'app/common/uploads';
import {dom, Holder, Observable, styled} from 'grainjs';
import * as ko from 'knockout';
import {initSchema, initValues} from 'test/fixtures/projects/helpers/ParseOptionsData';
import {withLocale} from 'test/fixtures/projects/helpers/withLocale';

// tslint:disable:no-console

let colRef = 1;

function makeDummyViewSection(name: string) {
  const field = (fieldName: string, ref = colRef++) => ({
    colRef: ko.observable(ref),
    colId: ko.observable(`Col${colRef}`),
    label: ko.observable(fieldName),
    column: ko.observable({
      id: ko.observable(ref),
      label: ko.observable(fieldName),
      colId: ko.observable(`Col${colRef}`),
      formula: ko.observable(''),
      getRowId: () => ref,
      refTable: ko.observable({
        tableId: ko.observable(name),
      }),
      visibleColModel: ko.observable({
        label: ko.observable(fieldName),
        formula: ko.observable(''),
        getRowId: () => ref,
        colId: ko.observable(ref),
      }),
      pureType: ko.observable('Text'),
    })
  });
  return {
    _isDeleted: ko.observable(false),
    isDisposed: ko.observable(false),
    title: ko.observable(name),
    viewFields: ko.observable(koArray([
      field('Column 1'),
      field('Column 2'),
      field('Column 3'),
      field('Column 4'),
    ])),
  } as unknown as ViewSectionRec;
}

// By setting those two, you can modify what will be shown first, start screen is when both are null.
const PANEL = 2;
const DEST_TABLE_ID = 'aaa';

const sampleSourceInfoArray: SourceInfo[] = [{
  destTableId: Observable.create(null, DEST_TABLE_ID),
  hiddenTableId: "GristHidden_import",
  origTableName: "",
  sourceSection: makeDummyViewSection('source1'),
  transformSection: Observable.create(null, makeDummyViewSection('dest1')),
  uploadFileIndex: 0,
  lastGenImporterViewPromise: null,
  isLoadingSection: Observable.create(null, false),
  selectedView: Observable.create(null, PANEL),
  customizedColumns: Observable.create(null, new Set()),
}, {
  destTableId: Observable.create(null, DEST_TABLE_ID),
  hiddenTableId: "GristHidden_import2",
  origTableName: "",
  sourceSection: makeDummyViewSection('source2'),
  transformSection: Observable.create(null, makeDummyViewSection('dest2')),
  uploadFileIndex: 1,
  lastGenImporterViewPromise: null,
  isLoadingSection: Observable.create(null, false),
  selectedView: Observable.create(null, PANEL),
  customizedColumns: Observable.create(null, new Set()),
}, {
  destTableId: Observable.create(null, DEST_TABLE_ID),
  hiddenTableId: "GristHidden_import3",
  origTableName: "NYC List",
  sourceSection: makeDummyViewSection('source3'),
  transformSection: Observable.create(null, makeDummyViewSection('dest3')),
  uploadFileIndex: 2,
  lastGenImporterViewPromise: null,
  isLoadingSection: Observable.create(null, false),
  selectedView: Observable.create(null, PANEL),
  customizedColumns: Observable.create(null, new Set()),
}, {
  destTableId: Observable.create(null, DEST_TABLE_ID),
  hiddenTableId: "GristHidden_import4",
  origTableName: "Stats",
  sourceSection: makeDummyViewSection('source4'),
  transformSection: Observable.create(null, makeDummyViewSection('dest4')),
  uploadFileIndex: 2,
  lastGenImporterViewPromise: null,
  isLoadingSection: Observable.create(null, false),
  selectedView: Observable.create(null, PANEL),
  customizedColumns: Observable.create(null, new Set()),
}, {
  destTableId: Observable.create(null, DEST_TABLE_ID),
  hiddenTableId: "GristHidden_import4",
  origTableName: "AAA",
  sourceSection: makeDummyViewSection('source5'),
  transformSection: Observable.create(null, makeDummyViewSection('dest5')),
  uploadFileIndex: 2,
  lastGenImporterViewPromise: null,
  isLoadingSection: Observable.create(null, false),
  selectedView: Observable.create(null, PANEL),
  customizedColumns: Observable.create(null, new Set()),
}];

const sampleUploadResult: UploadResult = {
  uploadId: 4,
  files: [{
    origName: "foo.csv",
    size: 13,
    ext: ".csv"
  }, {
    origName: "Hello World, what a long name you have.csv",
    size: 57,
    ext: ".csv"
  }, {
    origName: "NYC Restaurants.xlsx",
    size: 68259,
    ext: ".xlsx"
  }]
};

function setupTest() {
  const mode = Observable.create(null, "main");

  const docModel = {
    visibleTableIds: koArray(["Table1", "Hello_World", "Some_Other_Longish_Name"]),
    viewSections: {
      getRowModel() {
        return makeDummyViewSection('dest3');
      }
    }
  };
  const gristDoc: GristDoc = {
    docComm: null,
    docModel,
    viewModel : {
      activeSectionId: ko.observable(null),
    },
    docData: {
      sendAction() {
        return Promise.resolve(1);
      }
    }
  } as any;
  const holder = Holder.create<Importer>(null);
  const createPreview = (vs: ViewSectionRec) => ({
    viewPane: dom('div', `GridView for ${vs.title()}`),
    dispose: () => null,
    listenTo: (..._args: any[]) => undefined,
    sortedRows: SortedRowSet.create(null, (a, b) => 0)
  });

  function render(modeValue: string) {
    mode.set(modeValue);
    const parseOptions = {...initValues, SCHEMA: initSchema};
    const importer = Importer.create(holder, gristDoc, null, createPreview);
    (importer as any)._parseOptions.set(parseOptions);
    (importer as any)._sourceInfoArray.set(sampleSourceInfoArray);
    (importer as any)._sourceInfoSelected.set(sampleSourceInfoArray[0]);
    (importer as any)._prepareMergeOptions();
    (importer as any)._renderMain(sampleUploadResult);
    switch (modeValue) {
      case 'spinner': return (importer as any)._renderSpinner();
      case 'error': return (importer as any)._renderError("This is a test error message");
      case 'plugin': return (importer as any)._renderPlugin(
        dom('div', 'Hello, ', dom('input', {type: 'text'}), ' world', dom('button', 'Go!'))
      );
      case 'preview': return (importer as any)._renderMain(sampleUploadResult);
      case 'parseopts': return (importer as any)._renderParseOptions(initSchema, null);
    }
  }

  setTimeout(() => render('preview'), 0);

  return [
    dom.cls(cssRootVars),
    testBox(
      dom('div', {style: 'display: flex; padding: 8px;'},
        myButton('Spinner',
          cssButton.cls('-primary', (use) => use(mode) === 'spinner'),
          dom.on('click', () => render('spinner')),
        ),
        myButton('Error',
          cssButton.cls('-primary', (use) => use(mode) === 'error'),
          dom.on('click', () => render('error')),
        ),
        myButton('Plugin',
          cssButton.cls('-primary', (use) => use(mode) === 'plugin'),
          dom.on('click', () => render('plugin')),
        ),
        myButton('Preview',
          cssButton.cls('-primary', (use) => use(mode) === 'preview'),
          dom.on('click', () => render('preview')),
        ),
        myButton('Parse Options',
          cssButton.cls('-primary', (use) => use(mode) === 'parseopts'),
          dom.on('click', () => render('parseopts')),
        ),
      ),
    ),
  ];
}

const testBox = styled('div', `
  flex: 1 0 auto;
  margin: 2rem;
  box-shadow: 1px 1px 4px 2px #AAA;
  overflow: hidden;
`);

const myButton = styled(bigBasicButton, `
  margin-right: 16px;
`);

void withLocale(() => dom.update(document.body, setupTest()));
