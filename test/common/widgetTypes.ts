import {
  isLegacyCalendarCustomDef,
  LEGACY_CALENDAR_WIDGET_ID,
  LEGACY_CALENDAR_WIDGET_URL,
} from "app/common/widgetTypes";

import { assert } from "chai";

describe("widgetTypes", function() {
  describe("isLegacyCalendarCustomDef", function() {
    it("matches the bundled copy referenced by widgetId", function() {
      assert.isTrue(isLegacyCalendarCustomDef({ widgetId: LEGACY_CALENDAR_WIDGET_ID, url: null }));
      // The bundled copy's URL varied per deployment, so it must not be required.
      assert.isTrue(isLegacyCalendarCustomDef({
        widgetId: LEGACY_CALENDAR_WIDGET_ID,
        url: "http://localhost:8484/widgets/bundled/grist-bundled/calendar/index.html",
      }));
    });

    it("matches the gallery copy referenced by URL", function() {
      assert.isTrue(isLegacyCalendarCustomDef({ widgetId: null, url: LEGACY_CALENDAR_WIDGET_URL }));
    });

    it("does not match other custom widgets", function() {
      assert.isFalse(isLegacyCalendarCustomDef({ widgetId: "@gristlabs/widget-map", url: null }));
      assert.isFalse(isLegacyCalendarCustomDef({
        widgetId: null,
        url: "https://gristlabs.github.io/grist-widget/map/index.html",
      }));
      assert.isFalse(isLegacyCalendarCustomDef({ widgetId: null, url: null }));
      assert.isFalse(isLegacyCalendarCustomDef(null));
      assert.isFalse(isLegacyCalendarCustomDef(undefined));
    });
  });
});
