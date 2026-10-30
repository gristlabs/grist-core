import { parseButtonDefinitions } from "app/client/widgets/ButtonParser";
import * as gristTypes from "app/common/gristTypes";
import { CellValue, GristObjCode } from "app/plugin/GristData";

import { assert } from "chai";
import { describe, it } from "mocha";

describe("ButtonWidget", function() {
  it("parses formula-generated button definitions and preserves encoded action values", function() {
    const value: CellValue = [
      GristObjCode.List,
      [GristObjCode.Dict, {
        button: "Create",
        actions: [
          GristObjCode.List,
          [
            GristObjCode.List,
            "AddRecord",
            "People",
            null,
            {
              Name: "Ada",
              Labels: [GristObjCode.List, "admin", "author"],
            },
          ],
        ],
      }],
      [GristObjCode.Dict, {
        button: "Remove",
        actions: [
          GristObjCode.List,
          [GristObjCode.List, "RemoveRecord", "People", 7],
        ],
      }],
    ];

    assert.isTrue(Boolean(gristTypes.isRightType("Button")?.(value)));
    assert.deepEqual(parseButtonDefinitions(value), [{
      label: "Create",
      actions: [[
        "AddRecord",
        "People",
        null,
        {
          Name: "Ada",
          Labels: [GristObjCode.List, "admin", "author"],
        },
      ]],
    }, {
      label: "Remove",
      actions: [["RemoveRecord", "People", 7]],
    }]);
  });

  it("parses button definitions represented as plain Python lists and dictionaries", function() {
    const value = [{
      button: "Create",
      actions: [
        ["AddRecord", "People", null, { Name: "Ada" }],
        ["UpdateRecord", "People", 7, { Active: true }],
      ],
    }] as unknown as CellValue;

    assert.deepEqual(parseButtonDefinitions(value), [{
      label: "Create",
      actions: [
        ["AddRecord", "People", null, { Name: "Ada" }],
        ["UpdateRecord", "People", 7, { Active: true }],
      ],
    }]);
  });

  it("rejects malformed formula results", function() {
    assert.deepEqual(parseButtonDefinitions(""), []);
    assert.isNull(parseButtonDefinitions("not a list"));
    assert.isNull(parseButtonDefinitions([
      GristObjCode.List,
      [GristObjCode.Dict, { button: "Missing actions" }],
    ]));
    assert.isFalse(Boolean(gristTypes.isRightType("Button")?.("plain value")));
    assert.isFalse(Boolean(gristTypes.isRightType("Button")?.([
      GristObjCode.List,
      [GristObjCode.Dict, {
        button: "Invalid",
        actions: [GristObjCode.List, [GristObjCode.List, 42]],
      }],
    ])));
  });
});
