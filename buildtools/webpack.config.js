const fs = require('fs');
const MomentLocalesPlugin = require('moment-locales-webpack-plugin');
const { ProvidePlugin } = require('webpack');
const path = require('path');

// Get path to top-level node_modules if in a yarn workspace.
// Otherwise node_modules one level up won't get resolved.
// This is used in Electron packaging.
const base = path.dirname(path.dirname(require.resolve('grainjs/package.json')));

module.exports = {
  target: 'web',
  entry: {
    main: "app/client/app",
    errorPages: "app/client/errorMain",
    apiconsole: "app/client/apiconsole",
    boot: "app/client/boot",
    billing: "app/client/billingMain",
    form: "app/client/formMain",
    // Include client test harness if it is present (it won't be in
    // docker image).
    ...(fs.existsSync("test/client-harness/client.js") ? {
      test: "test/client-harness/client",
    } : {}),
  },
  output: {
    filename: "[name].bundle.js",
    sourceMapFilename: "[file].map",
    path: path.resolve("./static"),
    // Workaround for a known issue with webpack + onerror under chrome, see:
    //   https://github.com/webpack/webpack/issues/5681
    // "We use a source map plugin here with this special configuration
    // because if we do not - the window.onerror function does not work properly in chrome
    // and it swallows the errors because normally source maps have begin with webpack:///
    // here we are changing how the module file names are created
    // See this bug
    // https://bugs.chromium.org/p/chromium/issues/detail?id=765909
    //  See this for syntax
    // https://webpack.js.org/configuration/output/#output-devtoolmodulefilenametemplate
    // "
    devtoolModuleFilenameTemplate: "[resourcePath]?[loaders]",
    crossOriginLoading: "anonymous",
  },
  // This creates .map files, and takes webpack a couple of seconds to rebuild while developing,
  // but provides correct mapping back to typescript, and allows breakpoints to be set in
  // typescript ("cheap-module-eval-source-map" is faster, but breakpoints are largely broken).
  devtool: "source-map",
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
      { test: /\.js$/,
        use: ["source-map-loader"],
        enforce: "pre"
      }
    ]
  },
  plugins: [
    // Some modules assume presence of Buffer and process.
    new ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    }),
    // To strip all locales except “en”
    new MomentLocalesPlugin()
  ],
  externals: {
    // for test bundle: jsdom should not be touched within browser
    jsdom: 'alert',
    // for test bundle: jquery will be available as jQuery
    jquery: 'jQuery'
  },
};
