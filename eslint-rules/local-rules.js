const path = require("path");

module.exports = {
  rules: {
    "makeT-filename": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Enforce that `makeT()` is called with the filename (without extension) as its first argument when its result is assigned to `t`",
        },
        fixable: "code",
        schema: [],
        messages: {
          mismatch:
            "makeT() argument '{{actual}}' does not match the filename '{{expected}}'",
        },
      },
      create(context) {
        const filename = context.filename;
        const expected = path.basename(filename, path.extname(filename));

        return {
          CallExpression(node) {
            if (
              node.callee.type === "Identifier" &&
              node.callee.name === "makeT" &&
              node.parent.type === "VariableDeclarator" &&
              node.parent.id.name === "t" &&
              node.arguments.length === 1 &&
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
                *fix(fixer) {
                  yield fixer.replaceText(node.arguments[0], `"${expected}"`);
                }
              });
            }
          },
        };
      },
    },
  },
};
