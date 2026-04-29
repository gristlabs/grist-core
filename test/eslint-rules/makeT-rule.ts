import { RuleTester } from "eslint";
import localRules from "eslint-rules/local-rules";

const ruleTester = new RuleTester();

// Throws error if the tests in ruleTester.run() do not pass
ruleTester.run(
  "makeT-filename", // rule name
  localRules.rules["makeT-filename"] as any, // rule code.
  {
    // 'valid' checks cases that should pass
    valid: [
      {
        name: "passes when makeT() is called with a scope corresponding to the filename",
        filename: "app/client/ui/App.ts",
        code: `const t = makeT("App");`,
      },
      {
        name: "passes when makeT() is assigned to a variable not named `t`",
        filename: "app/client/ui/Foo.ts",
        code: `const t = makeT("Foo"); const appT = makeT("App");`,
      },
    ],
    // 'invalid' checks cases that should not pass
    invalid: [
      {
        name: "fails when makeT() is called with a scope differing with the filename",
        filename: "app/client/ui/App.ts",
        code: `const t = makeT("Foo");`,
        output: `const t = makeT("App");`,
        errors: 1,
      },
    ],
  },
);

console.info("✅ makeT-rule: All tests passed!");
