const MomentLocalesPlugin = require('moment-locales-webpack-plugin');
const { ProvidePlugin } = require('webpack');
const path = require('path');

module.exports = {
  target: 'web',
  entry: {
    main: "app/client/app",
    errorPages: "app/client/errorMain",
    account: "app/client/accountMain",
    billing: "app/client/billingMain",
    activation: "app/client/activationMain",
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
      path.resolve('./node_modules')
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
};
