const path = require('path');

// Get path to top-level node_modules if in a yarn workspace.
// Otherwise node_modules one level up won't get resolved.
// This is used in Electron packaging.
const base = path.dirname(path.dirname(require.resolve('grainjs/package.json')));

module.exports = {
  target: 'web',
  entry: {
    "grist-plugin-api": "app/plugin/grist-plugin-api",
  },
  output: {
    sourceMapFilename: "[file].map",
    path: path.resolve("./static"),
    library: "grist"
  },
  devtool: "source-map",
  node: false,
  resolve: {
    extensions: ['.ts', '.js'],
    modules: [
      path.resolve('.'),
      path.resolve('./ext'),
      path.resolve('./stubs'),
      path.resolve('./node_modules'),
      base,
    ],
    fallback: {
      'path': require.resolve("path-browserify"),
    },
  },
  optimization: {
    minimize: false, // keep class names in code
  },
  module: {
    rules: [
      {
        test: /\.(js|ts)?$/,
        loader: 'esbuild-loader',
        options: {
          loader: 'ts',
          target: 'es2017',
          sourcemap: true,
        },
        exclude: /node_modules/
      },
    ]
  }
};
