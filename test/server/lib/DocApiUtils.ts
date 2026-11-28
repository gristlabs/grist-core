import { ApiError } from "app/common/ApiError";
import { getFormulasParameter } from "app/server/lib/DocApiUtils";

import { assert } from "chai";
import { Request } from "express";

describe("DocApiUtils", function() {
  describe("getFormulasParameter", function() {
    const request = (formulas?: unknown) => ({ query: { formulas } }) as unknown as Request;

    it("returns undefined when no formulas are requested", function() {
      assert.isUndefined(getFormulasParameter(request()));
    });

    it("parses a JSON object mapping names to formula strings", function() {
      const formulas = { fullName: "$Person.Name", total: "$Price * $Qty" };
      assert.deepEqual(getFormulasParameter(request(JSON.stringify(formulas))), formulas);
    });

    it("rejects malformed JSON", function() {
      assert.throws(() => getFormulasParameter(request("not json")), ApiError);
    });

    it("rejects values that are not objects or contain non-string formulas", function() {
      for (const formulas of ["null", "[]", '"text"', "1", '{"computed": 1}']) {
        assert.throws(() => getFormulasParameter(request(formulas)), ApiError);
      }
    });

    it("rejects a non-string query parameter", function() {
      assert.throws(() => getFormulasParameter(request(["{}"])), ApiError);
    });
  });
});
