const assert  = require('chai').assert;
const child_process = require('child_process');
const fs      = require('fs');
const tmp     = require('tmp');

const Promise = require('bluebird');
Promise.promisifyAll(child_process);
Promise.promisifyAll(fs);
Promise.promisifyAll(tmp);

const {ActionHistoryImpl} = require('app/server/lib/ActionHistoryImpl');
const {DocStorage}        = require('app/server/lib/DocStorage');
const docUtils            = require('app/server/lib/docUtils');
const marshal             = require('app/common/marshal');
const {createDocTools}    = require('test/server/docTools');
const testUtils           = require('test/server/testUtils');

tmp.setGracefulCleanup();

describe('DocStorage', function() {

  var docStorageManager;

  // Turn off debug logging for this test, and restore afterwards.
  testUtils.setTmpLogLevel('warn');

  const docTools = createDocTools();


  // Set Grist home to a temporary directory for each test.
  before(function() {
    docStorageManager = docTools.getStorageManager();
  });

  describe('.createFile', function() {

    it("Should create a new db if one doesn't exist", function() {
      var docStorage = new DocStorage(docStorageManager, 'create-file-new');
      return docStorage.createFile()
      // Check that the sqlite db was created on disk.
      .then(() => docUtils.pathExists(docStorageManager.getPath('create-file-new')))
      .then(exists => assert.isTrue(exists))
      .then(() => docStorage.shutdown())

      // Check that opening it again works, except that the table has no metadata
      .then(() => testUtils.expectRejection(docStorage.openFile(), 'NO_METADATA_ERROR'))
      .then(() => docStorage.shutdown())

      // Check that attempting to create it again causes an error.
      .then(() => testUtils.expectRejection(docStorage.createFile(), 'EEXISTS'));
    });

    it("Should fail if asked to open a non-existent db", function() {
      var docStorage = new DocStorage(docStorageManager, 'open-fail');
      return testUtils.expectRejection(docStorage.openFile(), 'SQLITE_CANTOPEN');
    });

    it('should allow writing right after createFile', function() {
      let bar_rw = new DocStorage(docStorageManager, 'bar_rw');
      return bar_rw.createFile()
      .then(() => fs.accessAsync(docStorageManager.getPath('bar_rw'), fs.R_OK | fs.W_OK))
      .then(() => bar_rw.execTransaction(db => db.exec("CREATE TABLE 'test' ('test' TEXT)")))
      .then(() => bar_rw.shutdown());
    });

  });

  describe('.openFile', function() {
    // Read all tables in DocStorage, just to run some read-only queries.
    async function fetchAllTables(docStorage) {
      const tableNames = await docStorage.getAllTableNames();
      return Promise.all(tableNames.map(t => docStorage.fetchTable(t)));
    }

    it('should allow reading without modifying mtime', function() {
      let doc, docName;
      let pastTime = new Date('2016/1/1');

      return testUtils.useFixtureDoc('Hello.grist', docStorageManager)
      .then(_docName => docName = _docName)
      // On Windows, utimes() is strangely unreliable but works when stat() is called first.
      .then(() => fs.statAsync(docStorageManager.getPath(docName)))
      .then(() => fs.utimesAsync(docStorageManager.getPath(docName), pastTime, pastTime))
      .then(() => {
        doc = new DocStorage(docStorageManager, docName);
        return doc.openFile();
      })
      .then(() => fetchAllTables(doc))  // Should not touch mtime, even after shutdown.
      .then(() => doc.shutdown())
      .then(() => fs.statAsync(docStorageManager.getPath(docName)))
      .then(stats => {
        assert.equal(pastTime.getTime(), stats.mtime.getTime());
      })
      // Try again, but this time actually make a change.
      .then(() => doc.openFile())
      .then(() => doc.applyStoredActions([['UpdateRecord', 'Table1', 2, {A: 'poke!'}]]))
      .then(() => fs.statAsync(docStorageManager.getPath(docName)))
      .then(stats => {
        assert.isBelow(pastTime.getTime(), stats.mtime.getTime());
      })
      .finally(() => doc.shutdown());
    });

    it('should allow reading but not writing a read-only file', function() {
      let doc, docName;
      let pastTime = new Date('2016/1/1');

      return testUtils.useFixtureDoc('Hello.grist', docStorageManager)
      .then(_docName => docName = _docName)
      // On Windows, utimes() is strangely unreliable but works when stat() is called first.
      .then(() => fs.statAsync(docStorageManager.getPath(docName)))
      .then(() => fs.utimesAsync(docStorageManager.getPath(docName), pastTime, pastTime))
      .then(() => fs.chmodAsync(docStorageManager.getPath(docName), 0o400))
      .then(() => {
        doc = new DocStorage(docStorageManager, docName);
        return doc.openFile();
      })
      .then(() => fetchAllTables(doc)) // Should not touch mtime
      .then(() => testUtils.expectRejection(
        doc.execTransaction(db => db.exec("CREATE TABLE 'test' ('test' TEXT)")),
        'SQLITE_READONLY'))
      .then(() => fs.statAsync(docStorageManager.getPath(docName)))
      .then(stats => {
        assert.equal(pastTime.getTime(), stats.mtime.getTime());
      })
      .finally(() => doc.shutdown());
    });

    it('should allow writing', function() {
      let doc, docName;
      let pastTime = new Date('2016/1/1');

      return testUtils.useFixtureDoc('Hello.grist', docStorageManager)
      .then(_docName => docName = _docName)
      // On Windows, utimes() is strangely unreliable but works when stat() is called first.
      .then(() => fs.statAsync(docStorageManager.getPath(docName)))
      .then(() => fs.utimesAsync(docStorageManager.getPath(docName), pastTime, pastTime))
      .then(() => {
        doc = new DocStorage(docStorageManager, docName);
        return doc.openFile();
      })
      // Should touch mtime
      .then(() => doc.execTransaction(db => db.exec("CREATE TABLE 'test' ('test' TEXT)")))
      .then(() => fs.statAsync(docStorageManager.getPath(docName)))
      .then(stats => {
        assert.isBelow(pastTime.getTime(), stats.mtime.getTime());
      })
      .finally(() => doc.shutdown());
    });

  });

  describe('.execTransaction', function() {
    function assertTableList(doc, tables) {
      return doc.all("SELECT name FROM sqlite_master WHERE type='table' " +
        "AND name NOT LIKE '_gristsys_%'")
      .then(rows => assert.deepEqual(rows.map(r => r.name), tables));
    }

    it("should run callback inside a transaction", function() {
      var docStorage = new DocStorage(docStorageManager, 'exec-txn');
      return docStorage.createFile()
      .then(() => {
        // Simple case: just run a statement that should succeed.
        return docStorage.execTransaction(db => db.exec("CREATE TABLE 'Bar1' ('foo' TEXT)"))
        // Ensure that the Bar table exists (so the sql statement succeeded).
        .then(() => assertTableList(docStorage, ['Bar1']));
      })
      .then(() => {
        // Now try running one statement that should succeed, and then failing inside the
        // transaction; it should be rolled back along with the first statement.
        return docStorage.execTransaction((db) => {
          return db.exec("CREATE TABLE 'Bar2' ('foo' TEXT)")
          .then(() => { throw new Error("Fake error to test rollback"); });
        })
        .then(
          () => assert(false, "Transaction should have failed"),
          (err) => assert.match(err.message, /Fake error to test rollback/)
        )
        // Ensure that the Bar2 table does NOT exist (so the transaction got rolled back).
        .then(() => assertTableList(docStorage, ['Bar1']));
      });
    });

    it("should serialize execTransaction calls", function() {
      var docStorage = new DocStorage(docStorageManager, 'exec-serial');
      return docStorage.createFile()
      .then(() => assertTableList(docStorage, []))    // Make sure there are no tables initially.
      .then(() => {
        // Start several transactions simultaneously, including failing ones; subsequent
        // transaction must see the effects of previous ones, and should not be affected by
        // previous failures.
        return Promise.all([
          docStorage.execTransaction(db => db.exec("CREATE TABLE 'Bar1' ('foo' TEXT)")),
          docStorage.execTransaction(db => assertTableList(docStorage, ['Bar1'])),
          docStorage.execTransaction(db => db.exec("CREATE TABLE 'Bar1' ('foo' TEXT)"))
          .then(
            () => assert(false, "Transaction should have failed"),
            (err) => assert.match(err.message, /SQLITE_ERROR.*Bar1.*already exists/)
          ),
          docStorage.execTransaction(db => assertTableList(docStorage, ['Bar1'])),
          docStorage.execTransaction(db => db.exec("CREATE TABLE 'Bar2' ('foo' TEXT)")),
          docStorage.execTransaction(db => assertTableList(docStorage, ['Bar1', 'Bar2']))
        ]);
      });
    });
  });

  /** We save some statements for the beginnings of tables to simplify tests*/
  var barSql = [
        ["AddTable", "Bar", [
          { 'id': 'fname', 'label': 'fname', 'type': 'Text', 'isFormula': false },
          { 'id': 'lname', 'label': 'lname', 'type': 'Text', 'isFormula': false }
        ]] ];

  var fruitSql = [
        ["AddTable", "Fruits", [
          { 'id': 'name',   'label': 'name', 'type': 'Text', 'isFormula': false },
          { 'id': 'yummy',  'label': 'yummy', 'type': 'Int', 'isFormula': false }
        ]],
        ["AddRecord", "Fruits", 1, { 'name': 'Apple',      'yummy': 2 }],
        ["AddRecord", "Fruits", 2, { 'name': 'Clementine', 'yummy': 8 }] ];

  var peopleSqlSmall = [
         ["AddTable", "People", [
           { 'id': 'fname', 'label': 'fname', 'type': 'Text', 'isFormula': false },
           { 'id': 'lname', 'label': 'lname', 'type': 'Text', 'isFormula': false }
         ]],
         ["AddRecord", "People", 1, { 'fname': 'George', 'lname': 'Washington'}],
         ["AddRecord", "People", 2, { 'fname' : 'George', 'lname': 'Bush' }],
         ["AddRecord", "People", 3, { 'fname' : 'Ephraim', 'lname' : 'Williams' }] ];

  var peopleSql = [
        ["AddTable", "People", [
          { 'id': 'name', 'label': 'name', 'type': 'Text', 'isFormula': false},
          { 'id': 'age',  'label': 'age', 'type': 'Int',  'isFormula': false}
        ]],
        ["AddTable", "_grist_Tables", [
          { 'id' : 'tableId', 'type': 'Text', 'isFormula': false }]],
        ["AddTable", "_grist_Tables_column", [
          { 'id' : 'colId', 'isFormula' : false, 'type' : 'Text' },
          { 'id' : 'isFormula', 'isFormula' : false, 'type': 'Bool' },
          { 'id' : 'parentId',  'isFormula' : false, 'type': 'Int'},
          { 'id' : 'type',      'isFormula' : false, 'type': 'Text'}]],
        ["AddRecord", "_grist_Tables", 1, { 'tableId' : 'People' }],
        ["AddRecord", "_grist_Tables_column", 1,
          { 'colId' : 'name', 'parentId' : 1, 'isFormula' : false, 'type' : 'Text'}],
        ["AddRecord", "_grist_Tables_column", 2,
          { 'colId' : 'age', 'parentId' : 1, 'isFormula' : false, 'type' : 'Int'}],
        ["AddRecord", "People", 1, { 'name': 'Alice', 'age': 12 }],
        ["AddRecord", "People", 2, { 'name': 'Bob',   'age': 13 }] ];


  describe('.AddTable', function() {

    it("Should create a table in sqlite", function() {
      var docStorage = new DocStorage(docStorageManager, 'add-table-create');

      var checkQuery = "SELECT name FROM sqlite_master " +
                       "WHERE type='table' AND name='Bar'";

      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(barSql);
      })
      .then(function() {
        return docStorage.all(checkQuery);
      })
      .then(function(rows) {
          assert.deepEqual(rows, [{ 'name': 'Bar' }]);
      });
    });

    it("Should error if creating a duplicate table", function() {
      var docStorage = new DocStorage(docStorageManager, 'add-table-dup');
      return docStorage.createFile()
      .then(function() {
        return testUtils.expectRejection(docStorage.applyStoredActions(barSql.concat(barSql)),
            'SQLITE_ERROR', /Bar.*already exists/);
      });
    });

  });

  describe('.AddRecord', function() {

    it("Should add record to a table", function() {
      var addRecordAction = barSql.concat([
        [ "AddRecord", "Bar", 1, { 'fname': 'George', 'lname': 'Washington' } ],
        [ "AddRecord", "Bar", 2, { 'fname': 'John', 'lname': 'Adams' } ],
        [ "AddRecord", "Bar", 3, { 'fname': 'Thomas', 'lname': 'Jefferson' } ]
      ]);

      var checkQuery = "SELECT fname, lname FROM Bar";

      var docStorage = new DocStorage(docStorageManager, 'add-rec');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(addRecordAction);
      })
      .then(function() {
        return docStorage.all(checkQuery);
      })
      .then(function(rows) {
        assert.deepEqual(rows, [
          { 'fname': 'George', 'lname': 'Washington' },
          { 'fname': 'John',   'lname': 'Adams' },
          { 'fname': 'Thomas', 'lname': 'Jefferson' }
        ]);
      });
    });
  });

  describe('.BulkAddRecord', function() {

    it("Should add multiple records to a table", function() {
      var bulkAddRecordAction = barSql.concat([
        [ "BulkAddRecord", "bar", [1, 2, 3], {
          'fname': ['George', 'John', 'Thomas'],
          'lname': ['Washington', 'Adams', 'Jefferson']
        }],
        [ "BulkAddRecord", "bar", [4, 5], {
          'fname': ['James', 'James'],
          'lname': ['Madison', 'Monroe']
        }]
      ]);

      var checkQuery = "SELECT fname, lname FROM Bar";

      var docStorage = new DocStorage(docStorageManager, 'bulk-add-rec');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(bulkAddRecordAction);
      })
      .then(function() {
        return docStorage.all(checkQuery);
      })
      .then(function(rows) {
        assert.deepEqual(rows, [
          { 'fname': 'George', 'lname': 'Washington' },
          { 'fname': 'John',   'lname': 'Adams' },
          { 'fname': 'Thomas', 'lname': 'Jefferson' },
          { 'fname': 'James',  'lname': 'Madison' },
          { 'fname': 'James',  'lname': 'Monroe' }
        ]);
      });
    });

  });

  describe('.fetchTable', function() {
    var expectedData = {
      "id": [1, 2],
      "fname": ["pen", "book"],
      "lname": ["17", "5"]
    };

    it("Should return same data as was stored into the table", function() {
      var docStorage = new DocStorage(docStorageManager, 'fetch-table-same');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(barSql.concat([
          ["AddRecord", "Bar", 1, { 'fname': 'pen', 'lname': '17' }],
          ["AddRecord", "Bar", 2, { 'fname': 'book', 'lname': '5' }]
        ]));
      })
      .then(function() {
        return docStorage.fetchTable('Bar');
      })
      .then(function(tableData) {
        assert.deepEqual(marshal.loads(tableData), expectedData);
        return docStorage.shutdown();
      })
      .then(function() {
        // Check also that a new DocStorage object for the same DB will return the same data.
        docStorage = new DocStorage(docStorageManager, 'fetch-table-same');
        return testUtils.expectRejection(docStorage.openFile(), "NO_METADATA_ERROR");
      })
      .then(function() {
        return docStorage.fetchTable('Bar');
      })
      .then(function(tableData) {
        assert.deepEqual(marshal.loads(tableData), expectedData);
      });
    });
  });

  describe('attachFileIfNew', function() {
    var docStorage;
    it("should create attachment blob", function() {
      docStorage = new DocStorage(docStorageManager, 'test_Attachments');
      const correctFileContents = "Hello, world!"
      const replacementFileContents = "Another file"
      return docStorage.createFile()
      .then(() => docStorage.attachFileIfNew( "hello_world.txt", Buffer.from(correctFileContents)))
      .then(result => assert.isTrue(result))
      .then(() => docStorage.getFileInfo("hello_world.txt"))
      .then(fileInfo => assert.equal(fileInfo.data.toString('utf8'), correctFileContents))

      // If we use the same fileIdent for another file, it should not get attached.
      .then(() => docStorage.attachFileIfNew("hello_world.txt", Buffer.from(replacementFileContents)))
      .then(result => assert.isFalse(result))
      .then(() => docStorage.getFileInfo("hello_world.txt"))
      .then(fileInfo => assert.equal(fileInfo.data.toString('utf8'), correctFileContents))

      // The update parameter should allow the record to be overwritten
      .then(() => docStorage.attachOrUpdateFile("hello_world.txt", Buffer.from(replacementFileContents), undefined))
      .then(result => assert.isFalse(result))
      .then(() => docStorage.getFileInfo("hello_world.txt"))
      .then(fileInfo => assert.equal(fileInfo.data.toString('utf8'), replacementFileContents));
    });
  });

  describe('.UpdateRecord', function() {

    it("Should update normal (non-formula) columns", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_UpdateRecord');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(fruitSql);
      })
      .then(function() {
        return docStorage.applyStoredActions([
          ["UpdateRecord", 'Fruits', 1, { 'name': 'red apple', 'yummy': 0 }],
          ["UpdateRecord", 'Fruits', 2, { 'yummy': 8 }],
          ["UpdateRecord", 'Fruits', 1, { 'name': 'green apple' }]
        ]);
      })
      .then(function() {
        return docStorage.all("SELECT name, yummy FROM Fruits");
      })
      .then(function(rows) {
        assert.deepEqual(rows, [
          { 'name': 'green apple', 'yummy': 0 },
          { 'name': 'Clementine',      'yummy': 8 }
        ]);
      });
    });

  });

  describe('.RemoveRecord', function() {

    it("Should remove an existent record", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_RemoveRecord');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(peopleSqlSmall.concat([
          ["RemoveRecord", "People", 2]
        ]));
      }).then(function() {
        return docStorage.all("SELECT * FROM People");
      }).then(function(rows) {
        assert.deepEqual(rows, [
          { 'id' : 1, 'fname': 'George', 'lname': 'Washington' },
          { 'id' : 3, 'fname': 'Ephraim', 'lname': 'Williams' }
        ]);
      });
    });

    // TODO: Do we want to throw errors when removing a nonexistant column?
    // Indeed, when and how should we present SQL errors to the user?
    /*it("Should throw an error when removing nonexistent", function() {
      let docStorage = new DocStorage({ docName: 'test_RemoveColumn' });
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(peopleSqlSmall);
      }).then(function() {
        return testUtils.expectRejection(docStorage.applyStoredActions([
          ["RemoveRecord", "People", 4]
        ]), "SQLITE_ERROR");
      });
    });*/
  });

  describe('.AddColumn', function() {

    it("Should add a column if it doesn't already exist", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_AddColumn');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(peopleSqlSmall.concat([
          ["AddColumn", "People", "quality", { 'type' : 'Int', 'isFormula' : false}],
          ["AddRecord", "People", 4, { 'fname' : 'Frank', 'lname': 'Sinatra', 'quality' : 10 }]
        ]));
      }).then(function() {
        return docStorage.all("SELECT * FROM People");
      }).then(function(rows) {
        assert.deepEqual(rows, [
          { 'id' : 1, 'fname': 'George', 'lname': 'Washington', 'quality' : 0 },
          { 'id' : 2, 'fname': 'George', 'lname': 'Bush', 'quality' : 0 },
          { 'id' : 3, 'fname': 'Ephraim', 'lname': 'Williams', 'quality': 0},
          { 'id' : 4, 'fname': 'Frank', 'lname': 'Sinatra', 'quality' : 10}
        ]);
      });
   });
    it("Should throw an error when trying to add a duplicate column", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_AddColumn2');
      return docStorage.createFile()
      .then(function() {
         return docStorage.applyStoredActions(peopleSqlSmall);
      }).then(function() {
         return testUtils.expectRejection(docStorage.applyStoredActions([
           ["AddColumn", "People", "fname", { 'type' : 'Int', 'isFormula' : false}]
         ]), "SQLITE_ERROR", /duplicate column name: fname/);
      });
   });

  });

  describe('.RenameColumn', function() {

    it("Should rename a column to a valid name", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_RenameColumn');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(peopleSqlSmall.concat([
          ["RenameColumn", "People", "fname", "first_name"],
          ["AddRecord", "People", 4, { 'first_name': 'Frank', 'lname': 'Sinatra' }]
        ]));
      })
      .then(function() {
        return docStorage.all("SELECT * FROM People")
        .then(function(rows) {
          assert.deepEqual(rows, [
            { 'id': 1, 'first_name': 'George', 'lname': 'Washington' },
            { 'id': 2, 'first_name': 'George',   'lname': 'Bush' },
            { 'id': 3, 'first_name': 'Ephraim', 'lname': 'Williams' },
            { 'id': 4, 'first_name': 'Frank', 'lname': 'Sinatra' }
          ]);
        });
      })
      .finally(function() {
        return docStorage.shutdown();
      });
    });

    it("Should throw an error if renaming to an existing column", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_RenameColumn2');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(peopleSqlSmall);
      }).then(function() {
        return testUtils.expectRejection(docStorage.applyStoredActions([
          ["RenameColumn", "People", "fname", "lname"]
        ]), "SQLITE_ERROR", /duplicate column name: lname/);
      });
    });

  });

  describe('.ModifyColumn', function() {
    const marshaller = new marshal.Marshaller({version: 2});
    const encoded = (v) => {
      marshaller.marshal(v);
      return marshaller.dump();
    }

    it("Should modify the column type", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_ModifyColumn');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(peopleSql.concat([
          ["AddRecord", "People", 3, { 'name': 'Kim', 'age': false }],
          ["ModifyColumn", "People", "age", { 'type': 'Text' }],
          ["UpdateRecord", "_grist_Tables_column", 2, { 'type' : 'Text' }],
          ["AddRecord", "People", 4, { 'name': 'Carol', 'age': 14 }],
          ["AddRecord", "People", 5, { 'name': 'Declan', 'age': 97 }],
          ["AddRecord", "People", 6, { 'name': 'Junior', 'age': 1 }],
        ]));
      })
      .then(function() {
        return docStorage.all("SELECT * FROM People");
      })
      .then(function(rows) {
        // We used to expect SQLite to convert values to the new type. Now we explicitly don't
        // want it to. ModifyColumn docaction should preserve values unchanged. A separate
        // BulkUpdateRecord should follow up to change any values that should be changed.
        // If the column type in SQLite is not BLOB, as in this case, the values will be
        // marshalled.
        assert.deepEqual(rows, [
          { 'id': 1, 'name': 'Alice', 'age': 12 },
          { 'id': 2, 'name': 'Bob',   'age': 13 },
          { 'id': 3, 'name': 'Kim', 'age': encoded(false) },  // encoded to insert in int column
          { 'id': 4, 'name': 'Carol', 'age': encoded(14) },   // encoded to insert in text column
          { 'id': 5, 'name': 'Declan', 'age': encoded(97) },  // encoded to insert in text column
          { 'id': 6, 'name': 'Junior', 'age': encoded(1) },   // encoded to insert in text column
        ], "Int values should NOT become Text values");
      })
      .then(() => docStorage.applyStoredActions([
          ["UpdateRecord", "People", 2, { 'age': '13' }],
          ["UpdateRecord", "People", 4, { 'age': 'Fourteen' }],
      ]))
      .then(() => docStorage.all("SELECT * FROM People"))
      .then(rows => {
        assert.deepEqual(rows, [
          { 'id': 1, 'name': 'Alice', 'age': 12 },
          { 'id': 2, 'name': 'Bob',   'age': '13' },
          { 'id': 3, 'name': 'Kim', 'age': encoded(false) },
          { 'id': 4, 'name': 'Carol', 'age': 'Fourteen' },
          { 'id': 5, 'name': 'Declan', 'age': encoded(97) },
          { 'id': 6, 'name': 'Junior', 'age': encoded(1) },
        ]);
      })
      .then(() => docStorage.applyStoredActions([
        ["ModifyColumn", "People", "age", { 'type': 'Int' }]
      ]))
      .then(() => docStorage.all("SELECT * FROM People"))
      .then(rows => {
        assert.deepEqual(rows, [
          { 'id': 1, 'name': 'Alice', 'age': 12 },
          { 'id': 2, 'name': 'Bob',   'age': '13' },
          { 'id': 3, 'name': 'Kim', 'age': encoded(false) },
          { 'id': 4, 'name': 'Carol', 'age': 'Fourteen' },
          { 'id': 5, 'name': 'Declan', 'age': 97 },  // was decoded opportunistically
          { 'id': 6, 'name': 'Junior', 'age': 1 },   // was decoded opportunistically
        ], "Text values should NOT become Int values, even when look like Ints");
      })
      .then(() => docStorage.applyStoredActions([
        ["ModifyColumn", "People", "age", { 'type': 'Bool' }]
      ]))
      .then(() => docStorage.all("SELECT * FROM People"))
      .then(rows => {
        assert.deepEqual(rows, [
          { 'id': 1, 'name': 'Alice', 'age': 12 },
          { 'id': 2, 'name': 'Bob',   'age': '13' },
          { 'id': 3, 'name': 'Kim', 'age': 0 },      // was decoded opportunistically
          { 'id': 4, 'name': 'Carol', 'age': 'Fourteen' },
          { 'id': 5, 'name': 'Declan', 'age': 97 },
          { 'id': 6, 'name': 'Junior', 'age': 1 },   // 1 collides with representation of true
                                                     // (we could catch this and marshall it to
                                                     // preserve type if we wanted)
        ], "booleans and integers may get collapsed");
      })
      .then(() => docStorage.applyStoredActions([
        ["ModifyColumn", "People", "age", { 'type': 'Int' }]
      ]))
      .then(() => docStorage.all("SELECT * FROM People"))
      .then(rows => {
        assert.deepEqual(rows, [
          { 'id': 1, 'name': 'Alice', 'age': 12 },
          { 'id': 2, 'name': 'Bob',   'age': '13' },
          { 'id': 3, 'name': 'Kim', 'age': 0 },      // not preserved as false
          { 'id': 4, 'name': 'Carol', 'age': 'Fourteen' },
          { 'id': 5, 'name': 'Declan', 'age': 97 },
          { 'id': 6, 'name': 'Junior', 'age': 1 },   // not interpreted as true
        ], "booleans and integers were collapsed");
      })
      .finally(function() {
        return docStorage.shutdown();
      });
    });

    it("Should do nothing when modifying non-formula, non-types or to equal types", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_ModifyColumn2');
      let old_version = null;
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(peopleSql);
      })
      .then(function() {
        return docStorage.get("PRAGMA schema_version");
      })
      .get('schema_version')
      .then(function(version) {
        old_version = version;
        return docStorage.applyStoredActions([
          ["ModifyColumn", "People", "name", { 'type': 'Text' }],
          ["ModifyColumn", "People", "age",  { 'type': 'Id' }],
          ["ModifyColumn", "People", "age",  { 'type': 'Ref:foo' }],
          ["ModifyColumn", "People", "name", { 'label': 'John' }],
        ]);
      })
      .then(function() {
        return docStorage.get("PRAGMA schema_version");
      })
      .get('schema_version')
      .then(function(new_version) {
        assert.equal(new_version, old_version, "Schema version should stay the same");
      })
      .finally(function() {
        return docStorage.shutdown();
      });
    });
  });

   describe('.RemoveColumn', function() {

    it("Should remove an existent column", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_RemoveColumn');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(fruitSql.concat([
          ["RemoveColumn", "Fruits", "yummy"]
        ]));
      })
      .then(function() {
        return docStorage.all("SELECT * FROM FRUITS");
      })
      .then(function(rows) {
        assert.deepEqual(rows, [
          { 'id': 1, 'name': 'Apple' },
          { 'id': 2, 'name': 'Clementine' }
        ]);
      });
   });

   /* TODO: Should this be an error?
   it("Should throw an error when trying to remove a non-existent column", function() {
      let docStorage = new DocStorage({ docName: 'test_RemoveColumn2' });
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(fruitSql);
      })
      .then(function() {
        return testUtils.expectRejection(docStorage.applyStoredActions([
          ["RemoveColumn", "Fruits", "yumyum"]
        ]), "SQLITE_ERROR");
      });
    });*/

  });

  describe('.RemoveTable', function() {

    it("Should remove an existent table", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_RemoveTable');
      return docStorage.createFile()
      .then(function() {
        return docStorage.applyStoredActions(fruitSql.concat([
          ["RemoveTable", "Fruits"]
        ]));
      })
      .then(function() {
        return testUtils.expectRejection(docStorage.get("SELECT 1 FROM Fruits"),
          'SQLITE_ERROR', /no such table: Fruits/);
      });
    });

    it("Should throw an error when trying to remove an non-existent table", function() {
      let docStorage = new DocStorage(docStorageManager, 'test_RemoveTable2');
      return testUtils.expectRejection(docStorage.createFile()
      .then(function(doc) {
        return docStorage.applyStoredActions([["RemoveTable", "Vegetables"]]);
      }), 'SQLITE_ERROR', /no such table: Vegetables/);
    });

  });

  describe('.RenameDoc', function() {

    it("Should rename an existing doc to a new unique name", function() {
      let foo = new DocStorage(docStorageManager, 'test_RenameDoc');
      return foo.createFile()
      .then(() => foo.shutdown())
      .then(() => docStorageManager.renameDoc(foo.docName, 'bar'))
      .then(() => docUtils.pathExists(docStorageManager.getPath('bar')))
      .then(exists => assert.isTrue(exists));
    });

    it("Should fail when renaming to an existing name", function() {
      return testUtils.captureLog('warn', () => {
        let foo = new DocStorage(docStorageManager, 'test_RenameDoc_foo');
        let bar = new DocStorage(docStorageManager, 'test_RenameDoc_bar');
        return Promise.try(() => foo.createFile())
        .then(() => bar.createFile())
        .then(() => foo.shutdown())
        .then(() => testUtils.expectRejection(
          docStorageManager.renameDoc(foo.docName, bar.docName),
          'EEXIST', /open.*bar.grist/));
      })
      .then(messages => testUtils.assertMatchArray(messages, [
        /rename.*failed.*file already exists.*\/test_RenameDoc_bar.grist/
      ]));
    });

    it("Should allow renaming to a name that differs only in capitalization", function() {
      let foo = new DocStorage(docStorageManager, 'test-rename-case');
      return foo.createFile()
      .then(() => foo.shutdown())
      .then(() => docStorageManager.listDocs())
      .then(docs => {
        assert.include(docs.map(o => o.name), 'test-rename-case');
        assert.notInclude(docs.map(o => o.name), 'TEST-RENAME-CASE');
      })
      .then(() => docStorageManager.renameDoc(foo.docName, 'TEST-RENAME-CASE'))
      .then(() => docUtils.pathExists(docStorageManager.getPath('TEST-RENAME-CASE')))
      .then(exists => assert.isTrue(exists))
      .then(() => docStorageManager.listDocs())
      .then(docs => {
        assert.include(docs.map(o => o.name), 'TEST-RENAME-CASE');
        assert.notInclude(docs.map(o => o.name), 'test-rename-case');
      });
    });

  });

  describe('.DeleteActions', function() {

    // Contains records from the _gristsys_ActionHistory table as they should look
    // after deleting the two most recent actions.
    const actions = [
      {
        actionNum: 213,
        info: [0, {
          time: 1480214489261,
          user: 'dmitry@getgrist.com',
          desc: null,
          linkId: null,
          otherId: null,
          inst: "",
        }],
        userActions: [["UpdateRecord", "_grist_Views", 5, {"name":"Friends-"}]],
        undo: [["RenameTable", "Friends_", "Friends"],
               ["UpdateRecord", "_grist_Tables", 3, {"tableId":"Friends"}],
               ["UpdateRecord", "_grist_Views", 5, {"name":"Table (Raw)"}]],
      },
      {
        actionNum: 214,
        info: [0, {
          time: 1480214493424,
          user: 'dmitry@getgrist.com',
          desc: null,
          linkId: null,
          otherId: null,
          inst: "",
        }],
        userActions: [["UpdateRecord", "_grist_Views", 5, {"name":"Friends"}]],
        undo: [["RenameTable", "Friends", "Friends_"],
               ["UpdateRecord", "_grist_Tables", 3, {"tableId":"Friends_"}],
               ["UpdateRecord", "_grist_Views", 5, {"name":"Friends-"}]],
      },
      {
        actionNum: 215,
        info: [0, {
          time: 1480214497083,
          user: 'dmitry@getgrist.com',
          desc: null,
          linkId: null,
          otherId: null,
          inst: "",
        }],
        userActions: [["UpdateRecord", "_grist_Views", 3, {"name":"Performances2"}]],
        undo: [["RenameTable", "Performances2", "Performances"],
               ["UpdateRecord", "_grist_Tables", 2, {"tableId":"Performances"}],
               ["UpdateRecord", "_grist_Views", 3, {"name":"Table (Raw)"}]]
      },
      {
        actionNum: 216,
        info: [0, {
          time: 1480214500525,
          user: 'dmitry@getgrist.com',
          desc: null,
          linkId: null,
          otherId: null,
          inst: "",
        }],
        userActions: [["UpdateRecord", "_grist_Views", 3, {"name":"Performances"}]],
        undo: [["RenameTable", "Performances", "Performances2"],
               ["UpdateRecord", "_grist_Tables", 2, {"tableId":"Performances2"}],
               ["UpdateRecord", "_grist_Views", 3, {"name":"Performances2"}]],
      },
    ];

    // just look at fields supported by old ActionLog
    function filterAction(action) {
      return {
        actionNum: action.actionNum,
        info: action.info,
        userActions: action.userActions,
        undo: action.undo,
      };
    }

    it("Should delete actions past the number given", async function() {
      this.timeout(5000); // test appears to occasionally exceed default

      // create a new db for the test
      let activeDoc, docStorage;
      let originalSize;

      activeDoc = await docTools.loadFixtureDoc('Favorite_Films.grist');
      docStorage = activeDoc.docStorage;
      let recentActions = await activeDoc.getRecentActionsDirect(5);
      // Check that the actions are as expected. Ignore the last action, which includes the
      // formula calculations created during stored-formulas migration.
      assert.deepEqual(recentActions.slice(0, -1).map(filterAction), actions);
      let stat = await fs.statAsync(docStorage.docPath);
      // Save the original size.
      originalSize = stat.size;
      // Delete all actions but the most recent 3 (last one being stored-formulas calculation).
      const history = new ActionHistoryImpl(docStorage);
      await history.initialize();
      await history.deleteActions(3);
      recentActions = await activeDoc.getRecentActionsDirect(4);
      // Check that only the 2 most recent actions remain. Ignore the last action, which
      // includes the formula calculations created during stored-formulas migration.
      assert.deepEqual(recentActions.slice(0, -1).map(filterAction), actions.slice(-2));
      stat = await fs.statAsync(docStorage.docPath);
      // Check that the size is smaller (VACUUM should have been called after deletion).
      assert(stat.size < originalSize);
    });
  });
});
