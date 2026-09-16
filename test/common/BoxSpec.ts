import { validateBoxSpec } from "app/common/BoxSpec";

import { assert } from "chai";

describe("BoxSpec", function() {
  describe("validateBoxSpec", function() {
    const rejects = (spec: unknown, message: RegExp) =>
      assert.throws(() => validateBoxSpec(spec), message);

    it("accepts a tree of leaves and containers", function() {
      validateBoxSpec({ children: [{ leaf: 1 }, { leaf: 2 }] });
      validateBoxSpec({ children: [{ children: [{ leaf: 1 }, { leaf: 2 }] }, { leaf: 3 }] });
    });

    // Only the root may hold nothing; which leaves belong is up to the caller.
    it("accepts an empty root", function() {
      validateBoxSpec({ children: [] });
    });

    it("accepts sizes on leaves and containers", function() {
      validateBoxSpec({ children: [{ leaf: 1, size: 200 }, { children: [{ leaf: 2 }], size: 50 }] });
    });

    it("rejects a box that is not an object", function() {
      rejects(null, /Every box must be an object/);
      rejects([{ leaf: 1 }], /Every box must be an object/);
      rejects({ children: [{ leaf: 1 }, "x"] }, /Every box must be an object/);
    });

    it("rejects a key that is not part of a box", function() {
      rejects({ children: [{ leaf: 1, bogus: "x" }] }, /A box takes only leaf, size, children; got bogus/);
    });

    it("rejects a box that is neither leaf nor container", function() {
      rejects({ children: [{ leaf: 1 }, {}] }, /needs either leaf or children/);
      rejects({ children: [{ leaf: 1, children: [{ leaf: 2 }] }] }, /either leaf or children, not both/);
    });

    it("rejects children that are not an array", function() {
      rejects({ children: { leaf: 1 } }, /"children" must be an array of boxes/);
    });

    it("rejects a leaf id that is not an integer", function() {
      rejects({ children: [{ leaf: "1" }] }, /"leaf" must be an id \(an integer\), got "1"/);
      rejects({ children: [{ leaf: 1.5 }] }, /"leaf" must be an id \(an integer\)/);
    });

    it("rejects a size that is not a positive number", function() {
      rejects({ children: [{ leaf: 1, size: 0 }] }, /size must be a positive number/);
      rejects({ children: [{ leaf: 1, size: -5 }] }, /size must be a positive number/);
    });

    it("accepts collapsed on the root only", function() {
      validateBoxSpec({ children: [{ leaf: 1 }], collapsed: [{ leaf: 2 }] });
      rejects({ children: [{ leaf: 1, collapsed: [{ leaf: 2 }] }] }, /A box takes only leaf, size, children/);
    });

    it("rejects a malformed collapsed list", function() {
      rejects({ children: [{ leaf: 1 }], collapsed: { leaf: 2 } }, /"collapsed" must be an array/);
      rejects({ children: [{ leaf: 1 }], collapsed: [2] }, /Each collapsed entry must be/);
      rejects({ children: [{ leaf: 1 }], collapsed: [{ children: [] }] }, /Each collapsed entry must be/);
    });
  });
});
