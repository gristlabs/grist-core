/**
 * Tests for the /sql/full endpoint.
 * Tests DML, DDL, ACL filtering, value decoding, and formula recalculation.
 * These test the business logic in runSQLQuery/runSQLWrite/SqlACL/SqlValues
 * and do NOT depend on the PG wire protocol.
 */
import { UserAPIImpl } from "app/common/UserAPI";
import { prepareDatabase } from "test/server/lib/helpers/PrepareDatabase";
import { TestServer } from "test/server/lib/helpers/TestServer";
import { createTestDir, EnvironmentSnapshot, setTmpLogLevel } from "test/server/testUtils";

import { assert } from "chai";
import fetch from "node-fetch";

describe("DocApiSql-full", function() {
  this.timeout(60000);

  setTmpLogLevel("error");

  let server: TestServer;
  let oldEnv: EnvironmentSnapshot;
  let userApi: UserAPIImpl;
  let homeUrl: string;

  before(async function() {
    oldEnv = new EnvironmentSnapshot();
    const testDir = await createTestDir("DocApiSqlGranular");
    await prepareDatabase(testDir);
    server = await TestServer.startServer("home,docs", testDir, "DocApiSqlGranular");
    homeUrl = server.serverUrl;
    userApi = server.makeUserApi("docs", "chimpy");
  });

  after(async function() {
    if (server) { await server.stop(); }
    oldEnv?.restore();
  });

  let docId: string;

  beforeEach(async function() {
    const workspaces = await userApi.getOrgWorkspaces("current");
    const wsId = workspaces[0].id;
    docId = await userApi.newDoc({ name: "SqlTest" }, wsId);
    await userApi.applyUserActions(docId, [
      ["AddTable", "People", [
        { id: "Name", type: "Text" },
        { id: "Age", type: "Int" },
        { id: "Score", type: "Numeric" },
      ]],
      ["BulkAddRecord", "People", [null, null, null], {
        Name: ["Alice", "Bob", "Charlie"],
        Age: [30, 25, 35],
        Score: [95.5, 87.3, 92.1],
      }],
    ]);
  });

  /** Set up ACL: give kiwi a role and add rule groups. Each group creates one resource
   *  with one or more rules. A rule with no formula is the default (must be last). */
  async function addAclRules(
    kiwiRole: "viewers" | "editors",
    ...groups: {
      table: string, cols?: string,
      rules: { formula?: string, perms: string }[],
      userAttr?: { name: string, tableId: string, lookupColId: string, charId: string },
    }[]
  ) {
    await userApi.updateDocPermissions(docId, {
      users: { "kiwi@getgrist.com": kiwiRole },
    });
    const actions: any[] = [];
    let resId = -1;
    for (const group of groups) {
      actions.push(["AddRecord", "_grist_ACLResources", resId,
        { tableId: group.table, colIds: group.cols || "*" }]);
      if (group.userAttr) {
        actions.push(["AddRecord", "_grist_ACLRules", null, {
          resource: resId,
          userAttributes: JSON.stringify(group.userAttr),
        }]);
      }
      for (const rule of group.rules) {
        actions.push(["AddRecord", "_grist_ACLRules", null, {
          resource: resId,
          aclFormula: rule.formula || "",
          permissionsText: rule.perms,
        }]);
      }
      resId--;
    }
    await userApi.applyUserActions(docId, actions);
  }

  async function sqlPost(sql: string, args?: any[]) {
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_chimpy",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, args }),
    });
    const body = await resp.json();
    if (!resp.ok) { throw new Error(body.error || `HTTP ${resp.status}`); }
    return body;
  }

  // ---- SELECT ----

  it("should return decoded values and column metadata", async function() {
    const result = await sqlPost("SELECT Name, Age, Score FROM People ORDER BY Age");
    assert.equal(result.command, "SELECT");
    assert.equal(result.rowCount, 3);
    assert.isArray(result.columns);
    assert.deepEqual(result.columns.map((c: any) => c.id), ["Name", "Age", "Score"]);

    assert.equal(result.records[0].fields.Name, "Bob");
    assert.equal(result.records[0].fields.Age, 25);
  });

  it("should handle JOIN", async function() {
    await userApi.applyUserActions(docId, [
      ["AddTable", "Departments", [{ id: "DeptName", type: "Text" }]],
      ["BulkAddRecord", "Departments", [null, null], { DeptName: ["Engineering", "Sales"] }],
      ["AddColumn", "People", "Dept", { type: "Ref:Departments" }],
      ["BulkUpdateRecord", "People", [1, 2], { Dept: [1, 2] }],
    ]);
    const result = await sqlPost(
      "SELECT p.Name, d.DeptName FROM People p JOIN Departments d ON p.Dept = d.id ORDER BY p.Name",
    );
    assert.equal(result.rowCount, 2);
    assert.equal(result.records[0].fields.Name, "Alice");
    assert.equal(result.records[0].fields.DeptName, "Engineering");
  });

  it("should decode Bool values", async function() {
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Active", { type: "Bool" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Active: [true, false, true] }],
    ]);
    const result = await sqlPost("SELECT Name, Active FROM People ORDER BY Name");
    assert.strictEqual(result.records[0].fields.Active, true);
    assert.strictEqual(result.records[1].fields.Active, false);
  });

  it("should decode Ref 0 as null", async function() {
    await userApi.applyUserActions(docId, [
      ["AddTable", "Departments", [{ id: "Name", type: "Text" }]],
      ["BulkAddRecord", "Departments", [null], { Name: ["Engineering"] }],
      ["AddColumn", "People", "Dept", { type: "Ref:Departments" }],
      ["BulkUpdateRecord", "People", [1], { Dept: [1] }],
    ]);
    const result = await sqlPost("SELECT Name, Dept FROM People ORDER BY Name");
    assert.equal(result.records[0].fields.Dept, 1);    // Alice has dept
    assert.equal(result.records[1].fields.Dept, null);  // Bob has 0 → null
  });

  // ---- DML ----

  it("should INSERT and return row count", async function() {
    const result = await sqlPost("INSERT INTO People (Name, Age, Score) VALUES ('Diana', 28, 91.0)");
    assert.equal(result.command, "INSERT");
    assert.equal(result.rowCount, 1);

    const sel = await sqlPost("SELECT Name FROM People WHERE Name = 'Diana'");
    assert.equal(sel.rowCount, 1);
  });

  it("should UPDATE with WHERE", async function() {
    const result = await sqlPost("UPDATE People SET Age = 99 WHERE Name = 'Alice'");
    assert.equal(result.command, "UPDATE");
    assert.equal(result.rowCount, 1);

    const sel = await sqlPost("SELECT Age FROM People WHERE Name = 'Alice'");
    assert.equal(sel.records[0].fields.Age, 99);
  });

  it("should UPDATE with expressions", async function() {
    await sqlPost("UPDATE People SET Age = Age + 10 WHERE Name = 'Alice'");
    const sel = await sqlPost("SELECT Age FROM People WHERE Name = 'Alice'");
    assert.equal(sel.records[0].fields.Age, 40);
  });

  it("should DELETE with WHERE", async function() {
    const result = await sqlPost("DELETE FROM People WHERE Name = 'Bob'");
    assert.equal(result.command, "DELETE");
    assert.equal(result.rowCount, 1);

    const sel = await sqlPost("SELECT Name FROM People ORDER BY Name");
    assert.deepEqual(sel.records.map((r: any) => r.fields.Name), ["Alice", "Charlie"]);
  });

  it("should INSERT ... SELECT", async function() {
    await sqlPost("CREATE TABLE Archive (Name TEXT, Age INT)");
    await sqlPost("INSERT INTO Archive (Name, Age) SELECT Name, Age FROM People WHERE Age > 28");
    const sel = await sqlPost("SELECT Name FROM Archive ORDER BY Name");
    assert.deepEqual(sel.records.map((r: any) => r.fields.Name), ["Alice", "Charlie"]);
  });

  it("should INSERT ... RETURNING with formula columns", async function() {
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Summary", {
        type: "Text", isFormula: true,
        formula: "$Name + ' (age ' + str($Age) + ')'",
      }],
    ]);
    const result = await sqlPost(
      "INSERT INTO People (Name, Age, Score) VALUES ('Diana', 28, 91.0) RETURNING *");
    assert.equal(result.command, "INSERT");
    assert.equal(result.rowCount, 1);
    // RETURNING should include the formula column with computed value
    assert.isArray(result.records);
    assert.equal(result.records.length, 1);
    const row = result.records[0].fields;
    assert.equal(row.Name, "Diana");
    assert.equal(row.Age, 28);
    assert.equal(row.Summary, "Diana (age 28)");
  });

  // ---- DDL ----

  it("should CREATE TABLE", async function() {
    const result = await sqlPost("CREATE TABLE Projects (Title TEXT, Budget NUMERIC)");
    assert.equal(result.command, "CREATE");

    await sqlPost("INSERT INTO Projects (Title, Budget) VALUES ('Alpha', 1000)");
    const sel = await sqlPost("SELECT Title FROM Projects");
    assert.equal(sel.records[0].fields.Title, "Alpha");
  });

  it("should DROP TABLE", async function() {
    await sqlPost("CREATE TABLE TempTable (x TEXT)");
    await sqlPost("DROP TABLE TempTable");
    const tables = await sqlPost("SELECT tableId FROM _grist_Tables");
    assert.notInclude(tables.records.map((r: any) => r.fields.tableId), "TempTable");
  });

  // ---- Formula recalculation ----

  it("should trigger formula recalculation on write", async function() {
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Summary", {
        type: "Text", isFormula: true,
        formula: "$Name + ' (age ' + str($Age) + ')'",
      }],
    ]);

    await sqlPost("INSERT INTO People (Name, Age, Score) VALUES ('Diana', 28, 91.0)");
    const sel = await sqlPost("SELECT Summary FROM People WHERE Name = 'Diana'");
    assert.equal(sel.records[0].fields.Summary, "Diana (age 28)");
  });

  // ---- ACL ----

  it("should filter rows based on access rules", async function() {
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Age > 30", perms: "-R" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_kiwi",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT Name FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    const names = result.records.map((r: any) => r.fields.Name);
    assert.include(names, "Alice");
    assert.include(names, "Bob");
    assert.notInclude(names, "Charlie");
  });

  it("should hide denied columns and expand SELECT * without them", async function() {
    await addAclRules("viewers",
      { table: "People", cols: "Score", rules: [{ perms: "-R" }] });

    // SELECT * should return Name and Age but not Score
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_kiwi",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT * FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    const colIds = result.columns.map((c: any) => c.id);
    assert.include(colIds, "Name");
    assert.include(colIds, "Age");
    assert.notInclude(colIds, "Score");
    assert.equal(result.records[0].fields.Name, "Alice");

    // Explicitly naming denied column should error (no such column)
    const resp2 = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_kiwi",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT Score FROM People" }),
    });
    assert.notEqual(resp2.status, 200);
  });

  it("should filter rows using user.Email in access rules", async function() {
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Owner", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Owner: ["kiwi@getgrist.com", "chimpy@getgrist.com", "kiwi@getgrist.com"],
      }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Owner == user.Email", perms: "+R" }, { perms: "-R" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_kiwi",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT Name FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    const names = result.records.map((r: any) => r.fields.Name);
    assert.deepEqual(names, ["Alice", "Charlie"]);
  });

  // ---- ACL with user attribute tables ----

  it("should filter rows using user attribute table lookup", async function() {
    // Set up a Time Sheets-style pattern:
    // - People table with Email column
    // - Tasks table with Employee (Ref:People) column
    // - User attribute rule: "Person" looks up People by Email
    // - ACL rule: user.Person.id == rec.Employee → +R, else -R
    // This is the most common real-world pattern for multi-tenant row filtering.

    await userApi.applyUserActions(docId, [
      // Add an Employee ref column and a Tasks table
      ["AddTable", "Tasks", [
        { id: "TaskName", type: "Text" },
        { id: "Employee", type: "Ref:People" },
      ]],
      // Update People to have email addresses
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Name: ["Kiwi User", "Chimpy User", "Other User"],
      }],
      ["AddColumn", "People", "Email", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Email: ["kiwi@getgrist.com", "chimpy@getgrist.com", "other@getgrist.com"],
      }],
      // Add tasks assigned to different people
      ["BulkAddRecord", "Tasks", [null, null, null], {
        TaskName: ["Task A", "Task B", "Task C"],
        Employee: [1, 2, 1],  // Kiwi, Chimpy, Kiwi
      }],
    ]);

    // Give kiwi access and set up user attribute rule: "Person" looks up People by Email
    await addAclRules("editors",
      { table: "*", rules: [], userAttr: { name: "Person", tableId: "People", lookupColId: "Email", charId: "Email" } },
      { table: "Tasks", rules: [{ formula: "user.Person.id == rec.Employee", perms: "+R" }, { perms: "-R" }] });

    // Query as kiwi — should only see tasks assigned to kiwi (Employee=1)
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_kiwi",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT TaskName FROM Tasks ORDER BY TaskName" }),
    });
    const result = await resp.json();
    const names = result.records.map((r: any) => r.fields.TaskName);
    assert.deepEqual(names, ["Task A", "Task C"]);
    assert.notInclude(names, "Task B");
  });

  it("should filter using user attribute field other than id", async function() {
    // user.Person.Name (a text field on the looked-up record) == rec.AssignedTo
    // This tests that chained attribute access resolves actual field values,
    // not just the row id.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Email", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Email: ["kiwi@getgrist.com", "chimpy@getgrist.com", "other@getgrist.com"],
      }],
      ["AddTable", "Projects", [
        { id: "Title", type: "Text" },
        { id: "AssignedTo", type: "Text" },
      ]],
      ["BulkAddRecord", "Projects", [null, null, null], {
        Title: ["Proj X", "Proj Y", "Proj Z"],
        AssignedTo: ["Alice", "Bob", "Alice"],
      }],
    ]);
    await addAclRules("viewers",
      { table: "*", rules: [], userAttr: { name: "Person", tableId: "People", lookupColId: "Email", charId: "Email" } },
      { table: "Projects", rules: [{ formula: "user.Person.Name == rec.AssignedTo", perms: "+R" }, { perms: "-R" }] });

    // Kiwi's Person record is row 1 (Alice). Should only see projects assigned to "Alice".
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_kiwi",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT Title FROM Projects ORDER BY Title" }),
    });
    const result = await resp.json();
    const titles = result.records.map((r: any) => r.fields.Title);
    assert.deepEqual(titles, ["Proj X", "Proj Z"]);
  });

  it("should handle ACL rules with .lower() and .upper() string methods", async function() {
    await addAclRules("viewers",
      { table: "People", rules: [
        { formula: "rec.Name.upper() == 'ALICE' or rec.Name.lower() == 'bob'", perms: "+R" },
        { perms: "-R" },
      ] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_kiwi",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT Name FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    const names = result.records.map((r: any) => r.fields.Name);
    assert.deepEqual(names, ["Alice", "Bob"]);
  });

  // ---- ACL parity: SQL WHERE must match JS predicate evaluation ----
  // These tests verify that /sql/full returns the same rows as the REST API
  // for tricky ACL patterns where JS and SQL semantics could diverge.

  async function sqlNames(table: string, col: string, apiKey: string = "api_key_for_kiwi") {
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql: `SELECT ${col} FROM ${table} ORDER BY ${col}` }),
    });
    const result = await resp.json();
    if (!resp.ok) { throw new Error(`SQL query failed: ${result.error || resp.status}`); }
    return (result.records || []).map((r: any) => r.fields[col]).sort();
  }

  async function restNames(table: string, col: string, apiKey: string = "api_key_for_kiwi") {
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/tables/${table}/records`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const result = await resp.json();
    return (result.records || []).map((r: any) => r.fields[col]).sort();
  }

  it("should match REST API for truthy check on empty string", async function() {
    // rec.Tag as a truthy condition: JS treats "" as falsy, SQL treats "" as truthy.
    // Grist ACL evaluator (JS) excludes rows with empty string.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Tag", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Tag: ["active", "", "active"],  // Bob has empty string
      }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Tag", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult,
      "SQL and REST should agree on which rows pass the truthy check");
    // Both should exclude Bob (empty Tag)
    assert.notInclude(sqlResult, "Bob");
    assert.include(sqlResult, "Alice");
  });

  it("should match REST API for numeric comparison with zero", async function() {
    // rec.Score != 0: Bob's score set to 0, others nonzero.
    await userApi.applyUserActions(docId, [
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Score: [95.5, 0, 92.1],
      }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Score != 0", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    assert.notInclude(sqlResult, "Bob");
  });

  it("should match REST API for first-match rule ordering", async function() {
    // Multiple rules: allow if Age > 30, deny if Age > 25, allow by default.
    // First-match: Alice (30) → fails rule 1, matches rule 2 (denied).
    // Bob (25) → fails both, hits default (allowed).
    // Charlie (35) → matches rule 1 (allowed).
    await addAclRules("viewers", { table: "People", rules: [
      { formula: "rec.Age > 30", perms: "+R" },
      { formula: "rec.Age > 25", perms: "-R" },
      { perms: "+R" },
    ] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult,
      "SQL CASE WHEN must match JS first-match semantics");
    assert.include(sqlResult, "Charlie");  // Age 35 > 30 → allowed by rule 1
    assert.include(sqlResult, "Bob");      // Age 25, misses both rules → default allow
    assert.notInclude(sqlResult, "Alice");  // Age 30 > 25 → denied by rule 2
  });

  it("should match REST API for Bool column as condition", async function() {
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Active", { type: "Bool" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Active: [true, false, true] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Active", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    assert.include(sqlResult, "Alice");
    assert.notInclude(sqlResult, "Bob");
  });

  it("should match REST API for Ref column as condition", async function() {
    // Ref 0 is "no reference" — should be falsy in both JS and SQL.
    await userApi.applyUserActions(docId, [
      ["AddTable", "Depts", [{ id: "DName", type: "Text" }]],
      ["BulkAddRecord", "Depts", [null], { DName: ["Eng"] }],
      ["AddColumn", "People", "Dept", { type: "Ref:Depts" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Dept: [1, 0, 1] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Dept", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    assert.include(sqlResult, "Alice");
    assert.notInclude(sqlResult, "Bob");  // Dept is 0 → falsy
  });

  it("should match REST API for combined And/Or conditions", async function() {
    await addAclRules("viewers",
      { table: "People", rules: [
        // Allow if (Age >= 30 and Score > 90) or Name == "Bob"
        { formula: "(rec.Age >= 30 and rec.Score > 90) or rec.Name == 'Bob'", perms: "+R" },
        { perms: "-R" },
      ] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    // Alice: 30, 95.5 → passes first branch
    // Bob: 25, 87.3 → passes second branch
    // Charlie: 35, 92.1 → passes first branch
    assert.deepEqual(sqlResult, ["Alice", "Bob", "Charlie"]);
  });

  it("should match REST API for Not on a string column", async function() {
    // `not rec.Name` — JS: !"Alice" is false, !"" is true.
    // Need truthiness wrapper to propagate inside Not.
    await userApi.applyUserActions(docId, [
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Name: ["Alice", "", "Charlie"],  // Bob has empty name
      }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "not rec.Name", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Age");
    const restResult = await restNames("People", "Age");
    assert.deepEqual(sqlResult, restResult,
      "Not on string column must use JS truthiness (empty string is falsy)");
    // Only Bob (empty name) should pass `not rec.Name`
    assert.equal(sqlResult.length, 1);
  });

  it("should match REST API for Bool column negation", async function() {
    // `not rec.Active` is the idiomatic way to check for false Bool values.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Active", { type: "Bool" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Active: [true, false, true] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "not rec.Active", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    // Only Bob (Active=false) should pass `not rec.Active`
    assert.deepEqual(sqlResult, ["Bob"]);
  });

  it("should match REST API for Bool compared to number literal", async function() {
    // rec.Active == 0: JS false === 0 is false (type mismatch).
    // SQL would say 0 = 0 is true without the Bool-vs-number fix.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Active", { type: "Bool" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Active: [true, false, true] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Active == 0", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult,
      "Bool == 0 is always false in JS (type mismatch) — SQL must match");
  });

  it("should match REST API for Bool equality with False", async function() {
    // `rec.Active == False` is the explicit way to check for false.
    // In Python False==0 is True, but Grist's JS evaluator uses ===
    // where false===0 is false. This tests that SQL matches JS.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Active", { type: "Bool" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Active: [true, false, true] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Active == False", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
  });

  it("should match REST API for In membership check", async function() {
    // rec.Age in [30, 35]: Alice (30) and Charlie (35) match, Bob (25) doesn't.
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Age in [30, 35]", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    assert.include(sqlResult, "Alice");    // Age 30
    assert.include(sqlResult, "Charlie");  // Age 35
    assert.notInclude(sqlResult, "Bob");   // Age 25
  });

  it("should match REST API for Not with comparison", async function() {
    // not (rec.Age > 30): straightforward logical negation
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "not (rec.Age > 30)", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    assert.include(sqlResult, "Alice");    // 30 > 30 is false, negated → true
    assert.include(sqlResult, "Bob");      // 25 > 30 is false, negated → true
    assert.notInclude(sqlResult, "Charlie"); // 35 > 30 is true, negated → false
  });

  it("should match REST API for Is comparison with None", async function() {
    // rec.Score is None: tests null identity
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Note", { type: "Text" }],
      // Only set Alice's note; Bob and Charlie stay null
      ["BulkUpdateRecord", "People", [1], { Note: ["has note"] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Note is not None", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
  });

  it("should match REST API for arithmetic in condition", async function() {
    // rec.Age + rec.Score > 120
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Age + rec.Score > 120", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    // Alice: 30 + 95.5 = 125.5 > 120 → allowed
    // Bob: 25 + 87.3 = 112.3 → denied
    // Charlie: 35 + 92.1 = 127.1 > 120 → allowed
    assert.deepEqual(sqlResult, ["Alice", "Charlie"]);
  });

  it("should match REST API for >= comparison with null values", async function() {
    // rec.Score >= 0 where Score is null:
    // JS: null >= 0 → true (null coerces to 0, 0 >= 0 is true)
    // SQL: NULL >= 0 → NULL (falsy)
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Rating", { type: "Numeric" }],
      // Alice has rating, Bob has 0, Charlie has no rating (null)
      ["BulkUpdateRecord", "People", [1, 2], { Rating: [4.5, 0] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Rating >= 0", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult,
      "NULL >= 0 must match JS semantics (null coerces to 0)");
  });

  it("should match REST API for arithmetic with null column", async function() {
    // rec.Rating + rec.Age > 30 where Rating is null:
    // JS: null + 30 = 30 > 30 → false (null coerces to 0)
    // SQL: NULL + 30 = NULL > 30 → NULL (falsy)
    // Both say false for this case, but they'd diverge at threshold
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Bonus", { type: "Int" }],
      // Alice has bonus 10, Bob has no bonus (null), Charlie has bonus 5
      ["BulkUpdateRecord", "People", [1, 3], { Bonus: [10, 5] }],
    ]);
    // Allow if Age + Bonus > 25.
    // Alice: 30+10=40>25 → allowed. Bob: 25+null: JS 25>25 false, SQL NULL. Charlie: 35+5=40>25 → allowed.
    // Bob: JS says 25+0=25>25 is false. SQL says NULL+25=NULL>25 is false. Both false — match.
    // But change threshold to 24: JS 25+0=25>24 true, SQL NULL>24 false — diverge.
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Age + rec.Bonus > 24", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult,
      "Arithmetic with null column must match JS null-coercion semantics");
  });

  it("should match REST API for Not of a comparison involving null", async function() {
    // not (rec.Rating > 5) where Rating is null:
    // JS: not (null > 5) → not false → true
    // SQL: NOT (NULL > 5) → NOT NULL → NULL (falsy)
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Level", { type: "Int" }],
      // Alice has Level 10, Bob has no level (null), Charlie has Level 3
      ["BulkUpdateRecord", "People", [1, 3], { Level: [10, 3] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "not (rec.Level > 5)", perms: "+R" }, { perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult,
      "NOT (NULL > 5) must match JS: not false → true");
  });

  // ---- ACL rule combination tests ----
  // These test the rule system itself, not individual formula evaluation.

  it("should match REST API for column deny + row filter combined", async function() {
    // Row rule: only Age > 25. Column rule: deny Score.
    // Result: Alice and Charlie visible, Score hidden on both.
    await addAclRules("viewers",
      // Row filter
      { table: "People", rules: [{ formula: "rec.Age > 25", perms: "+R" }, { perms: "-R" }] },
      // Column deny
      { table: "People", cols: "Score", rules: [{ perms: "-R" }] });

    // Check rows filtered
    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    assert.notInclude(sqlResult, "Bob");  // Age 25, fails > 25

    // Check column hidden: SELECT * should not include Score
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    const colIds = result.columns.map((c: any) => c.id);
    assert.notInclude(colIds, "Score");
    assert.include(colIds, "Name");
  });

  it("should match REST API for multiple column deny groups", async function() {
    // Deny Score in one rule, deny Age in another.
    await addAclRules("viewers",
      { table: "People", cols: "Score", rules: [{ perms: "-R" }] },
      { table: "People", cols: "Age", rules: [{ perms: "-R" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    const colIds = result.columns.map((c: any) => c.id);
    assert.notInclude(colIds, "Score");
    assert.notInclude(colIds, "Age");
    assert.include(colIds, "Name");

    // REST should agree
    const restResp = await fetch(`${homeUrl}/api/docs/${docId}/tables/People/records`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
    });
    const restResult = await restResp.json();
    const restCols = Object.keys(restResult.records[0].fields);
    assert.notInclude(restCols, "Score");
    assert.notInclude(restCols, "Age");
  });

  it("should match REST API for owner bypassing all rules", async function() {
    // Set up restrictive rules, then query as owner (chimpy) — should see everything.
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Age > 100", perms: "+R" }, { perms: "-R" }] },
      { table: "People", cols: "Score", rules: [{ perms: "-R" }] });

    // Owner should see all rows and all columns
    const sqlResult = await sqlNames("People", "Name", "api_key_for_chimpy");
    assert.deepEqual(sqlResult, ["Alice", "Bob", "Charlie"]);

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_chimpy", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM People LIMIT 1" }),
    });
    const result = await resp.json();
    const colIds = result.columns.map((c: any) => c.id);
    assert.include(colIds, "Score");
  });

  it("should match REST API for table with global deny but no table rules", async function() {
    // Global rule denies non-owners. Table-specific allow overrides for People.
    // A second table with no specific rules should be denied.
    await userApi.applyUserActions(docId, [
      ["AddTable", "Secret", [{ id: "Data", type: "Text" }]],
      ["BulkAddRecord", "Secret", [null], { Data: ["hidden"] }],
    ]);
    await addAclRules("editors",
      // Table-specific: allow People
      { table: "People", rules: [{ perms: "+R" }] },
      // Global: deny non-owners
      { table: "*", rules: [{ formula: "user.Access not in [OWNER]", perms: "none" }] });

    // People should be readable
    const sqlPeople = await sqlNames("People", "Name");
    assert.equal(sqlPeople.length, 3);

    // Secret should be denied — query should fail or return empty
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT Data FROM Secret" }),
    });
    // Should get an error (table not accessible) matching REST behavior
    const restResp = await fetch(`${homeUrl}/api/docs/${docId}/tables/Secret/records`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
    });
    // Both should deny access with non-200 status
    assert.equal(resp.status, 403, "SQL should return 403 for denied table");
    assert.include([403, 404], restResp.status, "REST should deny access to Secret table");
  });

  it("should match REST API for JOIN across tables with different ACL", async function() {
    // People has row filter (Age > 25), Departments has no filter.
    // JOIN should only return People rows that pass the filter.
    await userApi.applyUserActions(docId, [
      ["AddTable", "Departments", [{ id: "DeptName", type: "Text" }]],
      ["BulkAddRecord", "Departments", [null, null], { DeptName: ["Eng", "Sales"] }],
      ["AddColumn", "People", "Dept", { type: "Ref:Departments" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Dept: [1, 2, 1] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Age > 25", perms: "+R" }, { perms: "-R" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "SELECT p.Name, d.DeptName FROM People p JOIN Departments d ON p.Dept = d.id ORDER BY p.Name",
      }),
    });
    const result = await resp.json();
    const names = result.records.map((r: any) => r.fields.Name);
    // Bob (Age 25) should be filtered out even in the JOIN
    assert.notInclude(names, "Bob");
    assert.include(names, "Alice");
    assert.include(names, "Charlie");
  });

  // ---- Structural edge cases ----

  it("should fail closed when ACL rule uses rec.Ref.Column pattern", async function() {
    // Grist ACL doesn't follow Ref columns — rec.Dept.DeptName evaluates
    // to undefined (Ref value is a row ID, not a record). The SQL path
    // fails closed with an error; REST silently treats the condition as false.
    await userApi.applyUserActions(docId, [
      ["AddTable", "Departments", [{ id: "DeptName", type: "Text" }]],
      ["BulkAddRecord", "Departments", [null], { DeptName: ["Eng"] }],
      ["AddColumn", "People", "Dept", { type: "Ref:Departments" }],
      ["BulkUpdateRecord", "People", [1], { Dept: [1] }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [
        { formula: "rec.Dept.DeptName == 'Eng'", perms: "+R" },
        { perms: "-R" },
      ] });

    // SQL path: fails closed (can't compile chained rec attribute to SQL)
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT Name FROM People" }),
    });
    assert.notEqual(resp.status, 200, "Unsupported ACL pattern must not return unfiltered data");

    // REST path: doesn't crash, but the rule evaluates to undefined == 'Eng'
    // which is always false, so no rows are visible.
    const restResp = await fetch(`${homeUrl}/api/docs/${docId}/tables/People/records`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
    });
    assert.equal(restResp.status, 200, "REST should not crash on this pattern");
  });

  it("should not leak data when user query references denied table in subquery", async function() {
    // SELECT * FROM AllowedTable WHERE id IN (SELECT ref FROM DeniedTable)
    // Should fail because DeniedTable is in the query's referenced tables.
    await userApi.applyUserActions(docId, [
      ["AddTable", "Secret", [{ id: "PersonRef", type: "Ref:People" }]],
      ["BulkAddRecord", "Secret", [null], { PersonRef: [1] }],
    ]);
    await addAclRules("viewers",
      // Deny Secret table
      { table: "Secret", rules: [{ perms: "-R" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "SELECT Name FROM People WHERE id IN (SELECT PersonRef FROM Secret)",
      }),
    });
    assert.equal(resp.status, 403, "Subquery against denied table must be rejected");
  });

  it("should match REST API when all columns are denied but table is allowed", async function() {
    // Table has +R for rows, but every data column has -R.
    // CTE becomes SELECT id FROM People WHERE ... — only id visible.
    await addAclRules("viewers",
      { table: "People", cols: "Name", rules: [{ perms: "-R" }] },
      { table: "People", cols: "Age", rules: [{ perms: "-R" }] },
      { table: "People", cols: "Score", rules: [{ perms: "-R" }] });

    // SQL: SELECT * should succeed but only return id (no data columns)
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM People" }),
    });
    assert.equal(resp.status, 200, "Query should succeed even with all data columns denied");
    const result = await resp.json();
    const colIds = (result.columns || []).map((c: any) => c.id);
    assert.notInclude(colIds, "Name");
    assert.notInclude(colIds, "Age");
    assert.notInclude(colIds, "Score");

    // REST: should return records with no data fields
    const restResp = await fetch(`${homeUrl}/api/docs/${docId}/tables/People/records`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
    });
    assert.equal(restResp.status, 200);
    const restResult = await restResp.json();
    const restFields = Object.keys(restResult.records[0].fields);
    assert.notInclude(restFields, "Name");
    assert.notInclude(restFields, "Age");
    assert.notInclude(restFields, "Score");
  });

  it("should work with no ACL rules at all", async function() {
    // Baseline: a viewer with no ACL rules should see everything
    // (default behavior is allow-all).
    await userApi.updateDocPermissions(docId, {
      users: { "kiwi@getgrist.com": "viewers" },
    });
    // No ACL rules added — just the default

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    assert.deepEqual(sqlResult, ["Alice", "Bob", "Charlie"]);
  });

  it("should not show denied column even via ORDER BY", async function() {
    // ORDER BY Score where Score is denied — should error, not leak ordering info
    await addAclRules("viewers",
      { table: "People", cols: "Score", rules: [{ perms: "-R" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT Name FROM People ORDER BY Score" }),
    });
    // Should error — Score is not in the CTE
    assert.notEqual(resp.status, 200,
      "ORDER BY on denied column should fail, not leak ordering info");
  });

  it("should match REST API for conditional column censoring", async function() {
    // Rule: -R on Secret when rec.Age < 30. Secret should be NULL for Bob (Age 25)
    // but visible for Alice (30) and Charlie (35). This uses CASE WHEN in the CTE.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Secret", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Secret: ["s1", "s2", "s3"],
      }],
    ]);
    await addAclRules("viewers",
      { table: "People", cols: "Secret", rules: [{ formula: "rec.Age < 30", perms: "-R" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT Name, Secret FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    assert.equal(resp.status, 200);
    const records = result.records.map((r: any) => r.fields);
    // Alice (30): visible. Bob (25): censored. Charlie (35): visible.
    assert.equal(records[0].Name, "Alice");
    assert.equal(records[0].Secret, "s1");
    assert.equal(records[1].Name, "Bob");
    assert.equal(records[1].Secret, "#CENSORED", "Censored cell should show #CENSORED");
    assert.equal(records[2].Name, "Charlie");
    assert.equal(records[2].Secret, "s3");

    // Verify REST censors the same cells
    const restResp = await fetch(`${homeUrl}/api/docs/${docId}/tables/People/records`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
    });
    const restResult = await restResp.json();
    const restBob = restResult.records.find((r: any) => r.fields.Name === "Bob");
    const restAlice = restResult.records.find((r: any) => r.fields.Name === "Alice");
    assert.notEqual(restBob.fields.Secret, "s2", "REST should censor Bob's Secret too");
    assert.equal(restAlice.fields.Secret, "s1");
  });

  it("should match REST API for user.UserID rule", async function() {
    // Private table accessible only to a specific user by UserID.
    const profile = await userApi.getUserProfile();
    await userApi.applyUserActions(docId, [
      ["AddTable", "OwnerOnly", [{ id: "Data", type: "Text" }]],
      ["BulkAddRecord", "OwnerOnly", [null], { Data: ["secret"] }],
    ]);
    await addAclRules("editors",
      { table: "OwnerOnly", rules: [{ formula: `user.UserID == ${profile.id}`, perms: "+R" }, { perms: "-R" }] });

    // Kiwi should be denied
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT Data FROM OwnerOnly" }),
    });
    assert.equal(resp.status, 403);

    // Owner should see it
    const ownerResult = await sqlNames("OwnerOnly", "Data", "api_key_for_chimpy");
    assert.deepEqual(ownerResult, ["secret"]);
  });

  it("should handle column-grant pattern (grant specific, deny rest)", async function() {
    // Pattern: grant "all" on columns B,D; deny "none" on * for non-owners.
    // REST API shows only B,D to editor. SQL path should match or fail closed.
    // This is a complex GranularAccess pattern; the SQL path may not fully
    // support it yet, but must not leak denied column data.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Secret", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Secret: ["x", "y", "z"] }],
    ]);
    await addAclRules("editors",
      // Grant Name,Age to everyone
      { table: "People", cols: "Name,Age", rules: [{ perms: "all" }] },
      // Deny everything else for non-owners
      { table: "People", rules: [{ formula: 'user.Access != "owners"', perms: "none" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM People ORDER BY Name" }),
    });
    assert.equal(resp.status, 200);
    const result = await resp.json();
    const colIds = (result.columns || []).map((c: any) => c.id);
    // Granted columns should be visible with real values
    assert.include(colIds, "Name");
    assert.include(colIds, "Age");
    // All rows visible (column grant makes rows accessible)
    assert.equal(result.rowCount, 3);
    // Non-granted columns: every value censored (user-only deny always matches)
    const records = result.records.map((r: any) => r.fields);
    assert.equal(records[0].Name, "Alice", "Granted column has real value");
    for (const rec of records) {
      if (colIds.includes("Score")) {
        assert.equal(rec.Score, "#CENSORED", "Non-granted column censored for denied rows");
      }
      if (colIds.includes("Secret")) {
        assert.equal(rec.Secret, "#CENSORED", "Non-granted column censored for denied rows");
      }
    }
  });

  it("should match REST API for ACL rule based on formula column", async function() {
    // rec.Public where Public is a formula column ($B == "clear").
    // The SQL CTE reads the cached formula value from SQLite.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Tag", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Tag: ["clear", "secret", "clear"] }],
      ["AddColumn", "People", "Public", {
        type: "Bool", isFormula: true, formula: '$Tag == "clear"',
      }],
    ]);
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "not rec.Public", perms: "-R" }] });

    const sqlResult = await sqlNames("People", "Name");
    const restResult = await restNames("People", "Name");
    assert.deepEqual(sqlResult, restResult);
    // Bob (Tag "secret", Public false) should be hidden
    assert.include(sqlResult, "Alice");
    assert.notInclude(sqlResult, "Bob");
    assert.include(sqlResult, "Charlie");
  });

  it("should match REST API for multiple conditional column rules (first-match)", async function() {
    // Two conditional deny rules on the same column: first-match should win.
    // Rule 1: deny Secret when rec.Age < 30
    // Rule 2: deny Secret when rec.Name == 'Charlie'
    // Alice (30): both conditions false → visible
    // Bob (25): rule 1 matches (Age < 30) → censored (first match wins)
    // Charlie (35): rule 1 false, rule 2 matches → censored
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Secret", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Secret: ["s1", "s2", "s3"] }],
    ]);
    await addAclRules("viewers",
      { table: "People", cols: "Secret", rules: [
        { formula: "rec.Age < 30", perms: "-R" },
        { formula: "rec.Name == 'Charlie'", perms: "-R" },
      ] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT Name, Secret FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    assert.equal(resp.status, 200);
    const records = result.records.map((r: any) => r.fields);
    assert.equal(records[0].Secret, "s1", "Alice: both conditions false → visible");
    assert.equal(records[1].Secret, "#CENSORED", "Bob: Age < 30 → censored");
    assert.equal(records[2].Secret, "#CENSORED", "Charlie: Name match → censored");
  });

  it("should match REST API for conditional column grant", async function() {
    // Grant Secret only when rec.Age >= 30. Otherwise censored.
    // This is the inverse of conditional deny — conditional visibility.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Secret", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Secret: ["s1", "s2", "s3"] }],
    ]);
    await addAclRules("viewers",
      { table: "People", cols: "Secret", rules: [
        // Grant when Age >= 30, deny by default
        { formula: "rec.Age >= 30", perms: "+R" },
        { perms: "-R" },
      ] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT Name, Secret FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    assert.equal(resp.status, 200);
    const records = result.records.map((r: any) => r.fields);
    assert.equal(records[0].Secret, "s1", "Alice (30): granted → visible");
    assert.equal(records[1].Secret, "#CENSORED", "Bob (25): default deny → censored");
    assert.equal(records[2].Secret, "s3", "Charlie (35): granted → visible");
  });

  it("should handle column grant + row filter interaction", async function() {
    // Column grant on Name,Age + row filter on Status.
    // Name,Age: visible for ALL rows (grant overrides row filter).
    // Score: visible only for public rows, censored otherwise.
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Status", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Status: ["public", "private", "public"],
      }],
    ]);
    await addAclRules("viewers",
      { table: "People", cols: "Name,Age", rules: [{ perms: "all" }] },
      { table: "People", rules: [
        { formula: "rec.Status == 'public'", perms: "+R" },
        { perms: "-R" },
      ] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM People ORDER BY Name" }),
    });
    assert.equal(resp.status, 200);
    const result = await resp.json();
    const records = result.records.map((r: any) => r.fields);
    // All 3 rows visible (because Name,Age grant makes rows accessible)
    assert.equal(records.length, 3);
    // Name always visible (granted)
    assert.equal(records[0].Name, "Alice");
    assert.equal(records[1].Name, "Bob");
    assert.equal(records[2].Name, "Charlie");
    // Score: visible for public rows, censored for private
    assert.notEqual(records[0].Score, "#CENSORED", "Alice (public): Score visible");
    assert.equal(records[1].Score, "#CENSORED", "Bob (private): Score censored");
    assert.notEqual(records[2].Score, "#CENSORED", "Charlie (public): Score visible");
  });

  it("should handle column grant + column censoring + row filter together", async function() {
    // Three ACL mechanisms at once:
    // - Column grant: Name always visible
    // - Conditional column deny: Secret censored when Age < 30
    // - Row filter: only public rows for non-granted, non-censored columns
    //
    // Expected per cell:
    // Alice  (30, public):  Name=Alice, Score=95.5, Secret=s1
    // Bob    (25, private): Name=Bob,   Score=#C,   Secret=#C (both: row deny AND col deny)
    // Charlie(35, public):  Name=Charlie, Score=92.1, Secret=s3
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Status", { type: "Text" }],
      ["AddColumn", "People", "Secret", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], {
        Status: ["public", "private", "public"],
        Secret: ["s1", "s2", "s3"],
      }],
    ]);
    await addAclRules("viewers",
      // Column grant: Name always visible
      { table: "People", cols: "Name", rules: [{ perms: "all" }] },
      // Conditional column deny: Secret censored when Age < 30
      { table: "People", cols: "Secret", rules: [
        { formula: "rec.Age < 30", perms: "-R" },
      ] },
      // Row filter: only public rows
      { table: "People", rules: [
        { formula: "rec.Status == 'public'", perms: "+R" },
        { perms: "-R" },
      ] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT Name, Score, Secret FROM People ORDER BY Name" }),
    });
    assert.equal(resp.status, 200);
    const result = await resp.json();
    const records = result.records.map((r: any) => r.fields);
    assert.equal(records.length, 3, "All rows visible because Name is granted");

    // Alice (public, Age 30): Name granted, Score passes row filter, Secret passes col rule
    assert.equal(records[0].Name, "Alice");
    assert.notEqual(records[0].Score, "#CENSORED", "Alice: Score visible (public)");
    assert.equal(records[0].Secret, "s1", "Alice: Secret visible (Age >= 30 and public)");

    // Bob (private, Age 25): Name granted, Score fails row filter, Secret fails BOTH
    assert.equal(records[1].Name, "Bob");
    assert.equal(records[1].Score, "#CENSORED", "Bob: Score censored (private)");
    assert.equal(records[1].Secret, "#CENSORED", "Bob: Secret censored (Age < 30 AND private)");

    // Charlie (public, Age 35): all visible
    assert.equal(records[2].Name, "Charlie");
    assert.notEqual(records[2].Score, "#CENSORED", "Charlie: Score visible (public)");
    assert.equal(records[2].Secret, "s3", "Charlie: Secret visible (Age >= 30 and public)");
  });

  it("should handle gnarly multi-rule interaction", async function() {
    // The kitchen sink: multiple column groups, conditional grants and denies,
    // user attributes, row filtering, and cell censoring all at once.
    //
    // Table: Staff with columns Name, Dept, Salary, Rating, Notes, Status
    //
    // Rules:
    //   Column grant on Name,Dept — always visible
    //   Column deny on Salary when rec.Dept != user.Team.Dept — only see your dept's salaries
    //   Column conditional grant on Rating: +R when rec.Status == 'published', default -R
    //   Column deny on Notes — always hidden
    //   Row filter: rec.Status != 'fired' → +R, default -R
    //   User attribute: Team looks up Teams table by email
    //
    // Data:
    //   Alice: Eng, 100k, 5, "note1", published  → visible (not fired, published)
    //   Bob:   Sales, 90k, 4, "note2", published  → visible, salary censored (wrong dept)
    //   Charlie: Eng, 110k, 3, "note3", draft     → visible, rating censored (not published)
    //   Diana: Eng, 95k, 2, "note4", fired        → row hidden (fired)
    //
    // Expected for kiwi (Eng team):
    //   Name    Dept   Salary  Rating  Notes  Status
    //   Alice   Eng    100000  5       hidden published  ← salary visible (same dept), rating visible (published)
    //   Bob     Sales  #C      4       hidden published  ← salary censored (wrong dept), rating visible (published)
    //   Charlie Eng    110000  #C      hidden draft      ← salary visible (same dept), rating censored (not published)
    //   (Diana hidden — fired)

    await userApi.applyUserActions(docId, [
      ["AddTable", "Teams", [
        { id: "Email", type: "Text" },
        { id: "Dept", type: "Text" },
      ]],
      ["BulkAddRecord", "Teams", [null, null], {
        Email: ["kiwi@getgrist.com", "chimpy@getgrist.com"],
        Dept: ["Eng", "Sales"],
      }],
      ["AddTable", "Staff", [
        { id: "Name", type: "Text" },
        { id: "Dept", type: "Text" },
        { id: "Salary", type: "Int" },
        { id: "Rating", type: "Int" },
        { id: "Notes", type: "Text" },
        { id: "Status", type: "Text" },
      ]],
      ["BulkAddRecord", "Staff", [null, null, null, null], {
        Name: ["Alice", "Bob", "Charlie", "Diana"],
        Dept: ["Eng", "Sales", "Eng", "Eng"],
        Salary: [100000, 90000, 110000, 95000],
        Rating: [5, 4, 3, 2],
        Notes: ["note1", "note2", "note3", "note4"],
        Status: ["published", "published", "draft", "fired"],
      }],
    ]);

    await addAclRules("viewers",
      // User attribute: Team lookup by email
      { table: "*", rules: [],
        userAttr: { name: "Team", tableId: "Teams", lookupColId: "Email", charId: "Email" } },
      // Column grant: Name, Dept always visible
      { table: "Staff", cols: "Name,Dept", rules: [{ perms: "all" }] },
      // Column deny: Salary censored when wrong department
      { table: "Staff", cols: "Salary", rules: [
        { formula: "rec.Dept != user.Team.Dept", perms: "-R" },
      ] },
      // Column conditional grant: Rating visible when published, default deny
      { table: "Staff", cols: "Rating", rules: [
        { formula: "rec.Status == 'published'", perms: "+R" },
        { perms: "-R" },
      ] },
      // Column deny: Notes always hidden
      { table: "Staff", cols: "Notes", rules: [{ perms: "-R" }] },
      // Row filter: hide fired employees
      { table: "Staff", rules: [
        { formula: "rec.Status != 'fired'", perms: "+R" },
        { perms: "-R" },
      ] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM Staff ORDER BY Name" }),
    });
    assert.equal(resp.status, 200);
    const result = await resp.json();
    const colIds = result.columns.map((c: any) => c.id);
    const records = result.records.map((r: any) => r.fields);

    // All 4 rows visible — column grants make rows accessible even when
    // the row filter would deny. Diana (fired) appears with granted columns
    // visible and everything else censored.
    assert.equal(records.length, 4);

    // Notes always hidden
    assert.notInclude(colIds, "Notes", "Notes column should be completely hidden");

    // Granted columns always visible with real values (all 4 rows)
    assert.include(colIds, "Name");
    assert.include(colIds, "Dept");
    assert.equal(records[0].Name, "Alice");
    assert.equal(records[1].Name, "Bob");
    assert.equal(records[2].Name, "Charlie");
    assert.equal(records[3].Name, "Diana");
    assert.equal(records[0].Dept, "Eng");
    assert.equal(records[1].Dept, "Sales");
    assert.equal(records[2].Dept, "Eng");
    assert.equal(records[3].Dept, "Eng");

    // Salary: visible for Eng AND not fired, censored otherwise.
    // Alice (Eng, not fired): visible. Bob (Sales): censored (wrong dept).
    // Charlie (Eng, not fired): visible. Diana (Eng, fired): censored (row filter).
    assert.equal(records[0].Salary, 100000, "Alice (Eng, not fired): salary visible");
    assert.equal(records[1].Salary, "#CENSORED", "Bob (Sales): salary censored (wrong dept)");
    assert.equal(records[2].Salary, 110000, "Charlie (Eng, not fired): salary visible");
    assert.equal(records[3].Salary, "#CENSORED", "Diana (fired): salary censored (row filter)");

    // Rating: visible when published AND row filter passes, censored otherwise.
    assert.equal(records[0].Rating, 5, "Alice (published, not fired): rating visible");
    assert.equal(records[1].Rating, 4, "Bob (published, not fired): rating visible");
    assert.equal(records[2].Rating, "#CENSORED", "Charlie (draft): rating censored");
    assert.equal(records[3].Rating, "#CENSORED", "Diana (fired): rating censored");

    // Status: not granted, not denied, subject to row filter only.
    if (colIds.includes("Status")) {
      assert.notEqual(records[0].Status, "#CENSORED", "Alice (not fired): Status visible");
      assert.equal(records[3].Status, "#CENSORED", "Diana (fired): Status censored");
    }

    // Cross-check against REST API: same rows, same censoring pattern.
    const restResp = await fetch(`${homeUrl}/api/docs/${docId}/tables/Staff/records`, {
      headers: { Authorization: "Bearer api_key_for_kiwi" },
    });
    assert.equal(restResp.status, 200);
    const restResult = await restResp.json();
    const restRecords = restResult.records;
    // REST should return same number of rows
    assert.equal(restRecords.length, records.length,
      "REST and SQL should return same number of rows");
    // Compare per-row: granted columns must match, censored cells must both be hidden
    for (const sqlRec of records) {
      const restRec = restRecords.find((r: any) => r.fields.Name === sqlRec.Name);
      assert.ok(restRec, `REST should have row for ${sqlRec.Name}`);
      // Granted columns: exact match
      assert.equal(restRec.fields.Name, sqlRec.Name, `Name match for ${sqlRec.Name}`);
      assert.equal(restRec.fields.Dept, sqlRec.Dept, `Dept match for ${sqlRec.Name}`);
      // Salary: if SQL says censored, REST should also censor (not show real value)
      if (sqlRec.Salary === "#CENSORED") {
        assert.notEqual(restRec.fields.Salary, sqlRec.Name === "Bob" ? 90000 :
          sqlRec.Name === "Diana" ? 95000 : -1,
        `REST should censor Salary for ${sqlRec.Name}`);
      } else {
        assert.equal(restRec.fields.Salary, sqlRec.Salary,
          `Salary should match for ${sqlRec.Name}`);
      }
      // Rating: if SQL says censored, REST should also censor
      if (sqlRec.Rating === "#CENSORED") {
        const realRating = sqlRec.Name === "Charlie" ? 3 : sqlRec.Name === "Diana" ? 2 : -1;
        assert.notEqual(restRec.fields.Rating, realRating,
          `REST should censor Rating for ${sqlRec.Name}`);
      } else {
        assert.equal(restRec.fields.Rating, sqlRec.Rating,
          `Rating should match for ${sqlRec.Name}`);
      }
    }
  });

  it("should handle column grant with unconditional table deny", async function() {
    // Pure column-grant pattern: table denies everything, columns grant Name,Age.
    // Non-granted columns should be completely hidden (not just censored).
    await addAclRules("viewers",
      { table: "People", cols: "Name,Age", rules: [{ perms: "all" }] },
      { table: "People", rules: [{ perms: "none" }] });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT * FROM People ORDER BY Name" }),
    });
    assert.equal(resp.status, 200);
    const result = await resp.json();
    const colIds = result.columns.map((c: any) => c.id);
    assert.include(colIds, "Name");
    assert.include(colIds, "Age");
    assert.notInclude(colIds, "Score", "Non-granted column should be hidden with unconditional deny");
    assert.equal(result.rowCount, 3, "All rows visible via granted columns");
  });

  // ---- Backwards compatibility ----

  it("should return legacy format without granular flag", async function() {
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer api_key_for_chimpy",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql: "SELECT Name FROM People ORDER BY Name" }),
    });
    const result = await resp.json();
    // Legacy format: {statement, records: [{fields: {...}}]}
    assert.property(result, "statement");
    assert.property(result, "records");
    assert.notProperty(result, "columns");
    assert.notProperty(result, "command");
    assert.equal(result.records[0].fields.Name, "Alice");
  });

  it("should support cellFormat=typed for self-describing values", async function() {
    // Set up columns covering Date, Ref, RefList, ChoiceList, DateTime, Bool, plain Text/Int
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Birthday", { type: "Date" }],
      ["AddColumn", "People", "Updated", { type: "DateTime:UTC" }],
      ["AddColumn", "People", "Active", { type: "Bool" }],
      ["AddColumn", "People", "Tags", { type: "ChoiceList" }],
      ["AddTable", "Departments", [{ id: "DeptName", type: "Text" }]],
      ["BulkAddRecord", "Departments", [null, null], { DeptName: ["Eng", "Sales"] }],
      ["AddColumn", "People", "Dept", { type: "Ref:Departments" }],
      ["AddColumn", "People", "Depts", { type: "RefList:Departments" }],
      ["BulkUpdateRecord", "People", [1], {
        Birthday: [1710460800],
        Updated: [1710460800],
        Active: [true],
        Tags: [["L", "fast", "smart"]],
        Dept: [1],
        Depts: [["L", 1, 2]],
      }],
    ]);

    // Default format: decoded plain values
    const normalResp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_chimpy", "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "SELECT Name, Birthday, Updated, Active, Tags, Dept, Depts FROM People WHERE Name = 'Alice'",
      }),
    });
    const normalResult = await normalResp.json();
    assert.equal(normalResp.status, 200);
    const n = normalResult.records[0].fields;
    assert.equal(typeof n.Birthday, "string", "Normal: Date as ISO string");
    assert.equal(typeof n.Dept, "number", "Normal: Ref as plain number");
    assert.equal(n.Active, true, "Normal: Bool as boolean");
    assert.equal(n.Name, "Alice", "Normal: Text as string");

    // Typed format: Grist-encoded tuples
    const typedResp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full?cellFormat=typed`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_chimpy", "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "SELECT Name, Birthday, Updated, Active, Tags, Dept, Depts FROM People WHERE Name = 'Alice'",
      }),
    });
    const typedResult = await typedResp.json();
    assert.equal(typedResp.status, 200);
    const t = typedResult.records[0].fields;

    // Text and Bool stay as-is (no type tuple needed)
    assert.equal(t.Name, "Alice");
    assert.equal(t.Active, true);

    // Date → ["d", epoch]
    assert.isArray(t.Birthday, "Typed: Date should be tuple");
    assert.equal(t.Birthday[0], "d");
    assert.equal(t.Birthday[1], 1710460800);

    // DateTime → ["D", epoch, timezone]
    assert.isArray(t.Updated, "Typed: DateTime should be tuple");
    assert.equal(t.Updated[0], "D");
    assert.equal(t.Updated[1], 1710460800);
    assert.equal(t.Updated[2], "UTC");

    // Ref → ["R", tableId, rowId]
    assert.isArray(t.Dept, "Typed: Ref should be tuple");
    assert.equal(t.Dept[0], "R");
    assert.equal(t.Dept[1], "Departments");
    assert.equal(t.Dept[2], 1);

    // RefList → ["r", tableId, [rowIds]]
    assert.isArray(t.Depts, "Typed: RefList should be tuple");
    assert.equal(t.Depts[0], "r");
    assert.equal(t.Depts[1], "Departments");
    assert.isArray(t.Depts[2]);
    assert.deepEqual(t.Depts[2], [1, 2]);

    // ChoiceList → ["L", ...choices]
    assert.isArray(t.Tags, "Typed: ChoiceList should be tuple");
    assert.equal(t.Tags[0], "L");
    assert.include(t.Tags, "fast");
    assert.include(t.Tags, "smart");
  });

  // ---- Security ----

  it("should deny writes from a viewer", async function() {
    await userApi.updateDocPermissions(docId, {
      users: { "kiwi@getgrist.com": "viewers" },
    });

    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "INSERT INTO People (Name, Age, Score) VALUES ('Eve', 22, 88)" }),
    });
    assert.notEqual(resp.status, 200, "Viewer should not be able to INSERT");

    const resp2 = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "DELETE FROM People WHERE Name = 'Alice'" }),
    });
    assert.notEqual(resp2.status, 200, "Viewer should not be able to DELETE");

    // Verify data unchanged
    const sel = await sqlNames("People", "Name", "api_key_for_chimpy");
    assert.deepEqual(sel, ["Alice", "Bob", "Charlie"]);
  });

  it("should not execute raw SQL injection attempts", async function() {
    const attacks = [
      "SELECT * FROM People; DROP TABLE People",
      "SELECT * FROM People WHERE Name = '' OR 1=1 --",
      "SELECT * FROM _grist_ACLRules",
    ];
    for (const sql of attacks) {
      const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
        method: "POST",
        headers: { "Authorization": "Bearer api_key_for_chimpy", "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      if (resp.ok) {
        const result = await resp.json();
        assert.notEqual(result.command, "DROP");
      }
    }
    const sel = await sqlPost("SELECT Name FROM People ORDER BY Name");
    assert.deepEqual(sel.records.map((r: any) => r.fields.Name), ["Alice", "Bob", "Charlie"]);
  });

  // ---- Black-hat attack tests ----
  // These attempt to bypass ACL filtering as a restricted user.

  async function kiwiSql(sql: string): Promise<{ status: number, body: any }> {
    const resp = await fetch(`${homeUrl}/api/docs/${docId}/sql/full`, {
      method: "POST",
      headers: { "Authorization": "Bearer api_key_for_kiwi", "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    });
    return { status: resp.status, body: await resp.json() };
  }

  it("ATTACK: schema prefix main.Table to bypass CTE", async function() {
    // The CTE rewrites "People" → "_acl_People". But "main.People"
    // is a different AST reference that might not get rewritten,
    // letting the attacker read the unfiltered table.
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Age > 100", perms: "+R" }, { perms: "-R" }] });

    // Normal query — should return no rows (nobody has Age > 100)
    const normal = await kiwiSql("SELECT Name FROM People");
    if (normal.status === 200) {
      assert.equal(normal.body.rowCount, 0, "Normal query should return no rows");
    }

    // Attack: try schema-qualified name to bypass CTE
    const attack = await kiwiSql("SELECT Name FROM main.People");
    const leaked = attack.status === 200 ?
      (attack.body.records || []).map((r: any) => r.fields.Name) : [];
    assert.notInclude(leaked, "Alice", "main.People must not bypass CTE");
    assert.notInclude(leaked, "Bob", "main.People must not bypass CTE");
    assert.notInclude(leaked, "Charlie", "main.People must not bypass CTE");
  });

  it("ATTACK: read _grist_ACLRules to see access control configuration", async function() {
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Age > 30", perms: "-R" }] });

    // Try to read the ACL rules directly
    const r1 = await kiwiSql("SELECT * FROM _grist_ACLRules");
    assert.notEqual(r1.status, 200, "Should not be able to read _grist_ACLRules");

    // Try to read schema
    const r2 = await kiwiSql("SELECT * FROM sqlite_master");
    assert.notEqual(r2.status, 200, "Should not be able to read sqlite_master");

    // Try pragma
    const r3 = await kiwiSql("PRAGMA table_info('People')");
    assert.notEqual(r3.status, 200, "Should not be able to run PRAGMA");
  });

  it("ATTACK: UNION to exfiltrate data from denied table", async function() {
    await userApi.applyUserActions(docId, [
      ["AddTable", "Secret", [{ id: "Data", type: "Text" }]],
      ["BulkAddRecord", "Secret", [null], { Data: ["top-secret"] }],
    ]);
    await addAclRules("viewers",
      { table: "Secret", rules: [{ perms: "-R" }] });

    // Try UNION with denied table
    const r = await kiwiSql("SELECT Name FROM People UNION SELECT Data FROM Secret");
    assert.notEqual(r.status, 200,
      "UNION referencing denied table should fail, not return data");
  });

  it("ATTACK: subquery in SELECT list to read hidden column", async function() {
    await userApi.applyUserActions(docId, [
      ["AddColumn", "People", "Secret", { type: "Text" }],
      ["BulkUpdateRecord", "People", [1, 2, 3], { Secret: ["s1", "s2", "s3"] }],
    ]);
    await addAclRules("viewers",
      { table: "People", cols: "Secret", rules: [{ perms: "-R" }] });

    // Try to read denied column via subquery in SELECT expression.
    // The CTE excludes Secret, so the subquery should fail (column not found).
    const r = await kiwiSql(
      "SELECT Name, (SELECT Secret FROM People p2 WHERE p2.id = People.id) AS leak FROM People",
    );
    if (r.status === 200) {
      // If it somehow succeeded, verify no secret values leaked
      for (const rec of r.body.records) {
        assert.notInclude(["s1", "s2", "s3"], rec.fields.leak,
          "VULNERABILITY: subquery leaked denied column value");
      }
    }
    // Expected: error because Secret column doesn't exist in the CTE
  });

  it("ATTACK: correlated subquery to probe hidden row existence", async function() {
    // Even if a row is hidden, can we detect its existence via a correlated subquery?
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Name == 'Alice'", perms: "+R" }, { perms: "-R" }] });

    // Kiwi can only see Alice. Try to detect Bob exists via EXISTS subquery.
    // Both "People" references get rewritten to _acl_People (which has only Alice),
    // so EXISTS should find no Bob rows.
    const r = await kiwiSql(
      "SELECT Name, EXISTS(SELECT 1 FROM People p2 WHERE p2.Name = 'Bob') AS bob_exists FROM People",
    );
    if (r.status === 200) {
      for (const rec of r.body.records) {
        const exists = rec.fields.bob_exists;
        assert.include([0, false, "0", null], exists,
          "VULNERABILITY: EXISTS detected hidden row Bob (got " + exists + ")");
      }
    }
  });

  it("ATTACK: COUNT(*) to detect hidden row count", async function() {
    await addAclRules("viewers",
      { table: "People", rules: [{ formula: "rec.Name == 'Alice'", perms: "+R" }, { perms: "-R" }] });

    // Kiwi can only see Alice. COUNT(*) should report 1, not 3.
    const r = await kiwiSql("SELECT COUNT(*) as n FROM People");
    if (r.status === 200) {
      const count = r.body.records[0].fields.n;
      assert.equal(count, 1,
        "VULNERABILITY: COUNT(*) revealed hidden row count (expected 1, got " + count + ")");
    }
  });
});
