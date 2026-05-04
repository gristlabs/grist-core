import { ICustomWidget, matchWidget } from "app/common/CustomWidget";

import { assert } from "chai";

describe("CustomWidget", function() {
  // Helper to create a minimal widget for testing.
  function makeWidget(widgetId: string, opts?: {
    pluginId?: string,
    url?: string,
  }): ICustomWidget {
    return {
      widgetId,
      name: widgetId,
      url: opts?.url ?? `https://example.com/${widgetId}`,
      ...(opts?.pluginId ? { source: { pluginId: opts.pluginId, name: opts.pluginId } } : {}),
    };
  }

  it("should return undefined for an empty list", function() {
    assert.isUndefined(matchWidget([], { widgetId: "w1" }));
  });

  it("should return undefined when no widget has a matching widgetId", function() {
    const widgets = [makeWidget("w1"), makeWidget("w2")];
    assert.isUndefined(matchWidget(widgets, { widgetId: "w3" }));
  });

  it("should return an exact widgetId match", function() {
    const widgets = [makeWidget("w1"), makeWidget("w2")];
    const result = matchWidget(widgets, { widgetId: "w2" });
    assert.equal(result?.widgetId, "w2");
  });

  it("should prefer a bundled widget over a non-bundled one", function() {
    const external = makeWidget("calendar", { url: "https://external.com/calendar" });
    const bundled = makeWidget("calendar", { pluginId: "bundled/grist-bundled" });
    // Order should not matter — try both orderings.
    for (const widgets of [[external, bundled], [bundled, external]]) {
      const result = matchWidget(widgets, { widgetId: "calendar" });
      assert.exists(result?.source, "expected bundled widget to be selected");
      assert.equal(result?.source?.pluginId, "bundled/grist-bundled");
    }
  });

  it("should prefer an exact pluginId match over other bundled widgets", function() {
    const bundledA = makeWidget("w1", { pluginId: "plugin-a" });
    const bundledB = makeWidget("w1", { pluginId: "plugin-b" });
    for (const widgets of [[bundledA, bundledB], [bundledB, bundledA]]) {
      const result = matchWidget(widgets, { widgetId: "w1", pluginId: "plugin-b" });
      assert.equal(result?.source?.pluginId, "plugin-b");
    }
  });

  it("should fall back to a bundled widget when pluginId doesn't match any", function() {
    const external = makeWidget("w1");
    const bundled = makeWidget("w1", { pluginId: "some-plugin" });
    const result = matchWidget([external, bundled], {
      widgetId: "w1",
      pluginId: "nonexistent-plugin",
    });
    assert.equal(result?.source?.pluginId, "some-plugin");
  });

  it("should fall back to an external widget when no bundled version exists", function() {
    const external = makeWidget("w1", { url: "https://external.com/w1" });
    const result = matchWidget([external], { widgetId: "w1", pluginId: "some-plugin" });
    assert.equal(result?.widgetId, "w1");
    assert.isUndefined(result?.source);
  });
});
