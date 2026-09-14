import { isEventOnLink } from "app/client/lib/domUtils";

import { assert } from "chai";
import { JSDOM } from "jsdom";

describe("domUtils", function() {
  describe("isEventOnLink", function() {
    const doc = new JSDOM(`<div><a href="#">x</a></div>`).window.document;
    const cell = doc.querySelector("div")!;
    const link = doc.querySelector("a")!;
    let savedDocument: Document;

    // JSDOM has no layout, so stand in for elementFromPoint. The link is under every point, and
    // as on Firefox, the coordinates must be numbers.
    doc.elementFromPoint = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) { throw new TypeError("not a finite value"); }
      return link;
    };

    beforeEach(function() {
      savedDocument = globalThis.document;
      globalThis.document = doc;
    });

    afterEach(function() {
      globalThis.document = savedDocument;
    });

    // Only the fields isEventOnLink reads. Real events can't be given a target without dispatching.
    function pointerEvent(props: Partial<MouseEvent>) {
      return props as Event;
    }

    it("should look under the pointer for a double click", function() {
      assert.isTrue(isEventOnLink(pointerEvent({ type: "dblclick", target: cell, clientX: 5, clientY: 5 })));
    });

    it("should go by the target alone for a double tap", function() {
      // A touchend has no coordinates. Looking them up used to throw on Firefox.
      assert.isTrue(isEventOnLink(pointerEvent({ type: "touchend", target: link })));
      assert.isFalse(isEventOnLink(pointerEvent({ type: "touchend", target: cell })));
    });
  });
});
