import path from "path";

import type { StorybookConfig } from "@storybook/html-webpack5";

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

  webpackFinal: async (config, { configDir }) => {
    // Reuse Grist's module resolution: allows imports like 'app/client/...'.
    // grist-core's root is the parent of this .storybook dir; deriving it from configDir
    // (not cwd) keeps it correct wherever the command is run from.
    // 'node_modules' (unresolved) lets webpack walk up to find the right one.
    const coreRoot = path.resolve(configDir, "..");
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
        target: "es2020",
      },
      exclude: /node_modules/,
    });

    return config;
  },
};

export default config;
