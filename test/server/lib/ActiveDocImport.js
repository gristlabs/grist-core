const assert            = require('chai').assert;
const fs                = require('fs');
const path              = require('path');

const {createDocTools} = require('test/server/docTools');
const testUtils        = require('test/server/testUtils');
const tmp              = require('tmp');
const _                = require('lodash');
const {DummyAuthorizer} = require('app/server/lib/Authorizer');
const {Client}         = require('app/server/lib/Client');
const {getFileUploadInfo, globalUploadSet, moveUpload} = require('app/server/lib/uploads');


tmp.setGracefulCleanup();

describe('ActiveDocImport', function() {
  this.timeout(10000);

  // Turn off logging for this test, and restore afterwards.
  testUtils.setTmpLogLevel('warn');

  const docTools = createDocTools();

  const docSession = docTools.createFakeSession();

  const csvPath = fs.realpathSync(path.resolve(testUtils.fixturesRoot, "uploads/FileUploadData.csv"));
  const csvPath1 = path.resolve(testUtils.fixturesRoot, "uploads/UploadedData1.csv");
  const csvPath2 = path.resolve(testUtils.fixturesRoot, "uploads/UploadedData2.csv");
  const extendedCsvPath2 = path.resolve(testUtils.fixturesRoot, "uploads/UploadedData2Extended.csv");
  const csvPath3 = path.resolve(testUtils.fixturesRoot, "uploads/UploadedData3.csv");
  const csvPathWithUnicodeHeaders = path.resolve(testUtils.fixturesRoot, "uploads/unicode_headers.csv");
  const xlsxPath = path.resolve(testUtils.fixturesRoot, "uploads/homicide_rates.xlsx");
  const xlsxPathWithUnicodeHeaders = path.resolve(testUtils.fixturesRoot, "uploads/unicode_headers.xlsx");
  const xlsxEmpty = path.resolve(testUtils.fixturesRoot, "uploads/empty_excel.xlsx");
  const jgristPath = path.resolve(testUtils.fixturesRoot, "uploads/cities.jgrist");
  const jgristBrokenPath = path.resolve(testUtils.fixturesRoot, "uploads/cities_broken.jgrist");
  const simpleArrayJsonPath = path.resolve(testUtils.fixturesRoot, "uploads/simple_array.json");
  const moreComplexJsonPath = path.resolve(testUtils.fixturesRoot, "uploads/spotifyGetSeveralAlbums.json");
  const jsonPathWithDirtyTableName = path.resolve(testUtils.fixturesRoot, "uploads/dirtyNames.json");
  const emptyData = path.resolve(testUtils.fixturesRoot, "uploads/empty_data.jgrist");
  const booleanData = path.resolve(testUtils.fixturesRoot, "uploads/BooleanData.xlsx");
  const dateTimeData = path.resolve(testUtils.fixturesRoot, "uploads/DateTimeData.xlsx");

  const expectedCommaSeparatedData = [ 'TableData', 'GristHidden_import', [ 1, 2, 3 ], {
    manualSort: [ 1, 2, 3 ],
    lname: [ 'washington', 'adams', 'jefferson' ],
    start_year: [ 1789, 1797, 1801 ],
    end_year: [ 1797, 1801, 1809 ],
    fname: [ 'george', 'john', 'thomas' ],
    gristHelper_Import_fname: [ 'george', 'john', 'thomas' ],
    gristHelper_Import_lname: [ 'washington', 'adams', 'jefferson' ],
    gristHelper_Import_start_year: [ 1789, 1797, 1801 ],
    gristHelper_Import_end_year: [ 1797, 1801, 1809 ]
  }];

  const expectedNoHeadersData = [ 'TableData', 'GristHidden_import', [ 1, 2, 3 ], {
    manualSort: [ 1, 2, 3 ],
    A: [ 'milk', 'egg', 'butter' ],
    B: [ 1, 2, 4 ],
    C: [ 'sold', 'in stock', 'sold' ],
    gristHelper_Import_A: [ 'milk', 'egg', 'butter' ],
    gristHelper_Import_B: [ 1, 2, 4 ],
    gristHelper_Import_C: [ 'sold', 'in stock', 'sold' ]
  }];

  const expectedHeadersFromFirstRowData = [ 'TableData', 'GristHidden_import', [ 1, 2 ], {
    manualSort: [ 1, 2 ],
    milk: [ 'egg', 'butter' ],
    c1: [ 2, 4 ],
    sold: [ 'in stock', 'sold' ],
    gristHelper_Import_milk: [ 'egg', 'butter' ],
    gristHelper_Import_c1: [ 2, 4 ],
    gristHelper_Import_sold: [ 'in stock', 'sold' ]
  }];

  const expectedFinalCommaSeparatedData = [ 'TableData', 'FileUploadData', [ 1, 2, 3 ], {
    manualSort: [ 1, 2, 3 ],
    lname: [ 'washington', 'adams', 'jefferson' ],
    start_year: [ 1789, 1797, 1801 ],
    end_year: [ 1797, 1801, 1809 ],
    fname: [ 'george', 'john', 'thomas' ]
  }];

  const expectedTransformedData = [ 'TableData', 'GristHidden_import', [ 1, 2, 3 ], {
    manualSort: [ 1, 2, 3 ],
    lname: [ 'washington', 'adams', 'jefferson' ],
    start_year: [ 1789, 1797, 1801 ],
    end_year: [ 1797, 1801, 1809 ],
    fname: [ 'george', 'john', 'thomas' ],
    gristHelper_Import_fname: [ 'George', 'John', 'Thomas' ],
    gristHelper_Import_lname: [ 'Washington', 'Adams', 'Jefferson' ],
    gristHelper_Import_start_year: [ 1789, 1797, 1801 ],
    gristHelper_Import_end_year: [ 1797, 1801, 1809 ]
  }];

  const expectedFinalTransformedData = [ 'TableData', 'FileUploadData', [ 1, 2, 3 ], {
    manualSort: [ 1, 2, 3 ],
    lname: [ 'Washington', 'Adams', 'Jefferson' ],
    start_year: [ 1789, 1797, 1801 ],
    end_year: [ 1797, 1801, 1809 ],
    fname: [ 'George', 'John', 'Thomas' ]
  }];

  const expectedPipeSeparatedData = [ 'TableData', 'GristHidden_import', [ 1, 2, 3 ], {
    manualSort: [ 1, 2, 3 ],
    fname_lname_start_year_end_year: [
      'george,washington,1789,1797',
      'john,adams,1797,1801',
      'thomas,jefferson,1801,1809'
    ],
    gristHelper_Import_fname_lname_start_year_end_year: [
      'george,washington,1789,1797',
      'john,adams,1797,1801',
      'thomas,jefferson,1801,1809' ],
  }];

  const expectedCommaSeparatedNoHeadersData = [ 'TableData', 'GristHidden_import', [ 1, 2, 3, 4 ], {
    manualSort: [ 1, 2, 3, 4 ],
    A: [ 'fname', 'george', 'john', 'thomas' ],
    B: [ 'lname', 'washington', 'adams', 'jefferson' ],
    C: [ 'start_year', '1789', '1797', '1801' ],
    D: [ 'end_year', '1797', '1801', '1809' ],
    gristHelper_Import_A: [ 'fname', 'george', 'john', 'thomas' ],
    gristHelper_Import_B: [ 'lname', 'washington', 'adams', 'jefferson' ],
    gristHelper_Import_C: [ 'start_year', '1789', '1797', '1801' ],
    gristHelper_Import_D: [ 'end_year', '1797', '1801', '1809' ]
  }];

  const expectedDestinationData = [ 'TableData', 'UploadedData1', [ 1, 2, 3 ], {
    manualSort: [ 1, 2, 3 ],
    Name: [ 'Lily', 'Kathy', 'Karen' ],
    Phone: [ 'Jones', 'Mills', 'Gold' ],
    Title: [ 'director', 'student', 'professor' ]
  }];

  const expectedFinalDestinationData = [ 'TableData', 'UploadedData1', [ 1, 2, 3, 4, 5, 6 ], {
    manualSort: [ 1, 2, 3, 4, 5, 6 ],
    Name: [ 'Lily', 'Kathy', 'Karen', 'George', 'John', 'Thomas' ],
    Phone: [ 'Jones', 'Mills', 'Gold', 'Washington', 'Adams', 'Jefferson' ],
    Title: [ 'director', 'student', 'professor', '', '', '' ]
  }];

  const expectedDestinationData2 = [ 'TableData', 'UploadedData2', [ 1, 2, 3, 4, 5, 6 ], {
    manualSort: [ 1, 2, 3, 4, 5, 6 ],
    CourseId: [ 'BUS100', 'BUS102', 'BUS300', 'BUS301', 'BUS500', 'BUS540' ],
    CourseName: [
      'Intro to Business', 'Business Law', 'Business Operations',
      'History of Business', 'Ethics and Law', 'Capstone'
    ],
    Instructor: [ '', 'Nathalie Patricia', 'Michael Rian', 'Mariyam Melania', 'Filip Andries', '' ],
    StartDate: [ 1610496000, 1610496000, 1610582400, 1610582400, 1610496000, 1610496000 ],
    PassFail: [ false, false, false, false, false, true ]
  }];

  const expectedFinalDestinationData2 = [ 'TableData', 'UploadedData2', [ 1, 2, 3, 4, 5, 6, 7, 8 ], {
    manualSort: [ 1, 2, 3, 4, 5, 6, 7, 8 ],
    CourseId: [ 'BUS100', 'BUS102', 'BUS300', 'BUS301', 'BUS500', 'BUS540', 'BUS501', 'BUS539' ],
    CourseName: [
      'Intro to Business', 'Business Law', 'Business Operations',
      'History of Business', 'Ethics and Law', 'Capstone', 'Marketing', 'Independent Study'
    ],
    Instructor: [
      'Mariyam Melania', 'Nathalie Patricia', 'Michael Rian', 'Mariyam Melania',
      'Filip Andries', '', 'Michael Rian', ''
    ],
    StartDate: [ 1610496000, 1610496000, 1610582400, 1610582400, 1610496000, 1610496000, 1610496000, 1610496000 ],
    PassFail: [ false, false, false, false, false, false, false, true ]
  }];

  const expectedComparisonData = {
    left: {n: 0, h: ''},
    right: {n: 0, h: ''},
    parent: null,
    summary: 'right',
    details: {
      leftChanges: {
        tableRenames: [],
        tableDeltas: {}
      },
      rightChanges: {
        tableRenames: [],
        tableDeltas: {
          GristHidden_import: {
            removeRows: [],
            updateRows: [1, 5, 6, 7, 8],
            addRows: [],
            columnRenames: [],
            columnDeltas: {
              gristHelper_Import_CourseId: {
                "6": [[""], ["BUS501"]], "7": [[""], ["BUS539"]]
              },
              gristHelper_Import_CourseName: {
                "5": [["Ethics and Law"], ["Ethics and Law"]], // Same because source has a blank value and destination does not.
                "6": [[""], ["Marketing"]],
                "7": [[""], ["Independent Study"]]
              },
              gristHelper_Import_Instructor: { "1": [[""], ["Mariyam Melania"]], "6": [[""], ["Michael Rian"]], "7": [[""], [""]] }, gristHelper_Import_StartDate: { "6": [[""], [1610496000]], "7": [[""], [1610496000]] },
              gristHelper_Import_PassFail: { "6": [[""], [false]], "7": [[""], [true]], "8": [[true], [false]] }
            },
          }
        }
      }
    }
  };

  const expectedComparisonData2 = {
    left: {n: 0, h: ''},
    right: {n: 0, h: ''},
    parent: null,
    summary: 'right',
    details: {
      leftChanges: {
        tableRenames: [],
        tableDeltas: {}
      },
      rightChanges: {
        tableRenames: [],
        tableDeltas: {
          GristHidden_import: {
            removeRows: [],
            updateRows: [1, 2, 3, 4, 5, 6, 7, 8],
            addRows: [],
            columnRenames: [],
            columnDeltas: {
              gristHelper_Import_CourseId: { "6": [[""], ["BUS501"]], "7": [[""], ["BUS539"]] },
              gristHelper_Import_CourseName: {
                "1": [["Intro to Business"], ["INTRO TO BUSINESS"]],
                "2": [["Business Law"], ["BUSINESS LAW"]],
                "3": [["Business Operations"], ["BUSINESS OPERATIONS"]],
                "4": [["History of Business"], ["HISTORY OF BUSINESS"]],
                "5": [["Ethics and Law"], ["Ethics and Law"]],
                "6": [[""], ["MARKETING"]],
                "7": [[""], ["INDEPENDENT STUDY"]],
                "8": [["Capstone"], ["CAPSTONE"]]
              },
              gristHelper_Import_Instructor: {
                "1": [[""], ["mariyam melania"]],
                "2": [["Nathalie Patricia"], ["nathalie patricia"]],
                "3": [["Michael Rian"], ["michael rian"]],
                "4": [["Mariyam Melania"], ["mariyam melania"]],
                "5": [["Filip Andries"], ["filip andries"]],
                "6": [[""], ["michael rian"]],
                "7": [[""], [""]] },
              gristHelper_Import_StartDate: { "6": [[""], [1610496000]], "7": [[""], [1610496000]] },
              gristHelper_Import_PassFail: { "6": [[""], [false]], "7": [[""], [true]], "8": [[true], [false]] }
            },
          }
        }
      }
    }
  };

  const fakeSession = {client: new Client(null, null, null),
                       authorizer: new DummyAuthorizer('editors', 'doc')};

  function assertDocTables(activeDoc, expectedTableIds) {
    return activeDoc.fetchTable(docSession, '_grist_Tables')
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData[3].tableId, expectedTableIds));
  }

  function createDataSource(activeDoc, srcPath) {
    return getFileUploadInfo(srcPath)
    .then(fileUploadInfo => {
      const uploadId = globalUploadSet.registerUpload([fileUploadInfo], null, _.noop, null);
      return {uploadId, transforms: []};
    });
  }

  it("should reimport files and remove all hidden tables if canceled or re imported", () => {
    let activeDoc;
    let dataSource;
    return docTools.createDoc('dummy').then(adoc => { activeDoc = adoc; })
    .then(() => createDataSource(activeDoc, csvPath))
    .then(dataSrc => dataSource = dataSrc)
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))

    // ensure that imported table has special name
    .then(tableInfo => assert.deepEqual(tableInfo.tables, [
        {
          "uploadFileIndex": 0,
          "destTableId": null,
          "hiddenTableId": "GristHidden_import",
          "origTableName": "",
          "transformSectionRef": 4
        }
      ]
    ))

    // ensure that correct temporary hidden tables got created, and have correct data.
    .then(() => assertDocTables(activeDoc, ['GristHidden_import']))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedCommaSeparatedData))

    // Re-import from the same source data.
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {"delimiter": "|"},
                                      ['GristHidden_import']))

    // check that after reimport the new temporary table was created with the same name because
    // an old one was deleted
    .then(tableInfo => assert.deepEqual(tableInfo.tables, [
        {
          "uploadFileIndex": 0,
          "destTableId": null,
          "hiddenTableId": "GristHidden_import",
          "origTableName": "",
          "transformSectionRef": 4
        }
      ]
    ))

    // checking that reimported table contains correct data, now parsed differently.
    .then(() => assertDocTables(activeDoc, ['GristHidden_import']))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedPipeSeparatedData))

    // Cancel import.
    .then(() => activeDoc.cancelImportFiles(fakeSession, dataSource.uploadId, ["GristHidden_import"]))

    // ensure that after canceling import temporary table was deleted
    .then(() => assertDocTables(activeDoc, []));
  });

  it("should finish import files and remove all hidden tables on 'Import File'", () => {
    let activeDoc;
    let dataSource;
    return docTools.createDoc('temp').then(adoc => { activeDoc = adoc; })
    .then(() => createDataSource(activeDoc, csvPath))
    .then(dataSrc => dataSource = dataSrc)
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))

    // ensure that imported table has special name, and exists with correct data.
    .then(tableInfo => assert.deepEqual(tableInfo.tables, [
        {
          "uploadFileIndex": 0,
          "destTableId": null,
          "hiddenTableId": "GristHidden_import",
          "origTableName": "",
          "transformSectionRef": 4
        }
      ]
    ))
    .then(() => assertDocTables(activeDoc, ['GristHidden_import']))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedCommaSeparatedData))

    // Finish import
    .then(() => activeDoc.finishImportFiles(fakeSession, dataSource, ['GristHidden_import'],
                                            {"parseOptions": {"delimiter": ","}}))
    .then(tableInfo => assert.deepEqual(tableInfo.tables, [
        {
          "uploadFileIndex": 0,
          "destTableId": null,
          "hiddenTableId": "FileUploadData",
          "origTableName": "",
          "transformSectionRef": -1 //TODO: FINISH IMPORT DOESNT MAKE TRANSFORM SECTION!!! is this ok?
        }
      ]
    ))
    // ensure that after finishing import temporary table was replaced with a new regular table.
    .then(() => assertDocTables(activeDoc, ['FileUploadData']))
    .then(() => activeDoc.fetchTable(docSession, 'FileUploadData'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedFinalCommaSeparatedData));
  });

  it("should apply transform rules and reimport files", function() {
    let activeDoc;
    let dataSourceTransformed;
    return docTools.createDoc('temp(7)').then(adoc => { activeDoc = adoc; })
    .then(() => createDataSource(activeDoc, csvPath))
    .then(dataSrc => {
      dataSourceTransformed = dataSrc;
      dataSourceTransformed.transforms[0] = {'': {
        destTableId: null,
        destCols: [
            {label: 'fname',      colId: null, type: 'Text', formula: '$fname.capitalize()'},
            {label: 'lname',      colId: null, type: 'Text', formula: '$lname.capitalize()'},
            {label: 'start_year', colId: null, type: 'Int', formula: '$start_year'},
            {label: 'end_year',   colId: null, type: 'Int', formula: '$end_year'}],
        sourceCols: ['fname', 'lname', 'start_year', 'end_year']
      }};
    })
    // Import using transform rules
    .then(() => activeDoc.importFiles(fakeSession, dataSourceTransformed, {}, []))
    // Ensure that reimported table contains correct data and applied rules.
    .then(() => assertDocTables(activeDoc, ['GristHidden_import']))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)

    .then(tableData => assert.deepEqual(tableData, expectedTransformedData))
    // Re-import again using transform rules
    .then(() => activeDoc.importFiles(fakeSession, dataSourceTransformed, {}, ['GristHidden_import']))
    // Ensure that reimported table contains correct data and applied rules.
    .then(() => assertDocTables(activeDoc, ['GristHidden_import']))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)

    .then(tableData => assert.deepEqual(tableData, expectedTransformedData))

    // Change delimiter which will change table schema and re-import
    .then(() => activeDoc.importFiles(fakeSession, dataSourceTransformed, {delimiter: `|`}, ['GristHidden_import']))
    .then(() => assertDocTables(activeDoc, ['GristHidden_import']))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    // Ensure that rules wasn't applied because schema was changed
    // (reimpored table has only one column, rules have information about three columns)
    .then(tableData => assert.deepEqual(tableData, expectedPipeSeparatedData))
    // Cancel import.
    .then(() => activeDoc.cancelImportFiles(
      fakeSession, dataSourceTransformed.uploadId, ["GristHidden_import"])
    );
  });

  it("should apply transform rules and finish import files into new table", function() {
    let activeDoc;
    let dataSource;
    let dataSourceTransformed;
    return docTools.createDoc('temp(8)').then(adoc => { activeDoc = adoc; })
    .then(() => createDataSource(activeDoc, csvPath))
    .then(dataSrc => {
      dataSource = dataSrc;
      dataSourceTransformed = dataSrc;
      dataSourceTransformed.transforms[0] = {'': {
        destTableId: null,
        destCols: [
            {label: 'fname',      colId: null, type: 'Text', formula: '$fname.capitalize()'},
            {label: 'lname',      colId: null, type: 'Text', formula: '$lname.capitalize()'},
            {label: 'start_year', colId: null, type: 'Int', formula: '$start_year'},
            {label: 'end_year',   colId: null, type: 'Int', formula: '$end_year'}],
        sourceCols: ['fname', 'lname', 'start_year', 'end_year']
      }};
    })
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))
    // Re-import using transform rules
    .then(() => activeDoc.finishImportFiles(fakeSession, dataSourceTransformed, ['GristHidden_import'], ''))
    // checking that reimported table contains correct data, now applied rules.
    .then(() => assertDocTables(activeDoc, ['FileUploadData']))
    .then(() => activeDoc.fetchTable(docSession, 'FileUploadData'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedFinalTransformedData));
  });

  it("should apply transform rules and finish import files into existing table", function() {
    let activeDoc;
    let dataSource;
    let dataSourceTransformed;
    return docTools.createDoc('temp(9)').then(adoc => { activeDoc = adoc; })
    // import destination table first
    .then(() => createDataSource(activeDoc, csvPath1))
    .then(ds => activeDoc.finishImportFiles(fakeSession, ds, [], {}))
    .then(() => assertDocTables(activeDoc, ['UploadedData1']))
    .then(() => activeDoc.fetchTable(docSession, 'UploadedData1'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedDestinationData))
    .then(() => createDataSource(activeDoc, csvPath))
    .then(dataSrc => {
      dataSource = dataSrc;
      dataSourceTransformed = dataSrc;
      dataSourceTransformed.transforms[0] = {'': {
        destTableId: 'UploadedData1',
        destCols: [{label: 'Name',  colId: 'gristHelper_Import_Name',  type: 'Text', formula: '$fname.capitalize()'},
                   {label: 'Phone', colId: 'gristHelper_Import_Phone', type: 'Text', formula: '$lname.capitalize()'},
                   {label: 'Title', colId: 'gristHelper_Import_Title', type: 'Text', formula: ''}],
        sourceCols: ['fname', 'lname', 'start_year', 'end_year']
      }};
    })
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))
    // Re-import using transform rules
    .then(() => activeDoc.finishImportFiles(fakeSession, dataSourceTransformed, ['GristHidden_import'], ''))
    // checking that updated table contains correct data, now with new data.
    .then(() => assertDocTables(activeDoc, ['UploadedData1']))
    .then(() => activeDoc.fetchTable(docSession, 'UploadedData1'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedFinalDestinationData));
  });

  it("should apply merge options and update existing records in destination table", function() {
    let activeDoc;
    let dataSource;
    let dataSourceTransformed;
    return docTools.createDoc('temp(10)').then(adoc => { activeDoc = adoc; })
    // Import destination table first.
    .then(() => createDataSource(activeDoc, csvPath2))
    .then(ds => activeDoc.finishImportFiles(fakeSession, ds, [], {}))
    .then(() => assertDocTables(activeDoc, ['UploadedData2']))
    .then(() => activeDoc.fetchTable(docSession, 'UploadedData2'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedDestinationData2))
    .then(() => createDataSource(activeDoc, extendedCsvPath2))
    .then(dataSrc => {
      dataSource = dataSrc;
      dataSourceTransformed = dataSrc;
      dataSourceTransformed.transforms[0] = {'': {
        destTableId: 'UploadedData2',
        destCols: [{label: 'CourseId', colId: 'gristHelper_Import_CourseId',  type: 'Text', formula: '$CourseId'},
                   {label: 'CourseName', colId: 'gristHelper_Import_CourseName', type: 'Text', formula: '$CourseName'},
                   {label: 'Instructor', colId: 'gristHelper_Import_Instructor', type: 'Text', formula: '$Instructor'},
                   {label: 'StartDate', colId: 'gristHelper_Import_StartDate', type: 'Date', formula: '$StartDate'},
                   {label: 'PassFail', colId: 'gristHelper_Import_PassFail', type: 'Bool', formula: '$PassFail'}],
        sourceCols: ['CourseId', 'CourseName', 'Instructor', 'StartDate', 'PassFail']
      }};
    })
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))
    // Import from extended version of file, matching on CourseId.
    .then(() => activeDoc.finishImportFiles(fakeSession, dataSourceTransformed, ['GristHidden_import'], {
      mergeOptionMaps: [
        {'': {mergeCols: ['gristHelper_Import_CourseId'], mergeStrategy: {type: 'replace-with-nonblank-source'}}}
      ]
    }))
    // Check that records in UploadedData2 were updated correctly.
    .then(() => assertDocTables(activeDoc, ['UploadedData2']))
    .then(() => activeDoc.fetchTable(docSession, 'UploadedData2'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedFinalDestinationData2));
  });

  it("should include column names as headers and back using parse option (headers were guessed initially)", function() {
    let activeDoc;
    let dataSource;
    return docTools.createDoc('dummy(10)')
    .then(adoc => { activeDoc = adoc; })
    .then(() => createDataSource(activeDoc, csvPath))
    .then(dataSrc => dataSource = dataSrc)
    // default flow, ensure that headers were guessed and used
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedCommaSeparatedData))
    // ensure that after unchecking option 'include_col_names_as_headers' column names became part of the table data
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {"include_col_names_as_headers": false},
                                      ['GristHidden_import']))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedCommaSeparatedNoHeadersData))
    // ensure that after checking option 'include_col_names_as_headers' column names were used as headers again
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {"include_col_names_as_headers": true},
                                      ['GristHidden_import']))
    .then(tableInfo => assert.deepEqual(tableInfo.options.include_col_names_as_headers, true))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedCommaSeparatedData));
  });

  it("should include column names as headers and back using parse option (headers weren't guessed initially)", function() {
    let activeDoc;
    let dataSource;
    return docTools.createDoc('dummy(10)')
    .then(adoc => { activeDoc = adoc; })
    .then(() => createDataSource(activeDoc, csvPath3))
    .then(dataSrc => dataSource = dataSrc)
    // default flow, ensure that headers weren't guessed
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))
    .then(tableInfo => assert.deepEqual(tableInfo.options.include_col_names_as_headers, false))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedNoHeadersData))
    // ensure that after checking option 'include_col_names_as_headers' column names were used as headers
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {"include_col_names_as_headers": true},
                                      ['GristHidden_import']))
    .then(tableInfo => assert.deepEqual(tableInfo.options.include_col_names_as_headers, true))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedHeadersFromFirstRowData))
    // ensure that after unchecking option 'include_col_names_as_headers' column names became part of the table data
    .then(() => activeDoc.importFiles(fakeSession, dataSource, {"include_col_names_as_headers": false},
                                      ['GristHidden_import']))
    .then(tableInfo => assert.deepEqual(tableInfo.options.include_col_names_as_headers, false))
    .then(() => activeDoc.fetchTable(docSession, 'GristHidden_import'))
    .then(result => result.tableData)
    .then(tableData => assert.deepEqual(tableData, expectedNoHeadersData));
  });

  // returns an object that map original table ids to fixed ids.
  function getFixedTableIdMap(tables) {
    return _(tables).keyBy('origTableName').mapValues("hiddenTableId").value();
  }

  it("should fix references", function() {
    let activeDoc;
    return docTools.createDoc('').then(adoc => {activeDoc = adoc;})
    .then(() => createDataSource(activeDoc, jsonPathWithDirtyTableName))
    .then(dataSource => activeDoc.finishImportFiles(fakeSession, dataSource, [], {}))
    .then(result => {
      const fixedTableId = getFixedTableIdMap(result.tables);
      const tables = activeDoc.docData.getTables();
      let table;

      table = tables.get(fixedTableId.dirtyNames);
      assert.equal(table.getColType("dirty_name_"), 'Ref:DirtyNames__dirty_name_');

      table = tables.get(fixedTableId["dirtyNames_**dirty_name**"]);
      assert.equal(table.getColType("a"), 'Ref:DirtyNames__dirty_name__a');
    });
  });

  it("should fix references as well in hidden tables", function() {
    let activeDoc;
    return docTools.createDoc('').then(adoc => {activeDoc = adoc;})
    .then(() => createDataSource(activeDoc, jsonPathWithDirtyTableName))
    .then(dataSource => activeDoc.importFiles(fakeSession, dataSource, {}, []))
    .then(result => {
      const fixedTableId = getFixedTableIdMap(result.tables);
      const tables = activeDoc.docData.getTables();
      let table;

      table = tables.get(fixedTableId.dirtyNames);
      assert.equal(table.getColType("dirty_name_"), 'Ref:' + fixedTableId['dirtyNames_**dirty_name**']);
      assert.equal(table.getColType("gristHelper_Import_dirty_name_"), 'Ref:' + fixedTableId['dirtyNames_**dirty_name**']);

      table = tables.get(fixedTableId["dirtyNames_**dirty_name**"]);
      assert.equal(table.getColType("a"), 'Ref:' + fixedTableId['dirtyNames_**dirty_name**_a']);
      assert.equal(table.getColType("gristHelper_Import_a"), 'Ref:' + fixedTableId['dirtyNames_**dirty_name**_a']);
    });
  });


  it("should allow empty data", function() {
    let activeDoc;
    return docTools.createDoc('').then(adoc => {activeDoc = adoc;})
    .then(() => createDataSource(activeDoc, emptyData))
    .then(dataSource => assert.isFulfilled(activeDoc.importFiles(fakeSession, dataSource, {}, [])));
  });

  describe("parsing", function() {
    const docTools = createDocTools({persistAcrossCases: true});
    let activeDoc, tmpDir;

    before(function() {
      return docTools.createDoc('temp-parsing').then(adoc => { activeDoc = adoc; })
      .then(() => activeDoc.docPluginManager.tmpDir()).then(t => { tmpDir = t; });
    });

    // Returns absPath suitable for parsing (moved to the pluginManager's tmpDir.
    function parseFile(path, origName=null) {
      return createDataSource(activeDoc, path)
      .then(dataSource => {
        const upload = globalUploadSet.getUploadInfo(dataSource.uploadId, null);
        return moveUpload(upload, tmpDir)
        .then(() => upload.files[0]);
      })
      .then(file => activeDoc.docPluginManager.parseFile(file.absPath, origName || file.origName, {}));
    }

    it("should parse csv imports", function() {
      return parseFile(csvPath)
        .then(result => {
          const tables = result.tables;
          assert.deepEqual(tables.map(t => t.table_name), [null]);
          assert.deepEqual(tables[0].column_metadata.map(c => c.id),
            ["fname", "lname", "start_year", "end_year"]);
          // The Python CSV parsing doesn't parse numbers to strings, that happens later.
          assert.deepEqual(tables[0].table_data[2],
            ["1789", "1797", "1801"]);
        });
    });

    it("should parse xlsx imports", function() {
      return parseFile(xlsxPath)
        .then(result => {
          const tables = result.tables;
          assert.deepEqual(tables.map(t => t.table_name),
            ["Homicide counts and rates (2000", "Sheet1"]);
          assert.deepEqual(tables[0].column_metadata.map(c => c.id),
            ['Region', 'Sub Region', 'Country/ Territory', 'Source', 'Indicator', "'00",
              "'01", "'02", "'03", "'04", "'05", "'06", "'07", "'08", "'09", "'10", "'11",
              "'12", "'13"]);
          assert.deepEqual(tables[1].column_metadata.map(c => c.id), ["Name", "Value"]);
          assert.deepEqual(tables[1].table_data, [["Test of xlsx"], [-1.2]]);
        });
    });

    it("should parse jgrist imports", function() {
      return parseFile(jgristPath)
        .then(result => {
          const tables = result.tables;
          assert.deepEqual(tables.map(t => t.table_name), ["city"]);
          assert.deepEqual(tables[0].column_metadata.map(c => c.id),
            ["id", "city"]);
          assert.deepEqual(tables[0].table_data[1],
            ["Berlin", "Tokyo"]);
        });
    });

    it("should reject broken jgrist imports", function() {
      return assert.isRejected(parseFile(jgristBrokenPath),
        /Grist json format could not be parsed.*not a GristTable/);
    });

    it("should parse a simple json array", function() {
      return parseFile(simpleArrayJsonPath)
        .then(result => {
          const tables = result.tables;
          assert.deepEqual(tables[0], {
            table_name: 'simple_array',
            column_metadata: [{id: "a", type: "Numeric"}, {id: "b", type: "Text"}],
            table_data: [[1, 4], ["baba", "abab"]]
          });
        });
    });

    it("should parse a more complex json file", function() {
      return parseFile(moreComplexJsonPath, "my_spotify.json")
        .then(result => {
          const tables = result.tables;
          assert.deepEqual(tables.map(t => t.table_name).sort(), [
            'my_spotify',
            'my_spotify_albums',
            'my_spotify_albums_artists',
            'my_spotify_albums_artists_external_urls',
            'my_spotify_albums_available_markets',
            'my_spotify_albums_external_ids',
            'my_spotify_albums_copyrights',
            'my_spotify_albums_external_urls',
            'my_spotify_albums_images',
            'my_spotify_albums_tracks',
            'my_spotify_albums_tracks_items',
            'my_spotify_albums_tracks_items_artists', // todo: user should be able to merge this table into 'albums_artists'
            'my_spotify_albums_tracks_items_artists_external_urls',
            'my_spotify_albums_tracks_items_available_markets',
            'my_spotify_albums_tracks_items_external_urls'].sort());
        });
    });

    it("should parse a xlsx file with boolean data", function() {
      return parseFile(booleanData).then(result => {
        const tables = result.tables;
        assert.deepEqual(tables.map(t => t.table_name), ["Book1"]);
        assert.deepEqual(tables[0].column_metadata.map(c => c.id),
                         ['']);
        assert.deepEqual(tables[0].table_data, [[5, 5, 1]]);
      });
    });

    it("should preserve original column headers when importing a csv file", function() {
      return parseFile(csvPathWithUnicodeHeaders)
        .then(result => {
          const tables = result.tables;
          assert.deepEqual(
            tables[0].column_metadata.map(c => c.id),
            [
              'Բարեւ աշխարհ',
              'Γειά σου Κόσμε',
              '123 test',
              'สวัสดีชาวโลก',
              'こんにちは世界',
              'नमस्ते दुनिया',
              'გამარჯობა მსოფლიო',
              '你好世界',
              '% test',
            ]
          );
        });
    });

    it("should preserve original column headers when importing a xlsx file", function() {
      return parseFile(xlsxPathWithUnicodeHeaders)
        .then(result => {
          const tables = result.tables;
          assert.deepEqual(tables[0].column_metadata.map(c => c.id),
            [
              '% test',
              '你好世界',
              'გამარჯობა მსოფლიო',
              'नमस्ते दुनिया',
              'Բարեւ աշխարհ',
              'Γειά σου Κόσμε',
              '123 test',
              'สวัสดีชาวโลก',
              'こんにちは世界',
            ]
          );
        });
    });

    it("should reject empty Excel files with a clear message", function() {
      return assert.isRejected(parseFile(xlsxEmpty),
        /No tables found \(1 empty tables skipped\)/);
    });

    it("should add document timezone to DateTime columns when importing xlsx files", async function() {
      const activeDoc = await docTools.createDoc('temp(11)');
      await activeDoc.applyUserActions(fakeSession, [['UpdateRecord', '_grist_DocInfo', 1, {
        timezone: 'America/New_York',
      }]]);
      const dataSource = await createDataSource(activeDoc, dateTimeData);
      await activeDoc.importFiles(fakeSession, dataSource, {}, []);
      const metaTables = await activeDoc.fetchMetaTables(docSession);
      const columns = metaTables['_grist_Tables_column'][3];
      assert.deepEqual(columns.colId, [
        'manualSort',
        'A',
        'gristHelper_Import_A',
      ]);
      assert.deepEqual(columns.type, [
        'ManualSortPos',
        'DateTime:America/New_York',
        'DateTime:America/New_York',
      ]);
      await activeDoc.finishImportFiles(fakeSession, dataSource, [], {})
      const result = await activeDoc.fetchTable(docSession, 'Sheet1')
      const tableData = result.tableData;
      assert.deepEqual(tableData[3], {
        A: [
          1041487323,
          1041573723,
          1041660123,
        ],
        manualSort: [1, 2, 3],
      });
    });
  });

  describe("generateImportDiff", function() {
    it("should return comparison data containing the table delta pre-merge", function() {
      let activeDoc;
      let transformRule;
      let dataSource;
      let dataSourceTransformed;
      return docTools.createDoc('temp(12)').then(adoc => { activeDoc = adoc; })
      // Import destination table first.
      .then(() => createDataSource(activeDoc, csvPath2))
      .then(ds => activeDoc.finishImportFiles(fakeSession, ds, [], {}))
      .then(() => assertDocTables(activeDoc, ['UploadedData2']))
      .then(() => activeDoc.fetchTable(docSession, 'UploadedData2'))
      .then(result => result.tableData)
      .then(tableData => assert.deepEqual(tableData, expectedDestinationData2))
      .then(() => createDataSource(activeDoc, extendedCsvPath2))
      .then(dataSrc => {
        dataSource = dataSrc;
        dataSourceTransformed = dataSrc;
        transformRule = {
          destTableId: 'UploadedData2',
          destCols: [{label: 'CourseId', colId: 'gristHelper_Import_CourseId',  type: 'Text', formula: '$CourseId'},
                     {label: 'CourseName', colId: 'gristHelper_Import_CourseName', type: 'Text', formula: '$CourseName'},
                     {label: 'Instructor', colId: 'gristHelper_Import_Instructor', type: 'Text', formula: '$Instructor'},
                     {label: 'StartDate', colId: 'gristHelper_Import_StartDate', type: 'Date', formula: '$StartDate'},
                     {label: 'PassFail', colId: 'gristHelper_Import_PassFail', type: 'Bool', formula: '$PassFail'}],
          sourceCols: ['CourseId', 'CourseName', 'Instructor', 'StartDate', 'PassFail']
        };
        dataSourceTransformed.transforms[0] = {'': transformRule};
      })
      .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))
      // Generate a diff of importing with merge column set to CourseId.
      .then(() => activeDoc.generateImportDiff(fakeSession, 'GristHidden_import', transformRule, {
        mergeCols: ['gristHelper_Import_CourseId'], mergeStrategy: {type: 'replace-with-nonblank-source'}
      }))
      // Check that the returned comparison data is correct.
      .then(comparison => assert.deepEqual(comparison, expectedComparisonData));
    });

    it("should respect transform rule formulas when generating comparison data", function() {
      let activeDoc;
      let transformRule;
      let dataSource;
      let dataSourceTransformed;
      return docTools.createDoc('temp(13)').then(adoc => { activeDoc = adoc; })
      // Import destination table first.
      .then(() => createDataSource(activeDoc, csvPath2))
      .then(ds => activeDoc.finishImportFiles(fakeSession, ds, [], {}))
      .then(() => assertDocTables(activeDoc, ['UploadedData2']))
      .then(() => activeDoc.fetchTable(docSession, 'UploadedData2'))
      .then(result => result.tableData)
      .then(tableData => assert.deepEqual(tableData, expectedDestinationData2))
      .then(() => createDataSource(activeDoc, extendedCsvPath2))
      .then(dataSrc => {
        dataSource = dataSrc;
        dataSourceTransformed = dataSrc;
        transformRule = {
          destTableId: 'UploadedData2',
          destCols: [{label: 'CourseId', colId: 'gristHelper_Import_CourseId',  type: 'Text', formula: '$CourseId'},
                     {label: 'CourseName', colId: 'gristHelper_Import_CourseName', type: 'Text', formula: '$CourseName.upper()'},
                     {label: 'Instructor', colId: 'gristHelper_Import_Instructor', type: 'Text', formula: '$Instructor.lower()'},
                     {label: 'StartDate', colId: 'gristHelper_Import_StartDate', type: 'Date', formula: '$StartDate'},
                     {label: 'PassFail', colId: 'gristHelper_Import_PassFail', type: 'Bool', formula: '$PassFail'}],
          sourceCols: ['CourseId', 'CourseName', 'Instructor', 'StartDate', 'PassFail']
        };
        dataSourceTransformed.transforms[0] = {'': transformRule};
      })
      .then(() => activeDoc.importFiles(fakeSession, dataSource, {}, []))
      // Generate a diff of importing with merge column set to CourseId.
      .then(() => activeDoc.generateImportDiff(fakeSession, 'GristHidden_import', transformRule, {
        mergeCols: ['gristHelper_Import_CourseId'], mergeStrategy: {type: 'replace-with-nonblank-source'}
      }))
      // Check that the returned comparison data is correct.
      .then(comparison => assert.deepEqual(comparison, expectedComparisonData2));
    });
  });
});
