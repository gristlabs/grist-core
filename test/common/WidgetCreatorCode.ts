import { parseWidgetError, readCustomWidgetBuilderOptions } from "app/common/WidgetCreatorCode";

import { assert } from "chai";

describe("WidgetCreatorCode", function() {
  it("reads a Custom Widget Builder widget as one file, and its own options without the code", function() {
    assert.deepEqual(readCustomWidgetBuilderOptions(null), { code: "", widgetOptions: null });
    assert.deepEqual(readCustomWidgetBuilderOptions({ other: 1 }), { code: "", widgetOptions: { other: 1 } });
    assert.deepEqual(readCustomWidgetBuilderOptions({ _html: "<head></head>", _js: "go();", other: 1 }), {
      code: '<head><script src="grist-plugin-api.js"></script></head>\n<script>\ngo();\n</script>\n',
      widgetOptions: { other: 1 },
    });
    assert.equal(readCustomWidgetBuilderOptions({ _html: "<p>hi</p>" }).widgetOptions, null);

    const readCustomWidgetBuilderCode = (options: Record<string, any>) => readCustomWidgetBuilderOptions(options).code;

    // The builder loads the plugin API when its HTML does not, so the file loads it, also without _js.
    const API = '<script src="grist-plugin-api.js"></script>';
    assert.equal(readCustomWidgetBuilderCode({ _html: "<p>hi</p>" }), `${API}<p>hi</p>`);
    assert.equal(readCustomWidgetBuilderCode({ _html: "<body><p>hi</p></body>", _js: "go();" }),
      `${API}<body><p>hi</p><script>\ngo();\n</script>\n</body>`);
    assert.equal(readCustomWidgetBuilderCode({ _html: "<p>hi</p>", _js: "go();" }),
      `${API}<p>hi</p>\n<script>\ngo();\n</script>\n`);
    assert.equal(readCustomWidgetBuilderCode({ _html: "<head></head><p>hi</p>", _js: "go();" }),
      `<head>${API}</head><p>hi</p>\n<script>\ngo();\n</script>\n`);
    // An HTML that loads the plugin API itself gets no second copy.
    assert.equal(readCustomWidgetBuilderCode({ _html: `${API}<p>hi</p>`, _js: "go();" }),
      `${API}<p>hi</p>\n<script>\ngo();\n</script>\n`);

    // Any address of the plugin API changes to the one Grist serves.
    assert.equal(readCustomWidgetBuilderCode({
      _html: '<script src="/grist-plugin-api.js"></script><p>hi</p>',
    }), `${API}<p>hi</p>`);
    assert.equal(readCustomWidgetBuilderCode({
      _html: '<script src="https://grist.example.com/static/grist-plugin-api.js"></script><p>hi</p>',
    }), `${API}<p>hi</p>`);
    assert.equal(readCustomWidgetBuilderCode({
      _html: '<script src="https://docs.getgrist.com/grist-plugin-api.js"></script><p>hi</p>',
    }), `${API}<p>hi</p>`);
    assert.equal(readCustomWidgetBuilderCode({
      _html: "<script src='https://docs.getgrist.com/grist-plugin-api.js'></script><p>hi</p>",
    }), "<script src='grist-plugin-api.js'></script><p>hi</p>");
  });

  it("reads the errors the widget posts", function() {
    assert.deepEqual(parseWidgetError({ error: { message: "boom", line: 3 } }),
      { message: "boom", line: 3, stack: undefined });
    assert.isNull(parseWidgetError({ mtype: 1 }));
    assert.isNull(parseWidgetError(null));
  });
});
