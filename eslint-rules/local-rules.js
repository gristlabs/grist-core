const path = require("path");

module.exports = {
  rules: {
    "makeT-filename": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Enforce that makeT() is called with the filename (without extension) as its first argument",
        },
        schema: [],
        messages: {
          mismatch:
            "makeT() argument '{{actual}}' does not match the filename '{{expected}}'",
        },
      },
      create(context) {
        const filename = context.filename ?? context.getFilename();
        const expected = path.basename(filename, path.extname(filename));

        return {
          CallExpression(node) {
            if (
              node.callee.type === "Identifier" &&
              node.callee.name === "makeT" &&
              node.arguments.length > 0 &&
              node.arguments[0].type === "Literal" &&
              typeof node.arguments[0].value === "string" &&
              node.arguments[0].value !== expected
            ) {
              context.report({
                node: node.arguments[0],
                messageId: "mismatch",
                data: {
                  actual: node.arguments[0].value,
                  expected,
                },
              });
            }
          },
        };
      },
    },
  },
};
