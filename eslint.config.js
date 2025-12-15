const globals = require("globals");

const babelParser = require("@babel/eslint-parser");
const { defineConfig, globalIgnores } = require("eslint/config");
const js = require("@eslint/js");
const { importX } = require("eslint-plugin-import-x");
const stylistic = require("@stylistic/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");

const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

module.exports = defineConfig([{
  extends: compat.extends("eslint:recommended"),

  plugins: {
    "@stylistic": stylistic
  },

  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.mocha,
    },

    parser: babelParser,
    ecmaVersion: 2018,

    parserOptions: {
      requireConfigFile: false,
    },
  },

  rules: {
    "no-prototype-builtins": "off",
    "no-unused-vars": ["error", {
      args: "none",
      caughtErrors: "none"
    }],

    "@stylistic/comma-spacing": "warn",
    "@stylistic/indent": ["error", 2],
    "@stylistic/no-trailing-spaces": "warn",
    "@stylistic/quotes": ["error", "double", {"avoidEscape": true, "allowTemplateLiterals": "always"}],
    "@stylistic/semi-spacing": "warn",
  },
}, globalIgnores(["static/**/*.js", "**/*-ti.ts"]), {
  files: ["**/*.ts"],

  extends: compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
  ),

  languageOptions: {
    parser: tsParser,
    sourceType: "module",
    ecmaVersion: 2018,

    parserOptions: {
      tsconfigRootDir: __dirname,
      project: ["./tsconfig.eslint.json"],
    },

    globals: {
      ...globals.node,
      ...globals.browser,
      ...globals.mocha,
      Promise: true,
    },
  },

  plugins: {
    "@typescript-eslint": typescriptEslint,
    "@stylistic": stylistic,
    "@import-x": importX
  },

  rules: {
    "curly": ["warn", "all"],
    "no-console": "off",
    "no-inner-declarations": "off",
    "no-prototype-builtins": "off",
    "no-restricted-imports": ["error", {
      "patterns": [{
        "group": ["./", "../"],
        "message": "Relative imports are not allowed",
      }],
    }],
    "no-shadow": "off",
    "no-undef": "off",
    "no-unused-expressions": ["error", {
      allowShortCircuit: true,
      allowTernary: true,
    }],
    "prefer-rest-params": "off",


    "@import-x/order": [
      "error",
      {
        "newlines-between": "always",
        "groups": [
          [ "internal", "index" ],
          "builtin",
          "external",
          "type"
        ],
        "named": {"enabled": true, "import": true, "export": false},
        "alphabetize": {
          "order": "asc",
          "caseInsensitive": true,
        },
      }
    ],

    "@stylistic/block-spacing": ["warn", "always"],
    "@stylistic/comma-spacing": "warn",
    "@stylistic/function-call-spacing": "error",
    "@stylistic/indent": ["error", 2],
    "@stylistic/keyword-spacing": "error",
    "@stylistic/max-len": ["warn", {
      code: 120,
      ignoreUrls: true,
      ignoreRegExpLiterals: true,
      ignoreTemplateLiterals: true
    }],
    "@stylistic/no-trailing-spaces": "warn",
    "@stylistic/no-whitespace-before-property": "error",
    "@stylistic/quotes": ["error", "double", {
      "avoidEscape": true,
      "allowTemplateLiterals": "always"
    }],
    "@stylistic/semi": ["error", "always"],
    "@stylistic/semi-spacing": "warn",
    "@stylistic/space-infix-ops": "error",
    "@stylistic/spaced-comment": "error",
    "@stylistic/switch-colon-spacing": "error",
    "@stylistic/type-annotation-spacing": "warn",

    "@typescript-eslint/ban-types": "off",
    "@typescript-eslint/explicit-member-accessibility": ["error", {
      overrides: {
        constructors: "off",
      },
    }],
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/member-ordering": ["warn", {
      default: [
        "public-static-field",
        "public-static-method",
        "protected-static-field",
        "private-static-field",
        "static-field",
        "protected-static-method",
        "private-static-method",
        "static-method",
        "public-field",
        "protected-field",
        "private-field",
        "field",
        "public-constructor",
        "protected-constructor",
        "private-constructor",
        "constructor",
        "public-method",
        "protected-method",
        "private-method",
        "method",
      ],
    }],
    "@typescript-eslint/naming-convention": ["warn", {
      selector: "memberLike",

      filter: {
        match: false,
        regex: "(listenTo)",
      },

      modifiers: ["private"],
      format: ["camelCase"],
      leadingUnderscore: "require",
    }],
    "@typescript-eslint/no-empty-function": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-inferrable-types": "off",
    "@typescript-eslint/no-misused-promises": ["error", {
      "checksVoidReturn": false,
    }],
    "@typescript-eslint/no-namespace": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-this-alias": "off",
    "@typescript-eslint/no-type-alias": ["warn", {
      "allowAliases": "always",
      "allowCallbacks": "always",
      "allowConditionalTypes": "always",
      "allowConstructors": "always",
      "allowLiterals": "in-unions-and-intersections",
      "allowMappedTypes": "always",
      "allowTupleTypes": "always",
      "allowGenerics": "always",
    }],
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unused-vars": ["error", {
      "vars": "all",
      "args": "none",
      "ignoreRestSiblings": false,
      "caughtErrors": "none"
    }],
    "@typescript-eslint/no-var-requires": "off",
    "@typescript-eslint/prefer-regexp-exec": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/restrict-plus-operands": "off",
    "@typescript-eslint/restrict-template-expressions": "off",
    "@typescript-eslint/unbound-method": "off",

    // FIXME: The below set of rules should be activated at some points
    "@typescript-eslint/no-unsafe-function-type": "off",
    "@typescript-eslint/no-base-to-string": "off",
    "@typescript-eslint/no-unsafe-enum-comparison": "off",
  },
}, globalIgnores([
  "*",
  "!app",
  "!test",
  "!plugins",
  "!buildtools",
  "!stubs",
  "!eslint.config.js",
  "plugins/**/dist",
])]);
