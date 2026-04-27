import path from "path";

import type { StorybookConfig } from "@storybook/html-webpack5";

// Root of grist-core (whether standalone or as core/ inside grist-saas).
// `yarn run storybook` sets cwd to the package root. Using process.cwd()
// instead of __dirname so this works under Node 23+'s ESM loader too.
const coreRoot = process.cwd();

const config: StorybookConfig = {
  stories: [
    "../storybook/**/*.stories.ts",
  ],
  framework: {
    name: "@storybook/html-webpack5",
    options: {},
  },
  addons: [
    "@storybook/addon-essentials",
  ],

  webpackFinal: async (config) => {
    // Reuse Grist's module resolution: allows imports like 'app/client/...'
    // In grist-core standalone, coreRoot is the repo root.
    // In grist-saas, coreRoot is the core/ subdirectory.
    // 'node_modules' (unresolved) lets webpack walk up to find the right one.
    config.resolve = config.resolve || {};
    config.resolve.extensions = [".ts", ".js", ...(config.resolve.extensions || [])];
    config.resolve.modules = [
      coreRoot,
      path.join(coreRoot, "stubs"),
      "node_modules",
    ];

    // Use esbuild-loader for TypeScript (same as Grist's build)
    config.module = config.module || {};
    config.module.rules = config.module.rules || [];
    config.module.rules.push({
      test: /\.ts$/,
      loader: "esbuild-loader",
      options: {
        loader: "ts",
        target: "es2017",
      },
      exclude: /node_modules/,
    });

    return config;
  },
};

export default config;
