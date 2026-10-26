import { ACLRuleCollection, getAclFacts, ReadAclOptions } from "app/common/ACLRuleCollection";
import { DocAction } from "app/common/DocActions";
import { DocData } from "app/common/DocData";
import { editorsBypassRules } from "app/common/DocUsage";
import { isMetadataTable } from "app/common/isHiddenTable";
import { compilePredicateFormula } from "app/common/PredicateFormula";
import { ActiveDoc } from "app/server/lib/ActiveDoc";
import { makeExceptionalDocSession } from "app/server/lib/DocSession";
import { createDocTools } from "test/server/docTools";

import { assert } from "chai";

const TRUE_PARSED = { aclFormula: "True", aclFormulaParsed: '["Const", true]' };

describe("ACLRuleCollection", function() {
  this.timeout(10000);

  const docTools = createDocTools({ persistAcrossCases: true });
  const fakeSession = makeExceptionalDocSession("system");

  let activeDoc: ActiveDoc;
  let docData: DocData;

  before(async function() {
    activeDoc = await docTools.createDoc("ACLRuleCollection");
    docData = activeDoc.docData!;
    await activeDoc.applyUserActions(fakeSession, [
      ["AddTable", "Orders", [{ id: "Amount" }, { id: "Stage" }]],
      ["AddTable", "Team", [{ id: "Email" }, { id: "Role" }]],
      ["AddRecord", "_grist_ACLResources", -1, { tableId: "*", colIds: "*" }],
    ]);
  });

  // Applies set of actions to a copy of the metadata and reads the rules from it.
  async function rulesAfter(actions: DocAction[], options: ReadAclOptions) {
    const copy = new DocData(
      (tableId) => { throw new Error(`Unexpected DocData fetch: ${tableId}`); },
      Object.fromEntries([...docData.getTables()]
        .filter(([tableId]) => isMetadataTable(tableId))
        .map(([tableId, table]) => [tableId, table.getTableDataAction()])),
    );
    for (const action of actions) {
      copy.receiveAction(action);
    }
    const rules = new ACLRuleCollection();
    await rules.update(copy, options);
    return { copy, rules };
  }

  // Applies set of actions to a copy of the metadata and returns what the rules report.
  async function messagesFor(actions: DocAction[], strict?: boolean): Promise<string[]> {
    const { copy, rules } = await rulesAfter(actions, { compile: compilePredicateFormula });
    return [
      ...(rules.ruleError ? [rules.ruleError.message] : []),
      ...rules.findRuleProblems(copy, { strict }).map(p => p.comment),
    ];
  }

  function defaultResourceId(): number {
    const resources = docData.getMetaTable("_grist_ACLResources");
    return resources.getRowIds().find(id => resources.getValue(id, "tableId") === "*")!;
  }

  let lastId = 0;
  const nextId = () => ++lastId;

  beforeEach(function() {
    lastId = 1000;
  });

  function rulesFor(
    resource: { tableId: string, colIds: string },
    ...rules: Record<string, unknown>[]
  ): DocAction[] {
    const resourceId = nextId();
    return [
      ["AddRecord", "_grist_ACLResources", resourceId, resource],
      ...rules.map((fields, i): DocAction =>
        ["AddRecord", "_grist_ACLRules", nextId(),
          { resource: resourceId, rulePos: i + 1, ...fields }]),
    ];
  }

  describe("findRuleProblems", function() {
    it("accepts rules that name existing tables and columns", async function() {
      assert.deepEqual(await messagesFor(rulesFor(
        { tableId: "Orders", colIds: "Amount" },
        {
          aclFormula: "user.Access != OWNER",
          aclFormulaParsed: JSON.stringify(
            ["NotEq", ["Attr", ["Name", "user"], "Access"], ["Name", "OWNER"]]),
          permissionsText: "-R",
        },
      )), []);
    });

    it("reports rules for a table that does not exist", async function() {
      const messages = await messagesFor(rulesFor(
        { tableId: "Nonexistent", colIds: "*" }, { permissionsText: "-R" }));
      assert.deepEqual(messages, ["Invalid tables in rules: Nonexistent"]);
    });

    it("reports rules for a column that does not exist", async function() {
      const messages = await messagesFor(rulesFor(
        { tableId: "Orders", colIds: "Nonexistent" }, { permissionsText: "-R" }));
      assert.deepEqual(messages, ["Invalid columns in rules for table Orders: Nonexistent"]);
    });

    it("reports rules it cannot assemble at all", async function() {
      // A rule that points to a missing resource cannot be read, so the collection falls
      // back to the emergency rules and reports the failure in ruleError.
      const messages = await messagesFor([
        ["AddRecord", "_grist_ACLRules", 200, { resource: 999, permissionsText: "-R", rulePos: 1 }],
      ]);
      assert.deepEqual(messages, ["ACLRule 200 refers to an invalid ACLResource 999"]);
    });

    it("reports formulas that use an unknown variable", async function() {
      const messages = await messagesFor([
        ["AddRecord", "_grist_ACLRules", 200, {
          resource: defaultResourceId(),
          aclFormula: "fuser.Access != OWNER",
          aclFormulaParsed: JSON.stringify(["Attr", ["Name", "fuser"], "Access"]),
          permissionsText: "-R",
          rulePos: 1,
        }],
      ]);
      assert.deepEqual(messages, ["Unknown variable 'fuser'"]);
    });
  });

  describe("strict mode", function() {
    async function assertStrictOnly(actions: DocAction[], expected: string) {
      assert.deepEqual(await messagesFor(actions), [], "should be accepted without strict");
      const strictMessages = await messagesFor(actions, true);
      assert.isTrue(
        strictMessages.some(m => m.includes(expected)),
        `expected a message containing ${JSON.stringify(expected)}, got ` +
        JSON.stringify(strictMessages));
    }

    it("reports user attributes that shadow a built-in one", async function() {
      await assertStrictOnly([
        ["AddRecord", "_grist_ACLRules", 200, {
          resource: defaultResourceId(),
          rulePos: 1,
          userAttributes: JSON.stringify(
            { name: "Access", tableId: "Team", lookupColId: "Email", charId: "Email" }),
        }],
      ], "conflict with built-in");
    });

    it("reports a column listed twice in one rule set", async function() {
      await assertStrictOnly(rulesFor(
        { tableId: "Orders", colIds: "Amount,Amount" }, { permissionsText: "-R" }),
      "Duplicate columns in rules");
    });

    it("reports permission bits that the resource silently drops", async function() {
      await assertStrictOnly(rulesFor(
        { tableId: "Orders", colIds: "Amount" }, { permissionsText: "+CRUD" }),
      "but only +RU applies here");
    });

    it("reports permission bits that make no sense for a special rule", async function() {
      await assertStrictOnly(rulesFor(
        { tableId: "*SPECIAL", colIds: "DocCopies" }, { permissionsText: "+S" }),
      "do not apply to it");
    });

    it("reports rules that share a rulePos", async function() {
      // Both rules need their own condition: a rule with an empty formula is the default
      // one, and nothing can come after it.
      const condition = (name: string) => ({
        aclFormula: `user.Access == ${name}`,
        aclFormulaParsed: JSON.stringify(
          ["Eq", ["Attr", ["Name", "user"], "Access"], ["Name", name]]),
      });
      await assertStrictOnly([
        ["AddRecord", "_grist_ACLRules", 200, {
          resource: defaultResourceId(), permissionsText: "-R", rulePos: 5, ...condition("EDITOR"),
        }],
        ["AddRecord", "_grist_ACLRules", 201, {
          resource: defaultResourceId(), permissionsText: "+R", rulePos: 5, ...condition("VIEWER"),
        }],
      ], "share the same rulePos");
    });

    it("accepts a set of correct rules", async function() {
      // Checks if happy path works, and rulePos can be shared between resources.
      assert.deepEqual(await messagesFor([
        ...rulesFor(
          { tableId: "Orders", colIds: "Amount" },
          { ...TRUE_PARSED, permissionsText: "-U" },
          { permissionsText: "+R" },
        ),
        ...rulesFor(
          { tableId: "Orders", colIds: "*" },
          { ...TRUE_PARSED, permissionsText: "-D" },
          { permissionsText: "+R" },
        ),
        ...rulesFor(
          { tableId: "*SPECIAL", colIds: "SchemaEdit" },
          { ...TRUE_PARSED, permissionsText: "+S" },
          { permissionsText: "-S" },
        ),
      ], true), []);
    });

    it("reports a column that has rules in two resources", async function() {
      assert.deepEqual(await messagesFor([
        ...rulesFor({ tableId: "Orders", colIds: "Amount" }, { permissionsText: "-U" }),
        ...rulesFor({ tableId: "Orders", colIds: "Amount,Stage" }, { permissionsText: "-U" }),
      ], true), ["Duplicate rule set for Orders:Amount"]);
    });

    it("reports user attributes named like a field or method of User", async function() {
      const attribute = (id: number, name: string): DocAction =>
        ["AddRecord", "_grist_ACLRules", id, {
          resource: defaultResourceId(),
          rulePos: id,
          userAttributes: JSON.stringify(
            { name, tableId: "Team", lookupColId: "Email", charId: "Email" }),
        }];
      assert.deepEqual(await messagesFor([
        attribute(201, "IsLoggedIn"),
        attribute(202, "toJSON"),
        attribute(203, "Member"),
      ], true), ["User attributes conflict with built-in ones: IsLoggedIn, toJSON"]);
    });

    it("accepts none and all for limited resources", async function() {
      for (const permissionsText of ["none", "all"]) {
        assert.deepEqual(await messagesFor([
          ...rulesFor({ tableId: "Orders", colIds: "*" }, { permissionsText }),
          ...rulesFor({ tableId: "Orders", colIds: "Amount" }, { permissionsText }),
        ], true), [], permissionsText);
      }
    });
  });

  describe("editorsBypassRules", function() {
    async function bypassFor(actions: DocAction[]): Promise<boolean> {
      const { rules } = await rulesAfter(actions, { pullOutSchemaEdit: true });
      assert.isUndefined(rules.ruleError);
      return editorsBypassRules(getAclFacts(rules));
    }

    // Only the text of a formula matters here, so any parsed formula will do.
    const rule = (aclFormula: string, permissionsText: string) =>
      ({ aclFormula, aclFormulaParsed: TRUE_PARSED.aclFormulaParsed, permissionsText });

    function defaultRule(id: number, fields: Record<string, unknown>): DocAction {
      return ["AddRecord", "_grist_ACLRules", id, { resource: defaultResourceId(), rulePos: id, ...fields }];
    }

    const limitEditors = () => rulesFor({ tableId: "Orders", colIds: "*" }, rule("user.Access == EDITOR", "-R"));

    it("is false without rules", async function() {
      assert.isFalse(await bypassFor([]));
    });

    it("is true when rules deny data and editors can edit structure", async function() {
      assert.isTrue(await bypassFor(limitEditors()));
      assert.isTrue(await bypassFor(rulesFor({ tableId: "Orders", colIds: "Amount" },
        rule("user.Access == EDITOR", "-U"))));
      assert.isTrue(await bypassFor([defaultRule(202, rule("user.Access != OWNER", "-D"))]));
    });

    it("is false when editors cannot edit structure", async function() {
      assert.isFalse(await bypassFor([
        ...limitEditors(),
        defaultRule(201, rule("user.Access != OWNER", "-S")),
      ]));
      // One default rule can limit both data and structure.
      assert.isFalse(await bypassFor([defaultRule(201, rule("user.Access != OWNER", "-RS"))]));
    });

    it("is true with the explicit rule letting editors edit structure", async function() {
      assert.isTrue(await bypassFor([
        ...limitEditors(),
        defaultRule(201, rule("user.Access == EDITOR", "+S")),
      ]));
    });

    it("is false when rules only allow", async function() {
      assert.isFalse(await bypassFor(rulesFor({ tableId: "Orders", colIds: "*" },
        rule("user.Access in [OWNER]", "+CRUD"))));
    });

    it("is false when structure rules are custom", async function() {
      // The structure checkbox is disabled in this case, and shows no warning.
      assert.isFalse(await bypassFor([
        defaultRule(202, rule("user.Email == 'x@example.com'", "-DS")),
      ]));
    });
  });
});
