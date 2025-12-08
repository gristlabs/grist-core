const {
  defineConfig,
  globalIgnores,
} = require("eslint/config");

const globals = require("globals");
const babelParser = require("@babel/eslint-parser");
const tsParser = require("@typescript-eslint/parser");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const stylistic = require("@stylistic/eslint-plugin");
const js = require("@eslint/js");

const {
  FlatCompat,
} = require("@eslint/eslintrc");

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
    "no-unused-vars": ["error", {
      args: "none",
      caughtErrors: "none"
    }],

    "no-prototype-builtins": "off",
    "@stylistic/no-trailing-spaces": "warn",
    "@stylistic/comma-spacing": "warn",
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
      "@stylistic": stylistic
    },

    rules: {
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

      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
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
      "@stylistic/type-annotation-spacing": "warn",
      "@typescript-eslint/unbound-method": "off",
      "no-undef": "off",
      "no-prototype-builtins": "off",
      "prefer-rest-params": "off",
      "no-console": "off",
      "no-shadow": "off",
      "no-inner-declarations": "off",

      "@stylistic/max-len": ["warn", {
        code: 120,
        ignoreUrls: true,
        ignoreRegExpLiterals: true,
        ignoreTemplateLiterals: true
      }],

      "sort-imports": ["warn", {
        ignoreDeclarationSort: true,
        ignoreCase: true,
        allowSeparatedGroups: true,
      }],

      "no-restricted-imports": ["error", {
        "patterns": [{
          "group": ["./", "../"],
          "message": "Relative imports are not allowed",
        }],
      }],

      "@stylistic/no-trailing-spaces": "warn",

      "no-unused-expressions": ["error", {
        allowShortCircuit: true,
        allowTernary: true,
      }],

      "@stylistic/block-spacing": ["warn", "always"],
      "@stylistic/comma-spacing": "warn",
      "curly": ["warn", "all"],
      "@stylistic/semi": ["warn", "always"],
      "@stylistic/semi-spacing": "warn",

    },
  }, globalIgnores([
    "*",
    "!app",
    "!test",
    "!plugins",
    "!buildtools",
    "!stubs",
    "!.eslintrc.js",
    "plugins/**/dist",
  ])]);
